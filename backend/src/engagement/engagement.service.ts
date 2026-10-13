import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, lt, lte, ne, or, sql } from 'drizzle-orm';
import { DateTime } from 'luxon';
import { z } from 'zod';
import { Database, DB } from '../database/database.module';
import {
  appointments,
  campaigns,
  clinics,
  conversations,
  doctors,
  handoffs,
  intakeResponses,
  notifications,
  patients,
  reviewRequests,
  services,
  waitlistEntries,
  type IntakeField,
} from '../database/schema';
import { TenantContext, tenantScope, withTenant, type Principal } from '../database/tenant';
import { BusinessRuleError, ConflictError, NotFoundError, PlanLimitError, ValidationError } from '../common/errors/app-error';
import { doctorDisplayName, formatWhen, personName } from '../common/utils/time';
import { ActionTokensService } from '../actions/action-tokens.service';
import { AppointmentsService } from '../appointments/appointments.service';
import { AuditService } from '../audit/audit.service';
import { QueueService, TenantJob } from '../jobs/queue.service';
import { NotificationsService } from '../notifications/notifications.service';
import { EventsService } from '../realtime/events.service';
import { ROLE_DEFINITIONS } from '../rbac/permissions';
import { env } from '../config/env';
import { BillingService } from '../billing/billing.service';

export const waitlistSchema = z.object({
  patientId: z.string().uuid(),
  specialtyId: z.string().uuid().nullable().optional(),
  doctorId: z.string().uuid().nullable().optional(),
  serviceId: z.string().uuid().nullable().optional(),
  fromDate: z.coerce.date(),
  toDate: z.coerce.date(),
  timeOfDay: z.enum(['morning', 'afternoon', 'evening']).nullable().optional(),
  notes: z.string().trim().max(500).nullable().optional(),
});

export const campaignSchema = z.object({
  kind: z.enum(['REACTIVATION', 'REVIEW']),
  name: z.string().trim().min(2).max(120),
  message: z.string().trim().min(10).max(900),
  criteria: z
    .object({
      monthsSinceLastVisit: z.number().int().min(1).max(60).default(6),
      specialtyId: z.string().uuid().nullable().optional(),
      daysSinceVisit: z.number().int().min(1).max(90).default(30),
    })
    .default({ monthsSinceLastVisit: 6, daysSinceVisit: 30 }),
});

const SYSTEM: Principal = { kind: 'SYSTEM', id: null, name: 'System', role: 'SYSTEM', permissions: new Set(ROLE_DEFINITIONS.CLINIC_ADMIN.permissions) };
const OFFER_FANOUT = 3;

interface WaitlistJob extends TenantJob {
  appointmentId: string;
}
interface CampaignJob extends TenantJob {
  campaignId: string;
}

const partOfDay = (d: DateTime) => (d.hour < 12 ? 'morning' : d.hour < 18 ? 'afternoon' : 'evening');

/**
 * Patient engagement: waitlist auto-fill, review requests, intake forms, reactivation campaigns and the
 * monthly value report. Every outbound message respects consent; every public action goes through a
 * single-use or expiring signed link (ActionTokensService).
 */
@Injectable()
export class EngagementService implements OnModuleInit {
  private readonly logger = new Logger(EngagementService.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly tokens: ActionTokensService,
    private readonly appointments: AppointmentsService,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService,
    private readonly queue: QueueService,
    private readonly events: EventsService,
    private readonly billing: BillingService,
  ) {}

  onModuleInit(): void {
    this.queue.register<WaitlistJob>('waitlist', (job) => this.offerFreedSlot(job.appointmentId).then(() => undefined));
    this.queue.register<CampaignJob>('campaigns', (job) => this.deliverCampaign(job.campaignId));
    this.queue.register<TenantJob>('engagement', () => this.sweep().then(() => undefined));
    void this.queue.every('engagement', 30 * 60_000, { organizationId: 'system' }).catch((e: Error) => this.logger.warn(`Engagement sweep not scheduled: ${e.message}`));
  }

  /** Periodic, cross-tenant housekeeping. */
  async sweep(now = new Date()) {
    const released = await this.appointments.releaseExpiredDeposits(now);
    const expiredOffers = await this.expireOffers(now);
    const reviews = await this.sendDueReviewRequests(now);
    const reports = await this.sendMonthlyReports(now);
    return { released, expiredOffers, reviews, reports };
  }

  private async clinic() {
    const [c] = await this.db.select().from(clinics).where(and(eq(clinics.id, TenantContext.clinicId()), eq(clinics.organizationId, TenantContext.orgId())));
    return c;
  }

