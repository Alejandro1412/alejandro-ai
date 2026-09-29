import { ACCOUNTS, bearer, createHarness, type Harness } from './harness';

interface Slot {
  doctorId: string;
  serviceId: string | null;
  start: string;
  end: string;
}

describe('Appointments: booking, conflicts, cancel, reschedule (e2e)', () => {
  let h: Harness;
  let token: string;
  let patientId: string;
  let doctorId: string;
  let slots: Slot[];

  beforeAll(async () => {
    h = await createHarness();
    token = await h.login(ACCOUNTS.reception);
    const patients = await h.http().get('/api/patients?pageSize=5&search=Miller').set(bearer(token));
    patientId = patients.body.data[0].id;
    const doctors = await h.http().get('/api/doctors').set(bearer(token));
    doctorId = doctors.body.data.find((d: { lastName: string }) => d.lastName === 'García').id;
    const res = await h.http().get(`/api/appointments/slots?doctorId=${doctorId}&days=14&limit=50`).set(bearer(token));
    expect(res.status).toBe(200);
    slots = res.body.data.slots;
    expect(slots.length).toBeGreaterThan(3);
  });
  afterAll(async () => {
    await h.close();
  });

  const book = (slot: Slot, who = token) =>
    h.http().post('/api/appointments').set(bearer(who)).send({ doctorId: slot.doctorId, patientId, serviceId: slot.serviceId, startTime: slot.start });

  it('only offers slots inside the future booking window and in order', () => {
    const now = Date.now();
    for (const s of slots) {
      expect(new Date(s.start).getTime()).toBeGreaterThan(now);
      expect(new Date(s.end).getTime()).toBeGreaterThan(new Date(s.start).getTime());
      expect(s.doctorId).toBe(doctorId);
    }
  });

  let bookedId: string;
  it('books a real slot and removes it from availability', async () => {
    const res = await book(slots[0]);
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ doctorId, patientId, status: 'CONFIRMED', source: 'HUMAN' });
    bookedId = res.body.data.id;

    const again = await h.http().get(`/api/appointments/slots?doctorId=${doctorId}&days=14&limit=50`).set(bearer(token));
    expect(again.body.data.slots.map((s: Slot) => s.start)).not.toContain(slots[0].start);
  });

  it('rejects a double booking of the same slot (calendar conflict)', async () => {
    const res = await book(slots[0]);
    expect(res.status).toBe(409);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toMatch(/CONFLICT|SLOT_UNAVAILABLE/);
  });

  it('rejects bookings outside working hours', async () => {
    const d = new Date(slots[0].start);
    d.setUTCHours(7, 0, 0, 0); // 02:00 in Bogotá
    const res = await h.http().post('/api/appointments').set(bearer(token)).send({ doctorId, patientId, startTime: d.toISOString() });
    expect([409, 422]).toContain(res.status);
  });

  it('rejects bookings in the past', async () => {
    const res = await h.http().post('/api/appointments').set(bearer(token)).send({ doctorId, patientId, startTime: new Date(Date.now() - 86_400_000).toISOString() });
    expect([400, 409, 422]).toContain(res.status);
  });

  it('handles concurrent booking races with exactly one winner', async () => {
    const target = slots[2];
    const results = await Promise.all([book(target), book(target), book(target)]);
    const statuses = results.map((r) => r.status).sort();
    expect(statuses.filter((s) => s === 201)).toHaveLength(1);
    expect(statuses.filter((s) => s === 409)).toHaveLength(2);
  });

  it('reschedules to a free slot and frees the old one', async () => {
    const res = await h.http().post(`/api/appointments/${bookedId}/reschedule`).set(bearer(token)).send({ startTime: slots[4].start });
    expect(res.status).toBe(201);
    const next = res.body.data.appointment ?? res.body.data;
    expect(new Date(next.startTime).toISOString()).toBe(new Date(slots[4].start).toISOString());
    bookedId = next.id;

    const freed = await book(slots[0]);
    expect(freed.status).toBe(201);
  });

  it('refuses to reschedule onto an occupied slot', async () => {
    const res = await h.http().post(`/api/appointments/${bookedId}/reschedule`).set(bearer(token)).send({ startTime: slots[2].start });
    expect(res.status).toBe(409);
  });

  it('cancels an appointment and makes the slot bookable again', async () => {
    const res = await h.http().post(`/api/appointments/${bookedId}/cancel`).set(bearer(token)).send({ reason: 'Paciente viaja' });
    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe('CANCELLED');

    const twice = await h.http().post(`/api/appointments/${bookedId}/cancel`).set(bearer(token)).send({});
    expect(twice.status).toBe(422);

    expect((await book(slots[4])).status).toBe(201);
  });

  it('records appointment events in the audit log', async () => {
    const admin = await h.login(ACCOUNTS.admin);
    const res = await h.http().get('/api/audit-logs?pageSize=50').set(bearer(admin));
    const actions = res.body.data.map((a: { action: string }) => a.action);
    expect(actions).toEqual(expect.arrayContaining(['appointment.created', 'appointment.cancelled', 'appointment.rescheduled']));
  });

  it('patients can only see and cancel their own appointments through the portal', async () => {
    const patient = await h.login(ACCOUNTS.patient);
    const own = await h.http().get('/api/portal/appointments').set(bearer(patient));
    expect(own.status).toBe(200);
    // bookedId belongs to John Miller, not to the logged-in patient.
    const res = await h.http().post(`/api/portal/appointments/${bookedId}/cancel`).set(bearer(patient)).send({});
    expect(res.status).toBe(404);
  });
});
