import { MetaWhatsAppProvider } from '../src/notifications/providers/channel-providers';
import { hmacSha256Hex } from '../src/common/utils/crypto';
import { ACCOUNTS, bearer, createHarness, type Harness } from './harness';

const waPayload = (id: string, from: string, body: string) => ({
  object: 'whatsapp_business_account',
  entry: [
    {
      id: 'waba',
      changes: [
        {
          field: 'messages',
          value: {
            messaging_product: 'whatsapp',
            metadata: { phone_number_id: 'test' },
            contacts: [{ wa_id: from, profile: { name: 'Pedro Gómez' } }],
            messages: [{ from, id, timestamp: `${Math.floor(Date.now() / 1000)}`, type: 'text', text: { body } }],
          },
        },
      ],
    },
  ],
});

describe('Knowledge base / RAG (e2e)', () => {
  let h: Harness;
  let admin: string;
  beforeAll(async () => {
    h = await createHarness();
    admin = await h.login(ACCOUNTS.admin);
  });
  afterAll(async () => {
    await h.close();
  });

  const waitIndexed = async (id: string) => {
    for (let i = 0; i < 40; i++) {
      const res = await h.http().get(`/api/knowledge/documents/${id}`).set(bearer(admin));
      const status = (res.body.data.source ?? res.body.data).status;
      if (status === 'INDEXED' || status === 'FAILED') return status as string;
      await new Promise((r) => setTimeout(r, 150));
    }
    return 'TIMEOUT';
  };

  let sourceId: string;
  it('ingests text through extract → chunk → embed → index', async () => {
    const res = await h
      .http()
      .post('/api/knowledge/text')
      .set(bearer(admin))
      .send({ title: 'Política de mascotas', category: 'Políticas', text: 'En NovaCare se permiten perros de asistencia en todas las sedes. Las mascotas de compañía no pueden ingresar a las áreas de consulta.' });
    expect(res.status).toBe(201);
    sourceId = res.body.data.id;
    expect(await waitIndexed(sourceId)).toBe('INDEXED');
  });

  it('retrieves the most relevant chunk with a score', async () => {
    const res = await h.http().get('/api/knowledge/search?q=¿Puedo ir con mi perro?').set(bearer(admin));
    expect(res.status).toBe(200);
    const top = res.body.data[0];
    expect(top.title).toBe('Política de mascotas');
    expect(top.score).toBeGreaterThan(0);
  });

  it('disabled sources are excluded from retrieval', async () => {
    await h.http().patch(`/api/knowledge/documents/${sourceId}`).set(bearer(admin)).send({ isEnabled: false });
    const res = await h.http().get('/api/knowledge/search?q=¿Puedo ir con mi perro?').set(bearer(admin));
    expect(res.body.data.map((r: { title: string }) => r.title)).not.toContain('Política de mascotas');
  });

  it('knowledge is tenant-scoped', async () => {
    await h.http().patch(`/api/knowledge/documents/${sourceId}`).set(bearer(admin)).send({ isEnabled: true });
    const aurora = await h.login(ACCOUNTS.auroraAdmin);
    const res = await h.http().get('/api/knowledge/search?q=¿Puedo ir con mi perro?').set(bearer(aurora));
    expect(res.body.data.map((r: { title: string }) => r.title)).not.toContain('Política de mascotas');
    expect((await h.http().get(`/api/knowledge/documents/${sourceId}`).set(bearer(aurora))).status).toBe(404);
  });

  it('blocks URL ingestion to private networks (SSRF)', async () => {
    const res = await h.http().post('/api/knowledge/url').set(bearer(admin)).send({ url: 'http://169.254.169.254/latest/meta-data' });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
  });

  it('receptionists can read but not write knowledge', async () => {
    const reception = await h.login(ACCOUNTS.reception);
    expect((await h.http().get('/api/knowledge/documents').set(bearer(reception))).status).toBe(200);
    expect((await h.http().post('/api/knowledge/text').set(bearer(reception)).send({ title: 'x y', text: 'something long enough' })).status).toBe(403);
  });
});