  private forEachClinic<T>(fn: (clinic: typeof clinics.$inferSelect) => Promise<T>) {
    return this.db
      .select()
      .from(clinics)
      .then((rows) => Promise.all(rows.map((c) => TenantContext.run({ organizationId: c.organizationId, clinicId: c.id, principal: SYSTEM }, () => fn(c)))));
  }

  // ───────────────────────── Waitlist ─────────────────────────
  async addToWaitlist(dto: z.infer<typeof waitlistSchema>, source = 'HUMAN') {
    if (dto.toDate <= dto.fromDate) throw new ValidationError('toDate must be after fromDate');
    if (!dto.doctorId && !dto.specialtyId && !dto.serviceId) throw new ValidationError('Choose a doctor, specialty or service');
    const [p] = await this.db.select({ id: patients.id }).from(patients).where(tenantScope(patients, eq(patients.id, dto.patientId)));
    if (!p) throw new NotFoundError('Patient', dto.patientId);
    const [dupe] = await this.db
      .select({ id: waitlistEntries.id })
      .from(waitlistEntries)
      .where(
        tenantScope(
          waitlistEntries,
          eq(waitlistEntries.patientId, dto.patientId),
          inArray(waitlistEntries.status, ['WAITING', 'OFFERED']),
          dto.doctorId ? eq(waitlistEntries.doctorId, dto.doctorId) : dto.specialtyId ? eq(waitlistEntries.specialtyId, dto.specialtyId) : undefined,
        ),
      );
    if (dupe) throw new ConflictError('ALREADY_ON_WAITLIST', 'The patient is already on the waitlist for this request', { id: dupe.id });
    const [row] = await this.db
      .insert(waitlistEntries)
      .values(withTenant({ ...dto, clinicId: TenantContext.clinicId(), source }))
      .returning();
    await this.audit.log({ action: 'waitlist.added', entityType: 'WaitlistEntry', entityId: row.id, patientId: dto.patientId, metadata: { source } });
    this.events.emit('waitlist.changed', { id: row.id });
    return row;
  }

  listWaitlist(status?: string) {
    return this.db.query.waitlistEntries.findMany({
      where: tenantScope(waitlistEntries, eq(waitlistEntries.clinicId, TenantContext.clinicId()), status ? eq(waitlistEntries.status, status as 'WAITING') : undefined),
      with: { patient: true, doctor: true, specialty: true, service: true },
      orderBy: [asc(waitlistEntries.createdAt)],
      limit: 200,
    });
  }

  async removeFromWaitlist(id: string) {
    const [row] = await this.db
      .update(waitlistEntries)
      .set({ status: 'CANCELLED', updatedAt: new Date() })
      .where(tenantScope(waitlistEntries, eq(waitlistEntries.id, id)))
      .returning();
    if (!row) throw new NotFoundError('WaitlistEntry', id);
    this.events.emit('waitlist.changed', { id });
    return row;
  }

  /** A slot was freed: offer it to the first matching patients on the waitlist. */
  async offerFreedSlot(appointmentId: string) {
    const [freed] = await this.db
      .select({ appt: appointments, doctor: doctors })
      .from(appointments)
      .innerJoin(doctors, eq(doctors.id, appointments.doctorId))
      .where(tenantScope(appointments, eq(appointments.id, appointmentId)));
    if (!freed || freed.appt.startTime.getTime() < Date.now() + 30 * 60_000) return { offered: 0 };
    const clinic = await this.clinic();
    const start = DateTime.fromJSDate(freed.appt.startTime, { zone: clinic.timezone });
    const candidates = await this.db
      .select()
      .from(waitlistEntries)
      .where(
        tenantScope(
          waitlistEntries,
          eq(waitlistEntries.clinicId, freed.appt.clinicId),
          eq(waitlistEntries.status, 'WAITING'),
          ne(waitlistEntries.patientId, freed.appt.patientId),
          lte(waitlistEntries.fromDate, freed.appt.startTime),
          gte(waitlistEntries.toDate, freed.appt.startTime),
          or(
            eq(waitlistEntries.doctorId, freed.doctor.id),
            and(isNull(waitlistEntries.doctorId), freed.doctor.specialtyId ? eq(waitlistEntries.specialtyId, freed.doctor.specialtyId) : sql`false`),
            and(isNull(waitlistEntries.doctorId), isNull(waitlistEntries.specialtyId), freed.appt.serviceId ? eq(waitlistEntries.serviceId, freed.appt.serviceId) : sql`false`),
          ),
        ),
      )
      .orderBy(asc(waitlistEntries.createdAt))
      .limit(20);
    const matching = candidates.filter((c) => !c.timeOfDay || c.timeOfDay === partOfDay(start)).slice(0, OFFER_FANOUT);
    const expiresAt = new Date(Math.min(Date.now() + 2 * 3_600_000, freed.appt.startTime.getTime() - 30 * 60_000));
    for (const entry of matching) {
      const link = await this.tokens.issue('waitlist', { entryId: entry.id, doctorId: freed.doctor.id, startTime: freed.appt.startTime.toISOString(), serviceId: freed.appt.serviceId }, { expiresAt });
      await this.db
        .update(waitlistEntries)
        .set({ status: 'OFFERED', offeredStart: freed.appt.startTime, offeredDoctorId: freed.doctor.id, offerExpiresAt: expiresAt, updatedAt: new Date() })
        .where(eq(waitlistEntries.id, entry.id));
      const [p] = await this.db.select().from(patients).where(eq(patients.id, entry.patientId));
      await this.notifications.notifyPatient(
        'WAITLIST_OFFER',
        entry.patientId,
        { doctorName: doctorDisplayName(freed.doctor), when: formatWhen(freed.appt.startTime, clinic.timezone, p?.preferredLanguage ?? 'es'), link: link.url },
        [...(p?.phone ? (['WHATSAPP'] as const) : []), ...(p?.email ? (['EMAIL'] as const) : []), 'IN_APP'],
        { waitlistEntryId: entry.id },
      );
      await this.audit.log({ action: 'waitlist.offered', entityType: 'WaitlistEntry', entityId: entry.id, patientId: entry.patientId, metadata: { appointmentId } });
    }
    if (matching.length) this.events.emit('waitlist.changed', { offered: matching.length });
    return { offered: matching.length };
  }

