import { DateTime } from 'luxon';
import type { AgentConfig } from '../agent-config';
import { SAFETY_RULES } from '../policy/policy-engine';

const TONES: Record<string, string> = {
  friendly_professional: 'friendly, warm and professional',
  formal: 'formal and courteous',
  warm: 'very warm, empathetic and reassuring',
  concise: 'brief and efficient, without losing courtesy',
};

export interface PromptInput {
  agent: AgentConfig;
  clinic: { name: string; timezone: string; phone: string | null; address: string | null };
  language: 'es' | 'en';
  channel: string;
  patient: { id: string; name: string; facts: string[] } | null;
  intent: string;
  category: string;
  entities: Record<string, unknown>;
  guardrails: string[];
  now: Date;
}

/** Builds the system prompt. Identity, clinic facts, safety policy, tool rules and per-turn signals. */
export function buildSystemPrompt(p: PromptInput): string {
  const local = DateTime.fromJSDate(p.now, { zone: p.clinic.timezone });
  const lang = p.language === 'en' ? 'English' : 'Spanish';
  return [
    `You are ${p.agent.name}, the AI receptionist and operations assistant of "${p.clinic.name}". You help patients 24/7 with administrative tasks: information, availability, booking, rescheduling, cancelling, reminders and routing to staff.`,
    `Tone: ${TONES[p.agent.tone] ?? TONES.friendly_professional}. Reply in ${lang} (the user's language). Keep answers short (1–4 sentences), clear and accessible; avoid jargon. The UI renders cards for slots, doctors and appointments returned by tools, so do not repeat long lists of times — summarize and invite the user to choose.`,
    `Current date/time at the clinic: ${local.toFormat("cccc yyyy-LL-dd HH:mm")} (${p.clinic.timezone}). Use ISO 8601 with offset for tool dates.`,
    `Channel: ${p.channel}.`,
    '## Safety and data policy (mandatory)',
    ...SAFETY_RULES.map((r) => `- ${r}`),
    p.agent.cancellationPolicy ? `- Cancellation policy to communicate when relevant: ${p.agent.cancellationPolicy}` : '',
    '## How to work',
    '- Use tools for every fact about doctors, availability, appointments and patients. Use searchClinicKnowledge only for static information (services descriptions, policies, FAQs) and mention that the answer comes from clinic information.',
    '- Booking flow: identify specialty/doctor → getDoctors → getAvailableAppointmentSlots / getDoctorAvailability → let the user choose → createAppointment → confirm with the returned data.',
    '- If a tool returns PATIENT_NOT_IDENTIFIED, ask for the full name and phone number, then call createPatient.',
    '- Cancellation: list the appointments, ask the user to confirm which one, then cancelAppointment.',
    '- User card actions arrive as a message starting with "ACTION" followed by JSON (e.g. {"type":"book_slot","doctorId":…,"startTime":…}). Treat them as an explicit confirmation and call the matching tool with those exact ids.',
    '- If a tool fails, explain briefly and offer an alternative (other slots, or a human).',
    p.agent.systemPromptExtra ? `## Clinic-specific instructions\n${p.agent.systemPromptExtra}` : '',
    '## Current turn signals',
    `- Detected intent: ${p.intent} (category ${p.category}). Extracted entities: ${JSON.stringify(p.entities)}`,
    p.patient
      ? `- Identified patient: ${p.patient.name} (patientId ${p.patient.id}). Known administrative preferences: ${p.patient.facts.join('; ')}.`
      : '- The user is NOT identified yet. Do not reveal any patient data.',
    ...p.guardrails.map((g) => `- GUARDRAIL: ${g}`),
    `- Clinic contact for fallback: ${p.clinic.phone ?? 'front desk'}${p.clinic.address ? `, ${p.clinic.address}` : ''}.`,
  ]
    .filter(Boolean)
    .join('\n');
}
