import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { env } from '../../config/env';
import { TenantContext } from '../../database/tenant';
import { AuditService } from '../../audit/audit.service';
import { ConversationsService } from '../../conversations/conversations.service';
import { EventsService } from '../../realtime/events.service';
import { RbacService } from '../../rbac/rbac.service';
import { UsageService } from '../../usage/usage.service';
import { CacheService } from '../../jobs/cache.service';
import { AgentConfigService } from '../agent-config.service';
import type { Attachment } from '../attachments';
import { LLMFactory } from '../llm/llm.factory';
import type { ChatMessage, LLMResponse, TurnHints } from '../llm/llm-provider';
import { estimateCostMicroUsd } from '../llm/pricing';
import { MemoryService } from '../memory/memory.service';
import { classify, type Classification } from '../policy/intent-classifier';
import { evaluatePolicy } from '../policy/policy-engine';
import { validateResponse } from '../policy/response-validator';
import { detectLanguage } from '../policy/text';
import type { ToolContext } from '../tools/tool';
import { ToolRegistry, type ToolResult } from '../tools/tool-registry';
import { buildSystemPrompt } from './prompt-builder';
import { resolveAppointmentChoice, resolveSlotChoice, type ShownAppointment, type ShownSlots } from '../conversation/choice-resolver';
import { deriveJourney, journeyGuidance, type Journey } from '../conversation/journey';
import { norm } from '../policy/text';
import { DateTime } from 'luxon';
import { PrivacyService } from '../../privacy/privacy.service';
import { BillingLifecycleService } from '../../billing/billing-lifecycle.service';
import { EngagementService } from '../../engagement/engagement.service';
import { NotificationsService } from '../../notifications/notifications.service';

