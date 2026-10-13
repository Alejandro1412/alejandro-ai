import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { and, eq, gte, inArray, lt, sql } from 'drizzle-orm';
import { env } from '../config/env';
import { Database, DB } from '../database/database.module';
import { clinics, invoices, plans, subscriptions, usageRecords } from '../database/schema';
import { TenantContext } from '../database/tenant';
import { AuditService } from '../audit/audit.service';
import { CacheService } from '../jobs/cache.service';
import { QueueService, TenantJob } from '../jobs/queue.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ROLE_DEFINITIONS } from '../rbac/permissions';
import { BillingProviderFactory } from './billing-provider';
import { AI_CONVERSATION_OVERAGE_MICRO_USD } from './plan-catalog';

const DAY = 86_400_000;
const INACTIVE = ['EXPIRED', 'SUSPENDED', 'CANCELED'] as const;
export type ServiceState = { status: string; active: boolean; graceEndsAt: Date | null; trialEndsAt: Date | null; reason: string | null };

const fmtDate = (d: Date, tz: string) => new Intl.DateTimeFormat('es-CO', { dateStyle: 'long', timeZone: tz }).format(d);

/**
 * Subscription lifecycle: trial → (grace) → expired, failed payment → dunning → suspended, period
 * renewal with AI-overage invoicing, and the monthly AI budget cap. Runs as an hourly sweep.
 * Expired/suspended tenants keep read access and their data; writes and the AI assistant pause.
 */
@Injectable()
export class BillingLifecycleService implements OnModuleInit {
  private readonly logger = new Logger(BillingLifecycleService.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly queue: QueueService,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService,
    private readonly cache: CacheService,
    private readonly providers: BillingProviderFactory,
  ) {}

  onModuleInit(): void {
    this.queue.register<TenantJob>('billing-lifecycle', () => this.sweep().then(() => undefined));
    void this.queue.every('billing-lifecycle', 60 * 60_000, { organizationId: 'system' }).catch((e: Error) => this.logger.warn(`Billing sweep not scheduled: ${e.message}`));
  }

  /** Cached (60 s) service state for request gating. */
  async state(organizationId: string): Promise<ServiceState> {
    const key = `billing:state:${organizationId}`;
    const cached = await this.cache.get<ServiceState>(key);
    if (cached) return cached;
    const [sub] = await this.db.select().from(subscriptions).where(eq(subscriptions.organizationId, organizationId));
    const state: ServiceState = sub
      ? { status: sub.status, active: !INACTIVE.includes(sub.status as (typeof INACTIVE)[number]), graceEndsAt: sub.graceEndsAt, trialEndsAt: sub.trialEndsAt, reason: sub.suspendedReason }
      : { status: 'NONE', active: true, graceEndsAt: null, trialEndsAt: null, reason: null };
    await this.cache.set(key, state, 60);
    return state;
  }

  async invalidate(organizationId: string) {
    await this.cache.del(`billing:state:${organizationId}`);
  }

  private inOrg<T>(organizationId: string, fn: () => Promise<T>) {
    return this.db
      .select({ id: clinics.id, name: clinics.name, timezone: clinics.timezone })
      .from(clinics)
      .where(eq(clinics.organizationId, organizationId))
      .limit(1)
      .then(([c]) =>
        TenantContext.run(
          { organizationId, clinicId: c?.id, principal: { kind: 'SYSTEM', id: null, name: 'Billing', role: 'SYSTEM', permissions: new Set(ROLE_DEFINITIONS.CLINIC_ADMIN.permissions) } },
          () => fn(),
        ).then((r) => ({ r, clinic: c })),
      );
  }

  private async tell(organizationId: string, type: 'BILLING_TRIAL_ENDING' | 'BILLING_PAYMENT_FAILED' | 'BILLING_SUSPENDED', vars: { when?: Date; reason?: string }) {
    await this.inOrg(organizationId, async () => {
      const [c] = await this.db.select().from(clinics).where(eq(clinics.organizationId, organizationId)).limit(1);
      const v = { clinicName: c?.name ?? '', when: vars.when ? fmtDate(vars.when, c?.timezone ?? 'UTC') : undefined, reason: vars.reason };
      if (c) await this.notifications.notifyStaff(type, v, { billing: true }, { roleKeys: ['CLINIC_ADMIN'] });
      await this.notifications.emailStaff(type, v, ['CLINIC_ADMIN']);
    });
  }

