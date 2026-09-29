import type { LLMRequest, TurnHints } from './llm-provider';
import { MockLLMProvider } from './mock.provider';

const hints = (over: Partial<TurnHints> = {}): TurnHints => ({
  language: 'es',
  intent: 'book_appointment',
  category: 'APPOINTMENT',
  entities: { specialtyName: 'Dermatología' },
  patient: { id: 'p1', name: 'María Rodríguez' },
  now: new Date().toISOString(),
  timezone: 'America/Bogota',
  action: null,
  forcedTool: null,
  pending: null,
  catalog: { specialties: [{ id: 's', name: 'Dermatología', nameEn: 'Dermatology' }] },
  clinicName: 'NovaCare',
  lastAssistantMessage: null,
  ...over,
});
const tools = ['getDoctors', 'getAvailableAppointmentSlots', 'createAppointment', 'requestHumanHandoff', 'listPatientAppointments', 'cancelAppointment'].map((name) => ({ name, description: '', parameters: {} }));
const req = (h: TurnHints, messages: LLMRequest['messages']): LLMRequest => ({ system: '', messages, tools, model: 'alejandro-mock-1', temperature: 0, maxTokens: 500, hints: h });

describe('MockLLMProvider (deterministic tool-calling policy)', () => {
  const llm = new MockLLMProvider();

  it('plans the booking flow step by step through tools', async () => {
    const h = hints();
    const user = { role: 'user' as const, content: 'Necesito una cita con dermatología' };
    const r1 = await llm.complete(req(h, [user]));
    expect(r1.toolCalls[0].name).toBe('getDoctors');
    const afterDoctors = [user, { role: 'assistant' as const, content: '', toolCalls: r1.toolCalls }, { role: 'tool' as const, toolCallId: r1.toolCalls[0].id, name: 'getDoctors', content: JSON.stringify({ ok: true, data: { doctors: [{ id: 'd1' }] } }) }];
    const r2 = await llm.complete(req(h, afterDoctors));
    expect(r2.toolCalls[0].name).toBe('getAvailableAppointmentSlots');
    const r3 = await llm.complete(
      req(h, [...afterDoctors, { role: 'assistant', content: '', toolCalls: r2.toolCalls }, { role: 'tool', toolCallId: 'x', name: 'getAvailableAppointmentSlots', content: JSON.stringify({ ok: true, data: { slots: [{ doctorId: 'd1', doctorName: 'Dra. María García', start: '2030-01-01T13:00:00Z' }] } }) }]),
    );
    expect(r3.toolCalls).toHaveLength(0);
    expect(r3.content).toMatch(/Dra\. María García/);
    expect(r3.usage.inputTokens).toBeGreaterThan(0);
  });

  it('asks for identification before booking for anonymous users', async () => {
    const r = await llm.complete(req(hints({ patient: null, intent: 'action', action: { type: 'book_slot', doctorId: 'd1', startTime: '2030-01-01T13:00:00Z' } }), [{ role: 'user', content: 'Reservar' }]));
    expect(r.toolCalls).toHaveLength(0);
    expect(r.content).toMatch(/nombre completo/);
  });

  it('always executes a policy-forced tool first', async () => {
    const r = await llm.complete(req(hints({ intent: 'human', forcedTool: { name: 'requestHumanHandoff', args: { reason: 'x', urgency: 'MEDIUM' } } }), [{ role: 'user', content: 'humano' }]));
    expect(r.toolCalls[0]).toMatchObject({ name: 'requestHumanHandoff', arguments: { urgency: 'MEDIUM' } });
  });
});
