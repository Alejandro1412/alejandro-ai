import type { Response } from 'supertest';
import { ACCOUNTS, bearer, createHarness, type Harness } from './harness';

interface Att {
  type: string;
  [k: string]: unknown;
}
interface Turn {
  conversationId: string;
  assistantMessage: { id: string; content: string; attachments: Att[] } | null;
  conversationStatus: string;
  journey: { flow: string; step: string; steps: string[] } | null;
  trace: { intent: string; steps: { type: string; name: string; status: string }[] };
}
const tools = (d: Turn) => d.trace.steps.filter((s) => s.type === 'tool').map((s) => s.name);
const card = <T = Att>(d: Turn, type: string) => d.assistantMessage?.attachments.find((a) => a.type === type) as T | undefined;

/** Reads a whole SSE body into { event, data } records. */
const sseParser = (res: Response & NodeJS.ReadableStream, cb: (err: Error | null, body: string) => void) => {
  let data = '';
  res.setEncoding('utf8');
  res.on('data', (c: string) => (data += c));
  res.on('end', () => cb(null, data));
};
const parseSse = (body: string) =>
  body
    .split('\n\n')
    .filter((b) => b.includes('data:'))
    .map((b) => ({ event: /event: (.*)/.exec(b)?.[1] ?? 'message', data: JSON.parse(/data: (.*)/.exec(b)![1]) as unknown }));

