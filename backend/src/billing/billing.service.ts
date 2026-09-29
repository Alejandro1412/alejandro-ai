import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { env } from '../config/env';
import { Database, DB, DbExecutor } from '../database/database.module';
import { doctors, invoices, knowledgeSources, memberships, plans, subscriptions, users, webhookEvents } from '../database/schema';
import { TenantContext, tenantScope } from '../database/tenant';
import { NotFoundError, PlanLimitError, ValidationError } from '../common/errors/app-error';
import { AuditService } from '../audit/audit.service';
import { UsageService } from '../usage/usage.service';
import { BillingEvent, BillingProviderFactory } from './billing-provider';
import { PLAN_CATALOG, TRIAL_DAYS, type PlanDefinition } from './plan-catalog';

function stripePriceIds(key: PlanDefinition['key']): { stripePriceMonthlyId?: string; stripePriceYearlyId?: string } {
  const e = env();
  const monthly = e[`STRIPE_PRICE_${key}_MONTHLY`];
  const yearly = e[`STRIPE_PRICE_${key}_YEARLY`];
  return { ...(monthly ? { stripePriceMonthlyId: monthly } : {}), ...(yearly ? { stripePriceYearlyId: yearly } : {}) };
}

const addPeriod = (from: Date, interval: 'MONTHLY' | 'YEARLY') => {
  const d = new Date(from);
  if (interval === 'YEARLY') d.setFullYear(d.getFullYear() + 1);
  else d.setMonth(d.getMonth() + 1);
  return d;
};

type LimitedResource = 'doctors' | 'users' | 'knowledgeSources';

