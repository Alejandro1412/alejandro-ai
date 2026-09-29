import { Inject, Injectable } from '@nestjs/common';
import { and, asc, count, desc, eq, gte, inArray, lt } from 'drizzle-orm';
import { z } from 'zod';
import { Database, DB } from '../database/database.module';
import { agents, appointments, clinics, conversations, doctors, patients, services } from '../database/schema';
import { TenantContext, tenantScope, withTenant } from '../database/tenant';
import { BusinessRuleError, ConflictError, ForbiddenError, NotFoundError } from '../common/errors/app-error';
import { offsetOf, Paginated } from '../common/utils/pagination';
import { doctorDisplayName, formatWhen, personName } from '../common/utils/time';
import { AuditService } from '../audit/audit.service';
import { CalendarsService } from '../calendars/calendars.service';
import { NotificationsService } from '../notifications/notifications.service';
import { EventsService } from '../realtime/events.service';
import { CacheService } from '../jobs/cache.service';
import { DEFAULT_NOTIFICATION_RULES } from '../ai/agent-defaults';
import { AvailabilityService } from './availability.service';

/** The DB exclusion constraint closes the check-then-insert race; surface it as the same typed conflict the pre-check raises. */
function translateOverlap(err: unknown): never {
  const e = err as { code?: string; constraint?: string; cause?: { code?: string; constraint?: string } };
  const pg = e?.code ? e : e?.cause;
  if (pg?.code === '23P01' && pg.constraint === 'appointments_no_overlap') throw new ConflictError('APPOINTMENT_CONFLICT', 'The selected time is no longer available');
  throw err;
}

export const APPOINTMENT_STATUSES = ['PENDING', 'CONFIRMED', 'COMPLETED', 'CANCELLED', 'NO_SHOW', 'RESCHEDULED'] as const;
export const APPOINTMENT_SOURCES = ['HUMAN', 'AI', 'WEB', 'WHATSAPP', 'API'] as const;

export const createAppointmentSchema = z.object({
  doctorId: z.string().uuid(),
  patientId: z.string().uuid(),
  serviceId: z.string().uuid().nullable().optional(),
  locationId: z.string().uuid().nullable().optional(),
  startTime: z.coerce.date(),
  notes: z.string().trim().max(1000).nullable().optional(),
  status: z.enum(['PENDING', 'CONFIRMED']).default('CONFIRMED'),
});

export const updateAppointmentSchema = z.object({
  status: z.enum(['CONFIRMED', 'COMPLETED', 'NO_SHOW', 'PENDING']).optional(),
  notes: z.string().trim().max(1000).nullable().optional(),
});

export const rescheduleSchema = z.object({ startTime: z.coerce.date(), doctorId: z.string().uuid().optional() });
export const cancelSchema = z.object({ reason: z.string().trim().max(500).optional() });

export const listAppointmentsSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  doctorId: z.string().uuid().optional(),
  patientId: z.string().uuid().optional(),
  status: z.enum(APPOINTMENT_STATUSES).optional(),
  source: z.enum(APPOINTMENT_SOURCES).optional(),
  order: z.enum(['asc', 'desc']).default('asc'),
});

type Source = (typeof APPOINTMENT_SOURCES)[number];

export interface BookingMeta {
  source: Source;
  conversationId?: string | null;
}