  /** Patient accepted an offer from the link. First one to accept gets the slot. */
  async acceptOffer(payload: { entryId: string; doctorId: string; startTime: string; serviceId?: string | null }) {
    const [entry] = await this.db.select().from(waitlistEntries).where(tenantScope(waitlistEntries, eq(waitlistEntries.id, payload.entryId)));
    if (!entry || entry.status !== 'OFFERED') throw new BusinessRuleError('OFFER_NOT_AVAILABLE', 'This offer is no longer available');
    const principal: Principal = { kind: 'PATIENT', id: null, name: 'Patient (link)', role: 'PATIENT', permissions: new Set(['portal.self']), patientId: entry.patientId };
    try {
      const appt = await TenantContext.run({ ...TenantContext.current(), principal }, () =>
        this.appointments.create(
          { doctorId: payload.doctorId, patientId: entry.patientId, serviceId: payload.serviceId ?? entry.serviceId ?? null, startTime: new Date(payload.startTime), status: 'CONFIRMED' },
          { source: 'WEB' },
        ),
      );
      await this.db.update(waitlistEntries).set({ status: 'BOOKED', appointmentId: appt.id, updatedAt: new Date() }).where(eq(waitlistEntries.id, entry.id));
      // Others who were offered the same slot go back to waiting.
      await this.db
        .update(waitlistEntries)
        .set({ status: 'WAITING', offeredStart: null, offeredDoctorId: null, offerExpiresAt: null, updatedAt: new Date() })
        .where(tenantScope(waitlistEntries, eq(waitlistEntries.status, 'OFFERED'), eq(waitlistEntries.offeredStart, new Date(payload.startTime)), ne(waitlistEntries.id, entry.id)));
      await this.audit.log({ action: 'waitlist.booked', entityType: 'WaitlistEntry', entityId: entry.id, patientId: entry.patientId, metadata: { appointmentId: appt.id } });
      this.events.emit('waitlist.changed', { id: entry.id });
      return appt;
    } catch (err) {
      if ((err as { code?: string }).code === 'APPOINTMENT_CONFLICT' || (err as { code?: string }).code === 'TOO_SOON') {
        await this.db.update(waitlistEntries).set({ status: 'WAITING', offeredStart: null, offerExpiresAt: null, updatedAt: new Date() }).where(eq(waitlistEntries.id, entry.id));
        throw new ConflictError('OFFER_TAKEN', 'Someone else took this slot first. You are still on the waitlist.');
      }
      throw err;
    }
  }

  private async expireOffers(now: Date) {
    const rows = await this.db
      .update(waitlistEntries)
      .set({ status: 'WAITING', offeredStart: null, offeredDoctorId: null, offerExpiresAt: null, updatedAt: now })
      .where(and(eq(waitlistEntries.status, 'OFFERED'), lt(waitlistEntries.offerExpiresAt, now)))
      .returning({ id: waitlistEntries.id });
    await this.db
      .update(waitlistEntries)
      .set({ status: 'EXPIRED', updatedAt: now })
      .where(and(inArray(waitlistEntries.status, ['WAITING', 'OFFERED']), lt(waitlistEntries.toDate, now)));
    return rows.length;
  }

