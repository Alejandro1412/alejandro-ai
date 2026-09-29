import { ACCOUNTS, PASSWORD, bearer, createHarness, type Harness } from './harness';

const cookieFrom = (res: { headers: Record<string, unknown> }): string => {
  const raw = res.headers['set-cookie'] as string[] | string | undefined;
  const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
  const rt = list.find((c) => c.startsWith('aai_rt='));
  if (!rt) throw new Error('refresh cookie missing');
  return rt.split(';')[0];
};

describe('Auth, RBAC and tenant isolation (e2e)', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await createHarness();
  });
  afterAll(async () => {
    await h.close();
  });

  describe('auth', () => {
    it('rejects bad credentials with the standard error envelope', async () => {
      const res = await h.http().post('/api/auth/login').send({ email: ACCOUNTS.admin, password: 'wrong-password' });
      expect(res.status).toBe(401);
      expect(res.body).toEqual({ success: false, error: expect.objectContaining({ code: expect.any(String), message: expect.any(String) }) });
    });

    it('validates input and reports details', async () => {
      const res = await h.http().post('/api/auth/login').send({ email: 'not-an-email' });
      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('logs in, sets an httpOnly refresh cookie and never returns the refresh token in the body', async () => {
      const res = await h.http().post('/api/auth/login').send({ email: ACCOUNTS.reception, password: PASSWORD });
      expect(res.status).toBe(200);
      expect(res.body.data.accessToken).toEqual(expect.any(String));
      expect(JSON.stringify(res.body)).not.toContain('refreshToken');
      const raw = (res.headers['set-cookie'] as unknown as string[]).join(';');
      expect(raw).toMatch(/aai_rt=.*HttpOnly/i);

      const me = await h.http().get('/api/auth/me').set(bearer(res.body.data.accessToken));
      expect(me.status).toBe(200);
      expect(me.body.data.user.email).toBe(ACCOUNTS.reception);
      expect(me.body.data).not.toHaveProperty('user.passwordHash');
    });

    it('rotates refresh tokens and revokes the whole family on reuse', async () => {
      const login = await h.http().post('/api/auth/login').send({ email: ACCOUNTS.doctor, password: PASSWORD });
      const first = cookieFrom(login);

      const rotated = await h.http().post('/api/auth/refresh').set('Cookie', first);
      expect(rotated.status).toBe(200);
      const second = cookieFrom(rotated);
      expect(second).not.toBe(first);

      // Replaying the already-rotated token is treated as theft…
      const replay = await h.http().post('/api/auth/refresh').set('Cookie', first);
      expect(replay.status).toBe(401);
      // …and the legitimate successor is revoked too.
      const after = await h.http().post('/api/auth/refresh').set('Cookie', second);
      expect(after.status).toBe(401);
    });

    it('requires authentication on protected routes', async () => {
      const res = await h.http().get('/api/patients');
      expect(res.status).toBe(401);
      const forged = await h.http().get('/api/patients').set('Authorization', 'Bearer abc.def.ghi');
      expect(forged.status).toBe(401);
    });
  });

  describe('RBAC (enforced in the backend)', () => {
    it('receptionist cannot read the audit log, admin can', async () => {
      const reception = await h.login(ACCOUNTS.reception);
      const admin = await h.login(ACCOUNTS.admin);
      expect((await h.http().get('/api/audit-logs').set(bearer(reception))).status).toBe(403);
      const ok = await h.http().get('/api/audit-logs').set(bearer(admin));
      expect(ok.status).toBe(200);
      expect(ok.body.data.length).toBeGreaterThan(0);
    });

    it('patients cannot use staff endpoints', async () => {
      const patient = await h.login(ACCOUNTS.patient);
      expect((await h.http().get('/api/patients').set(bearer(patient))).status).toBe(403);
      expect((await h.http().get('/api/analytics/overview').set(bearer(patient))).status).toBe(403);
      const portal = await h.http().get('/api/portal/me').set(bearer(patient));
      expect(portal.status).toBe(200);
    });

    it('doctor can read but not change clinic settings', async () => {
      const doctor = await h.login(ACCOUNTS.doctor);
      expect((await h.http().get('/api/doctors').set(bearer(doctor))).status).toBe(200);
      expect((await h.http().patch('/api/clinics/current').set(bearer(doctor)).send({ name: 'Hacked' })).status).toBe(403);
    });

    it('staff cannot use the patient portal', async () => {
      const reception = await h.login(ACCOUNTS.reception);
      expect((await h.http().get('/api/portal/me').set(bearer(reception))).status).toBe(403);
    });
  });

  describe('tenant isolation', () => {
    it('a clinic never sees another clinic’s patients, doctors or appointments', async () => {
      const nova = await h.login(ACCOUNTS.admin);
      const aurora = await h.login(ACCOUNTS.auroraAdmin);

      const novaPatients = await h.http().get('/api/patients?pageSize=5').set(bearer(nova));
      const novaPatientId = novaPatients.body.data[0].id as string;
      const novaDoctors = await h.http().get('/api/doctors').set(bearer(nova));
      const novaDoctorId = novaDoctors.body.data[0].id as string;
      const novaAppts = await h.http().get('/api/appointments?pageSize=1').set(bearer(nova));
      const novaApptId = novaAppts.body.data[0].id as string;

      expect((await h.http().get(`/api/patients/${novaPatientId}`).set(bearer(aurora))).status).toBe(404);
      expect((await h.http().get(`/api/doctors/${novaDoctorId}`).set(bearer(aurora))).status).toBe(404);
      expect((await h.http().get(`/api/appointments/${novaApptId}`).set(bearer(aurora))).status).toBe(404);
      expect((await h.http().post(`/api/appointments/${novaApptId}/cancel`).set(bearer(aurora)).send({})).status).toBe(404);

      const auroraPatients = await h.http().get('/api/patients?pageSize=100').set(bearer(aurora));
      expect(auroraPatients.body.data.map((p: { id: string }) => p.id)).not.toContain(novaPatientId);
      const auroraDoctors = await h.http().get('/api/doctors').set(bearer(aurora));
      expect(auroraDoctors.body.data.map((d: { id: string }) => d.id)).not.toContain(novaDoctorId);
    });

    it('cannot book an appointment for another tenant’s patient', async () => {
      const nova = await h.login(ACCOUNTS.admin);
      const aurora = await h.login(ACCOUNTS.auroraAdmin);
      const novaPatientId = (await h.http().get('/api/patients?pageSize=1').set(bearer(nova))).body.data[0].id;
      const auroraDoctorId = (await h.http().get('/api/doctors').set(bearer(aurora))).body.data[0].id;
      const res = await h
        .http()
        .post('/api/appointments')
        .set(bearer(aurora))
        .send({ doctorId: auroraDoctorId, patientId: novaPatientId, startTime: new Date(Date.now() + 3 * 86_400_000).toISOString() });
      expect(res.status).toBe(404);
    });
  });
});