@Injectable()
export class AppointmentsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly availability: AvailabilityService,
    private readonly calendars: CalendarsService,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService,
    private readonly events: EventsService,
    private readonly cache: CacheService,
  ) {}

  async list(q: z.infer<typeof listAppointmentsSchema>) {
    const where = tenantScope(
      appointments,
      eq(appointments.clinicId, TenantContext.clinicId()),
      q.from ? gte(appointments.startTime, q.from) : undefined,
      q.to ? lt(appointments.startTime, q.to) : undefined,
      q.doctorId ? eq(appointments.doctorId, q.doctorId) : undefined,
      q.patientId ? eq(appointments.patientId, q.patientId) : undefined,
      q.status ? eq(appointments.status, q.status) : undefined,
      q.source ? eq(appointments.source, q.source) : undefined,
    );
    const [items, [{ total }]] = await Promise.all([
      this.db.query.appointments.findMany({
        where,
        with: { doctor: { with: { specialty: true } }, patient: true, service: true, location: true },
        orderBy: [q.order === 'asc' ? asc(appointments.startTime) : desc(appointments.startTime)],
        limit: q.pageSize,
        offset: offsetOf(q),
      }),
      this.db.select({ total: count() }).from(appointments).where(where),
    ]);
    return Paginated.of(items, total, q);
  }

  async get(id: string) {
    const appt = await this.db.query.appointments.findFirst({
      where: tenantScope(appointments, eq(appointments.id, id)),
      with: { doctor: { with: { specialty: true } }, patient: true, service: true, location: true },
    });
    if (!appt) throw new NotFoundError('Appointment', id);
    return appt;
  }

  /** Patient-scoped fetch: a patient (or the AI acting for one) can only touch their own appointments. */
  async getForPatient(id: string, patientId: string) {
    const appt = await this.get(id);
    // Same answer as a missing id so a patient cannot probe for other patients' appointments.
    if (appt.patientId !== patientId) throw new NotFoundError('Appointment');
    return appt;
  }

  async upcomingForPatient(patientId: string) {
    return this.db.query.appointments.findMany({
      where: tenantScope(appointments, eq(appointments.patientId, patientId), inArray(appointments.status, ['PENDING', 'CONFIRMED']), gte(appointments.startTime, new Date())),
      with: { doctor: { with: { specialty: true } }, service: true, location: true },
      orderBy: [asc(appointments.startTime)],
    });
  }

  async create(dto: z.infer<typeof createAppointmentSchema>, meta: BookingMeta = { source: 'HUMAN' }) {
    const principal = TenantContext.principal();
    const [doctor] = await this.db.select().from(doctors).where(tenantScope(doctors, eq(doctors.id, dto.doctorId)));
    if (!doctor) throw new NotFoundError('Doctor', dto.doctorId);
    const [patient] = await this.db.select().from(patients).where(tenantScope(patients, eq(patients.id, dto.patientId)));
    if (!patient) throw new NotFoundError('Patient', dto.patientId);
    if (principal.kind === 'PATIENT' && principal.patientId !== patient.id) throw new ForbiddenError('NOT_OWNER', 'Patients can only book for themselves');

    let duration = doctor.defaultDurationMinutes;
    if (dto.serviceId) {
      const [service] = await this.db.select().from(services).where(tenantScope(services, eq(services.id, dto.serviceId)));
      if (!service || !service.isActive) throw new NotFoundError('Service', dto.serviceId);
      if (!(await this.availability.doctorOffersService(doctor.id, service.id))) {
        throw new BusinessRuleError('SERVICE_NOT_OFFERED', 'This doctor does not offer the selected service');
      }
      duration = service.durationMinutes;
    }
    const range = { start: dto.startTime, end: new Date(dto.startTime.getTime() + duration * 60_000) };
    const check = await this.availability.assertBookable(doctor.id, range);
    if (!check.ok) throw new ConflictError(check.reason === 'SLOT_TAKEN' ? 'APPOINTMENT_CONFLICT' : check.reason, this.reasonMessage(check.reason));

    // DB exclusion constraint `appointments_no_overlap` closes the race window between check and insert.
    const [appt] = await this.db
      .insert(appointments)
      .values(
        withTenant({
          clinicId: TenantContext.clinicId(),
          doctorId: doctor.id,
          patientId: patient.id,
          serviceId: dto.serviceId ?? null,
          locationId: dto.locationId ?? doctor.locationId,
          startTime: range.start,
          endTime: range.end,
          status: dto.status,
          source: meta.source,
          notes: dto.notes,
          createdById: principal.id,
          createdByType: principal.kind,
          conversationId: meta.conversationId ?? null,
        }),
      )
      .returning()
      .catch(translateOverlap);

    const clinic = await this.clinicInfo();
    const eventId = await this.calendars.createEvent(doctor.id, {
      summary: `${personName(patient)} · ${doctorDisplayName(doctor)}`,
      description: `Alejandro AI · ${meta.source}`,
      start: range.start,
      end: range.end,
      timezone: clinic.timezone,
      attendeeEmails: patient.email ? [patient.email] : [],
    });
    if (eventId) await this.db.update(appointments).set({ calendarEventId: eventId }).where(eq(appointments.id, appt.id));
    if (meta.conversationId) await this.db.update(conversations).set({ hasBooking: true }).where(tenantScope(conversations, eq(conversations.id, meta.conversationId)));

    await this.audit.log({
      action: 'appointment.created',
      entityType: 'Appointment',
      entityId: appt.id,
      patientId: patient.id,
      metadata: { doctorId: doctor.id, startTime: range.start.toISOString(), source: meta.source },
    });
    const when = formatWhen(range.start, clinic.timezone, patient.preferredLanguage);
    await this.notifications.notifyPatient('APPOINTMENT_BOOKED', patient.id, { doctorName: doctorDisplayName(doctor), when, clinicName: clinic.name }, clinic.rules.onBooking, {
      appointmentId: appt.id,
    });
    await this.notifications.notifyStaff(
      'APPOINTMENT_BOOKED',
      { patientName: personName(patient), doctorName: doctorDisplayName(doctor), when, clinicName: clinic.name },
      { appointmentId: appt.id, source: meta.source },
      { userIds: doctor.userId ? [doctor.userId] : [] },
    );
    await this.changed(appt.id, 'created');
    return this.get(appt.id);
  }

  async update(id: string, dto: z.infer<typeof updateAppointmentSchema>) {
    const current = await this.get(id);
    if (['CANCELLED', 'RESCHEDULED'].includes(current.status) && dto.status) {
      throw new BusinessRuleError('APPOINTMENT_CLOSED', 'Cancelled or rescheduled appointments cannot change status');
    }
    await this.db.update(appointments).set(dto).where(tenantScope(appointments, eq(appointments.id, id)));
    await this.audit.log({ action: 'appointment.updated', entityType: 'Appointment', entityId: id, patientId: current.patientId, metadata: dto });
    await this.changed(id, 'updated');
    return this.get(id);
  }

  /**
   * Rescheduling keeps history: the original becomes RESCHEDULED and a new linked appointment is created
   * atomically. The original slot is excluded from the conflict check so moving within an overlapping window works.
   */
  async reschedule(id: string, dto: z.infer<typeof rescheduleSchema>, meta: BookingMeta = { source: 'HUMAN' }) {
    const current = await this.get(id);
    if (!['PENDING', 'CONFIRMED'].includes(current.status)) throw new BusinessRuleError('APPOINTMENT_CLOSED', 'Only active appointments can be rescheduled');
    const principal = TenantContext.principal();
    if (principal.kind === 'PATIENT' && principal.patientId !== current.patientId) throw new ForbiddenError('NOT_OWNER', 'Not your appointment');
    const doctorId = dto.doctorId ?? current.doctorId;
    const duration = (current.endTime.getTime() - current.startTime.getTime()) / 60_000;
    const range = { start: dto.startTime, end: new Date(dto.startTime.getTime() + duration * 60_000) };
    const check = await this.availability.assertBookable(doctorId, range, current.id);
    if (!check.ok) throw new ConflictError(check.reason === 'SLOT_TAKEN' ? 'APPOINTMENT_CONFLICT' : check.reason, this.reasonMessage(check.reason));

    const next = await this.db.transaction(async (tx) => {
      await tx.update(appointments).set({ status: 'RESCHEDULED' }).where(tenantScope(appointments, eq(appointments.id, id)));
      const [row] = await tx
        .insert(appointments)
        .values(
          withTenant({
            clinicId: current.clinicId,
            doctorId,
            patientId: current.patientId,
            serviceId: current.serviceId,
            locationId: current.locationId,
            startTime: range.start,
            endTime: range.end,
            status: 'CONFIRMED' as const,
            source: meta.source,
            notes: current.notes,
            createdById: principal.id,
            createdByType: principal.kind,
            conversationId: meta.conversationId ?? current.conversationId,
            rescheduledFromId: current.id,
            calendarEventId: doctorId === current.doctorId ? current.calendarEventId : null,
          }),
        )
        .returning();
      return row;
    }).catch(translateOverlap);

    const clinic = await this.clinicInfo();
    if (doctorId === current.doctorId) {
      await this.calendars.updateEvent(doctorId, current.calendarEventId, { start: range.start, end: range.end, timezone: clinic.timezone });
    } else {
      await this.calendars.deleteEvent(current.doctorId, current.calendarEventId);
      const eventId = await this.calendars.createEvent(doctorId, { summary: personName(current.patient), start: range.start, end: range.end, timezone: clinic.timezone });
      if (eventId) await this.db.update(appointments).set({ calendarEventId: eventId }).where(eq(appointments.id, next.id));
    }
    await this.audit.log({
      action: 'appointment.rescheduled',
      entityType: 'Appointment',
      entityId: next.id,
      patientId: current.patientId,
      metadata: { from: current.startTime.toISOString(), to: range.start.toISOString(), previousId: id, source: meta.source },
    });
    const full = await this.get(next.id);
    const when = formatWhen(range.start, clinic.timezone, current.patient.preferredLanguage);
    await this.notifications.notifyPatient('APPOINTMENT_CHANGED', current.patientId, { doctorName: doctorDisplayName(full.doctor), when, clinicName: clinic.name }, clinic.rules.onBooking, {
      appointmentId: next.id,
    });
    await this.notifications.notifyStaff('APPOINTMENT_CHANGED', { patientName: personName(current.patient), doctorName: doctorDisplayName(full.doctor), when }, { appointmentId: next.id });
    await this.changed(next.id, 'rescheduled');
    return full;
  }

  async cancel(id: string, reason: string | undefined, meta: BookingMeta = { source: 'HUMAN' }) {
    const current = await this.get(id);
    if (!['PENDING', 'CONFIRMED'].includes(current.status)) throw new BusinessRuleError('APPOINTMENT_CLOSED', 'Only active appointments can be cancelled');
    const principal = TenantContext.principal();
    if (principal.kind === 'PATIENT' && principal.patientId !== current.patientId) throw new ForbiddenError('NOT_OWNER', 'Not your appointment');
    await this.db
      .update(appointments)
      .set({ status: 'CANCELLED', cancelledAt: new Date(), cancellationReason: reason ?? null })
      .where(tenantScope(appointments, eq(appointments.id, id)));
    await this.calendars.deleteEvent(current.doctorId, current.calendarEventId);
    await this.audit.log({ action: 'appointment.cancelled', entityType: 'Appointment', entityId: id, patientId: current.patientId, metadata: { reason, source: meta.source } });
    const clinic = await this.clinicInfo();
    const when = formatWhen(current.startTime, clinic.timezone, current.patient.preferredLanguage);
    await this.notifications.notifyPatient('APPOINTMENT_CANCELLED', current.patientId, { doctorName: doctorDisplayName(current.doctor), when, clinicName: clinic.name }, clinic.rules.onCancel, {
      appointmentId: id,
    });
    await this.notifications.notifyStaff('APPOINTMENT_CANCELLED', { patientName: personName(current.patient), doctorName: doctorDisplayName(current.doctor), when }, { appointmentId: id });
    await this.changed(id, 'cancelled');
    return this.get(id);
  }

  private async clinicInfo() {
    const [row] = await this.db
      .select({ name: clinics.name, timezone: clinics.timezone, rules: agents.notificationRules })
      .from(clinics)
      .leftJoin(agents, eq(agents.clinicId, clinics.id))
      .where(and(eq(clinics.id, TenantContext.clinicId()), eq(clinics.organizationId, TenantContext.orgId())));
    return { ...row, rules: row.rules ?? DEFAULT_NOTIFICATION_RULES };
  }

  private async changed(id: string, change: string) {
    this.events.emit('appointment.changed', { id, change });
    await this.cache.del(`analytics:${TenantContext.orgId()}:*`);
  }

  private reasonMessage(reason: string): string {
    const map: Record<string, string> = {
      SLOT_TAKEN: 'The selected time is no longer available',
      OUTSIDE_WORKING_HOURS: "The selected time is outside the doctor's working hours",
      TOO_SOON: 'The selected time does not meet the minimum booking notice',
      DOCTOR_UNAVAILABLE: 'The doctor is not currently accepting appointments',
      DOCTOR_NOT_FOUND: 'Doctor not found',
    };
    return map[reason] ?? 'The selected time cannot be booked';
  }
}
