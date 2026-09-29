import { z } from 'zod';
import type { Attachment } from '../../attachments';
import { doctorDisplayName } from '../../../common/utils/time';
import { AppError } from '../../../common/errors/app-error';
import { norm } from '../../policy/text';
import { defineTool, ToolContext, ToolFailure } from '../tool';
import { slotItem, toCard, ToolDeps } from '../tool-deps';

const slotShape = z.object({ doctorId: z.string(), doctorName: z.string(), specialty: z.string().nullable(), start: z.string(), end: z.string() });
const slotsOutput = z.object({
  timezone: z.string(),
  from: z.string(),
  to: z.string(),
  extended: z.boolean(),
  serviceId: z.string().nullable(),
  rescheduleAppointmentId: z.string().nullable(),
  slots: z.array(slotShape),
});
type SlotsOutput = z.infer<typeof slotsOutput>;

const cardShape = z.object({
  id: z.string(),
  doctorId: z.string(),
  doctorName: z.string(),
  specialty: z.string().nullable(),
  serviceName: z.string().nullable(),
  start: z.string(),
  end: z.string(),
  when: z.string(),
  status: z.string(),
  location: z.string().nullable(),
});

function presentSlots(out: SlotsOutput, ctx: ToolContext): Attachment[] {
  if (!out.slots.length) return [];
  const groups = new Map<string, { doctorId: string; doctorName: string; specialty: string | null; slots: ReturnType<typeof slotItem>[] }>();
  for (const s of out.slots) {
    const g = groups.get(s.doctorId) ?? { doctorId: s.doctorId, doctorName: s.doctorName, specialty: s.specialty, slots: [] };
    g.slots.push(slotItem(s.start, s.end, out.timezone, ctx.language));
    groups.set(s.doctorId, g);
  }
  return [
    {
      type: 'slots',
      mode: out.rescheduleAppointmentId ? 'reschedule' : 'book',
      appointmentId: out.rescheduleAppointmentId ?? undefined,
      serviceId: out.serviceId,
      timezone: out.timezone,
      groups: [...groups.values()],
    },
  ];
}

/** Maps domain errors to recoverable tool failures the model can explain. */
function asToolFailure(err: unknown): never {
  if (err instanceof AppError) throw new ToolFailure(err.code, err.message, err.code === 'APPOINTMENT_CONFLICT' ? 'Offer other slots via getAvailableAppointmentSlots' : undefined);
  throw err;
}

