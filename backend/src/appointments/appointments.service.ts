import { Inject, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { and, asc, count, desc, eq, gte, inArray, lt, lte } from 'drizzle-orm';
import { DateTime } from 'luxon';
import { z } from 'zod';
import { Database, DB } from '../database/database.module';
import { agents, appointments, clinics, conversations, doctors, intakeResponses, patients, services } from '../database/schema';
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
import { env } from '../config/env';
import { ActionTokensService } from '../actions/action-tokens.service';
import { BillingProviderFactory } from '../billing/billing-provider';
import { QueueService } from '../jobs/queue.service';
import { ROLE_DEFINITIONS } from '../rbac/permissions';
import { randomToken } from '../common/utils/crypto';
import { AvailabilityService } from './availability.service';

/** The DB exclusion constraint closes the check-then-insert race; surface it as the same typed conflict the pre-check raises. */
function translateOverlap(err: unknown): never {
  const e = err as { code?: string; constraint?: string; cause?: { code?: string; constraint?: string } };
  const pg = e?.code ? e : e?.cause;
  if (pg?.code === '23P01' && pg.constraint === 'appointments_no_overlap') throw new ConflictError('APPOINTMENT_CONFLICT', 'The selected time is no longer available');
  throw err;
}

export const APPOINTMENT_STATUSES = ['PENDING', 'CONFIRMED', 'COMPLETED', 'CANCELLED', 'NO_SHOW', 'RESCHEDULED'] as const;
export const APPOINTMENT_SOURCES = ['HUMAN', 'AI', 'WEB', 'WHATSAPP', 'API', 'PHONE'] as const;

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

/** Recurring series: the same slot every week / two weeks / month (e.g. physiotherapy, psychology). */
export const seriesSchema = createAppointmentSchema.extend({
  frequency: z.enum(['WEEKLY', 'BIWEEKLY', 'MONTHLY']),
  occurrences: z.number().int().min(2).max(24),
});

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
  seriesId?: string | null;
  /** Series bookings notify once for the whole series. */
  silent?: boolean;
}

const fmtMoney = (cents: number, currency: string, lang: string) =>
  new Intl.NumberFormat(lang === 'en' ? 'en-US' : 'es-CO', { style: 'currency', currency, maximumFractionDigits: 0 }).format(cents / 100);

const SYSTEM_PRINCIPAL = { kind: 'SYSTEM' as const, id: null, name: 'System', role: 'SYSTEM', permissions: new Set(ROLE_DEFINITIONS.CLINIC_ADMIN.permissions) };