@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly providers: BillingProviderFactory,
    private readonly usage: UsageService,
    private readonly audit: AuditService,
  ) {}

  /** Idempotently syncs the plan catalog into the DB (seed + boot). */
  async syncPlans(): Promise<void> {
    for (const p of PLAN_CATALOG) {
      const values = {
        key: p.key,
        name: p.name,
        description: p.description,
        priceMonthlyCents: p.priceMonthlyCents,
        priceYearlyCents: p.priceYearlyCents,
        limits: p.limits,
        features: p.features,
        isPopular: p.isPopular,
        sortOrder: p.sortOrder,
        // Stripe price ids come from the environment so the same build works in test and live mode.
        ...stripePriceIds(p.key),
      };
      await this.db.insert(plans).values(values).onConflictDoUpdate({ target: plans.key, set: values });
    }
  }

  listPlans() {
    return this.db.select().from(plans).where(eq(plans.isActive, true)).orderBy(asc(plans.sortOrder));
  }

  async startTrial(tx: DbExecutor, organizationId: string, planKey: string): Promise<void> {
    const [plan] = await tx.select().from(plans).where(eq(plans.key, planKey));
    if (!plan) throw new NotFoundError('Plan', planKey);
    const now = new Date();
    const trialEnds = new Date(now.getTime() + TRIAL_DAYS * 86_400_000);
    await tx.insert(subscriptions).values({
      organizationId,
      planId: plan.id,
      status: 'TRIALING',
      currentPeriodStart: now,
      currentPeriodEnd: trialEnds,
      trialEndsAt: trialEnds,
    });
  }

  private async currentSubscription() {
    const orgId = TenantContext.orgId();
    const [row] = await this.db
      .select({ sub: subscriptions, plan: plans })
      .from(subscriptions)
      .innerJoin(plans, eq(plans.id, subscriptions.planId))
      .where(eq(subscriptions.organizationId, orgId));
    if (!row) throw new NotFoundError('Subscription');
    return row;
  }

  async overview() {
    const { sub, plan } = await this.currentSubscription();
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);
    const [usage, invoiceRows] = await Promise.all([this.usageCounts(monthStart), this.invoices()]);
    return {
      subscription: {
        id: sub.id,
        status: sub.status,
        interval: sub.interval,
        currentPeriodStart: sub.currentPeriodStart,
        currentPeriodEnd: sub.currentPeriodEnd,
        trialEndsAt: sub.trialEndsAt,
        cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
        hasPaymentMethod: Boolean(sub.stripeCustomerId),
      },
      plan,
      usage,
      invoices: invoiceRows,
      provider: this.providers.get().name,
    };
  }

  private async usageCounts(since: Date) {
    const orgId = TenantContext.orgId();
    const [[d], [u], [k], ai] = await Promise.all([
      this.db.select({ n: sql<number>`count(*)::int` }).from(doctors).where(tenantScope(doctors)),
      this.db.select({ n: sql<number>`count(*)::int` }).from(memberships).where(and(eq(memberships.organizationId, orgId), sql`${memberships.roleId} not in (select id from roles where key in ('PATIENT','AI_AGENT'))`)),
      this.db.select({ n: sql<number>`count(*)::int` }).from(knowledgeSources).where(tenantScope(knowledgeSources)),
      this.usage.countSince('AI_CONVERSATION', since),
    ]);
    return { doctors: d.n, users: u.n, knowledgeSources: k.n, aiConversationsThisMonth: ai };
  }

  invoices() {
    return this.db.select().from(invoices).where(tenantScope(invoices)).orderBy(desc(invoices.issuedAt)).limit(24);
  }

  /** Throws PlanLimitError (HTTP 402) when adding one more `resource` would exceed the plan. */
  async assertWithinLimit(resource: LimitedResource): Promise<void> {
    const { plan } = await this.currentSubscription();
    const limit = plan.limits[resource];
    if (limit === null || limit === undefined) return;
    const counts = await this.usageCounts(new Date());
    if (counts[resource] >= limit) throw new PlanLimitError(resource, { limit, plan: plan.key });
  }

  async hasFeature(feature: 'whatsapp' | 'customBranding' | 'apiAccess'): Promise<boolean> {
    const { plan } = await this.currentSubscription();
    return Boolean(plan.limits[feature]);
  }

  /** AI conversation allowance. Over-quota conversations are allowed and metered as overage. */
  async aiQuota() {
    const { plan, sub } = await this.currentSubscription();
    const used = await this.usage.countSince('AI_CONVERSATION', sub.currentPeriodStart);
    const limit = plan.limits.aiConversationsPerMonth;
    return { used, limit, overage: limit === null ? 0 : Math.max(0, used - limit) };
  }

  async checkout(planKey: string, interval: 'MONTHLY' | 'YEARLY', userId: string) {
    const [plan] = await this.db.select().from(plans).where(eq(plans.key, planKey));
    if (!plan || !plan.isActive) throw new NotFoundError('Plan', planKey);
    const { sub } = await this.currentSubscription();
    const [user] = await this.db.select({ email: users.email }).from(users).where(eq(users.id, userId));
    const provider = this.providers.get();
    const session = await provider.createCheckoutSession({
      organizationId: TenantContext.orgId(),
      planKey,
      interval,
      priceId: interval === 'YEARLY' ? plan.stripePriceYearlyId : plan.stripePriceMonthlyId,
      customerEmail: user.email,
      customerId: sub.stripeCustomerId,
      successUrl: `${env().APP_URL}/settings/billing?checkout=success`,
      cancelUrl: `${env().APP_URL}/settings/billing?checkout=cancelled`,
    });
    if (session.completedImmediately) await this.applyPlan(TenantContext.orgId(), plan.id, interval, { paid: true });
    return { url: session.url, provider: provider.name, completed: session.completedImmediately };
  }

  async portal() {
    const { sub } = await this.currentSubscription();
    const returnUrl = `${env().APP_URL}/settings/billing`;
    if (!sub.stripeCustomerId) return { url: returnUrl };
    return this.providers.get().createPortalSession(sub.stripeCustomerId, returnUrl);
  }

  async cancelAtPeriodEnd(cancel: boolean) {
    const { sub } = await this.currentSubscription();
    if (cancel && sub.stripeSubscriptionId) await this.providers.get().cancelSubscription(sub.stripeSubscriptionId);
    const [row] = await this.db.update(subscriptions).set({ cancelAtPeriodEnd: cancel }).where(eq(subscriptions.id, sub.id)).returning();
    await this.audit.log({ action: 'billing.plan_changed', entityType: 'Subscription', entityId: sub.id, metadata: { cancelAtPeriodEnd: cancel } });
    return row;
  }

  /** Activates a plan for an organization and issues an invoice record. */
  async applyPlan(
    organizationId: string,
    planId: string,
    interval: 'MONTHLY' | 'YEARLY',
    opts: { paid: boolean; stripeCustomerId?: string; stripeSubscriptionId?: string; stripeInvoiceId?: string; hostedUrl?: string },
  ) {
    const [plan] = await this.db.select().from(plans).where(eq(plans.id, planId));
    const now = new Date();
    const periodEnd = addPeriod(now, interval);
    const [sub] = await this.db
      .update(subscriptions)
      .set({
        planId,
        interval,
        status: 'ACTIVE',
        currentPeriodStart: now,
        currentPeriodEnd: periodEnd,
        trialEndsAt: null,
        cancelAtPeriodEnd: false,
        ...(opts.stripeCustomerId ? { stripeCustomerId: opts.stripeCustomerId } : {}),
        ...(opts.stripeSubscriptionId ? { stripeSubscriptionId: opts.stripeSubscriptionId } : {}),
      })
      .where(eq(subscriptions.organizationId, organizationId))
      .returning();
    const [{ n }] = await this.db.select({ n: sql<number>`count(*)::int` }).from(invoices);
    await this.db.insert(invoices).values({
      organizationId,
      subscriptionId: sub.id,
      number: `AAI-${now.getFullYear()}-${String(n + 1).padStart(6, '0')}`,
      amountCents: interval === 'YEARLY' ? plan.priceYearlyCents : plan.priceMonthlyCents,
      currency: plan.currency,
      status: opts.paid ? 'PAID' : 'OPEN',
      periodStart: now,
      periodEnd,
      paidAt: opts.paid ? now : null,
      stripeInvoiceId: opts.stripeInvoiceId,
      hostedUrl: opts.hostedUrl,
    });
    await TenantContext.run({ organizationId }, () =>
      this.audit.log({ action: 'billing.plan_changed', entityType: 'Subscription', entityId: sub.id, metadata: { plan: plan.key, interval }, organizationId }),
    );
    return sub;
  }

  /** Processes a verified billing webhook idempotently. */
  async handleWebhook(rawBody: Buffer, signature: string | undefined): Promise<{ received: true }> {
    const provider = this.providers.get();
    let event: BillingEvent;
    try {
      event = provider.verifyWebhook(rawBody, signature);
    } catch (err) {
      await this.db
        .insert(webhookEvents)
        .values({ provider: 'stripe', eventType: 'unknown', payload: {}, signatureValid: false, status: 'REJECTED', error: (err as Error).message });
      throw err;
    }
    const inserted = await this.db
      .insert(webhookEvents)
      .values({ provider: 'stripe', eventType: event.type, externalId: event.id, payload: event.data, signatureValid: true })
      .onConflictDoNothing()
      .returning();
    if (!inserted.length) return { received: true }; // duplicate delivery
    try {
      await this.dispatch(event);
      await this.db.update(webhookEvents).set({ status: 'PROCESSED', processedAt: new Date() }).where(eq(webhookEvents.id, inserted[0].id));
    } catch (err) {
      this.logger.error(`Billing webhook ${event.type} failed: ${(err as Error).message}`);
      await this.db.update(webhookEvents).set({ status: 'FAILED', error: (err as Error).message }).where(eq(webhookEvents.id, inserted[0].id));
    }
    return { received: true };
  }

  /** Mirrors a paid Stripe invoice locally so the billing page shows real receipts. Idempotent by Stripe invoice id. */
  private async recordPaidInvoice(obj: Record<string, unknown>): Promise<void> {
    const subscriptionId = obj.subscription as string | undefined;
    if (!subscriptionId) return; // one-off invoices are not part of the SaaS subscription
    const [sub] = await this.db.select().from(subscriptions).where(eq(subscriptions.stripeSubscriptionId, subscriptionId));
    if (!sub) throw new ValidationError(`Unknown Stripe subscription ${subscriptionId}`);
    const line = ((obj.lines as { data?: { period?: { start?: number; end?: number } }[] } | undefined)?.data ?? [])[0];
    const seconds = (v: unknown, fallback: number) => new Date((typeof v === 'number' ? v : fallback) * 1000);
    const created = typeof obj.created === 'number' ? obj.created : Math.floor(Date.now() / 1000);
    const values = {
      organizationId: sub.organizationId,
      subscriptionId: sub.id,
      number: String(obj.number ?? obj.id),
      amountCents: Number(obj.amount_paid ?? obj.total ?? 0),
      currency: String(obj.currency ?? 'usd').toUpperCase(),
      status: 'PAID' as const,
      periodStart: seconds(line?.period?.start ?? obj.period_start, created),
      periodEnd: seconds(line?.period?.end ?? obj.period_end, created),
      stripeInvoiceId: String(obj.id),
      hostedUrl: (obj.hosted_invoice_url as string | undefined) ?? null,
      paidAt: new Date(),
    };
    await this.db.insert(invoices).values(values).onConflictDoUpdate({ target: invoices.stripeInvoiceId, set: { status: 'PAID', paidAt: values.paidAt, hostedUrl: values.hostedUrl } });
    await this.db.update(subscriptions).set({ status: 'ACTIVE', currentPeriodStart: values.periodStart, currentPeriodEnd: values.periodEnd }).where(eq(subscriptions.id, sub.id));
  }

  private async dispatch(event: BillingEvent): Promise<void> {
    const obj = event.data as Record<string, unknown> & { metadata?: Record<string, string> };
    switch (event.type) {
      case 'checkout.session.completed': {
        const orgId = obj.metadata?.organizationId ?? (obj.client_reference_id as string | undefined);
        const planKey = obj.metadata?.planKey;
        if (!orgId || !planKey) throw new ValidationError('checkout session without organization metadata');
        const [plan] = await this.db.select().from(plans).where(eq(plans.key, planKey));
        await this.applyPlan(orgId, plan.id, (obj.metadata?.interval as 'MONTHLY' | 'YEARLY') ?? 'MONTHLY', {
          paid: true,
          stripeCustomerId: obj.customer as string,
          stripeSubscriptionId: obj.subscription as string,
        });
        break;
      }
      case 'customer.subscription.deleted': {
        await this.db.update(subscriptions).set({ status: 'CANCELED' }).where(eq(subscriptions.stripeSubscriptionId, obj.id as string));
        break;
      }
      case 'customer.subscription.updated': {
        const status = String(obj.status).toUpperCase();
        const mapped = status === 'PAST_DUE' ? 'PAST_DUE' : status === 'CANCELED' ? 'CANCELED' : status === 'TRIALING' ? 'TRIALING' : 'ACTIVE';
        await this.db
          .update(subscriptions)
          .set({ status: mapped, cancelAtPeriodEnd: Boolean(obj.cancel_at_period_end) })
          .where(eq(subscriptions.stripeSubscriptionId, obj.id as string));
        break;
      }
      case 'invoice.paid': {
        await this.recordPaidInvoice(obj);
        break;
      }
      case 'invoice.payment_failed': {
        await this.db.update(subscriptions).set({ status: 'PAST_DUE' }).where(eq(subscriptions.stripeSubscriptionId, obj.subscription as string));
        break;
      }
      default:
        break;
    }
  }
}