  // ───────────────────────── Reviews ─────────────────────────
  /** Completed visits in the last 2 days → one review request each (only patients with marketing consent). */
  async sendDueReviewRequests(now = new Date()) {
    const results = await this.forEachClinic(async (clinic) => {
      const due = await this.db
        .select({ appt: appointments, doctor: doctors, patient: patients })
        .from(appointments)
        .innerJoin(doctors, eq(doctors.id, appointments.doctorId))
        .innerJoin(patients, eq(patients.id, appointments.patientId))
        .where(
          tenantScope(
            appointments,
            eq(appointments.clinicId, clinic.id),
            eq(appointments.status, 'COMPLETED'),
            isNull(appointments.reviewRequestedAt),
            gte(appointments.endTime, new Date(now.getTime() - 2 * 86_400_000)),
            lte(appointments.endTime, now),
            isNotNull(patients.marketingConsentAt),
            isNull(patients.anonymizedAt),
          ),
        )
        .limit(200);
      let sent = 0;
      for (const row of due) if (await this.requestReview(row.appt.id)) sent++;
      return sent;
    });
    return results.reduce((a, b) => a + b, 0);
  }

  async requestReview(appointmentId: string) {
    const claimed = await this.db
      .update(appointments)
      .set({ reviewRequestedAt: new Date() })
      .where(tenantScope(appointments, eq(appointments.id, appointmentId), isNull(appointments.reviewRequestedAt)))
      .returning();
    if (!claimed.length) return false;
    const appt = claimed[0];
    const [doctor] = await this.db.select().from(doctors).where(eq(doctors.id, appt.doctorId));
    const [rr] = await this.db
      .insert(reviewRequests)
      .values(withTenant({ clinicId: appt.clinicId, appointmentId: appt.id, patientId: appt.patientId, doctorId: appt.doctorId }))
      .onConflictDoNothing()
      .returning();
    if (!rr) return false;
    const link = await this.tokens.issue('review', { reviewRequestId: rr.id });
    const clinic = await this.clinic();
    const [p] = await this.db.select().from(patients).where(eq(patients.id, appt.patientId));
    await this.notifications.notifyPatient(
      'REVIEW_REQUEST',
      appt.patientId,
      { doctorName: doctorDisplayName(doctor), clinicName: clinic.name, link: link.url },
      p?.phone ? ['WHATSAPP'] : ['EMAIL'],
      { reviewRequestId: rr.id },
    );
    return true;
  }

  async submitReview(reviewRequestId: string, rating: number, comment: string | null) {
    const [rr] = await this.db.select().from(reviewRequests).where(tenantScope(reviewRequests, eq(reviewRequests.id, reviewRequestId)));
    if (!rr) throw new NotFoundError('Review');
    const clinic = await this.clinic();
    const redirect = rating >= 4 && clinic.googleReviewUrl ? clinic.googleReviewUrl : null;
    await this.db
      .update(reviewRequests)
      .set({ rating, comment: comment?.slice(0, 1000) ?? null, respondedAt: new Date(), redirectedToGoogle: Boolean(redirect) })
      .where(eq(reviewRequests.id, rr.id));
    await this.audit.log({ action: 'review.received', entityType: 'ReviewRequest', entityId: rr.id, patientId: rr.patientId, metadata: { rating } });
    if (rating <= 3) {
      const [p] = await this.db.select().from(patients).where(eq(patients.id, rr.patientId));
      const [d] = rr.doctorId ? await this.db.select().from(doctors).where(eq(doctors.id, rr.doctorId)) : [];
      await this.notifications.notifyStaff(
        'REVIEW_LOW_RATING',
        { patientName: p ? personName(p) : '—', doctorName: d ? doctorDisplayName(d) : '—', message: `${rating}/5${comment ? ` — "${comment.slice(0, 200)}"` : ''}` },
        { reviewRequestId: rr.id },
        { roleKeys: ['CLINIC_ADMIN'] },
      );
    }
    return { redirectUrl: redirect };
  }