@Injectable()
export class AppointmentsService {
  private readonly logger = new Logger(AppointmentsService.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly availability: AvailabilityService,
    private readonly calendars: CalendarsService,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService,
    private readonly events: EventsService,
    private readonly cache: CacheService,
    private readonly tokens: ActionTokensService,
    private readonly payments: BillingProviderFactory,
    private readonly queue: QueueService,
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
    let service: typeof services.$inferSelect | undefined;
    if (dto.serviceId) {
      [service] = await this.db.select().from(services).where(tenantScope(services, eq(services.id, dto.serviceId)));
      if (!service || !service.isActive) throw new NotFoundError('Service', dto.serviceId);
      if (!(await this.availability.doctorOffersService(doctor.id, service.id))) {
        throw new BusinessRuleError('SERVICE_NOT_OFFERED', 'This doctor does not offer the selected service');
      }
      duration = service.durationMinutes;
    }
    const range = { start: dto.startTime, end: new Date(dto.startTime.getTime() + duration * 60_000) };
    const check = await this.availability.assertBookable(doctor.id, range);
    if (!check.ok) throw new ConflictError(check.reason === 'SLOT_TAKEN' ? 'APPOINTMENT_CONFLICT' : check.reason, this.reasonMessage(check.reason));

    const clinicRow = await this.clinicInfo();
    // Deposits apply to self-service bookings (patients, AI, web, WhatsApp, phone) when the clinic enables them.
    const needsDeposit = Boolean(clinicRow.depositsEnabled && service?.depositCents && service.depositCents > 0 && principal.kind !== 'USER' && principal.kind !== 'SYSTEM');
    const videoUrl = service?.isVirtual ? `${env().VIDEO_BASE_URL.replace(/\/$/, '')}/AlejandroAI-${randomToken(12)}` : null;

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
          status: needsDeposit ? ('PENDING' as const) : dto.status,
          source: meta.source,
          notes: dto.notes,
          createdById: principal.id,
          createdByType: principal.kind,
          conversationId: meta.conversationId ?? null,
          depositCents: needsDeposit ? service!.depositCents : null,
          depositStatus: needsDeposit ? ('PENDING' as const) : ('NONE' as const),
          videoUrl,
          seriesId: meta.seriesId ?? null,
        }),
      )
      .returning()
      .catch(translateOverlap);

    const clinic = clinicRow;
    const eventId = await this.calendars.createEvent(doctor.id, {
      summary: `${personName(patient)} · ${doctorDisplayName(doctor)}`,
      description: `Alejandro AI · ${meta.source}${videoUrl ? `\n${videoUrl}` : ''}`,
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
    const lang = patient.preferredLanguage;
    const when = formatWhen(range.start, clinic.timezone, lang);
    const links: { paymentUrl?: string | null; intakeUrl?: string | null; currency: string } = { currency: service?.currency ?? clinic.currency };
    if (needsDeposit) {
      const pay = await this.tokens.issue('payment', { appointmentId: appt.id }, { ttlHours: env().DEPOSIT_HOLD_MINUTES / 60 });
      const link = await this.payments.get().createPaymentLink({
        amountCents: service!.depositCents!,
        currency: service!.currency,
        description: `${clinic.name} — ${service!.name}`,
        successUrl: `${pay.url}?paid=1`,
        cancelUrl: pay.url,
        customerEmail: patient.email,
        metadata: { kind: 'deposit', appointmentId: appt.id, organizationId: TenantContext.orgId() },
      });
      await this.db.update(appointments).set({ paymentRef: link.reference }).where(eq(appointments.id, appt.id));
      links.paymentUrl = link.url;
    }
    if (service?.intakeFields?.length) links.intakeUrl = (await this.tokens.issue('intake', { appointmentId: appt.id }, { expiresAt: range.end })).url;

    if (!meta.silent) {
      const extra = await this.patientExtras(appt.id, lang, { videoUrl, intakeUrl: links.intakeUrl ?? null, manage: !needsDeposit, until: range.start });
      if (needsDeposit) {
        await this.notifications.notifyPatient(
          'DEPOSIT_REQUIRED',
          patient.id,
          { doctorName: doctorDisplayName(doctor), when, clinicName: clinic.name, amount: fmtMoney(service!.depositCents!, service!.currency, lang), link: links.paymentUrl ?? '' },
          clinic.rules.onBooking,
          { appointmentId: appt.id },
        );
      } else {
        await this.notifications.notifyPatient('APPOINTMENT_BOOKED', patient.id, { doctorName: doctorDisplayName(doctor), when, clinicName: clinic.name, extra }, clinic.rules.onBooking, {
          appointmentId: appt.id,
        });
      }
      await this.notifications.notifyStaff(
        'APPOINTMENT_BOOKED',
        { patientName: personName(patient), doctorName: doctorDisplayName(doctor), when, clinicName: clinic.name },
        { appointmentId: appt.id, source: meta.source },
        { userIds: doctor.userId ? [doctor.userId] : [] },
      );
    }
    await this.changed(appt.id, 'created');
    return { ...(await this.get(appt.id)), links };
  }

  /** Lines appended to patient messages: video link, intake form, one-tap confirm / cancel links. */
  private async patientExtras(appointmentId: string, lang: string, o: { videoUrl?: string | null; intakeUrl?: string | null; manage: boolean; until: Date }) {
    const en = lang === 'en';
    const lines: string[] = [];
    if (o.videoUrl) lines.push(`${en ? 'Video consultation' : 'Consulta por video'}: ${o.videoUrl}`);
    if (o.intakeUrl) lines.push(`${en ? 'Please complete this short form before your visit' : 'Por favor completa este formulario antes de tu cita'}: ${o.intakeUrl}`);
    if (o.manage) {
      const confirm = await this.tokens.issue('confirm', { appointmentId }, { expiresAt: o.until });
      const cancel = await this.tokens.issue('cancel', { appointmentId }, { expiresAt: o.until });
      lines.push(`${en ? 'Confirm attendance' : 'Confirmar asistencia'}: ${confirm.url}`, `${en ? 'Cancel' : 'Cancelar'}: ${cancel.url}`);
    }
    return lines.join('\n') || undefined;
  }

  /** Links included in reminders (used by the reminder sweep). */
  async reminderExtras(appointmentId: string, lang: string) {
    const appt = await this.get(appointmentId);
    return this.patientExtras(appointmentId, lang, { videoUrl: appt.videoUrl, manage: !appt.patientConfirmedAt, until: appt.startTime });
  }

  /** Patient says "I'll be there" (reminder link, WhatsApp "1", chat). Idempotent. */
  async confirmAttendance(id: string, via: string) {
    const current = await this.get(id);
    const principal = TenantContext.principal();
    if ((principal.kind === 'PATIENT' || principal.kind === 'AI_AGENT') && principal.patientId && principal.patientId !== current.patientId) throw new NotFoundError('Appointment');
    if (!['PENDING', 'CONFIRMED'].includes(current.status)) throw new BusinessRuleError('APPOINTMENT_CLOSED', 'This appointment is no longer active');
    if (current.depositStatus === 'PENDING') throw new BusinessRuleError('DEPOSIT_PENDING', 'The deposit has not been paid yet');
    if (current.patientConfirmedAt) return current;
    await this.db.update(appointments).set({ patientConfirmedAt: new Date(), status: 'CONFIRMED' }).where(tenantScope(appointments, eq(appointments.id, id)));
    await this.audit.log({ action: 'appointment.attendance_confirmed', entityType: 'Appointment', entityId: id, patientId: current.patientId, metadata: { via } });
    const clinic = await this.clinicInfo();
    await this.notifications.notifyStaff(
      'ATTENDANCE_CONFIRMED',
      { patientName: personName(current.patient), doctorName: doctorDisplayName(current.doctor), when: formatWhen(current.startTime, clinic.timezone, 'es') },
      { appointmentId: id },
      { roleKeys: ['RECEPTIONIST'], userIds: current.doctor.userId ? [current.doctor.userId] : [] },
    );
    await this.changed(id, 'confirmed');
    return this.get(id);
  }

  /** Deposit received (Stripe webhook or simulated payment): the held slot becomes a confirmed appointment. */
  async markDepositPaid(id: string, reference: string) {
    const current = await this.get(id);
    if (current.depositStatus === 'PAID') return current;
    if (current.status !== 'PENDING' || current.depositStatus !== 'PENDING') throw new BusinessRuleError('DEPOSIT_NOT_PENDING', 'This appointment is not waiting for a deposit');
    await this.db
      .update(appointments)
      .set({ depositStatus: 'PAID', status: 'CONFIRMED', paymentRef: reference })
      .where(tenantScope(appointments, eq(appointments.id, id)));
    await this.audit.log({ action: 'appointment.deposit_paid', entityType: 'Appointment', entityId: id, patientId: current.patientId, metadata: { reference, amountCents: current.depositCents } });
    const clinic = await this.clinicInfo();
    const lang = current.patient.preferredLanguage;
    const intakeUrl = current.service?.intakeFields?.length ? (await this.tokens.issue('intake', { appointmentId: id }, { expiresAt: current.endTime })).url : null;
    const extra = await this.patientExtras(id, lang, { videoUrl: current.videoUrl, intakeUrl, manage: true, until: current.startTime });
    await this.notifications.notifyPatient(
      'APPOINTMENT_BOOKED',
      current.patientId,
      { doctorName: doctorDisplayName(current.doctor), when: formatWhen(current.startTime, clinic.timezone, lang), clinicName: clinic.name, extra },
      clinic.rules.onBooking,
      { appointmentId: id },
    );
    await this.changed(id, 'deposit_paid');
    return this.get(id);
  }

  /** Releases slots whose deposit was not paid in time. Runs across tenants (sweep). */
  async releaseExpiredDeposits(now = new Date()): Promise<number> {
    const cutoff = new Date(now.getTime() - env().DEPOSIT_HOLD_MINUTES * 60_000);
    const due = await this.db
      .select({ id: appointments.id, organizationId: appointments.organizationId, clinicId: appointments.clinicId })
      .from(appointments)
      .where(and(eq(appointments.status, 'PENDING'), eq(appointments.depositStatus, 'PENDING'), lte(appointments.createdAt, cutoff)));
    for (const row of due) {
      await TenantContext.run({ organizationId: row.organizationId, clinicId: row.clinicId, principal: SYSTEM_PRINCIPAL }, async () => {
        const claimed = await this.db
          .update(appointments)
          .set({ depositStatus: 'EXPIRED', status: 'CANCELLED', cancelledAt: new Date(), cancellationReason: 'Deposit not received in time' })
          .where(and(eq(appointments.id, row.id), eq(appointments.depositStatus, 'PENDING')))
          .returning({ id: appointments.id });
        if (!claimed.length) return;
        const appt = await this.get(row.id);
        await this.calendars.deleteEvent(appt.doctorId, appt.calendarEventId);
        const clinic = await this.clinicInfo();
        await this.notifications.notifyPatient('DEPOSIT_RELEASED', appt.patientId, { when: formatWhen(appt.startTime, clinic.timezone, appt.patient.preferredLanguage) }, clinic.rules.onCancel, {
          appointmentId: appt.id,
        });
        await this.audit.log({ action: 'appointment.deposit_expired', entityType: 'Appointment', entityId: appt.id, patientId: appt.patientId });
        await this.queue.enqueue('waitlist', { organizationId: row.organizationId, clinicId: row.clinicId, appointmentId: appt.id });
        await this.changed(appt.id, 'cancelled');
      });
    }
    return due.length;
  }

  /** Books a recurring series. Occurrences that collide are skipped and reported, the rest are booked atomically one by one. */
  async createSeries(dto: z.infer<typeof seriesSchema>, meta: BookingMeta = { source: 'HUMAN' }) {
    const seriesId = randomUUID();
    const { frequency, occurrences, ...base } = dto;
    const clinic = await this.clinicInfo();
    const booked: Awaited<ReturnType<AppointmentsService['get']>>[] = [];
    const skipped: { startTime: string; reason: string }[] = [];
    for (let i = 0; i < occurrences; i++) {
      // Step in the clinic's time zone so DST changes keep the same wall-clock time.
      const start = DateTime.fromJSDate(base.startTime, { zone: clinic.timezone });
      const at = (frequency === 'MONTHLY' ? start.plus({ months: i }) : start.plus({ weeks: i * (frequency === 'BIWEEKLY' ? 2 : 1) })).toJSDate();
      try {
        booked.push(await this.create({ ...base, startTime: at }, { ...meta, seriesId, silent: i > 0 }));
      } catch (err) {
        const e = err as { code?: string; message: string };
        if (!e.code) throw err;
        skipped.push({ startTime: at.toISOString(), reason: e.code });
      }
    }
    if (!booked.length) throw new ConflictError('SERIES_NOT_BOOKABLE', 'None of the requested dates is available', { skipped });
    await this.audit.log({ action: 'appointment.series_created', entityType: 'AppointmentSeries', entityId: seriesId, patientId: dto.patientId, metadata: { frequency, booked: booked.length, skipped: skipped.length } });
    return { seriesId, booked, skipped };
  }

  async cancelSeries(seriesId: string, reason?: string) {
    const rows = await this.db
      .select({ id: appointments.id })
      .from(appointments)
      .where(tenantScope(appointments, eq(appointments.seriesId, seriesId), inArray(appointments.status, ['PENDING', 'CONFIRMED']), gte(appointments.startTime, new Date())));
    for (const r of rows) await this.cancel(r.id, reason);
    return { cancelled: rows.length };
  }

  async intakeFor(appointmentId: string) {
    await this.get(appointmentId);
    const [row] = await this.db.select().from(intakeResponses).where(tenantScope(intakeResponses, eq(intakeResponses.appointmentId, appointmentId)));
    return row ?? null;
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
    // The freed slot is offered to the waitlist (best effort, async).
    if (current.startTime.getTime() > Date.now()) {
      await this.queue.enqueue('waitlist', { organizationId: TenantContext.orgId(), clinicId: current.clinicId, appointmentId: id }).catch((e: Error) => this.logger.warn(`Waitlist offer not queued: ${e.message}`));
    }
    await this.changed(id, 'cancelled');
    return this.get(id);
  }

  private async clinicInfo() {
    const [row] = await this.db
      .select({ name: clinics.name, timezone: clinics.timezone, currency: clinics.currency, depositsEnabled: clinics.depositsEnabled, rules: agents.notificationRules })
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