describe('Integrations: WhatsApp webhook, public webchat, billing (e2e)', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await createHarness();
  });
  afterAll(async () => {
    await h.close();
  });

  it('verifies the Meta subscription challenge only with the right token', async () => {
    const ok = await h.http().get('/api/webhooks/whatsapp').query({ 'hub.mode': 'subscribe', 'hub.verify_token': 'test-verify-token', 'hub.challenge': '12345' });
    expect(ok.status).toBe(200);
    expect(ok.text).toContain('12345');
    const bad = await h.http().get('/api/webhooks/whatsapp').query({ 'hub.mode': 'subscribe', 'hub.verify_token': 'nope', 'hub.challenge': '12345' });
    expect([401, 403]).toContain(bad.status);
  });

  it('processes an inbound message once, even when Meta retries the delivery', async () => {
    const payload = waPayload('wamid.TEST-1', '573009998877', '¿Cuál es el horario de atención?');
    const first = await h.http().post('/api/webhooks/whatsapp').send(payload);
    expect(first.status).toBe(200);
    expect(first.body.data.processed).toBe(1);
    const retry = await h.http().post('/api/webhooks/whatsapp').send(payload);
    expect(retry.body.data.processed).toBe(0);

    const admin = await h.login(ACCOUNTS.admin);
    const convs = await h.http().get('/api/conversations?channel=WHATSAPP&pageSize=100').set(bearer(admin));
    expect(convs.status).toBe(200);
  });

  it('validates X-Hub-Signature-256 with the app secret (production adapter)', () => {
    const provider = new MetaWhatsAppProvider('token', 'phone-id', 'app-secret');
    const raw = Buffer.from(JSON.stringify(waPayload('wamid.X', '1', 'hola')));
    expect(provider.validateWebhook(raw, `sha256=${hmacSha256Hex('app-secret', raw)}`)).toBe(true);
    expect(provider.validateWebhook(raw, `sha256=${hmacSha256Hex('other', raw)}`)).toBe(false);
    expect(provider.validateWebhook(raw, undefined)).toBe(false);
  });

  it('public webchat requires a session token and answers from the right clinic', async () => {
    const profile = await h.http().get('/api/public/clinics/novacare');
    expect(profile.status).toBe(200);
    expect(profile.body.data.clinic.name).toBe('NovaCare Medical Center');
    expect(JSON.stringify(profile.body.data)).not.toMatch(/credentials|passwordHash|apiKey/);

    const noSession = await h.http().post('/api/public/chat/novacare/messages').send({ message: 'Hola' });
    expect(noSession.status).toBe(401);

    const session = await h.http().post('/api/public/chat/novacare/session').send({ language: 'es' });
    expect(session.status).toBe(201);
    const token = session.body.data.sessionToken as string;
    const msg = await h.http().post('/api/public/chat/novacare/messages').set('X-Chat-Session', token).send({ message: '¿Dónde quedan?' });
    expect(msg.status).toBe(201);
    expect(msg.body.data.assistantMessage.content).toMatch(/Chicó|Usaquén|Bogotá/);
    expect(msg.body.data).not.toHaveProperty('trace');

    // A session from one clinic cannot be replayed against another tenant.
    const cross = await h.http().post('/api/public/chat/aurora/messages').set('X-Chat-Session', token).send({ message: 'Hola' });
    expect(cross.status).toBe(401);

    expect((await h.http().get('/api/public/clinics/does-not-exist')).status).toBe(404);
  });

  it('publishes the pricing catalog and shows the subscription to admins only', async () => {
    const plans = await h.http().get('/api/billing/plans');
    expect(plans.status).toBe(200);
    expect(plans.body.data.map((p: { key: string }) => p.key)).toEqual(['STARTER', 'PROFESSIONAL', 'CLINIC']);
    const admin = await h.login(ACCOUNTS.admin);
    const overview = await h.http().get('/api/billing/overview').set(bearer(admin));
    expect(overview.status).toBe(200);
    expect(overview.body.data.plan.key).toBe('PROFESSIONAL');
    const reception = await h.login(ACCOUNTS.reception);
    expect((await h.http().get('/api/billing/overview').set(bearer(reception))).status).toBe(403);
  });

  it('rejects unsigned Stripe webhooks when Stripe is configured (mock accepts only well-formed events)', async () => {
    const res = await h.http().post('/api/webhooks/stripe').set('Content-Type', 'application/json').send('{not json');
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it('health endpoint reports database status', async () => {
    const res = await h.http().get('/api/health');
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).toMatch(/database|db/i);
  });
});
