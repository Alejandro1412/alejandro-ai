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

export interface TurnInput {
  conversationId: string;
  text: string;
  action?: Record<string, unknown> | null;
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
  assistantMessage: { id: string; content: string; attachments: Attachment[]; createdAt: Date } | null;
  conversationStatus: string;
  trace: TurnTrace;
}

const WRITE_TOOLS = new Set(['createAppointment', 'cancelAppointment', 'rescheduleAppointment', 'createPatient', 'createLead', 'createSupportTicket', 'sendAppointmentReminder']);
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
  ) {}

  async handleTurn(input: TurnInput): Promise<TurnResult> {
    const t0 = Date.now();
    const requestId = randomUUID();
    const conv = await this.conversations.getRaw(input.conversationId);
    const [agent, clinic, catalog] = await Promise.all([this.config.get(), this.config.clinic(), this.config.catalog()]);
    const metadata = { ...(conv.metadata as Record<string, unknown>) };
    const language = detectLanguage(input.text, (conv.language as 'es' | 'en') ?? 'es');
    const now = new Date();

    // 1) Intent + entities (deterministic, explainable).
    const classification: Classification = input.action
      ? { intent: 'action', category: 'APPOINTMENT', confidence: 1, entities: {}, flags: { medicalMention: false, complaint: false, wantsHuman: false, emergency: false } } as unknown as Classification
      : classify(input.text, catalog, clinic.timezone, now);

    // Multi-turn identification: merge partial identity (name / phone) across turns while an operation is pending.
    if (metadata.pending && !conv.patientId && !input.action) {
      const e = classification.entities;
      const bareName = input.text.trim().match(/^([\p{Lu}][\p{L}'-]+)((?:\s+[\p{Lu}][\p{L}'-]+){1,3})$/u);
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

    const userMessage = await this.conversations.addMessage(conv.id, {
      role: 'USER',
      content: input.text,
      action: input.action ?? null,
      intent: classification.intent,
      category: classification.category,
      language,
    });
    const convPatch: Record<string, unknown> = { language };
    if (!conv.subject && !['greeting', 'action', 'unknown', 'thanks'].includes(classification.intent)) convPatch.subject = input.text.slice(0, 120);

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
      return { conversationId: conv.id, userMessage, assistantMessage: null, conversationStatus: conv.status, trace };
    }

    // 2) Policy engine (before any model call).
    const decision = evaluatePolicy(classification, input.text, agent.handoffRules, { failedTurns: Number(metadata.failedTurns ?? 0), lang: language });
    trace.policy = { mode: decision.mode, reasons: decision.reasons, forcedTool: decision.forcedTool };
    trace.steps.push({ type: 'policy', name: decision.mode, status: 'OK', latencyMs: 0, detail: { reasons: decision.reasons } });
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

    const runTool = async (name: string, args: Record<string, unknown>, id = `call_${randomUUID()}`) => {
      const r = await TenantContext.run(aiContext(), () => this.tools.execute({ id, name, arguments: args }, toolCtx));
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

    if (decision.mode === 'emergency') {
      await runTool(decision.forcedTool!, decision.forcedArgs!);
      content =
        language === 'en'
          ? '⚠️ What you describe may be a medical emergency. Please call your local emergency number right now (e.g. 911 in the US, 123 in Colombia) or go to the nearest emergency room. I have alerted our clinic team so a person can contact you. I cannot provide medical advice through this chat.'
          : '⚠️ Lo que describes podría ser una emergencia médica. Llama ahora mismo a la línea de emergencias de tu país (por ejemplo 123 en Colombia o 911) o acude al servicio de urgencias más cercano. Ya alerté a nuestro equipo para que una persona te contacte. No puedo dar indicaciones médicas por este chat.';
      attachments.unshift({ type: 'emergency' });
    } else {
      // 3) Agent loop: model ⇄ tools.
      const resolved = this.llm.resolve(agent.provider, agent.model);
      trace.provider = resolved.provider.name;
      trace.model = resolved.model;
      trace.providerFallback = resolved.fallback;
      const longTerm = await this.memory.longTerm(patientId);
      const history = await this.memory.shortTerm(conv.id, userMessage.id);
      const turnMessages: ChatMessage[] = [
        ...history,
        { role: 'user', content: input.action ? `${input.text}\nACTION ${JSON.stringify(input.action)}` : input.text },
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
          action: input.action ?? null,
          forcedTool: decision.forcedTool ? { name: decision.forcedTool, args: decision.forcedArgs ?? {} } : null,
          pending: (metadata.pending as Record<string, unknown>) ?? null,
          catalog: { specialties: catalog.specialties.map((s) => ({ id: s.id, name: s.name, nameEn: s.nameEn ?? null })) },
          clinicName: clinic.name,
          lastAssistantMessage: lastAssistant?.content ?? null,
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
          now,
        });

        const llmStart = Date.now();
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
        turnMessages.push({ role: 'assistant', content: res.content, toolCalls: res.toolCalls });
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

    // 4) Response validation (independent of the model).
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
    if (!patientId && input.action?.type === 'book_slot') metadata.pending = { type: 'book_slot', action: input.action };
    else if (!patientId && ['cancel_appointment', 'reschedule_appointment', 'my_appointments'].includes(classification.intent)) metadata.pending = { type: 'intent', intent: classification.intent };
    else if (patientId && metadata.pending && (ok('createAppointment') || ok('listPatientAppointments') || ok('createPatient'))) {
      delete metadata.pending;
      delete metadata.partialIdentity;
    }
    metadata.failedTurns = unanswered || classification.intent === 'unknown' ? Number(metadata.failedTurns ?? 0) + 1 : 0;

    const resolvedByAi = !handedOff && (executed.some((e) => e.ok && (WRITE_TOOLS.has(e.name) || INFO_TOOLS.has(e.name))) || Boolean(kb?.ok && (kb.output as { found: boolean }).found));
    if (!metadata.metered) {
      metadata.metered = true;
      await TenantContext.run(aiContext(), () => this.usage.record({ kind: 'AI_CONVERSATION', provider: trace.provider, conversationId: conv.id }));
    }
    attachments.push(...this.suggestions(classification, executed, language, catalog.specialties, handedOff, unanswered, Boolean(patientId)));

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
      assistantMessage: { id: assistantMessage.id, content, attachments, createdAt: assistantMessage.createdAt },
      conversationStatus: latest.status,
      trace,
    };
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
  ): Attachment[] {
    const es = lang === 'es';
    const s = (label: string, message = label) => ({ label, message });
    let items: { label: string; message: string }[] = [];
    const booked = executed.some((e) => e.name === 'createAppointment' && e.ok);
    if (handedOff) return [];
    if (booked) items = [s(es ? 'Ver mis citas' : 'View my appointments'), s(es ? 'Gracias' : 'Thanks')];
    else if (unanswered) items = [s(es ? 'Hablar con una persona' : 'Talk to a person')];
    else if (['book_appointment', 'check_availability'].includes(c.intent) && !executed.some((e) => e.name.includes('Availab') || e.name === 'getAvailableAppointmentSlots'))
      items = specialties.slice(0, 5).map((sp) => s(es ? sp.name : (sp.nameEn ?? sp.name), es ? `Quiero una cita de ${sp.name}` : `I want a ${sp.nameEn ?? sp.name} appointment`));
    else if (['greeting', 'unknown', 'thanks'].includes(c.intent))
      items = [
        s(es ? 'Agendar una cita' : 'Book an appointment'),
        s(es ? '¿Qué servicios ofrecen?' : 'What services do you offer?'),
        s(es ? 'Horarios de atención' : 'Opening hours'),
        ...(identified ? [s(es ? 'Ver mis citas' : 'View my appointments')] : []),
        s(es ? 'Hablar con una persona' : 'Talk to a person'),
      ];
    else if (c.intent === 'services_info') items = [s(es ? 'Agendar una cita' : 'Book an appointment'), s(es ? '¿Cuánto cuesta una consulta?' : 'How much is a consultation?')];
    else if (c.intent === 'medical_advice') items = specialties.slice(0, 3).map((sp) => s(es ? `Cita de ${sp.name}` : `${sp.nameEn ?? sp.name} appointment`, es ? `Quiero una cita de ${sp.name}` : `I want a ${sp.nameEn ?? sp.name} appointment`));
    return items.length ? [{ type: 'suggestions', items }] : [];
  }
}

function summarizeOutput(v: unknown): unknown {
  const s = JSON.stringify(v);
  return s.length > 1500 ? `${s.slice(0, 1500)}…` : v;
}