  async reviewStats(days = 90) {
    const since = new Date(Date.now() - days * 86_400_000);
    const rows = await this.db.query.reviewRequests.findMany({
      where: tenantScope(reviewRequests, eq(reviewRequests.clinicId, TenantContext.clinicId()), gte(reviewRequests.sentAt, since)),
      with: { patient: true, doctor: true },
      orderBy: [desc(reviewRequests.sentAt)],
      limit: 200,
    });
    const rated = rows.filter((r) => r.rating !== null);
    return {
      sent: rows.length,
      responded: rated.length,
      average: rated.length ? Math.round((rated.reduce((a, r) => a + r.rating!, 0) / rated.length) * 10) / 10 : null,
      redirectedToGoogle: rows.filter((r) => r.redirectedToGoogle).length,
      distribution: [1, 2, 3, 4, 5].map((n) => ({ rating: n, count: rated.filter((r) => r.rating === n).length })),
      recent: rated.slice(0, 20).map((r) => ({
        id: r.id,
        rating: r.rating,
        comment: r.comment,
        patient: r.patient ? personName(r.patient) : null,
        doctor: r.doctor ? doctorDisplayName(r.doctor) : null,
        at: r.respondedAt,
      })),
    };
  }

  // ───────────────────────── Intake forms ─────────────────────────
  async intakeForm(appointmentId: string) {
    const appt = await this.appointments.get(appointmentId);
    const fields: IntakeField[] = appt.service?.intakeFields ?? [];
    const [existing] = await this.db.select().from(intakeResponses).where(tenantScope(intakeResponses, eq(intakeResponses.appointmentId, appointmentId)));
    return { appt, fields, answers: existing?.answers ?? null };
  }