  async sweep(now = new Date()) {
    const out = { trialWarnings: 0, trialsEnded: 0, dunning: 0, expired: 0, renewed: 0 };
    const grace = env().BILLING_GRACE_DAYS * DAY;
    const subs = await this.db.select().from(subscriptions);
    for (const sub of subs) {
      try {
        // 1) Trial ending in ≤3 days → one warning.
        if (sub.status === 'TRIALING' && sub.trialEndsAt && sub.trialEndsAt.getTime() - now.getTime() <= 3 * DAY && sub.trialEndsAt > now && sub.dunningStage === 0) {
          await this.db.update(subscriptions).set({ dunningStage: 1, lastDunningAt: now }).where(eq(subscriptions.id, sub.id));
          await this.tell(sub.organizationId, 'BILLING_TRIAL_ENDING', { when: sub.trialEndsAt });
          out.trialWarnings++;
        }
        // 2) Trial over → grace period.
        if (sub.status === 'TRIALING' && sub.trialEndsAt && sub.trialEndsAt <= now) {
          const graceEndsAt = new Date(now.getTime() + grace);
          await this.db.update(subscriptions).set({ status: 'PAST_DUE', graceEndsAt, dunningStage: 1, lastDunningAt: now }).where(eq(subscriptions.id, sub.id));
          await this.tell(sub.organizationId, 'BILLING_PAYMENT_FAILED', { when: graceEndsAt });
          await this.inOrg(sub.organizationId, () => this.audit.log({ action: 'billing.trial_expired', entityType: 'Subscription', entityId: sub.id, organizationId: sub.organizationId }));
          await this.invalidate(sub.organizationId);
          out.trialsEnded++;
          continue;
        }
        // 3) Past due → reminders every 3 days, then expire at the end of the grace period.
        if (sub.status === 'PAST_DUE') {
          const graceEndsAt = sub.graceEndsAt ?? new Date(now.getTime() + grace);
          if (!sub.graceEndsAt) await this.db.update(subscriptions).set({ graceEndsAt }).where(eq(subscriptions.id, sub.id));
          if (graceEndsAt <= now) {
            await this.db.update(subscriptions).set({ status: 'EXPIRED', suspendedReason: 'payment_overdue' }).where(eq(subscriptions.id, sub.id));
            await this.tell(sub.organizationId, 'BILLING_SUSPENDED', { reason: 'pago vencido' });
            await this.inOrg(sub.organizationId, () => this.audit.log({ action: 'billing.suspended', entityType: 'Subscription', entityId: sub.id, organizationId: sub.organizationId, metadata: { reason: 'payment_overdue' } }));
            await this.invalidate(sub.organizationId);
            out.expired++;
          } else if (!sub.lastDunningAt || now.getTime() - sub.lastDunningAt.getTime() >= 3 * DAY) {
            await this.db.update(subscriptions).set({ dunningStage: sub.dunningStage + 1, lastDunningAt: now }).where(eq(subscriptions.id, sub.id));
            await this.tell(sub.organizationId, 'BILLING_PAYMENT_FAILED', { when: graceEndsAt });
            out.dunning++;
          }
          continue;
        }
        // 4) Period end: invoice AI overage; without a processor (mock) the period renews locally.
        if (sub.status === 'ACTIVE' && sub.currentPeriodEnd <= now) {
          await this.closePeriod(sub, now);
          out.renewed++;
        }
      } catch (err) {
        this.logger.error(`Billing sweep for ${sub.organizationId} failed: ${(err as Error).message}`);
      }
    }
    return out;
  }