/** Channels where a member of staff (playground) or an authenticated patient (portal, consent at sign-up) is chatting. */
const CONSENT_EXEMPT_CHANNELS = new Set(['PLAYGROUND', 'PORTAL']);
const AFFIRM_RE = /^(si|sí|yes|ok|okay|acepto|de acuerdo|claro|dale|i accept|accept|agree|i agree|1)\b/;
const DENY_RE = /^(no|no acepto|rechazo|i do not|i don't|decline|2)\b/;

export type TurnEvent =
  | { type: 'status'; stage: 'thinking' | 'policy' | 'llm' | 'validating' }
  | { type: 'tool'; name: string; phase: 'start' | 'end'; status?: string; latencyMs?: number }
  | { type: 'policy'; mode: string; reasons: string[] };

export interface TurnInput {
  conversationId: string;
  text: string;
  action?: Record<string, unknown> | null;
  /** Live progress for streaming clients (tool calls, model steps). Never contains secrets. */
  onEvent?: (e: TurnEvent) => void;
}

export interface TraceStep {
  type: 'llm' | 'tool' | 'policy' | 'validation';
  name: string;
  status: string;
  latencyMs: number;
  detail?: Record<string, unknown>;
}

export interface TurnTrace {
  requestId: string;
  language: 'es' | 'en';
  intent: string;
  category: string;
  confidence: number;
  entities: Record<string, unknown>;
  policy: { mode: string; reasons: string[]; forcedTool: string | null };
  retrieved: { title: string; score: number; excerpt: string }[];
  steps: TraceStep[];
  provider: string;
  model: string;
  providerFallback: boolean;
  tokens: { input: number; output: number };
  costUsd: number;
  llmLatencyMs: number;
  totalLatencyMs: number;
  violations: string[];
  errors: string[];
}

export interface TurnResult {
  conversationId: string;
  userMessage: { id: string; content: string; createdAt: Date };
  assistantMessage: { id: string; role: 'ASSISTANT'; content: string; attachments: Attachment[]; feedback: null; createdAt: Date } | null;
  conversationStatus: string;
  journey: Journey | null;
  trace: TurnTrace;
}

const WRITE_TOOLS = new Set(['confirmAttendance', 'addToWaitlist', 'createAppointment', 'cancelAppointment', 'rescheduleAppointment', 'createPatient', 'createLead', 'createSupportTicket', 'sendAppointmentReminder']);
const INFO_TOOLS = new Set(['getServices', 'getServiceInformation', 'getBusinessHours', 'getClinicLocations', 'getClinicInformation', 'getDoctors', 'getDoctorProfile', 'getAvailableAppointmentSlots', 'getDoctorAvailability', 'listPatientAppointments']);

/**
 * AI Orchestration Layer.
 * User → Conversation → Intent/Context → Policy Engine → (LLM ⇄ Tool selection/execution/validation)*
 * → Response validation → Audit/Usage → User.
 * Provider-agnostic: the loop works identically with OpenAI, Anthropic, Gemini or the local mock.
 */
@Injectable()
export class OrchestratorService {
  private readonly logger = new Logger(OrchestratorService.name);

  constructor(
    private readonly conversations: ConversationsService,
    private readonly config: AgentConfigService,
    private readonly memory: MemoryService,
    private readonly tools: ToolRegistry,
    private readonly llm: LLMFactory,
    private readonly usage: UsageService,
    private readonly audit: AuditService,
    private readonly events: EventsService,
    private readonly rbac: RbacService,
    private readonly cache: CacheService,
    private readonly privacy: PrivacyService,
    private readonly lifecycle: BillingLifecycleService,
    private readonly engagement: EngagementService,
    private readonly notifications: NotificationsService,
  ) {}

  async handleTurn(input: TurnInput): Promise<TurnResult> {
    const t0 = Date.now();
    const requestId = randomUUID();
    const conv = await this.conversations.getRaw(input.conversationId);
    const [agent, clinic, catalog] = await Promise.all([this.config.get(), this.config.clinic(), this.config.catalog()]);
    const metadata = { ...(conv.metadata as Record<string, unknown>) };
    const language = detectLanguage(input.text, (conv.language as 'es' | 'en') ?? 'es');
    const now = new Date();

    const emit = (e: TurnEvent) => {
      try {
        input.onEvent?.(e);
      } catch {
        /* a disconnected stream must never break the turn */
      }
    };
    emit({ type: 'status', stage: 'thinking' });

    // Data-processing consent answer ("acepto" / "no", or the consent card buttons).
    let consentReply: 'yes' | 'no' | null = null;
    if (metadata.consentPending) {
      const a = input.action as Record<string, unknown> | null | undefined;
      if (a?.type === 'give_consent') consentReply = a.granted === 'yes' ? 'yes' : 'no';
      else if (!input.action && norm(input.text).split(/\s+/).length <= 5) consentReply = AFFIRM_RE.test(norm(input.text)) ? 'yes' : DENY_RE.test(norm(input.text)) ? 'no' : null;
      if (!consentReply) delete metadata.consentPending; // the patient moved on to something else
    }
    if (consentReply) input = { ...input, action: null };

    // 0) Free-text answers to the cards shown last turn ("el viernes a las 8", "sí", "la segunda").
    const typed = input.action || consentReply ? null : this.resolveTypedChoice(input.text, metadata, agent.bookingRules.requireConfirmation, language, clinic.timezone);
    let action: Record<string, unknown> | null = input.action ?? typed?.action ?? null;
    const direct: { content: string; attachments: Attachment[] } | null = typed?.direct ?? null;
    if (!typed || typed.consumedConfirm) delete metadata.pendingConfirm;
    if (typed?.pendingConfirm) metadata.pendingConfirm = typed.pendingConfirm;
    if (input.action) delete metadata.pendingConfirm;

    // 1) Intent + entities (deterministic, explainable).
    const classification: Classification = action
      ? { intent: 'action', category: 'APPOINTMENT', confidence: 1, entities: {}, flags: { medicalMention: false, complaint: false, wantsHuman: false, emergency: false } } as unknown as Classification
      : classify(input.text, catalog, clinic.timezone, now);

    // Multi-turn identification: merge partial identity (name / phone) across turns while an operation is pending.
    if (metadata.pending && !conv.patientId && !action) {
      const e = classification.entities;
      // "Laura Gómez", "Laura Gómez 3015550199", "Laura Gómez, laura@x.co" → name (+ contact parsed separately).
      const nameOnly = input.text.replace(/[+(]?\d[\d\s().-]{6,}\d/g, ' ').replace(/\S+@\S+/g, ' ').replace(/[,;]/g, ' ').replace(/\s+/g, ' ').trim();
      const bareName = nameOnly.match(/^([\p{Lu}][\p{L}'-]+)((?:\s+[\p{Lu}][\p{L}'-]+){1,3})$/u);
      if (bareName && !e.firstName) {
        e.firstName = bareName[1];
        e.lastName = bareName[2].trim();
      }
      const partial = { ...((metadata.partialIdentity as Record<string, string>) ?? {}) };
      for (const k of ['firstName', 'lastName', 'phone', 'email'] as const) if (e[k]) partial[k] = e[k] as string;
      Object.assign(e, partial);
      metadata.partialIdentity = partial;
      if (partial.phone || partial.firstName) {
        classification.intent = 'identify';
        classification.category = 'ADMINISTRATIVE';
      }
    }

    // Booking refinements ("otro día", "por la tarde", "más opciones") keep the specialty/doctor already chosen.
    const prevJourney = (metadata.journey as Journey | undefined) ?? null;
    const bookingCtx = (metadata.bookingContext as Record<string, string> | undefined) ?? {};
    if (typed) {
      // The message was understood as a choice on the cards shown last turn.
      classification.intent = action ? classification.intent : 'select_option';
      classification.confidence = 1;
    }
    if (!action && !direct && prevJourney?.flow === 'booking' && ['need', 'time'].includes(prevJourney.step)) {
      const e = classification.entities as Record<string, unknown>;
      const t = norm(input.text);
      const moreOptions = /(otro dia|otros dias|otra fecha|otras fechas|otros horarios|mas opciones|mas tarde|mas temprano|otra semana|other (day|days|date|times)|more options|later|earlier|another (day|time))/.test(t);
      const refining = Boolean(e.timeOfDay || e.dateFrom || moreOptions);
      if (refining && ['unknown', 'general_question', 'deny', 'affirm', 'book_appointment', 'check_availability', 'reschedule_appointment', 'small_talk'].includes(classification.intent)) {
        classification.intent = 'book_appointment';
        classification.category = 'APPOINTMENT';
        classification.confidence = 0.85;
        for (const k of ['specialtyId', 'specialtyName', 'doctorId', 'doctorName', 'serviceId']) if (!e[k] && bookingCtx[k]) e[k] = bookingCtx[k];
        const shown = metadata.lastSlots as ShownSlots | undefined;
        if (!e.dateFrom && moreOptions && shown?.slots.length) {
          const lastDay = DateTime.fromISO(shown.slots[shown.slots.length - 1].start, { zone: clinic.timezone }).startOf('day').plus({ days: 1 });
          e.dateFrom = lastDay.toISO();
          e.dateTo = lastDay.plus({ days: 7 }).toISO();
        }
      }
    }
    // Elliptical follow-ups ("¿y para un electrocardiograma?", "and on Saturdays?") keep the previous informational intent.
    const INFO_INTENTS = ['preparation', 'pricing', 'hours', 'location', 'services_info', 'doctor_info', 'billing', 'general_question'];
    const followUp = !action && !direct && /^[¿¡\s"']*(y|e|and|what about|how about|tambien|also)\b/.test(norm(input.text));
    const weakIntent = ['unknown', 'general_question'].includes(classification.intent) || (classification.intent === 'book_appointment' && !/(cita|agend|reserv|turno|appointment|book|schedule)/.test(norm(input.text)));
    if (followUp && weakIntent && INFO_INTENTS.includes(String(metadata.lastIntent))) {
      classification.intent = metadata.lastIntent as Classification['intent'];
      classification.category = 'GENERAL_INFORMATION';
    }
    // Follow-ups inherit the subject of the previous question ("¿y cuánto cuesta?" → same service).
    const ENTITY_KEYS = ['serviceId', 'serviceName', 'specialtyId', 'specialtyName', 'doctorId', 'doctorName'] as const;
    const ents = classification.entities as Record<string, unknown>;
    const lastEnts = (metadata.lastEntities as Record<string, string> | undefined) ?? {};
    if (followUp && INFO_INTENTS.includes(classification.intent) && !ENTITY_KEYS.some((k) => ents[k])) for (const k of ENTITY_KEYS) if (lastEnts[k]) ents[k] = lastEnts[k];
    if (ENTITY_KEYS.some((k) => ents[k])) metadata.lastEntities = Object.fromEntries(ENTITY_KEYS.filter((k) => ents[k]).map((k) => [k, ents[k]]));
    metadata.lastIntent = classification.intent;
    if (classification.intent === 'preparation' && !(classification.entities as Record<string, unknown>).specialtyName && metadata.lastBooked) {
      // "¿Cómo me preparo?" right after booking refers to that appointment.
      Object.assign(classification.entities, { specialtyName: (metadata.lastBooked as Record<string, string>).specialty });
    }
    if (classification.intent === 'join_waitlist') {
      const e = classification.entities as Record<string, unknown>;
      for (const k of ['specialtyId', 'specialtyName', 'doctorId', 'doctorName', 'serviceId']) if (!e[k] && bookingCtx[k]) e[k] = bookingCtx[k];
    }
    if (['book_appointment', 'check_availability'].includes(classification.intent)) {
      const e = classification.entities as Record<string, string | undefined>;
      const ctx: Record<string, string> = { ...bookingCtx };
      for (const k of ['specialtyId', 'specialtyName', 'doctorId', 'doctorName', 'serviceId']) if (e[k]) ctx[k] = e[k]!;
      if (e.specialtyId && e.specialtyId !== bookingCtx.specialtyId && !e.doctorId) delete ctx.doctorId;
      metadata.bookingContext = ctx;
    }

    const userMessage = await this.conversations.addMessage(conv.id, {
      role: 'USER',
      content: input.text,
      action: (action as Record<string, string>) ?? null,
      intent: classification.intent,
      category: classification.category,
      language,
    });
    const convPatch: Record<string, unknown> = { language };
    if (!conv.subject && !['greeting', 'action', 'unknown', 'thanks', 'small_talk', 'affirm', 'deny', 'select_option', 'capabilities'].includes(classification.intent)) convPatch.subject = input.text.slice(0, 120);

    const trace: TurnTrace = {
      requestId,
      language,
      intent: classification.intent,
      category: classification.category,
      confidence: classification.confidence,
      entities: classification.entities as Record<string, unknown>,
      policy: { mode: 'normal', reasons: [], forcedTool: null },
      retrieved: [],
      steps: [],
      provider: agent.provider,
      model: agent.model,
      providerFallback: false,
      tokens: { input: 0, output: 0 },
      costUsd: 0,
      llmLatencyMs: 0,
      totalLatencyMs: 0,
      violations: [],
      errors: [],
    };

    // Human is handling the conversation: AI stays silent.
    if (!conv.aiEnabled || conv.status === 'HANDOFF' || conv.status === 'CLOSED') {
      await this.conversations.patch(conv.id, convPatch);
      trace.policy = { mode: 'human_active', reasons: ['AI_PAUSED_FOR_HUMAN'], forcedTool: null };
      trace.totalLatencyMs = Date.now() - t0;
      return { conversationId: conv.id, userMessage, assistantMessage: null, conversationStatus: conv.status, journey: null, trace };
    }

    // 2) Policy engine (before any model call).
    const decision = evaluatePolicy(classification, input.text, agent.handoffRules, { failedTurns: Number(metadata.failedTurns ?? 0), lang: language });
    trace.policy = { mode: decision.mode, reasons: decision.reasons, forcedTool: decision.forcedTool };
    trace.steps.push({ type: 'policy', name: decision.mode, status: 'OK', latencyMs: 0, detail: { reasons: decision.reasons } });
    emit({ type: 'policy', mode: decision.mode, reasons: decision.reasons });
    if (decision.mode !== 'normal') {
      await this.audit.log({ action: 'ai.policy_escalation', entityType: 'Conversation', entityId: conv.id, patientId: conv.patientId, metadata: { mode: decision.mode, reasons: decision.reasons } });
    }

    let patientId = conv.patientId;
    const aiPerms = await this.rbac.permissionsFor('AI_AGENT');
    const ctx = TenantContext.current()!;
    const aiContext = () => ({
      ...ctx,
      principal: { kind: 'AI_AGENT' as const, id: null, name: agent.name, role: 'AI_AGENT', permissions: aiPerms, patientId },
    });
    const toolCtx: ToolContext = {
      conversationId: conv.id,
      clinicId: clinic.id,
      get patientId() {
        return patientId;
      },
      language,
      timezone: clinic.timezone,
      channel: conv.channel,
      agent,
      bindPatient: async (id: string) => {
        patientId = id;
        await this.conversations.patch(conv.id, { patientId: id });
      },
    };

    const executed: ToolResult[] = [];
    const attachments: Attachment[] = [];
    let content = '';

    const consentNeeded = () => !CONSENT_EXEMPT_CHANNELS.has(conv.channel) && !(metadata.consent as { granted?: boolean } | undefined)?.granted;
    let consentBlocked: Record<string, unknown> | null = null;
    const runTool = async (name: string, args: Record<string, unknown>, id = `call_${randomUUID()}`): Promise<ToolResult> => {
      if (name === 'createPatient' && consentNeeded()) {
        // Personal data is never stored from a chat before the person accepts the privacy notice.
        consentBlocked = args;
        const blocked = { id, name, args, status: 'DENIED', ok: false, output: null, error: { code: 'CONSENT_REQUIRED', message: 'The patient must accept the data-processing notice first', hint: 'The UI shows a consent card; wait for the answer.' }, attachments: [], latencyMs: 0 } as unknown as ToolResult;
        executed.push(blocked);
        trace.steps.push({ type: 'tool', name, status: 'DENIED', latencyMs: 0, detail: { reason: 'CONSENT_REQUIRED' } });
        return blocked;
      }
      emit({ type: 'tool', name, phase: 'start' });
      const r = await TenantContext.run(aiContext(), () => this.tools.execute({ id, name, arguments: args }, toolCtx));
      emit({ type: 'tool', name, phase: 'end', status: r.status, latencyMs: r.latencyMs });
      executed.push(r);
      attachments.push(...r.attachments);
      trace.steps.push({
        type: 'tool',
        name,
        status: r.status,
        latencyMs: r.latencyMs,
        detail: { args, result: r.ok ? summarizeOutput(r.output) : r.error },
      });
      if (name === 'searchClinicKnowledge' && r.ok) {
        const out = r.output as { results: { title: string; score: number; content: string }[] };
        trace.retrieved.push(...out.results.map((x) => ({ title: x.title, score: x.score, excerpt: x.content.slice(0, 200) })));
      }
      return r;
    };

    // Subscription inactive: patients get a polite message, no model call (emergencies still escalate).
    const serviceState = conv.channel === 'PLAYGROUND' ? { active: true } : await this.lifecycle.state(TenantContext.orgId());
    let deterministic: string | null = null;
    if (!serviceState.active && decision.mode !== 'emergency') {
      deterministic =
        language === 'en'
          ? `Our virtual assistant is not available right now. Please contact ${clinic.name}${clinic.phone ? ` at ${clinic.phone}` : ''}.`
          : `En este momento el asistente virtual no está disponible. Por favor comunícate con ${clinic.name}${clinic.phone ? ` al ${clinic.phone}` : ''}.`;
      trace.steps.push({ type: 'policy', name: 'subscription_inactive', status: 'BLOCKED', latencyMs: 0 });
    }

    if (!deterministic && consentReply) {
      const pendingArgs = metadata.consentPending as { args?: Record<string, unknown> } | undefined;
      delete metadata.consentPending;
      await this.privacy.record({ conversationId: conv.id, patientId: patientId ?? null, kind: 'DATA_PROCESSING', granted: consentReply === 'yes', channel: conv.channel });
      trace.steps.push({ type: 'policy', name: 'consent', status: consentReply === 'yes' ? 'GRANTED' : 'DECLINED', latencyMs: 0 });
      if (consentReply === 'no') {
        delete metadata.pending;
        delete metadata.partialIdentity;
        deterministic =
          language === 'en'
            ? `Understood — I won't store your details. Without that authorization I can't book through this chat, but you can call ${clinic.name}${clinic.phone ? ` at ${clinic.phone}` : ''}, and I'm still happy to answer questions about services, prices or hours. What would you like to know?`
            : `Entendido, no guardaré tus datos. Sin esa autorización no puedo agendar por este chat, pero puedes llamar a ${clinic.name}${clinic.phone ? ` al ${clinic.phone}` : ''}, y con gusto sigo respondiendo dudas sobre servicios, precios u horarios. ¿Qué te gustaría saber?`;
      } else {
        metadata.consent = { granted: true, at: new Date().toISOString() };
        if (pendingArgs?.args) {
          const r = await runTool('createPatient', pendingArgs.args);
          if (r.ok && patientId) await this.privacy.attachConversationConsent(conv.id, patientId);
        }
        const pending = metadata.pending as { type?: string; action?: Record<string, unknown>; intent?: string } | undefined;
        if (patientId && pending?.type === 'book_slot' && pending.action) {
          action = pending.action;
          classification.intent = 'action' as Classification['intent'];
        } else if (patientId && pending?.type === 'intent' && pending.intent) {
          classification.intent = pending.intent as Classification['intent'];
        } else if (!patientId) {
          classification.intent = 'identify';
        } else {
          const name = (await this.memory.longTerm(patientId))?.name?.split(' ')[0] ?? '';
          deterministic = language === 'en' ? `Thanks${name ? `, ${name}` : ''}! Your details are saved. How can I help you?` : `¡Gracias${name ? `, ${name}` : ''}! Ya guardé tus datos. ¿En qué te ayudo?`;
        }
      }
    }

    if (!deterministic && classification.intent === 'opt_out') {
      if (patientId) {
        await this.engagement.optOut(patientId);
        await this.privacy.record({ patientId, conversationId: conv.id, kind: 'MARKETING', granted: false, channel: conv.channel });
      }
      deterministic =
        language === 'en'
          ? "Done — you won't receive promotional messages from us anymore. You'll still get confirmations and reminders for your appointments. Anything else I can help with?"
          : 'Listo, ya no recibirás mensajes promocionales. Seguirás recibiendo las confirmaciones y recordatorios de tus citas. ¿Te ayudo con algo más?';
    }

    if (deterministic) {
      content = deterministic;
    } else if (direct && decision.mode === 'normal') {
      content = direct.content.replace(/\.\.(?!\.)/g, '.');
      attachments.push(...direct.attachments);
      trace.steps.push({ type: 'policy', name: 'typed_choice', status: 'OK', latencyMs: 0, detail: { understood: true } });
    } else if (decision.mode === 'emergency') {
      await runTool(decision.forcedTool!, decision.forcedArgs!);
      const selfHarm = /(suicid|quiero morir|me quiero matar|quitarme la vida|no quiero vivir|hacerme dano|kill myself|end my life|want to die|hurt myself)/.test(norm(input.text));
      content = selfHarm
        ? language === 'en'
          ? "I'm really sorry you're feeling this way, and I'm glad you wrote. You don't have to face this alone. If you might act on these thoughts, please call your local emergency number right now (e.g. 911) or a crisis line in your country. I've alerted our clinic team so a person can contact you. Is there someone you trust who can be with you now?"
          : 'Siento mucho que te sientas así y me alegra que lo hayas escrito. No tienes que pasar por esto solo/a. Si sientes que podrías hacerte daño, llama ahora mismo a la línea de emergencias de tu país (en Colombia 123 o la línea 106) o a una línea de crisis. Ya avisé a nuestro equipo para que una persona te contacte. ¿Hay alguien de confianza que pueda acompañarte ahora?'
        : language === 'en'
          ? '⚠️ What you describe may be a medical emergency. Please call your local emergency number right now (e.g. 911 in the US, 123 in Colombia) or go to the nearest emergency room. I have alerted our clinic team so a person can contact you. I cannot provide medical advice through this chat.'
          : '⚠️ Lo que describes podría ser una emergencia médica. Llama ahora mismo a la línea de emergencias de tu país (por ejemplo 123 en Colombia o 911) o acude al servicio de urgencias más cercano. Ya alerté a nuestro equipo para que una persona te contacte. No puedo dar indicaciones médicas por este chat.';
      attachments.unshift({ type: 'emergency' });
    } else {
      // 3) Agent loop: model ⇄ tools.
      let resolved = this.llm.resolve(agent.provider, agent.model);
      if (resolved.provider.name !== 'mock') {
        const budget = await this.lifecycle.aiBudget(TenantContext.orgId());
        if (budget.exceeded) {
          // Over the monthly AI budget: keep serving patients with the local engine instead of failing.
          resolved = { ...this.llm.resolve('mock', ''), fallback: true };
          trace.steps.push({ type: 'policy', name: 'ai_budget', status: 'FALLBACK', latencyMs: 0, detail: { capUsd: budget.capUsd, spentUsd: Math.round(budget.spentUsd * 100) / 100 } });
          await this.warnBudget(budget);
        }
      }
      trace.provider = resolved.provider.name;
      trace.model = resolved.model;
      trace.providerFallback = resolved.fallback;
      const longTerm = await this.memory.longTerm(patientId);
      const history = await this.memory.shortTerm(conv.id, userMessage.id);
      const turnMessages: ChatMessage[] = [
        ...history,
        { role: 'user', content: action ? `${input.text}\nACTION ${JSON.stringify(action)}` : input.text },
      ];
      const specs = await this.tools.specsFor(agent);
      const lastAssistant = [...history].reverse().find((m) => m.role === 'assistant');
      const maxIterations = env().AI_MAX_TOOL_ITERATIONS;

      for (let i = 0; i < maxIterations; i++) {
        const hints: TurnHints = {
          language,
          intent: classification.intent,
          category: classification.category,
          entities: classification.entities as Record<string, unknown>,
          patient: patientId ? { id: patientId, name: longTerm?.name ?? (await this.memory.longTerm(patientId))?.name ?? '' } : null,
          now: now.toISOString(),
          timezone: clinic.timezone,
          action: action ?? null,
          forcedTool: decision.forcedTool ? { name: decision.forcedTool, args: decision.forcedArgs ?? {} } : null,
          pending: (metadata.pending as Record<string, unknown>) ?? null,
          catalog: { specialties: catalog.specialties.map((s) => ({ id: s.id, name: s.name, nameEn: s.nameEn ?? null })) },
          clinicName: clinic.name,
          lastAssistantMessage: lastAssistant?.content ?? null,
          journey: prevJourney ? { flow: prevJourney.flow, step: prevJourney.step } : null,
        };
        const system = buildSystemPrompt({
          agent,
          clinic: { name: clinic.name, timezone: clinic.timezone, phone: clinic.phone, address: clinic.address },
          language,
          channel: conv.channel,
          patient: patientId ? { id: patientId, name: hints.patient!.name, facts: longTerm?.facts ?? [] } : null,
          intent: classification.intent,
          category: classification.category,
          entities: classification.entities as Record<string, unknown>,
          guardrails: [
            ...decision.guardrails,
            ...(decision.forcedTool ? [`You must call ${decision.forcedTool} now with arguments ${JSON.stringify(decision.forcedArgs)}.`] : []),
            ...(metadata.pending ? [`Pending operation waiting for patient identification: ${JSON.stringify(metadata.pending)}. Complete it once the patient is identified.`] : []),
          ],
          journey: journeyGuidance(prevJourney, language),
          now,
        });

        const llmStart = Date.now();
        emit({ type: 'status', stage: 'llm' });
        let res: LLMResponse;
        try {
          res = await resolved.provider.complete({ system, messages: turnMessages, tools: specs, model: resolved.model, temperature: agent.temperature, maxTokens: agent.maxTokens, hints });
        } catch (err) {
          const msg = (err as Error).message;
          this.logger.error(`LLM call failed (${resolved.provider.name}): ${msg}`);
          trace.errors.push(`LLM_ERROR: ${msg}`);
          trace.steps.push({ type: 'llm', name: resolved.provider.name, status: 'ERROR', latencyMs: Date.now() - llmStart });
          content =
            language === 'en'
              ? "I'm having trouble processing your request right now. I've let our team know — you can also call the clinic directly."
              : 'Estoy teniendo problemas para procesar tu solicitud en este momento. Ya avisé al equipo; también puedes llamar directamente a la clínica.';
          break;
        }
        const latency = Date.now() - llmStart;
        trace.llmLatencyMs += latency;
        trace.tokens.input += res.usage.inputTokens;
        trace.tokens.output += res.usage.outputTokens;
        const cost = estimateCostMicroUsd(resolved.model, res.usage.inputTokens, res.usage.outputTokens);
        trace.costUsd += cost / 1e6;
        trace.steps.push({
          type: 'llm',
          name: `${resolved.provider.name}:${resolved.model}`,
          status: 'OK',
          latencyMs: latency,
          detail: { tokensIn: res.usage.inputTokens, tokensOut: res.usage.outputTokens, toolCalls: res.toolCalls.map((c) => c.name), finishReason: res.finishReason },
        });
        this.events.emit('agent.step', { conversationId: conv.id, type: 'llm', name: resolved.provider.name, latencyMs: latency, toolCalls: res.toolCalls.map((c) => c.name) });
        await TenantContext.run(aiContext(), () =>
          this.usage.record({ kind: 'AI_COMPLETION', provider: resolved.provider.name, model: resolved.model, tokensIn: res.usage.inputTokens, tokensOut: res.usage.outputTokens, latencyMs: latency, costMicroUsd: cost, conversationId: conv.id }),
        );

        if (!res.toolCalls.length) {
          content = res.content.trim();
          break;
        }
        turnMessages.push({ role: 'assistant', content: res.content, toolCalls: res.toolCalls, raw: res.raw });
        for (const callSpec of res.toolCalls) {
          const r = await runTool(callSpec.name, callSpec.arguments, callSpec.id);
          turnMessages.push({ role: 'tool', toolCallId: callSpec.id, name: callSpec.name, content: JSON.stringify(r.ok ? { ok: true, data: r.output } : { ok: false, error: r.error }) });
        }
        if (i === maxIterations - 1) {
          trace.errors.push('MAX_TOOL_ITERATIONS');
          content = language === 'en' ? 'Let me connect you with our team to finish this request.' : 'Déjame comunicarte con nuestro equipo para terminar esta solicitud.';
        }
      }
      if (!content) content = language === 'en' ? 'How else can I help you?' : '¿En qué más te puedo ayudar?';
    }

    if (consentBlocked) {
      const notice = await this.privacy.consentText(language);
      metadata.consentPending = { args: consentBlocked };
      content = `${notice.text} ${language === 'en' ? 'Do you accept?' : '¿Aceptas?'}`;
      attachments.length = 0;
      attachments.push({
        type: 'consent',
        version: notice.version,
        privacyUrl: notice.privacyUrl,
        text: notice.text,
        acceptLabel: language === 'en' ? 'I accept' : 'Acepto',
        declineLabel: language === 'en' ? 'No, thanks' : 'No acepto',
      });
    }

    // 4) Response validation (independent of the model).
    emit({ type: 'status', stage: 'validating' });
    const validation = validateResponse(content, executed.map((e) => ({ name: e.name, ok: e.ok, output: e.output })), language);
    if (validation.violations.length) {
      trace.violations = validation.violations;
      trace.steps.push({ type: 'validation', name: 'response-validator', status: 'REWRITTEN', latencyMs: 0, detail: { violations: validation.violations } });
      content = validation.content;
    }

    // 5) Operational state: pending operations, failed-turn counter, outcome flags.
    const ok = (n: string) => executed.some((e) => e.name === n && e.ok);
    const kb = executed.find((e) => e.name === 'searchClinicKnowledge');
    const unanswered = Boolean(kb && kb.ok && !(kb.output as { found: boolean }).found && !executed.some((e) => e.ok && e.name !== 'searchClinicKnowledge'));
    const handedOff = ok('requestHumanHandoff');
    if (!patientId && action?.type === 'book_slot') metadata.pending = { type: 'book_slot', action };
    else if (!patientId && ['cancel_appointment', 'reschedule_appointment', 'my_appointments'].includes(classification.intent)) metadata.pending = { type: 'intent', intent: classification.intent };
    else if (patientId && metadata.pending && (ok('createAppointment') || ok('listPatientAppointments') || ok('createPatient'))) {
      delete metadata.pending;
      delete metadata.partialIdentity;
    }
    metadata.failedTurns = unanswered || classification.intent === 'unknown' ? Number(metadata.failedTurns ?? 0) + 1 : 0;

    // When real slots are on screen the doctor cards add nothing (each slot group already names the doctor).
    if (attachments.some((a) => a.type === 'slots')) {
      for (let i = attachments.length - 1; i >= 0; i--) if (attachments[i].type === 'doctors') attachments.splice(i, 1);
    }

    // Remember the options shown this turn so the patient can answer in free text next turn.
    const slotsCard = attachments.find((a): a is Extract<Attachment, { type: 'slots' }> => a.type === 'slots');
    const apptsCard = attachments.find((a): a is Extract<Attachment, { type: 'appointments' }> => a.type === 'appointments');
    if (slotsCard) {
      metadata.lastSlots = {
        mode: slotsCard.mode,
        appointmentId: slotsCard.appointmentId ?? null,
        serviceId: slotsCard.serviceId ?? null,
        timezone: slotsCard.timezone,
        slots: slotsCard.groups.flatMap((g) => g.slots.map((x) => ({ doctorId: g.doctorId, doctorName: g.doctorName, start: x.start, day: x.day, time: x.time }))).slice(0, 40),
      } satisfies ShownSlots;
      metadata.lastSlotsCard = slotsCard;
      delete metadata.lastAppointments;
      delete metadata.lastAppointmentsCard;
    } else if (apptsCard && apptsCard.purpose !== 'list') {
      metadata.lastAppointmentsCard = apptsCard;
      metadata.lastAppointments = { purpose: apptsCard.purpose, items: apptsCard.items.map((i) => ({ id: i.id, doctorId: i.doctorId, doctorName: i.doctorName, specialty: i.specialty, start: i.start, when: i.when })) };
      delete metadata.lastSlots;
      delete metadata.lastSlotsCard;
    }
    if (ok('createAppointment') || ok('rescheduleAppointment') || ok('cancelAppointment')) {
      delete metadata.lastSlots;
      delete metadata.lastSlotsCard;
      delete metadata.lastAppointments;
      delete metadata.lastAppointmentsCard;
      delete metadata.pendingConfirm;
      if (ok('createAppointment')) {
        delete metadata.bookingContext;
        const booked = executed.find((e) => e.name === 'createAppointment' && e.ok)?.output as { appointment?: { specialty?: string | null; doctorName?: string; when?: string } } | undefined;
        if (booked?.appointment) metadata.lastBooked = { specialty: booked.appointment.specialty ?? null, doctorName: booked.appointment.doctorName, when: booked.appointment.when };
      }
    }

    const journey = handedOff
      ? null
      : deriveJourney({
          previous: prevJourney,
          intent: classification.intent,
          okTools: new Set(executed.filter((e) => e.ok).map((e) => e.name)),
          slotsMode: slotsCard?.mode ?? null,
          appointmentsPurpose: apptsCard?.purpose ?? null,
          pendingConfirm: (metadata.pendingConfirm as { type: string } | undefined) ?? null,
          waitingIdentification: Boolean(metadata.pending && (metadata.pending as { type?: string }).type === 'book_slot' && !patientId),
          identified: Boolean(patientId),
        });
    if (journey) metadata.journey = journey;
    else delete metadata.journey;

    const resolvedByAi = !handedOff && (executed.some((e) => e.ok && (WRITE_TOOLS.has(e.name) || INFO_TOOLS.has(e.name))) || Boolean(kb?.ok && (kb.output as { found: boolean }).found));
    if (!metadata.metered) {
      metadata.metered = true;
      await TenantContext.run(aiContext(), () => this.usage.record({ kind: 'AI_CONVERSATION', provider: trace.provider, conversationId: conv.id }));
    }
    if (!attachments.some((a) => a.type === 'suggestions' || a.type === 'consent')) attachments.push(...this.suggestions(classification, executed, language, catalog.specialties, handedOff, unanswered, Boolean(patientId), journey));

    trace.totalLatencyMs = Date.now() - t0;
    const assistantMessage = await this.conversations.addMessage(conv.id, {
      role: 'ASSISTANT',
      content,
      attachments,
      intent: classification.intent,
      category: classification.category,
      language,
      unanswered,
      trace: trace as unknown as Record<string, unknown>,
      tokensIn: trace.tokens.input,
      tokensOut: trace.tokens.output,
      latencyMs: trace.totalLatencyMs,
    });
    const latest = await this.conversations.getRaw(conv.id);
    await this.conversations.patch(conv.id, {
      ...convPatch,
      metadata,
      ...(resolvedByAi ? { resolvedByAi: true } : {}),
      ...(handedOff ? { resolvedByAi: false } : {}),
    });
    await this.cache.del(`analytics:${TenantContext.orgId()}:*`);

    return {
      conversationId: conv.id,
      userMessage,
      assistantMessage: { id: assistantMessage.id, role: 'ASSISTANT' as const, content, attachments, feedback: null, createdAt: assistantMessage.createdAt },
      conversationStatus: latest.status,
      journey,
      trace,
    };
  }

  /** One staff alert per org per month when the AI budget cap is reached. */
  private async warnBudget(budget: { capUsd: number | null; spentUsd: number }) {
    const month = new Date().toISOString().slice(0, 7);
    const key = `billing:aibudget-warned:${TenantContext.orgId()}:${month}`;
    if (await this.cache.get(key)) return;
    await this.cache.set(key, true, 32 * 86_400);
    await this.audit.log({ action: 'billing.ai_budget_reached', entityType: 'Organization', metadata: budget });
    await this.notifications.notifyStaff(
      'SYSTEM_ALERT',
      { message: `Se alcanzó el presupuesto mensual de IA (US$${budget.capUsd}). Alejandro AI sigue atendiendo con el motor local hasta el próximo mes o hasta que mejores el plan.` },
      { billing: true },
      { roleKeys: ['CLINIC_ADMIN'] },
    );
  }

  /**
   * Maps a free-text answer onto the options shown in the previous turn. Booking and cancelling
   * always go through an explicit confirmation (card or "sí"), so a misread sentence never books.
   */
  private resolveTypedChoice(
    text: string,
    metadata: Record<string, unknown>,
    requireConfirmation: boolean,
    lang: 'es' | 'en',
    timezone: string,
  ): { action?: Record<string, unknown>; direct?: { content: string; attachments: Attachment[] }; pendingConfirm?: Record<string, unknown>; consumedConfirm?: boolean } | null {
    const es = lang !== 'en';
    const t = norm(text);
    const short = t.split(/\s+/).length <= 6;
    const AFFIRM = /^(si|sí|claro|dale|ok|okay|vale|listo|por favor|yes|yep|yeah|sure|please|de acuerdo|perfecto|confirmo|confirmar|correcto|exacto|hazlo|adelante|go ahead|confirm)\b/;
    const DENY = /^(no|nop|nope|mejor no|todavia no|aun no|not yet|no thanks|no gracias|prefiero otro|otro horario|elegir otro)\b/;
    const pending = metadata.pendingConfirm as Record<string, unknown> | undefined;
    const slotsCard = metadata.lastSlotsCard as Extract<Attachment, { type: 'slots' }> | undefined;

    if (pending && short && AFFIRM.test(t)) return { action: pending, consumedConfirm: true };
    if (pending && short && DENY.test(t)) {
      if (pending.type === 'confirm_cancel')
        return { consumedConfirm: true, direct: { content: es ? 'Perfecto, tu cita sigue igual. ¿Te ayudo con algo más?' : "Great, your appointment stays as it is. Anything else I can help with?", attachments: [] } };
      return {
        consumedConfirm: true,
        direct: {
          content: es ? 'Sin problema, no reservé nada. Elige otro horario o dime qué día u hora te queda mejor.' : "No problem, nothing was booked. Pick another time or tell me which day or time works better.",
          attachments: slotsCard ? [slotsCard] : [],
        },
      };
    }

    const confirmCard = (title: string, body: string, act: Record<string, unknown>, confirmLabel: string, cancelLabel: string, cancelMessage: string): Attachment => ({
      type: 'confirm',
      title,
      body,
      action: act as Record<string, string | number | null>,
      confirmLabel,
      cancelLabel,
      cancelMessage,
    });

    const shown = metadata.lastSlots as ShownSlots | undefined;
    if (shown) {
      const r = resolveSlotChoice(text, shown);
      if (r && 'match' in r) {
        const slot = r.match;
        const act: Record<string, unknown> =
          shown.mode === 'reschedule'
            ? { type: 'reschedule_to', appointmentId: shown.appointmentId ?? null, startTime: slot.start, doctorId: slot.doctorId }
            : { type: 'book_slot', doctorId: slot.doctorId, startTime: slot.start, serviceId: shown.serviceId ?? null };
        if (!requireConfirmation) return { action: act };
        const when = `${slot.day} · ${slot.time}`;
        const q =
          shown.mode === 'reschedule'
            ? es ? `Perfecto. ¿Muevo tu cita al ${slot.day} a las ${slot.time} con ${slot.doctorName}?` : `Great. Shall I move your appointment to ${slot.day} at ${slot.time} with ${slot.doctorName}?`
            : es ? `Perfecto. ¿Te reservo el ${slot.day} a las ${slot.time} con ${slot.doctorName}?` : `Great. Shall I book ${slot.day} at ${slot.time} with ${slot.doctorName} for you?`;
        return {
          pendingConfirm: act,
          direct: {
            content: q,
            attachments: [
              confirmCard(
                es ? (shown.mode === 'reschedule' ? 'Nuevo horario' : 'Reservar este horario') : shown.mode === 'reschedule' ? 'New time' : 'Book this time',
                `${when} — ${slot.doctorName}`,
                act,
                es ? 'Sí, confirmar' : 'Yes, confirm',
                es ? 'Elegir otro' : 'Pick another',
                es ? 'No, prefiero otro horario' : 'No, I prefer another time',
              ),
            ],
          },
        };
      }
      if (r && 'ambiguous' in r && slotsCard) {
        const keep = new Set(r.ambiguous.map((x) => x.start));
        const filtered = { ...slotsCard, groups: slotsCard.groups.map((g) => ({ ...g, slots: g.slots.filter((x) => keep.has(x.start)) })).filter((g) => g.slots.length) };
        const list = r.ambiguous.map((x) => x.time).join(es ? ' o ' : ' or ');
        return { direct: { content: es ? `Ese día tengo varias opciones: ${list}. ¿Cuál prefieres?` : `That day I have several options: ${list}. Which one do you prefer?`, attachments: [filtered] } };
      }
    }

    const appts = metadata.lastAppointments as { purpose: 'cancel' | 'reschedule'; items: ShownAppointment[] } | undefined;
    if (appts) {
      const r = resolveAppointmentChoice(text, appts.items, timezone);
      if (r && 'ambiguous' in r) {
        const list = r.ambiguous.map((a) => a.when).join(es ? ' o ' : ' or ');
        const card = metadata.lastAppointmentsCard as Extract<Attachment, { type: 'appointments' }> | undefined;
        const keep = new Set(r.ambiguous.map((a) => a.id));
        return {
          direct: {
            content: es ? `Tienes ${r.ambiguous.length} citas que coinciden: ${list}. ¿Cuál de ellas?` : `You have ${r.ambiguous.length} matching appointments: ${list}. Which one?`,
            attachments: card ? [{ ...card, items: card.items.filter((i) => keep.has(i.id)) }] : [],
          },
        };
      }
      if (r && 'match' in r) {
        const a = r.match;
        if (appts.purpose === 'reschedule') return { action: { type: 'start_reschedule', appointmentId: a.id, doctorId: a.doctorId } };
        const act = { type: 'confirm_cancel', appointmentId: a.id };
        if (/(cancel|^(si|sí|yes|confirmo|dale)\b)/.test(t)) return { action: act };
        return {
          pendingConfirm: act,
          direct: {
            content: es ? `¿Confirmas que cancelo tu cita del ${a.when} con ${a.doctorName}?` : `Do you confirm I should cancel your appointment on ${a.when} with ${a.doctorName}?`,
            attachments: [confirmCard(es ? 'Cancelar cita' : 'Cancel appointment', `${a.when} — ${a.doctorName}`, act, es ? 'Sí, cancelar' : 'Yes, cancel', es ? 'No, mantenerla' : 'No, keep it', es ? 'No, mejor la mantengo' : "No, I'll keep it")],
          },
        };
      }
    }
    return null;
  }

  /** Quick replies computed from the turn outcome (localized, clickable in the chat UI). */
  private suggestions(
    c: Classification,
    executed: ToolResult[],
    lang: 'es' | 'en',
    specialties: { name: string; nameEn?: string | null }[],
    handedOff: boolean,
    unanswered: boolean,
    identified: boolean,
    journey: Journey | null = null,
  ): Attachment[] {
    const es = lang === 'es';
    const s = (label: string, message = label) => ({ label, message });
    let items: { label: string; message: string }[] = [];
    const booked = executed.some((e) => e.name === 'createAppointment' && e.ok);
    const step = journey ? `${journey.flow}:${journey.step}` : '';
    const menu = () => [
      s(es ? 'Agendar una cita' : 'Book an appointment'),
      ...(identified ? [s(es ? 'Ver mis citas' : 'View my appointments')] : []),
      s(es ? '¿Qué servicios ofrecen?' : 'What services do you offer?'),
      s(es ? 'Horarios y sedes' : 'Hours and locations', es ? '¿Cuál es el horario y dónde quedan?' : 'What are your hours and where are you?'),
      s(es ? 'Hablar con una persona' : 'Talk to a person'),
    ];
    if (handedOff || step.endsWith(':confirm')) return [];
    if (booked || step === 'booking:done')
      items = [s(es ? '¿Cómo me preparo?' : 'How do I prepare?', es ? '¿Cómo me preparo para la cita?' : 'How should I prepare for the appointment?'), s(es ? 'Ver mis citas' : 'View my appointments'), s(es ? 'Gracias' : 'Thanks')];
    else if (step === 'booking:time' || step === 'reschedule:time')
      items = [
        s(es ? 'Por la mañana' : 'Morning', es ? 'Prefiero por la mañana' : 'I prefer mornings'),
        s(es ? 'Por la tarde' : 'Afternoon', es ? 'Prefiero por la tarde' : 'I prefer afternoons'),
        s(es ? 'Otros días' : 'Other days', es ? 'Muéstrame otros días' : 'Show me other days'),
      ];
    else if (step === 'cancel:done') items = [s(es ? 'Agendar nueva cita' : 'Book a new appointment', es ? 'Quiero agendar una nueva cita' : 'I want to book a new appointment'), s(es ? 'Gracias' : 'Thanks')];
    else if (step === 'reschedule:done') items = [s(es ? 'Ver mis citas' : 'View my appointments'), s(es ? 'Gracias' : 'Thanks')];
    else if (unanswered) items = [s(es ? 'Hablar con una persona' : 'Talk to a person'), s(es ? 'Agendar una cita' : 'Book an appointment')];
    else if (['book_appointment', 'check_availability'].includes(c.intent) && !executed.some((e) => e.name.includes('Availab') || e.name === 'getAvailableAppointmentSlots'))
      items = specialties.slice(0, 5).map((sp) => s(es ? sp.name : (sp.nameEn ?? sp.name), es ? `Quiero una cita de ${sp.name}` : `I want a ${sp.nameEn ?? sp.name} appointment`));
    else if (['greeting', 'unknown', 'thanks', 'capabilities', 'small_talk', 'affirm', 'deny', 'general_question'].includes(c.intent) && !step) items = menu();
    else if (c.intent === 'services_info')
      items = [s(es ? 'Agendar una cita' : 'Book an appointment'), s(es ? '¿Cuánto cuesta una consulta?' : 'How much is a consultation?'), s(es ? '¿Cómo me preparo?' : 'How do I prepare?', es ? '¿Cómo me preparo para la cita?' : 'How should I prepare for the appointment?')];
    else if (['hours', 'location'].includes(c.intent)) items = [s(es ? 'Agendar una cita' : 'Book an appointment'), s(es ? '¿Tienen parqueadero?' : 'Is there parking?')];
    else if (c.intent === 'pricing') items = [s(es ? 'Agendar una cita' : 'Book an appointment'), s(es ? 'Métodos de pago' : 'Payment methods', es ? '¿Qué métodos de pago aceptan?' : 'Which payment methods do you accept?')];
    else if (c.intent === 'medical_advice') items = specialties.slice(0, 3).map((sp) => s(es ? `Cita de ${sp.name}` : `${sp.nameEn ?? sp.name} appointment`, es ? `Quiero una cita de ${sp.name}` : `I want a ${sp.nameEn ?? sp.name} appointment`));
    return items.length ? [{ type: 'suggestions', items }] : [];
  }
}

function summarizeOutput(v: unknown): unknown {
  const s = JSON.stringify(v);
  return s.length > 1500 ? `${s.slice(0, 1500)}…` : v;
}