  async submitIntake(appointmentId: string, answers: Record<string, unknown>) {
    const { appt, fields } = await this.intakeForm(appointmentId);
    if (!fields.length) throw new BusinessRuleError('NO_INTAKE_FORM', 'This appointment has no intake form');
    if (appt.startTime.getTime() < Date.now()) throw new BusinessRuleError('INTAKE_CLOSED', 'The appointment already started');
    const clean: Record<string, string | boolean> = {};
    for (const f of fields) {
      const v = answers[f.key];
      if (f.type === 'checkbox') {
        clean[f.key] = v === true || v === 'true';
        if (f.required && !clean[f.key]) throw new ValidationError(`"${f.label}" is required`, { field: f.key });
        continue;
      }
      const s = typeof v === 'string' ? v.trim().slice(0, 2000) : '';
      if (f.required && !s) throw new ValidationError(`"${f.label}" is required`, { field: f.key });
      if (s && f.type === 'select' && f.options && !f.options.includes(s)) throw new ValidationError(`Invalid option for "${f.label}"`, { field: f.key });
      if (s && f.type === 'date' && !/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new ValidationError(`Invalid date for "${f.label}"`, { field: f.key });
      if (s) clean[f.key] = s;
    }
    await this.db
      .insert(intakeResponses)
      .values(withTenant({ appointmentId, answers: clean }))
      .onConflictDoUpdate({ target: intakeResponses.appointmentId, set: { answers: clean, submittedAt: new Date() } });
    await this.audit.log({ action: 'appointment.intake_submitted', entityType: 'Appointment', entityId: appointmentId, patientId: appt.patientId });
    this.events.emit('appointment.changed', { id: appointmentId, change: 'intake' });
    return { saved: true };
  }

  // ───────────────────────── Campaigns ─────────────────────────
  private audienceQuery(kind: 'REACTIVATION' | 'REVIEW', criteria: z.infer<typeof campaignSchema>['criteria']) {
    const clinicId = TenantContext.clinicId();
    const base = [
      eq(patients.clinicId, clinicId),
      isNotNull(patients.marketingConsentAt),
      isNull(patients.anonymizedAt),
      or(isNotNull(patients.phone), isNotNull(patients.email)),
    ];
    if (kind === 'REACTIVATION') {
      const cutoff = DateTime.now().minus({ months: criteria.monthsSinceLastVisit }).toJSDate();
      return tenantScope(
        patients,
        ...base,
        // last visit before the cutoff and nothing booked ahead
        sql`(select max(a.start_time) from ${appointments} a where a.patient_id = ${patients.id} and a.status = 'COMPLETED') < ${cutoff.toISOString()}`,
        sql`not exists (select 1 from ${appointments} a where a.patient_id = ${patients.id} and a.start_time > now() and a.status in ('PENDING','CONFIRMED'))`,
        criteria.specialtyId
          ? sql`exists (select 1 from ${appointments} a join ${doctors} d on d.id = a.doctor_id where a.patient_id = ${patients.id} and d.specialty_id = ${criteria.specialtyId})`
          : undefined,
      );
    }
    const since = DateTime.now().minus({ days: criteria.daysSinceVisit }).toJSDate();
    return tenantScope(
      patients,
      ...base,
      sql`exists (select 1 from ${appointments} a where a.patient_id = ${patients.id} and a.status = 'COMPLETED' and a.end_time >= ${since.toISOString()} and a.review_requested_at is null)`,
    );
  }

  async previewAudience(dto: Pick<z.infer<typeof campaignSchema>, 'kind' | 'criteria'>) {
    const where = this.audienceQuery(dto.kind, campaignSchema.shape.criteria.parse(dto.criteria));
    const [{ n }] = await this.db.select({ n: sql<number>`count(*)::int` }).from(patients).where(where);
    const sample = await this.db.select({ id: patients.id, firstName: patients.firstName, lastName: patients.lastName }).from(patients).where(where).limit(5);
    const [{ total }] = await this.db.select({ total: sql<number>`count(*)::int` }).from(patients).where(tenantScope(patients, eq(patients.clinicId, TenantContext.clinicId())));
    const [{ consented }] = await this.db
      .select({ consented: sql<number>`count(*)::int` })
      .from(patients)
      .where(tenantScope(patients, eq(patients.clinicId, TenantContext.clinicId()), isNotNull(patients.marketingConsentAt)));
    return { recipients: n, sample: sample.map((p) => `${p.firstName} ${p.lastName.slice(0, 1)}.`), patientsTotal: total, withMarketingConsent: consented };
  }

  async createCampaign(dto: z.infer<typeof campaignSchema>) {
    if (!(await this.billing.hasFeature('campaigns'))) throw new PlanLimitError('campaigns', { feature: 'campaigns' });
    const [row] = await this.db
      .insert(campaigns)
      .values(withTenant({ ...dto, clinicId: TenantContext.clinicId(), createdById: TenantContext.principal().id }))
      .returning();
    await this.audit.log({ action: 'campaign.created', entityType: 'Campaign', entityId: row.id, metadata: { kind: dto.kind } });
    return row;
  }

  async listCampaigns() {
    const rows = await this.db.select().from(campaigns).where(tenantScope(campaigns, eq(campaigns.clinicId, TenantContext.clinicId()))).orderBy(desc(campaigns.createdAt)).limit(100);
    // Attribution: bookings by recipients within 14 days of sending.
    return Promise.all(
      rows.map(async (c) => {
        if (!c.sentAt) return c;
        const ids = ((c.criteria as { recipientIds?: string[] }).recipientIds ?? []).slice(0, 5000);
        if (!ids.length) return c;
        const [{ n }] = await this.db
          .select({ n: sql<number>`count(distinct ${appointments.patientId})::int` })
          .from(appointments)
          .where(tenantScope(appointments, inArray(appointments.patientId, ids), gte(appointments.createdAt, c.sentAt), lte(appointments.createdAt, new Date(c.sentAt.getTime() + 14 * 86_400_000))));
        return { ...c, stats: { ...c.stats, booked: n } };
      }),
    );
  }

  async sendCampaign(id: string) {
    const [c] = await this.db.select().from(campaigns).where(tenantScope(campaigns, eq(campaigns.id, id)));
    if (!c) throw new NotFoundError('Campaign', id);
    if (c.status !== 'DRAFT') throw new BusinessRuleError('CAMPAIGN_ALREADY_SENT', 'This campaign was already sent');
    const criteria = campaignSchema.shape.criteria.parse(c.criteria);
    const recipients = await this.db.select({ id: patients.id }).from(patients).where(this.audienceQuery(c.kind, criteria)).limit(5000);
    const [row] = await this.db
      .update(campaigns)
      .set({ status: 'SENDING', criteria: { ...criteria, recipientIds: recipients.map((r) => r.id) }, stats: { recipients: recipients.length, sent: 0, failed: 0, booked: 0 } })
      .where(and(eq(campaigns.id, id), eq(campaigns.status, 'DRAFT')))
      .returning();
    if (!row) throw new BusinessRuleError('CAMPAIGN_ALREADY_SENT', 'This campaign was already sent');
    await this.queue.enqueue<CampaignJob>('campaigns', { organizationId: TenantContext.orgId(), clinicId: TenantContext.clinicId(), campaignId: id }, { attempts: 1 });
    await this.audit.log({ action: 'campaign.sent', entityType: 'Campaign', entityId: id, metadata: { recipients: recipients.length } });
    return row;
  }

  private async deliverCampaign(id: string) {
    const [c] = await this.db.select().from(campaigns).where(tenantScope(campaigns, eq(campaigns.id, id)));
    if (!c || c.status !== 'SENDING') return;
    const clinic = await this.clinic();
    const ids = (c.criteria as { recipientIds?: string[] }).recipientIds ?? [];
    const bookUrl = `${env().APP_URL.replace(/\/$/, '')}/c/${clinic.slug}`;
    let sent = 0;
    let failed = 0;
    for (const patientId of ids) {
      try {
        const [p] = await this.db.select().from(patients).where(tenantScope(patients, eq(patients.id, patientId)));
        if (!p || !p.marketingConsentAt || p.anonymizedAt) continue; // consent re-checked at send time
        if (c.kind === 'REVIEW') {
          const [last] = await this.db
            .select({ id: appointments.id })
            .from(appointments)
            .where(tenantScope(appointments, eq(appointments.patientId, p.id), eq(appointments.status, 'COMPLETED'), isNull(appointments.reviewRequestedAt)))
            .orderBy(desc(appointments.endTime))
            .limit(1);
          if (last && (await this.requestReview(last.id))) sent++;
          continue;
        }
        const en = p.preferredLanguage === 'en';
        const message = `${c.message.replaceAll('{nombre}', p.firstName).replaceAll('{name}', p.firstName)}\n\n${en ? 'Book here' : 'Agenda aquí'}: ${bookUrl}\n${en ? 'Reply STOP to unsubscribe.' : 'Responde BAJA para no recibir más mensajes.'}`;
        await this.notifications.notifyPatient('CAMPAIGN', p.id, { clinicName: clinic.name, message }, p.phone ? ['WHATSAPP'] : ['EMAIL'], { campaignId: c.id });
        sent++;
      } catch (err) {
        failed++;
        this.logger.warn(`Campaign ${id} → ${patientId} failed: ${(err as Error).message}`);
      }
    }
    await this.db
      .update(campaigns)
      .set({ status: 'SENT', sentAt: new Date(), stats: { recipients: ids.length, sent, failed, booked: 0 } })
      .where(eq(campaigns.id, id));
    this.events.emit('campaign.sent', { id, sent });
  }

  /** "BAJA" / "STOP" from WhatsApp withdraws marketing consent. */
  async optOut(patientId: string) {
    await this.db.update(patients).set({ marketingConsentAt: null }).where(tenantScope(patients, eq(patients.id, patientId)));
  }

  // ───────────────────────── Value report ─────────────────────────
  /** What Alejandro AI did for the clinic in a month, with the previous month for comparison. */
  async valueReport(month?: string) {
    const clinic = await this.clinic();
    const start = (month ? DateTime.fromFormat(month, 'yyyy-MM', { zone: clinic.timezone }) : DateTime.now().setZone(clinic.timezone)).startOf('month');
    if (!start.isValid) throw new ValidationError('month must be YYYY-MM');
    const current = await this.monthMetrics(clinic, start);
    const previous = await this.monthMetrics(clinic, start.minus({ months: 1 }));
    return { month: start.toFormat('yyyy-MM'), clinic: { name: clinic.name, currency: clinic.currency, minutesSavedPerConversation: clinic.minutesSavedPerConversation }, current, previous };
  }

  private async monthMetrics(clinic: typeof clinics.$inferSelect, start: DateTime) {
    const from = start.toJSDate();
    const to = start.plus({ months: 1 }).toJSDate();
    const convScope = tenantScope(conversations, eq(conversations.clinicId, clinic.id), ne(conversations.channel, 'PLAYGROUND'), gte(conversations.createdAt, from), lt(conversations.createdAt, to));
    const convs = await this.db.select({ id: conversations.id, createdAt: conversations.createdAt, channel: conversations.channel, hasBooking: conversations.hasBooking }).from(conversations).where(convScope);
    const [{ handoffs: handed }] = await this.db
      .select({ handoffs: sql<number>`count(distinct ${handoffs.conversationId})::int` })
      .from(handoffs)
      .where(tenantScope(handoffs, eq(handoffs.clinicId, clinic.id), gte(handoffs.createdAt, from), lt(handoffs.createdAt, to)));
    const hours = clinic.businessHours as Record<string, [string, string][]>;
    const keys = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
    const afterHours = convs.filter((c) => {
      const t = DateTime.fromJSDate(c.createdAt, { zone: clinic.timezone });
      const hm = t.toFormat('HH:mm');
      return !(hours[keys[t.weekday - 1]] ?? []).some(([a, b]) => hm >= a && hm < b);
    }).length;
    const appts = await this.db
      .select({ status: appointments.status, source: appointments.source, price: services.priceCents, confirmed: appointments.patientConfirmedAt, reminder: appointments.reminderSentAt })
      .from(appointments)
      .leftJoin(services, eq(services.id, appointments.serviceId))
      .where(tenantScope(appointments, eq(appointments.clinicId, clinic.id), gte(appointments.createdAt, from), lt(appointments.createdAt, to)));
    const AI_SOURCES = ['AI', 'WEB', 'WHATSAPP', 'PHONE'];
    const byAi = appts.filter((a) => AI_SOURCES.includes(a.source));
    const visits = await this.db
      .select({ status: appointments.status })
      .from(appointments)
      .where(tenantScope(appointments, eq(appointments.clinicId, clinic.id), gte(appointments.startTime, from), lt(appointments.startTime, to), inArray(appointments.status, ['COMPLETED', 'NO_SHOW'])));
    const noShows = visits.filter((v) => v.status === 'NO_SHOW').length;
    const [{ refilled }] = await this.db
      .select({ refilled: sql<number>`count(*)::int` })
      .from(waitlistEntries)
      .where(tenantScope(waitlistEntries, eq(waitlistEntries.clinicId, clinic.id), eq(waitlistEntries.status, 'BOOKED'), gte(waitlistEntries.updatedAt, from), lt(waitlistEntries.updatedAt, to)));
    const [{ reviews, avg }] = await this.db
      .select({ reviews: sql<number>`count(${reviewRequests.rating})::int`, avg: sql<number | null>`round(avg(${reviewRequests.rating})::numeric, 1)::float` })
      .from(reviewRequests)
      .where(tenantScope(reviewRequests, eq(reviewRequests.clinicId, clinic.id), gte(reviewRequests.respondedAt, from), lt(reviewRequests.respondedAt, to)));
    const resolvedByAi = Math.max(0, convs.length - handed);
    return {
      conversations: convs.length,
      resolvedByAi,
      resolutionRate: convs.length ? Math.round((resolvedByAi / convs.length) * 100) : null,
      afterHours,
      byChannel: Object.fromEntries(['WEB', 'PORTAL', 'WHATSAPP', 'PHONE'].map((ch) => [ch, convs.filter((c) => c.channel === ch).length])),
      appointmentsByAi: byAi.filter((a) => a.status !== 'CANCELLED').length,
      revenueBookedByAiCents: byAi.filter((a) => !['CANCELLED', 'NO_SHOW'].includes(a.status)).reduce((s, a) => s + (a.price ?? 0), 0),
      remindersSent: appts.filter((a) => a.reminder).length,
      attendanceConfirmed: appts.filter((a) => a.confirmed).length,
      noShowRate: visits.length ? Math.round((noShows / visits.length) * 1000) / 10 : null,
      slotsRefilledFromWaitlist: refilled,
      reviews,
      averageRating: avg,
      minutesSaved: convs.length * clinic.minutesSavedPerConversation,
    };
  }

  /** On the 1st of each month: email/in-app summary of the previous month to clinic admins. */
  private async sendMonthlyReports(now: Date) {
    const results = await this.forEachClinic(async (clinic) => {
      const local = DateTime.fromJSDate(now, { zone: clinic.timezone });
      if (local.day !== 1 || local.hour < 8) return 0 as number;
      const [already] = await this.db
        .select({ id: notifications.id })
        .from(notifications)
        .where(tenantScope(notifications, eq(notifications.clinicId, clinic.id), eq(notifications.type, 'MONTHLY_REPORT'), gte(notifications.createdAt, new Date(now.getTime() - 20 * 86_400_000))))
        .limit(1);
      if (already) return 0 as number;
      const prev = local.minus({ months: 1 });
      const r = await this.valueReport(prev.toFormat('yyyy-MM'));
      const c = r.current;
      const money = new Intl.NumberFormat('es-CO', { style: 'currency', currency: clinic.currency, maximumFractionDigits: 0 }).format(c.revenueBookedByAiCents / 100);
      const message = [
        `${c.conversations} conversaciones atendidas (${c.afterHours} fuera de horario).`,
        `${c.appointmentsByAi} citas agendadas por la IA ≈ ${money}.`,
        `${Math.round(c.minutesSaved / 60)} horas de recepción ahorradas.`,
        c.noShowRate !== null ? `Inasistencia: ${c.noShowRate}%.` : '',
        c.slotsRefilledFromWaitlist ? `${c.slotsRefilledFromWaitlist} cupos recuperados con la lista de espera.` : '',
        `Detalle: ${env().APP_URL.replace(/\/$/, '')}/reports/value?month=${r.month}`,
      ]
        .filter(Boolean)
        .join('\n');
      await this.notifications.notifyStaff('MONTHLY_REPORT', { when: prev.setLocale('es').toFormat('LLLL yyyy'), message }, { month: r.month }, { roleKeys: ['CLINIC_ADMIN'] });
      await this.notifications.emailStaff('MONTHLY_REPORT', { when: prev.setLocale('es').toFormat('LLLL yyyy'), message }, ['CLINIC_ADMIN']);
      return 1 as number;
    });
    return results.reduce((a, b) => a + b, 0);
  }
}