  /** Overage = AI conversations beyond the plan allowance during the closing period. */
  private async closePeriod(sub: typeof subscriptions.$inferSelect, now: Date) {
    const [plan] = await this.db.select().from(plans).where(eq(plans.id, sub.planId));
    const [{ used }] = await this.db
      .select({ used: sql<number>`coalesce(sum(${usageRecords.quantity}),0)::int` })
      .from(usageRecords)
      .where(and(eq(usageRecords.organizationId, sub.organizationId), eq(usageRecords.kind, 'AI_CONVERSATION'), gte(usageRecords.createdAt, sub.currentPeriodStart), lt(usageRecords.createdAt, sub.currentPeriodEnd)));
    const limit = plan.limits.aiConversationsPerMonth;
    const overage = limit === null ? 0 : Math.max(0, used - limit);
    if (overage > 0) {
      const amountCents = Math.round((overage * AI_CONVERSATION_OVERAGE_MICRO_USD) / 10_000);
      const [{ n }] = await this.db.select({ n: sql<number>`count(*)::int` }).from(invoices);
      let hostedUrl: string | null = null;
      if (this.providers.get().name === 'stripe') {
        const link = await this.providers.get().createPaymentLink({
          amountCents,
          currency: plan.currency,
          description: `AI overage: ${overage} conversations`,
          successUrl: `${env().APP_URL}/settings/billing?overage=paid`,
          cancelUrl: `${env().APP_URL}/settings/billing`,
          metadata: { kind: 'overage', organizationId: sub.organizationId },
        });
        hostedUrl = link.url;
      }
      await this.db.insert(invoices).values({
        organizationId: sub.organizationId,
        subscriptionId: sub.id,
        number: `AAI-${now.getFullYear()}-${String(n + 1).padStart(6, '0')}`,
        amountCents,
        currency: plan.currency,
        status: 'OPEN',
        periodStart: sub.currentPeriodStart,
        periodEnd: sub.currentPeriodEnd,
        description: `Excedente IA: ${overage} conversaciones × $${(AI_CONVERSATION_OVERAGE_MICRO_USD / 1e6).toFixed(2)}`,
        hostedUrl,
      });
      await this.inOrg(sub.organizationId, () =>
        this.audit.log({ action: 'billing.overage_invoiced', entityType: 'Subscription', entityId: sub.id, organizationId: sub.organizationId, metadata: { overage, amountCents } }),
      );
    }
    if (this.providers.get().name === 'mock' || !sub.stripeSubscriptionId) {
      const next = new Date(sub.currentPeriodEnd);
      if (sub.interval === 'YEARLY') next.setFullYear(next.getFullYear() + 1);
      else next.setMonth(next.getMonth() + 1);
      await this.db.update(subscriptions).set({ currentPeriodStart: sub.currentPeriodEnd, currentPeriodEnd: next < now ? new Date(now.getTime() + 30 * DAY) : next }).where(eq(subscriptions.id, sub.id));
    }
  }

  /** Monthly LLM spend vs the plan cap. Over the cap the clinic keeps working on the local engine. */
  async aiBudget(organizationId: string): Promise<{ capUsd: number | null; spentUsd: number; exceeded: boolean }> {
    const key = `billing:aibudget:${organizationId}`;
    const cached = await this.cache.get<{ capUsd: number | null; spentUsd: number; exceeded: boolean }>(key);
    if (cached) return cached;
    const [row] = await this.db
      .select({ limits: plans.limits })
      .from(subscriptions)
      .innerJoin(plans, eq(plans.id, subscriptions.planId))
      .where(eq(subscriptions.organizationId, organizationId));
    const capUsd = row?.limits.aiMonthlyBudgetUsd ?? null;
    const monthStart = new Date();
    monthStart.setUTCDate(1);
    monthStart.setUTCHours(0, 0, 0, 0);
    const [{ micro }] = await this.db
      .select({ micro: sql<number>`coalesce(sum(${usageRecords.costMicroUsd}),0)::bigint` })
      .from(usageRecords)
      .where(and(eq(usageRecords.organizationId, organizationId), inArray(usageRecords.kind, ['AI_COMPLETION', 'EMBEDDING']), gte(usageRecords.createdAt, monthStart)));
    const spentUsd = Number(micro) / 1e6;
    const result = { capUsd, spentUsd, exceeded: capUsd !== null && spentUsd >= capUsd };
    await this.cache.set(key, result, 120);
    return result;
  }
}
