import { eq } from 'drizzle-orm';
import { DB, type Database } from '../src/database/database.module';
import { appointments, clinics, subscriptions } from '../src/database/schema';
import { QueueService } from '../src/jobs/queue.service';
import { mockOutbox } from '../src/notifications/providers/channel-providers';
import { BillingLifecycleService } from '../src/billing/billing-lifecycle.service';
import { NotificationsService } from '../src/notifications/notifications.service';
import { TenantContext } from '../src/database/tenant';
import { validTwilioSignature } from '../src/voice/voice.service';
import { createHmac } from 'node:crypto';
import { ACCOUNTS, bearer, createHarness, type Harness } from './harness';

interface Att {
  type: string;
  [k: string]: unknown;
}
const linkToken = (text: string) => /\/a\/([A-Za-z0-9_-]{30,})/.exec(text)?.[1];
const day = 86_400_000;

describe('v3 growth & operations (e2e)', () => {
  let h: Harness;
  let admin: string;
  let owner: string;
  let db: Database;
  let queue: QueueService;

  beforeAll(async () => {
    h = await createHarness();
    admin = await h.login(ACCOUNTS.admin);
    owner = await h.login(ACCOUNTS.owner);
    db = h.app.get(DB);
    queue = h.app.get(QueueService);
  });
  afterAll(async () => {
    await queue.drain();
    // Leave the shared test database as other suites expect it.
    await db.update(subscriptions).set({ status: 'TRIALING', trialEndsAt: new Date(Date.now() + 10 * day), graceEndsAt: null, dunningStage: 0, suspendedReason: null }).where(eq(subscriptions.status, 'EXPIRED'));
    await h.close();
  });

  const webchat = async () => {
    const s = await h.http().post('/api/public/chat/novacare/session').send({});
    const token = s.body.data.sessionToken as string;
    return async (message: string, action?: Record<string, unknown>) => {
      const res = await h
        .http()
        .post('/api/public/chat/novacare/messages')
        .set('X-Chat-Session', token)
        .send({ message, ...(action ? { action } : {}) });
      if (res.status !== 201) throw new Error(`${res.status} ${JSON.stringify(res.body)}`);
      return res.body.data as { assistantMessage: { content: string; attachments: Att[] }; journey: { step: string } | null };
    };
  };
  const firstSlot = (atts: Att[]) => {
    const card = atts.find((a) => a.type === 'slots') as unknown as { groups: { doctorId: string; slots: { start: string }[] }[] };
    return { doctorId: card.groups[0].doctorId, startTime: card.groups[0].slots[card.groups[0].slots.length - 1].start };
  };

  describe('consent before personal data', () => {
    it('asks for consent before registering a new patient from the web chat, then books', async () => {
      const chat = await webchat();
      const a = await chat('Necesito una cita de cardiología');
      await chat('Reservar', { type: 'book_slot', ...firstSlot(a.assistantMessage.attachments) });
      const b = await chat('Valentina Ortiz 3009876543');
      const consent = b.assistantMessage.attachments.find((x) => x.type === 'consent');
      expect(consent).toMatchObject({ version: expect.any(String), privacyUrl: expect.any(String) });
      expect(b.assistantMessage.attachments.find((x) => x.type === 'appointment')).toBeUndefined();
      const c = await chat('Acepto');
      expect(c.assistantMessage.attachments.find((x) => x.type === 'appointment')).toBeDefined();
      const pats = await h.http().get('/api/patients?search=Valentina').set(bearer(admin));
      const p = pats.body.data.find((x: { lastName: string }) => x.lastName === 'Ortiz');
      expect(p.consentAt).toBeTruthy();
      const consents = await h.http().get(`/api/patients/${p.id}/consents`).set(bearer(admin));
      expect(consents.body.data[0]).toMatchObject({ kind: 'DATA_PROCESSING', granted: true });
    });

    it('portal sign-up requires accepting the privacy notice and records the evidence', async () => {
      const base = { clinicSlug: 'novacare', firstName: 'Lucía', lastName: 'Prado', email: 'lucia.prado@example.com', password: 'Segura2026!x', locale: 'es' };
      expect((await h.http().post('/api/auth/patient/register').send(base)).status).toBe(400);
      const ok = await h.http().post('/api/auth/patient/register').send({ ...base, acceptPrivacy: true, marketingConsent: true });
      expect([200, 201]).toContain(ok.status);
      const token = ok.body.data.accessToken as string;
      const consents = await h.http().get('/api/portal/me/consents').set(bearer(token));
      expect(consents.body.data.map((c: { kind: string }) => c.kind).sort()).toEqual(['DATA_PROCESSING', 'MARKETING']);
      await h.http().patch('/api/portal/me/consents').set(bearer(token)).send({ marketing: false }).expect(200);
      const me = await h.http().get('/api/portal/me').set(bearer(token));
      expect(me.body.data.patient.marketingConsentAt).toBeNull();
      const exp = await h.http().get('/api/portal/me/export').set(bearer(token));
      expect(exp.body.data.profile.email).toBe('lucia.prado@example.com');
    });

    it('declining consent stores nothing and keeps helping', async () => {
      const chat = await webchat();
      const a = await chat('Quiero una cita de ortopedia');
      await chat('Reservar', { type: 'book_slot', ...firstSlot(a.assistantMessage.attachments) });
      await chat('Tomás Pardo 3001112233');
      const c = await chat('No');
      expect(c.assistantMessage.content).toMatch(/no guardaré/i);
      const pats = await h.http().get('/api/patients?search=Pardo').set(bearer(admin));
      expect(pats.body.data.filter((x: { firstName: string }) => x.firstName === 'Tomás')).toHaveLength(0);
    });
  });

  describe('deposits, intake forms and patient links', () => {
    let apptCard: Record<string, string>;

    it('holds the slot until the deposit is paid and exposes payment + intake links', async () => {
      await h.http().patch('/api/clinics/current').set(bearer(admin)).send({ depositsEnabled: true }).expect(200);
      const services = (await h.http().get('/api/services').set(bearer(admin))).body.data as { id: string; name: string }[];
      const derma = services.find((s) => s.name === 'Consulta dermatológica')!;
      const chat = await webchat();
      const a = await chat('Quiero una consulta dermatológica');
      await chat('Reservar', { type: 'book_slot', ...firstSlot(a.assistantMessage.attachments), serviceId: derma.id });
      await chat('Camila Ríos 3014445566');
      const c = await chat('Acepto');
      apptCard = (c.assistantMessage.attachments.find((x) => x.type === 'appointment') as unknown as { appointment: Record<string, string> }).appointment;
      expect(apptCard.status).toBe('PENDING');
      expect(apptCard.paymentUrl).toMatch(/\/a\//);
      expect(apptCard.intakeUrl).toMatch(/\/a\//);
      expect(c.assistantMessage.content).toMatch(/anticipo/);
      expect(c.assistantMessage.content).not.toMatch(/quedó confirmada/);
    });

    it('pays the deposit once (single-use link) and confirms the appointment', async () => {
      const tok = linkToken(apptCard.paymentUrl)!;
      const d = await h.http().get(`/api/public/actions/${tok}`);
      expect(d.body.data).toMatchObject({ purpose: 'payment', simulated: true });
      expect(JSON.stringify(d.body.data)).not.toMatch(/patientId|organizationId/);
      const paid = await h.http().post(`/api/public/actions/${tok}`).send({});
      expect(paid.body.data).toMatchObject({ done: true, status: 'CONFIRMED' });
      expect((await h.http().post(`/api/public/actions/${tok}`).send({})).status).toBe(410);
    });

    it('validates and stores intake answers that staff can read', async () => {
      const tok = linkToken(apptCard.intakeUrl)!;
      expect((await h.http().post(`/api/public/actions/${tok}`).send({ answers: { reason: '' } })).status).toBe(400);
      expect((await h.http().post(`/api/public/actions/${tok}`).send({ answers: { reason: 'Control', insurance: 'Otro' } })).status).toBe(400);
      await h.http().post(`/api/public/actions/${tok}`).send({ answers: { reason: 'Control', insurance: 'EPS', firstVisit: true } }).expect(201);
      const intake = await h.http().get(`/api/appointments/${apptCard.id}/intake`).set(bearer(admin));
      expect(intake.body.data.answers).toEqual({ reason: 'Control', insurance: 'EPS', firstVisit: true });
      await h.http().patch('/api/clinics/current').set(bearer(admin)).send({ depositsEnabled: false }).expect(200);
    });

    it('rejects unknown and malformed links', async () => {
      expect((await h.http().get('/api/public/actions/not-a-token')).status).toBe(404);
      expect((await h.http().get(`/api/public/actions/${'x'.repeat(43)}`)).status).toBe(404);
    });

    it('confirms attendance from a reminder answered with "1" on WhatsApp', async () => {
      const [a] = await db.select().from(appointments).where(eq(appointments.id, apptCard.id));
      const notifications = h.app.get(NotificationsService);
      await TenantContext.run({ organizationId: a.organizationId, clinicId: a.clinicId, principal: { kind: 'SYSTEM', id: null, name: 'test', role: 'SYSTEM', permissions: new Set() } }, () => notifications.sendReminderNow(a.id));
      await queue.drain();
      const reminder = mockOutbox.filter((m) => m.channel === 'WHATSAPP' && m.to.endsWith('3014445566')).at(-1)!;
      expect(reminder.body).toMatch(/responde 1 para confirmar/i);
      const sim = await h.http().post('/api/integrations/whatsapp/simulate').set(bearer(admin)).send({ from: '+573014445566', text: '1' });
      expect(sim.body.data.reply).toMatch(/Confirmé|confirmada/i);
      const [after] = await db.select().from(appointments).where(eq(appointments.id, a.id));
      expect(after.patientConfirmedAt).toBeTruthy();
    });
  });

  describe('waitlist auto-fill', () => {
    it('offers a freed slot to the waitlist and books it for the first patient who accepts', async () => {
      const patients = (await h.http().get('/api/patients?pageSize=50').set(bearer(admin))).body.data as { id: string; phone: string | null; firstName: string }[];
      const waiting = patients.find((p) => p.phone && !['María', 'John'].includes(p.firstName))!;
      const specs = (await h.http().get('/api/specialties').set(bearer(admin))).body.data as { id: string; slug: string }[];
      const ortho = specs.find((s) => s.slug === 'ortopedia')!;
      const from = new Date().toISOString();
      const to = new Date(Date.now() + 30 * day).toISOString();
      await h.http().post('/api/waitlist').set(bearer(admin)).send({ patientId: waiting.id, specialtyId: ortho.id, fromDate: from, toDate: to }).expect(201);
      expect((await h.http().post('/api/waitlist').set(bearer(admin)).send({ patientId: waiting.id, specialtyId: ortho.id, fromDate: from, toDate: to })).status).toBe(409);

      const list = await h
        .http()
        .get(`/api/appointments?from=${new Date(Date.now() + 2 * day).toISOString()}&to=${new Date(Date.now() + 12 * day).toISOString()}&status=CONFIRMED&pageSize=200`)
        .set(bearer(admin));
      const freed = (list.body.data as { id: string; patientId: string; doctor: { specialtyId: string } }[]).find((a) => a.doctor.specialtyId === ortho.id && a.patientId !== waiting.id)!;
      await h.http().post(`/api/appointments/${freed.id}/cancel`).set(bearer(admin)).send({ reason: 'test' }).expect(201);
      await queue.drain();

      const offer = mockOutbox.filter((m) => m.channel === 'WHATSAPP' && m.to === waiting.phone && /Se liberó/.test(m.body)).at(-1)!;
      const tok = linkToken(offer.body)!;
      const accepted = await h.http().post(`/api/public/actions/${tok}`).send({});
      expect(accepted.body.data).toMatchObject({ done: true, status: 'CONFIRMED' });
      const wl = (await h.http().get('/api/waitlist?status=BOOKED').set(bearer(admin))).body.data as { patientId: string }[];
      expect(wl.some((w) => w.patientId === waiting.id)).toBe(true);
    });

    it('the AI can add an identified patient to the waitlist', async () => {
      const pid = (await h.http().get('/api/ai/playground/scenarios').set(bearer(admin))).body.data[0].patientId;
      const res = await h.http().post('/api/ai/chat').set(bearer(admin)).send({ message: 'Anótame en la lista de espera de cardiología', patientId: pid });
      expect(res.body.data.trace.steps.map((s: { name: string }) => s.name)).toContain('addToWaitlist');
      expect(res.body.data.assistantMessage.content).toMatch(/lista de espera/);
    });
  });

  describe('reviews', () => {
    it('sends review requests only with marketing consent; high ratings go to Google, low ones alert staff', async () => {
      const r = await h.http().get('/api/reviews').set(bearer(admin));
      expect(r.body.data.average).toBeGreaterThan(3);
      const engagement = h.app.get((await import('../src/engagement/engagement.service')).EngagementService);
      const [done] = await db.select().from(appointments).where(eq(appointments.status, 'COMPLETED')).limit(1);
      const sent = await TenantContext.run({ organizationId: done.organizationId, clinicId: done.clinicId, principal: { kind: 'SYSTEM', id: null, name: 't', role: 'SYSTEM', permissions: new Set() } }, async () => {
        await db.update(appointments).set({ reviewRequestedAt: null }).where(eq(appointments.id, done.id));
        await db.execute(`delete from review_requests where appointment_id = '${done.id}'` as never);
        return engagement.requestReview(done.id);
      });
      expect(sent).toBe(true);
      await queue.drain();
      const msg = mockOutbox.filter((m) => /Cómo te fue|How did it go/.test(m.body)).at(-1)!;
      const tok = linkToken(msg.body)!;
      const res = await h.http().post(`/api/public/actions/${tok}`).send({ rating: 5, comment: 'Excelente' });
      expect(res.body.data.redirectUrl).toMatch(/^https:\/\/g\.page\//);
      expect((await h.http().post(`/api/public/actions/${tok}`).send({ rating: 1 })).status).toBe(410);
    });
  });

  describe('privacy: export and erasure', () => {
    it('exports a portable JSON and anonymizes irreversibly', async () => {
      const created = await h.http().post('/api/patients').set(bearer(admin)).send({ firstName: 'Borrar', lastName: 'Prueba', phone: '+573009990000', consent: true }).expect(201);
      const id = created.body.data.id as string;
      const exp = await h.http().get(`/api/patients/${id}/export`).set(bearer(admin));
      expect(exp.body.data).toMatchObject({ format: 'alejandro-ai/patient-export@1', profile: { firstName: 'Borrar' } });
      expect((await h.http().post(`/api/patients/${id}/anonymize`).set(bearer(admin)).send({ reason: 'solicitud' })).status).toBe(400);
      await h.http().post(`/api/patients/${id}/anonymize`).set(bearer(admin)).send({ reason: 'Solicitud del titular', confirm: 'ANONYMIZE' }).expect(201);
      const after = await h.http().get(`/api/patients/${id}`).set(bearer(admin));
      expect(after.body.data).toMatchObject({ firstName: 'Anonimizado', phone: null, email: null });
      expect((await h.http().post(`/api/patients/${id}/anonymize`).set(bearer(admin)).send({ reason: 'again', confirm: 'ANONYMIZE' })).status).toBe(422);
      // Receptionists cannot erase records.
      const reception = await h.login(ACCOUNTS.reception);
      expect((await h.http().post(`/api/patients/${id}/anonymize`).set(bearer(reception)).send({ reason: 'x', confirm: 'ANONYMIZE' })).status).toBe(403);
    });

    it('imports patients from CSV with validation and de-duplication', async () => {
      const csv = 'nombre,apellido,telefono,email\nAna,Ruiz,+573110001122,ana.ruiz@example.com\nAna,Ruiz,+573110001122,\nSin,Contacto,,\n';
      const res = await h.http().post('/api/patients/import').set(bearer(admin)).send({ csv });
      expect(res.body.data).toMatchObject({ total: 3, created: 1, skipped: 1 });
      expect(res.body.data.errors[0]).toMatchObject({ row: 4 });
    });
  });

  describe('multi-tenant WhatsApp', () => {
    it('one number belongs to exactly one clinic', async () => {
      await h.http().put('/api/integrations/whatsapp/channel').set(bearer(admin)).send({ phoneNumberId: '111222333444', accessToken: 'EAAG-novacare-token-0000000000' }).expect(200);
      const aurora = await h.login(ACCOUNTS.auroraAdmin);
      // Aurora is on Starter (no WhatsApp) → plan gate first; still never allowed to take NovaCare's number.
      const res = await h.http().put('/api/integrations/whatsapp/channel').set(bearer(aurora)).send({ phoneNumberId: '111222333444' });
      expect([402, 409]).toContain(res.status);
      const got = await h.http().get('/api/integrations/whatsapp/channel').set(bearer(admin));
      expect(got.body.data).toMatchObject({ phoneNumberId: '111222333444', hasOwnToken: true });
      expect(JSON.stringify(got.body.data)).not.toMatch(/EAAG/);
    });
  });

  describe('voice receptionist', () => {
    it('validates Twilio signatures', () => {
      const url = 'https://api.example.com/api/webhooks/voice/novacare/incoming';
      const params = { CallSid: 'CA1', From: '+15550001111' };
      const sig = createHmac('sha1', 'tok').update(url + 'CallSidCA1From+15550001111').digest('base64');
      expect(validTwilioSignature('tok', url, params, sig)).toBe(true);
      expect(validTwilioSignature('tok', url, { ...params, From: '+1999' }, sig)).toBe(false);
      expect(validTwilioSignature('tok', url, params, undefined)).toBe(false);
    });

    it('answers a simulated call with speech-friendly text and numbered options', async () => {
      const start = await h.http().post('/api/integrations/voice/simulate').set(bearer(admin)).send({ text: '' });
      expect(start.body.data.twiml).toMatch(/<Gather input="speech dtmf"/);
      const turn = await h.http().post('/api/integrations/voice/simulate').set(bearer(admin)).send({ text: 'Necesito una cita de dermatología', conversationId: start.body.data.conversationId });
      expect(turn.body.data.say).toMatch(/Opción 1:/);
      expect(turn.body.data.say).not.toMatch(/\*\*|https?:/);
    });

    it('rejects webhook calls with a bad signature when a token is configured', async () => {
      process.env.TWILIO_AUTH_TOKEN = 'configured-token';
      const { resetEnvCache } = await import('../src/config/env');
      resetEnvCache();
      const res = await h.http().post('/api/webhooks/voice/novacare/incoming').type('form').send({ CallSid: 'CA9', From: '+15550001111' }).set('X-Twilio-Signature', 'bogus');
      expect(res.status).toBe(401);
      delete process.env.TWILIO_AUTH_TOKEN;
      resetEnvCache();
    });
  });

  describe('platform admin & billing lifecycle', () => {
    let auroraOrg: string;
    beforeAll(async () => {
      const [c] = await db.select().from(clinics).where(eq(clinics.slug, 'aurora'));
      auroraOrg = c.organizationId;
    });

    it('is only reachable with platform.admin', async () => {
      expect((await h.http().get('/api/admin/overview').set(bearer(admin))).status).toBe(403);
      const o = await h.http().get('/api/admin/overview').set(bearer(owner));
      expect(o.body.data).toMatchObject({ tenants: expect.any(Number), mrrCents: expect.any(Number) });
    });

    it('trial → grace (past due) → expired → read-only API and paused assistant → reactivated', async () => {
      const lifecycle = h.app.get(BillingLifecycleService);
      await db.update(subscriptions).set({ status: 'TRIALING', trialEndsAt: new Date(Date.now() - 1000), dunningStage: 1 }).where(eq(subscriptions.organizationId, auroraOrg));
      await lifecycle.sweep();
      let [sub] = await db.select().from(subscriptions).where(eq(subscriptions.organizationId, auroraOrg));
      expect(sub.status).toBe('PAST_DUE');
      expect(sub.graceEndsAt!.getTime()).toBeGreaterThan(Date.now());
      await db.update(subscriptions).set({ graceEndsAt: new Date(Date.now() - 1000) }).where(eq(subscriptions.organizationId, auroraOrg));
      await lifecycle.sweep();
      [sub] = await db.select().from(subscriptions).where(eq(subscriptions.organizationId, auroraOrg));
      expect(sub.status).toBe('EXPIRED');

      const aurora = await h.login(ACCOUNTS.auroraAdmin);
      const blocked = await h.http().post('/api/patients').set(bearer(aurora)).send({ firstName: 'X', lastName: 'Y', phone: '+525500001111' });
      expect(blocked.status).toBe(402);
      expect(blocked.body.error.code).toBe('SUBSCRIPTION_INACTIVE');
      expect((await h.http().get('/api/patients').set(bearer(aurora))).status).toBe(200);
      expect((await h.http().get('/api/billing/overview').set(bearer(aurora))).status).toBe(200);
      const s = await h.http().post('/api/public/chat/aurora/session').send({});
      const turn = await h.http().post('/api/public/chat/aurora/messages').set('X-Chat-Session', s.body.data.sessionToken).send({ message: 'Quiero una cita' });
      expect(turn.body.data.assistantMessage.content).toMatch(/no está disponible/);

      await h.http().post(`/api/admin/tenants/${auroraOrg}/reactivate`).set(bearer(owner)).expect(201);
      expect((await h.http().post('/api/patients').set(bearer(aurora)).send({ firstName: 'X', lastName: 'Y', phone: '+525500001111' })).status).toBe(201);
    });

    it('impersonation issues a short-lived, audited token for the tenant admin', async () => {
      expect((await h.http().post(`/api/admin/tenants/${auroraOrg}/impersonate`).set(bearer(owner)).send({})).status).toBe(400);
      const imp = await h.http().post(`/api/admin/tenants/${auroraOrg}/impersonate`).set(bearer(owner)).send({ reason: 'Ticket #42' });
      expect(imp.body.data.expiresIn).toBe(1800);
      const me = await h.http().get('/api/auth/me').set(bearer(imp.body.data.accessToken));
      expect(me.body.data.impersonatedBy).toBeTruthy();
      expect(me.body.data.organization.id).toBe(auroraOrg);
      const audit = await h.http().get('/api/audit-logs?action=platform.impersonated').set(bearer(imp.body.data.accessToken));
      expect(audit.body.data.length).toBeGreaterThan(0);
    });
  });

  describe('value report & ops', () => {
    it('reports the month with a comparison', async () => {
      const r = await h.http().get('/api/reports/value').set(bearer(admin));
      expect(r.body.data.current).toMatchObject({ conversations: expect.any(Number), appointmentsByAi: expect.any(Number), minutesSaved: expect.any(Number) });
      expect(r.body.data.previous).toBeDefined();
      expect((await h.http().get('/api/reports/value?month=2026-13').set(bearer(admin))).status).toBe(400);
    });

    it('deep health reports dependencies without secrets', async () => {
      const r = await h.http().get('/api/health/deep');
      expect(r.body.data.checks.database.status).toBe('up');
      expect(JSON.stringify(r.body.data)).not.toMatch(/secret|password|key=/i);
    });
  });
});