export function schedulingTools(d: ToolDeps) {
  async function resolveSpecialty(name?: string) {
    if (!name) return undefined;
    const q = norm(name);
    const list = await d.clinics.listSpecialties();
    return list.find((s) => [s.name, s.nameEn ?? '', s.slug, ...(s.keywords ?? [])].map(norm).some((n) => n && (n.includes(q.slice(0, 7)) || q.includes(n.slice(0, 7)))));
  }

  async function searchSlots(
    input: { doctorId?: string; specialty?: string; serviceId?: string; fromDate?: string; toDate?: string; timeOfDay?: 'MORNING' | 'AFTERNOON'; rescheduleAppointmentId?: string },
    ctx: ToolContext,
  ): Promise<SlotsOutput> {
    const specialty = input.doctorId ? undefined : await resolveSpecialty(input.specialty);
    if (input.specialty && !specialty && !input.doctorId) throw new ToolFailure('SPECIALTY_NOT_FOUND', `The clinic has no specialty matching "${input.specialty}"`, 'Call getDoctors or getServices to see what the clinic offers');
    let excludeId: string | undefined;
    if (input.rescheduleAppointmentId) {
      if (!ctx.patientId) throw new ToolFailure('PATIENT_NOT_IDENTIFIED', 'Identify the patient first');
      await d.appointments.getForPatient(input.rescheduleAppointmentId, ctx.patientId).catch(asToolFailure);
      excludeId = input.rescheduleAppointmentId;
    }
    const now = new Date();
    let from = input.fromDate ? new Date(input.fromDate) : now;
    if (from < now) from = now;
    let to = input.toDate ? new Date(input.toDate) : new Date(from.getTime() + 7 * 86_400_000);
    if (to <= from) to = new Date(from.getTime() + 86_400_000);
    const perDoctor = ctx.agent.bookingRules.maxSlotsToOffer ?? 6;
    const query = { doctorIds: input.doctorId ? [input.doctorId] : undefined, specialtyId: specialty?.id, serviceId: input.serviceId, timeOfDay: input.timeOfDay, perDoctorLimit: perDoctor, excludeAppointmentId: excludeId };
    let res = await d.availability.findSlots({ ...query, from, to });
    let extended = false;
    if (!res.slots.length) {
      // Nothing in the requested window: look further ahead so the patient still gets real options.
      const extTo = new Date(to.getTime() + 14 * 86_400_000);
      res = await d.availability.findSlots({ ...query, from: to, to: extTo });
      if (res.slots.length) {
        extended = true;
        from = to;
        to = extTo;
      }
    }
    return {
      timezone: res.timezone,
      from: from.toISOString(),
      to: to.toISOString(),
      extended,
      serviceId: input.serviceId ?? null,
      rescheduleAppointmentId: input.rescheduleAppointmentId ?? null,
      slots: res.slots.slice(0, 12).map((s) => ({ doctorId: s.doctorId, doctorName: s.doctorName, specialty: s.specialty, start: s.start, end: s.end })),
    };
  }

  const slotInput = {
    fromDate: z.string().datetime({ offset: true }).optional().describe('ISO start of the search window (default: now)'),
    toDate: z.string().datetime({ offset: true }).optional().describe('ISO end of the search window (default: +7 days)'),
    timeOfDay: z.enum(['MORNING', 'AFTERNOON']).optional(),
    serviceId: z.string().uuid().optional(),
    rescheduleAppointmentId: z.string().uuid().optional().describe('Set when looking for a new time for an existing appointment'),
  };

  const getDoctors = defineTool({
    name: 'getDoctors',
    description: 'List active doctors, optionally filtered by specialty name (e.g. "dermatología", "cardiology").',
    input: z.object({ specialty: z.string().max(80).optional() }),
    output: z.object({
      doctors: z.array(z.object({ id: z.string(), name: z.string(), specialty: z.string().nullable(), languages: z.array(z.string()), bio: z.string().nullable(), color: z.string(), avatarUrl: z.string().nullable() })),
    }),
    permission: 'doctors.read',
    async execute({ specialty }) {
      const sp = await resolveSpecialty(specialty);
      if (specialty && !sp) return { doctors: [] };
      const rows = await d.doctors.list({ status: 'ACTIVE', specialtyId: sp?.id });
      return {
        doctors: rows.map((r) => ({ id: r.id, name: doctorDisplayName(r), specialty: r.specialty?.name ?? null, languages: r.languages, bio: r.bio, color: r.color, avatarUrl: r.avatarUrl })),
      };
    },
    present(out) {
      return out.doctors.length ? [{ type: 'doctors', doctors: out.doctors }] : [];
    },
  });

  const getDoctorProfile = defineTool({
    name: 'getDoctorProfile',
    description: 'Get a doctor profile (specialty, bio, languages, services, weekly schedule) by id or by name.',
    input: z.object({ doctorId: z.string().uuid().optional(), name: z.string().max(80).optional() }),
    output: z.object({
      id: z.string(),
      name: z.string(),
      specialty: z.string().nullable(),
      bio: z.string().nullable(),
      languages: z.array(z.string()),
      location: z.string().nullable(),
      services: z.array(z.string()),
      weeklySchedule: z.array(z.object({ dayOfWeek: z.number(), from: z.string(), to: z.string() })),
    }),
    permission: 'doctors.read',
    async execute({ doctorId, name }) {
      let id = doctorId;
      if (!id && name) {
        const q = norm(name).replace(/^(dr|dra|doctor|doctora)\.?\s+/, '');
        const all = await d.doctors.list({ status: 'ACTIVE' });
        id = all.find((x) => norm(`${x.firstName} ${x.lastName}`).includes(q) || q.includes(norm(x.lastName)))?.id;
      }
      if (!id) throw new ToolFailure('DOCTOR_NOT_FOUND', 'No doctor matches that name', 'Call getDoctors to list doctors');
      const doc = await d.doctors.get(id).catch(asToolFailure);
      return {
        id: doc.id,
        name: doctorDisplayName(doc),
        specialty: doc.specialty?.name ?? null,
        bio: doc.bio,
        languages: doc.languages,
        location: doc.location ? `${doc.location.name} — ${doc.location.address}` : null,
        services: doc.services.map((s) => s.name),
        weeklySchedule: doc.schedules.map((s) => ({ dayOfWeek: s.dayOfWeek, from: s.startTime, to: s.endTime })),
      };
    },
    present(out) {
      return [{ type: 'doctors', doctors: [{ id: out.id, name: out.name, specialty: out.specialty, bio: out.bio, languages: out.languages, color: '#4f46e5', avatarUrl: null }] }];
    },
  });

  const getDoctorAvailability = defineTool({
    name: 'getDoctorAvailability',
    description: 'Real-time available appointment slots for ONE doctor. Always use this (never the knowledge base) to answer availability questions.',
    input: z.object({ doctorId: z.string().uuid(), ...slotInput }),
    output: slotsOutput,
    permission: 'appointments.read',
    execute: (input, ctx) => searchSlots(input, ctx),
    present: presentSlots,
  });

  const getAvailableAppointmentSlots = defineTool({
    name: 'getAvailableAppointmentSlots',
    description: 'Real-time available slots across doctors, filtered by specialty and/or service and a date window. Returns a few options per doctor spread across days.',
    input: z.object({ specialty: z.string().max(80).optional().describe('Specialty name, e.g. "dermatología"'), doctorId: z.string().uuid().optional(), ...slotInput }),
    output: slotsOutput,
    permission: 'appointments.read',
    execute: (input, ctx) => searchSlots(input, ctx),
    present: presentSlots,
  });

  const createAppointment = defineTool({
    name: 'createAppointment',
    description:
      'Book an appointment for the identified patient in a slot previously returned by an availability tool. Only confirm to the user after this returns success.',
    input: z.object({
      doctorId: z.string().uuid(),
      startTime: z.string().datetime({ offset: true }),
      serviceId: z.string().uuid().optional(),
      notes: z.string().max(300).optional().describe('Administrative note only (no clinical content)'),
    }),
    output: z.object({ appointment: cardShape }),
    permission: 'appointments.create',
    sideEffect: true,
    requiresPatient: true,
    async execute(input, ctx) {
      const appt = await d.appointments
        .create(
          { doctorId: input.doctorId, patientId: ctx.patientId!, serviceId: input.serviceId ?? null, startTime: new Date(input.startTime), notes: input.notes ?? null, status: 'CONFIRMED' },
          { source: ctx.channel === 'WHATSAPP' ? 'WHATSAPP' : 'AI', conversationId: ctx.conversationId },
        )
        .catch(asToolFailure);
      await d.patients.updatePreferences(ctx.patientId!, { preferredDoctorId: input.doctorId });
      return { appointment: toCard(appt, ctx.timezone, ctx.language) };
    },
    present: (out) => [{ type: 'appointment', appointment: out.appointment, state: 'created' }],
  });

  const listPatientAppointments = defineTool({
    name: 'listPatientAppointments',
    description: "List the identified patient's upcoming active appointments.",
    input: z.object({ purpose: z.enum(['list', 'cancel', 'reschedule']).optional() }),
    output: z.object({ purpose: z.string(), appointments: z.array(cardShape) }),
    permission: 'appointments.read',
    requiresPatient: true,
    async execute({ purpose }, ctx) {
      const rows = await d.appointments.upcomingForPatient(ctx.patientId!);
      return { purpose: purpose ?? 'list', appointments: rows.map((a) => toCard(a, ctx.timezone, ctx.language)) };
    },
    present: (out) => (out.appointments.length ? [{ type: 'appointments', purpose: out.purpose as 'list', items: out.appointments }] : []),
  });

  const getAppointment = defineTool({
    name: 'getAppointment',
    description: 'Get one appointment of the identified patient by id.',
    input: z.object({ appointmentId: z.string().uuid() }),
    output: z.object({ appointment: cardShape }),
    permission: 'appointments.read',
    requiresPatient: true,
    async execute({ appointmentId }, ctx) {
      const a = await d.appointments.getForPatient(appointmentId, ctx.patientId!).catch(asToolFailure);
      return { appointment: toCard(a, ctx.timezone, ctx.language) };
    },
    present: (out) => [{ type: 'appointment', appointment: out.appointment, state: 'info' }],
  });

  const cancelAppointment = defineTool({
    name: 'cancelAppointment',
    description: 'Cancel an appointment of the identified patient. Ask the user to confirm first, then call this. Only confirm after success.',
    input: z.object({ appointmentId: z.string().uuid(), reason: z.string().max(300).optional() }),
    output: z.object({ appointment: cardShape }),
    permission: 'appointments.delete',
    sideEffect: true,
    requiresPatient: true,
    async execute({ appointmentId, reason }, ctx) {
      await d.appointments.getForPatient(appointmentId, ctx.patientId!).catch(asToolFailure);
      const a = await d.appointments.cancel(appointmentId, reason ?? 'Cancelled by patient via Alejandro AI', { source: 'AI', conversationId: ctx.conversationId }).catch(asToolFailure);
      return { appointment: toCard(a, ctx.timezone, ctx.language) };
    },
    present: (out) => [{ type: 'appointment', appointment: out.appointment, state: 'cancelled' }],
  });

  const rescheduleAppointment = defineTool({
    name: 'rescheduleAppointment',
    description: 'Move an appointment of the identified patient to a new slot returned by an availability tool (with rescheduleAppointmentId). Only confirm after success.',
    input: z.object({ appointmentId: z.string().uuid(), newStartTime: z.string().datetime({ offset: true }), doctorId: z.string().uuid().optional() }),
    output: z.object({ appointment: cardShape, previousStart: z.string() }),
    permission: 'appointments.update',
    sideEffect: true,
    requiresPatient: true,
    async execute({ appointmentId, newStartTime, doctorId }, ctx) {
      const prev = await d.appointments.getForPatient(appointmentId, ctx.patientId!).catch(asToolFailure);
      const a = await d.appointments.reschedule(appointmentId, { startTime: new Date(newStartTime), doctorId }, { source: 'AI', conversationId: ctx.conversationId }).catch(asToolFailure);
      return { appointment: toCard(a, ctx.timezone, ctx.language), previousStart: prev.startTime.toISOString() };
    },
    present: (out) => [{ type: 'appointment', appointment: out.appointment, state: 'rescheduled' }],
  });

  const sendAppointmentReminder = defineTool({
    name: 'sendAppointmentReminder',
    description: "Send a reminder for one of the identified patient's appointments over their available channels.",
    input: z.object({ appointmentId: z.string().uuid() }),
    output: z.object({ sent: z.boolean(), channels: z.array(z.string()) }),
    permission: 'appointments.read',
    sideEffect: true,
    requiresPatient: true,
    async execute({ appointmentId }, ctx) {
      await d.appointments.getForPatient(appointmentId, ctx.patientId!).catch(asToolFailure);
      const r = await d.notifications.sendReminderNow(appointmentId);
      return { sent: r.sent, channels: r.channels };
    },
  });

  return [
    getDoctors,
    getDoctorProfile,
    getDoctorAvailability,
    getAvailableAppointmentSlots,
    createAppointment,
    listPatientAppointments,
    getAppointment,
    cancelAppointment,
    rescheduleAppointment,
    sendAppointmentReminder,
  ];
}
