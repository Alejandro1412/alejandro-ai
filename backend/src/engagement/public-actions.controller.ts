import { Body, Controller, Get, Inject, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { Public } from '../common/decorators/auth.decorators';
import { env } from '../config/env';
import { BusinessRuleError, ValidationError } from '../common/errors/app-error';
import { doctorDisplayName, formatWhen } from '../common/utils/time';
import { zv } from '../common/pipes/zod.pipe';
import { Database, DB } from '../database/database.module';
import { appointments, clinics, doctors, reviewRequests, waitlistEntries } from '../database/schema';
import { TenantContext, type Principal } from '../database/tenant';
import { ActionTokensService } from '../actions/action-tokens.service';
import { AppointmentsService } from '../appointments/appointments.service';
import { AuditService } from '../audit/audit.service';
import { BillingProviderFactory } from '../billing/billing-provider';
import { EngagementService } from './engagement.service';

const performSchema = z.object({
  reason: z.string().trim().max(300).optional(),
  rating: z.number().int().min(1).max(5).optional(),
  comment: z.string().trim().max(1000).optional(),
  answers: z.record(z.string().max(60), z.union([z.string().max(2000), z.boolean()])).optional(),
});

type TokenRow = Awaited<ReturnType<ActionTokensService['peek']>>;

/**
 * The page behind every link sent to patients (/a/:token): confirm or cancel an appointment, take a
 * waitlist slot, fill the intake form, leave a review, pay a deposit. The token is the only credential;
 * the patient never sees ids, and every action is scoped to that one appointment / entry.
 */
@ApiTags('Public')
@Public()
@Controller('public/actions')
export class PublicActionsController {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly tokens: ActionTokensService,
    private readonly appointments: AppointmentsService,
    private readonly engagement: EngagementService,
    private readonly payments: BillingProviderFactory,
    private readonly audit: AuditService,
  ) {}

  private async inTenant<T>(row: TokenRow, patientId: string | null, fn: () => Promise<T>): Promise<T> {
    const principal: Principal = { kind: 'PATIENT', id: null, name: 'Patient (link)', role: 'PATIENT', permissions: new Set(['portal.self']), patientId };
    return TenantContext.run({ ...TenantContext.current(), organizationId: row.organizationId, clinicId: row.clinicId, principal }, fn);
  }

  private async patientOf(row: TokenRow): Promise<string | null> {
    const p = row.payload as Record<string, string>;
    if (p.appointmentId) {
      const [a] = await this.db.select({ patientId: appointments.patientId }).from(appointments).where(eq(appointments.id, p.appointmentId));
      return a?.patientId ?? null;
    }
    if (p.entryId) {
      const [w] = await this.db.select({ patientId: waitlistEntries.patientId }).from(waitlistEntries).where(eq(waitlistEntries.id, p.entryId));
      return w?.patientId ?? null;
    }
    if (p.reviewRequestId) {
      const [r] = await this.db.select({ patientId: reviewRequests.patientId }).from(reviewRequests).where(eq(reviewRequests.id, p.reviewRequestId));
      return r?.patientId ?? null;
    }
    return null;
  }

  @Get(':token')
  @Throttle({ default: { limit: env().PUBLIC_CHAT_RATE_LIMIT_MAX, ttl: 60_000 } })
  @ApiOperation({ summary: 'Describe what a patient link does (no side effects)' })
  async describe(@Param('token') token: string) {
    const row = await this.tokens.peek(token);
    const patientId = await this.patientOf(row);
    return this.inTenant(row, patientId, async () => {
      const [clinic] = await this.db.select().from(clinics).where(eq(clinics.id, row.clinicId));
      const p = row.payload as Record<string, string>;
      const base = {
        purpose: row.purpose,
        expiresAt: row.expiresAt,
        clinic: { name: clinic.name, slug: clinic.slug, phone: clinic.phone, timezone: clinic.timezone, privacyPolicyUrl: clinic.privacyPolicyUrl },
      };
      const apptSummary = async (id: string) => {
        const a = await this.appointments.get(id);
        const lang = a.patient.preferredLanguage;
        return {
          doctor: doctorDisplayName(a.doctor),
          specialty: a.doctor.specialty?.name ?? null,
          service: a.service?.name ?? null,
          when: formatWhen(a.startTime, clinic.timezone, lang),
          start: a.startTime,
          status: a.status,
          location: a.location ? `${a.location.name} — ${a.location.address}` : null,
          videoUrl: a.videoUrl,
          patientFirstName: a.patient.firstName,
          patientConfirmed: Boolean(a.patientConfirmedAt),
          depositStatus: a.depositStatus,
          depositCents: a.depositCents,
          currency: a.service?.currency ?? clinic.currency,
          language: lang,
        };
      };
      switch (row.purpose) {
        case 'confirm':
        case 'cancel':
          return { ...base, appointment: await apptSummary(p.appointmentId) };
        case 'payment':
          return { ...base, appointment: await apptSummary(p.appointmentId), simulated: this.payments.get().name === 'mock' };
        case 'intake': {
          const form = await this.engagement.intakeForm(p.appointmentId);
          return { ...base, appointment: await apptSummary(p.appointmentId), fields: form.fields, answers: form.answers };
        }
        case 'waitlist': {
          const [d] = await this.db.select().from(doctors).where(eq(doctors.id, p.doctorId));
          const [w] = await this.db.select().from(waitlistEntries).where(eq(waitlistEntries.id, p.entryId));
          return { ...base, offer: { doctor: d ? doctorDisplayName(d) : null, when: formatWhen(new Date(p.startTime), clinic.timezone, 'es'), start: p.startTime, available: w?.status === 'OFFERED' } };
        }
        case 'review': {
          const [r] = await this.db.select().from(reviewRequests).where(eq(reviewRequests.id, p.reviewRequestId));
          const [d] = r?.doctorId ? await this.db.select().from(doctors).where(eq(doctors.id, r.doctorId)) : [];
          return { ...base, review: { doctor: d ? doctorDisplayName(d) : null, answered: Boolean(r?.respondedAt) } };
        }
        default:
          throw new ValidationError('Unknown link');
      }
    });
  }

  @Post(':token')
  @Throttle({ default: { limit: Math.max(10, Math.floor(env().PUBLIC_CHAT_RATE_LIMIT_MAX / 3)), ttl: 60_000 } })
  @ApiOperation({ summary: 'Perform the action of a patient link' })
  async perform(@Param('token') token: string, @Body(zv(performSchema)) dto: z.infer<typeof performSchema>) {
    const row = await this.tokens.peek(token);
    const patientId = await this.patientOf(row);
    const p = row.payload as Record<string, string>;
    const result = await this.inTenant(row, patientId, async () => {
      switch (row.purpose) {
        case 'confirm': {
          const a = await this.appointments.confirmAttendance(p.appointmentId, 'link');
          return { done: true, status: a.status };
        }
        case 'cancel': {
          if (!(await this.tokens.consume(row.id))) throw new BusinessRuleError('ACTION_LINK_USED', 'This link was already used');
          const a = await this.appointments.cancel(p.appointmentId, dto.reason ?? 'Cancelled by patient (link)', { source: 'WEB' });
          return { done: true, status: a.status };
        }
        case 'waitlist': {
          if (!(await this.tokens.consume(row.id))) throw new BusinessRuleError('ACTION_LINK_USED', 'This link was already used');
          const a = await this.engagement.acceptOffer({ entryId: p.entryId, doctorId: p.doctorId, startTime: p.startTime, serviceId: p.serviceId ?? null });
          return { done: true, status: a.status, appointmentId: a.id, paymentUrl: a.links?.paymentUrl ?? null };
        }
        case 'intake':
          if (!dto.answers) throw new ValidationError('answers are required');
          return this.engagement.submitIntake(p.appointmentId, dto.answers);
        case 'review': {
          if (!dto.rating) throw new ValidationError('rating is required');
          if (!(await this.tokens.consume(row.id))) throw new BusinessRuleError('ACTION_LINK_USED', 'This link was already used');
          return { done: true, ...(await this.engagement.submitReview(p.reviewRequestId, dto.rating, dto.comment ?? null)) };
        }
        case 'payment': {
          if (this.payments.get().name !== 'mock') throw new BusinessRuleError('PAY_WITH_PROCESSOR', 'Complete the payment on the secure payment page');
          if (!(await this.tokens.consume(row.id))) throw new BusinessRuleError('ACTION_LINK_USED', 'This link was already used');
          const a = await this.appointments.markDepositPaid(p.appointmentId, `simulated_${row.id.slice(0, 8)}`);
          return { done: true, status: a.status, simulated: true };
        }
        default:
          throw new ValidationError('Unknown link');
      }
    });
    await TenantContext.run({ organizationId: row.organizationId, clinicId: row.clinicId }, () =>
      this.audit.log({ action: 'action_link.used', entityType: 'ActionToken', entityId: row.id, patientId, actor: { type: 'PATIENT', name: 'Patient (link)' }, metadata: { purpose: row.purpose } }),
    );
    return result;
  }
}
