import type { HandoffRules } from '../../database/schema';
import type { Classification } from './intent-classifier';
import { norm } from './text';

export type PolicyMode = 'normal' | 'emergency' | 'handoff' | 'medical_guardrail';

export interface PolicyDecision {
  mode: PolicyMode;
  /** Tool the agent must execute this turn (e.g. requestHumanHandoff). */
  forcedTool: string | null;
  forcedArgs: Record<string, unknown> | null;
  /** Extra instructions appended to the system prompt for this turn. */
  guardrails: string[];
  /** Whether the LLM should be called at all. */
  callModel: boolean;
  reasons: string[];
}

export const SAFETY_RULES = [
  'You are NOT a doctor. Never diagnose, never interpret symptoms, test results or images, and never recommend, dose or adjust medications.',
  'Never invent prices, availability, doctors, services, policies or appointment details. Only state facts returned by tools or retrieved from the clinic knowledge base.',
  'Availability, appointments, and patient data are dynamic: ALWAYS obtain them by calling tools — never from the knowledge base or memory.',
  'Never confirm that an appointment was booked, cancelled or rescheduled unless the corresponding tool returned success in this conversation.',
  'Only discuss data that belongs to the current clinic and the current identified patient. Never reveal other patients’ information.',
  'If the user describes an emergency (chest pain, difficulty breathing, severe bleeding, suicidal thoughts, loss of consciousness…), tell them to call their local emergency number immediately and escalate to a human.',
  'If you cannot resolve a request or the user asks for a person, use requestHumanHandoff.',
];

/**
 * Policy Engine: turns the classification + clinic handoff rules into an execution decision
 * BEFORE the model runs. Safety-critical paths (emergencies, explicit handoff) never depend on the LLM.
 */
export function evaluatePolicy(c: Classification, text: string, rules: HandoffRules, ctx: { failedTurns: number; lang?: 'es' | 'en' }): PolicyDecision {
  const es = ctx.lang !== 'en';
  const R = {
    emergency: es ? 'Posible emergencia médica reportada por el usuario' : 'Possible medical emergency reported by the user',
    human: es ? 'El usuario pidió hablar con una persona' : 'User requested a human',
    keyword: es ? 'Se detectó una palabra clave de escalamiento de la clínica' : 'Clinic handoff keyword detected',
    complaint: es ? 'Queja o asunto administrativo sensible' : 'Complaint or sensitive administrative issue',
    lowConfidence: es ? 'El asistente no logró resolver la solicitud tras varios intentos' : 'The assistant could not resolve the request after several attempts',
  };
  const d: PolicyDecision = { mode: 'normal', forcedTool: null, forcedArgs: null, guardrails: [], callModel: true, reasons: [] };

  if (c.intent === 'emergency') {
    return {
      mode: 'emergency',
      forcedTool: 'requestHumanHandoff',
      forcedArgs: { reason: R.emergency, urgency: 'CRITICAL' },
      guardrails: [],
      callModel: false,
      reasons: ['EMERGENCY_KEYWORDS'],
    };
  }

  const keywordHit = rules.keywords.some((k) => norm(text).includes(norm(k)));
  if ((c.flags.wantsHuman && rules.onUserRequest) || keywordHit || (c.flags.complaint && rules.onSensitiveTopic)) {
    d.mode = 'handoff';
    d.forcedTool = 'requestHumanHandoff';
    d.forcedArgs = {
      reason: c.flags.wantsHuman ? R.human : keywordHit ? R.keyword : R.complaint,
      urgency: c.flags.complaint ? 'HIGH' : 'MEDIUM',
    };
    d.reasons.push(c.flags.wantsHuman ? 'USER_REQUESTED_HUMAN' : keywordHit ? 'HANDOFF_KEYWORD' : 'COMPLAINT');
    return d;
  }

  if (rules.onLowConfidence && ctx.failedTurns + (c.confidence < 0.5 ? 1 : 0) > rules.maxFailedTurns) {
    d.mode = 'handoff';
    d.forcedTool = 'requestHumanHandoff';
    d.forcedArgs = { reason: R.lowConfidence, urgency: 'MEDIUM' };
    d.reasons.push('LOW_CONFIDENCE');
    return d;
  }

  if (c.intent === 'medical_advice' || c.flags.medicalMention) {
    d.mode = 'medical_guardrail';
    d.guardrails.push(
      'The user mentioned symptoms or asked for medical advice. Do not diagnose or recommend treatment. Acknowledge with empathy, explain that a professional must evaluate it, and offer to book an appointment with the appropriate specialty.',
    );
    d.reasons.push('MEDICAL_SAFETY');
  }
  return d;
}