describe('Alejandro AI — natural conversation & guidance (e2e)', () => {
  let h: Harness;
  let token: string;
  let patientId: string;

  beforeAll(async () => {
    h = await createHarness();
    token = await h.login(ACCOUNTS.admin);
    patientId = (await h.http().get('/api/ai/playground/scenarios').set(bearer(token))).body.data[0].patientId;
  });
  afterAll(async () => {
    await h.close();
  });

  const session = () => {
    let conversationId: string | undefined;
    return async (message: string, action?: Record<string, unknown>, patient: string | null = patientId): Promise<Turn> => {
      const body: Record<string, unknown> = { message, ...(conversationId ? { conversationId } : { patientId: patient }), ...(action ? { action } : {}) };
      const res = await h.http().post('/api/ai/chat').set(bearer(token)).send(body);
      if (res.status !== 201) throw new Error(`${res.status} ${JSON.stringify(res.body)}`);
      conversationId = res.body.data.conversationId;
      return res.body.data as Turn;
    };
  };

  it('holds small talk without escalating, and always proposes a next step', async () => {
    const chat = session();
    for (const msg of ['¿Cómo estás?', '¿Eres un robot?', 'Cuéntame un chiste', '¿Cuál es la capital de Francia?', '¿Qué puedes hacer?']) {
      const d = await chat(msg);
      expect(d.conversationStatus).toBe('ACTIVE');
      expect(d.assistantMessage?.content).toMatch(/\?/); // ends with a guiding question
      expect(tools(d)).not.toContain('requestHumanHandoff');
    }
  });

  it('books from free text: "la segunda" → confirmation card → "sí" → appointment, with the journey advancing', async () => {
    const chat = session();
    const a = await chat('Necesito una cita de dermatología');
    expect(a.journey).toMatchObject({ flow: 'booking', step: 'time' });
    expect(card(a, 'slots')).toBeDefined();
    expect(card(a, 'doctors')).toBeUndefined(); // slots already name the doctor

    const b = await chat('la segunda');
    expect(tools(b)).toEqual([]); // nothing is booked from a guess
    const confirm = card<{ action: { type: string; doctorId: string; startTime: string } }>(b, 'confirm');
    expect(confirm?.action.type).toBe('book_slot');
    expect(b.journey).toMatchObject({ step: 'confirm' });

    const c = await chat('sí');
    expect(tools(c)).toContain('createAppointment');
    expect(card(c, 'appointment')).toBeDefined();
    expect(c.journey).toMatchObject({ flow: 'booking', step: 'done' });
    const appt = (card<{ appointment: { id: string; start: string } }>(c, 'appointment'))!.appointment;
    expect(new Date(appt.start).toISOString()).toBe(new Date(confirm!.action.startTime).toISOString());

    const d = await chat('¿Cómo me preparo?');
    expect(d.trace.intent).toBe('preparation');
    expect(tools(d)).toContain('searchClinicKnowledge');
    expect(d.assistantMessage?.content).toMatch(/15 minutos/);
  });

  it('saying "no" to the confirmation books nothing and shows the options again', async () => {
    const chat = session();
    await chat('Quiero una cita de cardiología');
    const b = await chat('la primera');
    expect(card(b, 'confirm')).toBeDefined();
    const c = await chat('no');
    expect(tools(c)).toEqual([]);
    expect(card(c, 'slots')).toBeDefined();
    expect(c.journey).toMatchObject({ step: 'time' });
  });

  it('keeps context in follow-ups ("¿y cuánto cuesta?")', async () => {
    const chat = session();
    await chat('¿Cómo me preparo para un electrocardiograma?');
    const d = await chat('¿y cuánto cuesta?');
    expect(d.trace.intent).toBe('pricing');
    expect(d.assistantMessage?.content).toMatch(/95\.000/);
  });

  it('streams agent steps, text deltas and the final result over SSE', async () => {
    const res = await h
      .http()
      .post('/api/ai/chat/stream')
      .set(bearer(token))
      .send({ message: 'Necesito una cita de ortopedia', patientId })
      .buffer(true)
      .parse(sseParser as never);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/event-stream/);
    const events = parseSse(res.body as string);
    const steps = events.filter((e) => e.event === 'step').map((e) => e.data as { type: string; name?: string; phase?: string });
    expect(steps).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'tool', name: 'getAvailableAppointmentSlots', phase: 'end' })]));
    const text = events.filter((e) => e.event === 'delta').map((e) => (e.data as { text: string }).text).join('');
    const done = events.find((e) => e.event === 'done')!.data as Turn;
    expect(text).toBe(done.assistantMessage!.content);
    expect(done.journey).toMatchObject({ flow: 'booking' });
  });

  it('public webchat stream never exposes the observability trace', async () => {
    const s = await h.http().post('/api/public/chat/novacare/session').send({});
    const res = await h
      .http()
      .post('/api/public/chat/novacare/messages/stream')
      .set('X-Chat-Session', s.body.data.sessionToken)
      .send({ message: 'Hola' })
      .buffer(true)
      .parse(sseParser as never);
    const done = parseSse(res.body as string).find((e) => e.event === 'done')!.data as Record<string, unknown>;
    expect(done).not.toHaveProperty('trace');
    expect(JSON.stringify(parseSse(res.body as string))).not.toMatch(/system|prompt|tokens/i);
  });

  it('stores thumbs feedback and reports satisfaction', async () => {
    const s = await h.http().post('/api/public/chat/novacare/session').send({});
    const sessionToken = s.body.data.sessionToken as string;
    const turn = await h.http().post('/api/public/chat/novacare/messages').set('X-Chat-Session', sessionToken).send({ message: '¿Dónde quedan?' });
    const messageId = turn.body.data.assistantMessage.id as string;
    const ok = await h.http().post(`/api/public/chat/novacare/messages/${messageId}/feedback`).set('X-Chat-Session', sessionToken).send({ value: 1 });
    expect(ok.status).toBe(201);
    expect(ok.body.data.feedback).toBe(1);
    // Invalid values and other sessions are rejected.
    expect((await h.http().post(`/api/public/chat/novacare/messages/${messageId}/feedback`).set('X-Chat-Session', sessionToken).send({ value: 5 })).status).toBe(400);
    const other = await h.http().post('/api/public/chat/novacare/session').send({});
    expect((await h.http().post(`/api/public/chat/novacare/messages/${messageId}/feedback`).set('X-Chat-Session', other.body.data.sessionToken).send({ value: -1 })).status).toBe(404);

    const overview = await h.http().get('/api/analytics/overview?days=7').set(bearer(token));
    expect(overview.body.data.satisfaction.positive).toBeGreaterThan(0);
  });

  it('accepts current model ids and reports the engine in use', async () => {
    const res = await h.http().patch('/api/ai/config').set(bearer(token)).send({ provider: 'anthropic', model: 'claude-sonnet-5-5' });
    expect(res.status).toBe(200);
    const cfg = await h.http().get('/api/ai/config').set(bearer(token));
    // No ANTHROPIC_API_KEY in tests → safe fallback to the local engine, reported as such.
    expect(cfg.body.data.effective).toMatchObject({ provider: 'mock', fallback: true });
    expect((await h.http().patch('/api/ai/config').set(bearer(token)).send({ provider: 'anthropic', model: 'not a model; drop table' })).status).toBe(400);
    await h.http().patch('/api/ai/config').set(bearer(token)).send({ provider: 'mock', model: 'alejandro-mock-1' });
  });
});
