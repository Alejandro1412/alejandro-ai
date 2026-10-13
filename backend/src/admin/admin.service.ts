import { Inject, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { and, desc, eq, gte, ilike, inArray, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { env } from '../config/env';
import { Database, DB } from '../database/database.module';
import { clinics, conversations, doctors, invoices, memberships, organizations, plans, roles, subscriptions, usageRecords, users } from '../database/schema';
import { TenantContext } from '../database/tenant';
import { BusinessRuleError, NotFoundError } from '../common/errors/app-error';
import { likeTerm } from '../common/utils/pagination';
import { AuditService } from '../audit/audit.service';
import { BillingService } from '../billing/billing.service';
import { BillingLifecycleService } from '../billing/billing-lifecycle.service';
import type { AccessTokenPayload } from '../common/guards/jwt-auth.guard';

export const adminPlanSchema = z.object({ planKey: z.enum(['STARTER', 'PROFESSIONAL', 'CLINIC']), interval: z.enum(['MONTHLY', 'YEARLY']).default('MONTHLY') });
export const extendTrialSchema = z.object({ days: z.number().int().min(1).max(90) });
export const reasonSchema = z.object({ reason: z.string().trim().min(3).max(300) });

const monthStart = () => {
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCHours(0, 0, 0, 0);
  return d;
};

/**
 * Platform operator console (SUPER_ADMIN only): every query here is intentionally cross-tenant and every
 * mutation is audited in BOTH the operator's organization and the affected tenant.
 */
@Injectable()
export class AdminService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly billing: BillingService,
    private readonly lifecycle: BillingLifecycleService,
    private readonly audit: AuditService,
    private readonly jwt: JwtService,
  ) {}

  async overview() {
    const subs = await this.db.select({ status: subscriptions.status, interval: subscriptions.interval, monthly: plans.priceMonthlyCents, yearly: plans.priceYearlyCents, key: plans.key }).from(subscriptions).innerJoin(plans, eq(plans.id, subscriptions.planId));
    const mrrCents = subs.filter((s) => s.status === 'ACTIVE').reduce((sum, s) => sum + (s.interval === 'YEARLY' ? Math.round(s.yearly / 12) : s.monthly), 0);
    const byStatus = Object.fromEntries(['TRIALING', 'ACTIVE', 'PAST_DUE', 'EXPIRED', 'SUSPENDED', 'CANCELED'].map((st) => [st, subs.filter((s) => s.status === st).length]));
    const byPlan = Object.fromEntries(['STARTER', 'PROFESSIONAL', 'CLINIC'].map((k) => [k, subs.filter((s) => s.key === k && s.status === 'ACTIVE').length]));
    const since = monthStart();
    const [usage] = await this.db
      .select({ aiCostMicro: sql<number>`coalesce(sum(${usageRecords.costMicroUsd}) filter (where ${usageRecords.kind} in ('AI_COMPLETION','EMBEDDING')),0)::bigint`, conversations: sql<number>`coalesce(sum(${usageRecords.quantity}) filter (where ${usageRecords.kind} = 'AI_CONVERSATION'),0)::int`, messages: sql<number>`coalesce(sum(${usageRecords.quantity}) filter (where ${usageRecords.kind} in ('WHATSAPP_MESSAGE','SMS_MESSAGE')),0)::int` })
      .from(usageRecords)
      .where(gte(usageRecords.createdAt, since));
    const [{ signups }] = await this.db.select({ signups: sql<number>`count(*)::int` }).from(organizations).where(gte(organizations.createdAt, new Date(Date.now() - 30 * 86_400_000)));
    const [{ open }] = await this.db.select({ open: sql<number>`coalesce(sum(${invoices.amountCents}),0)::int` }).from(invoices).where(eq(invoices.status, 'OPEN'));
    return {
      tenants: subs.length,
      byStatus,
      byPlan,
      mrrCents,
      arrCents: mrrCents * 12,
      signupsLast30Days: signups,
      thisMonth: { aiCostUsd: Number(usage.aiCostMicro) / 1e6, aiConversations: usage.conversations, outboundMessages: usage.messages },
      openInvoicesCents: open,
    };
  }

  async tenants(search?: string) {
    const since = monthStart();
    const rows = await this.db
      .select({
        org: organizations,
        sub: subscriptions,
        plan: plans,
        clinic: { id: clinics.id, name: clinics.name, slug: clinics.slug, city: clinics.city, onboardedAt: clinics.onboardedAt },
        users: sql<number>`(select count(*)::int from ${memberships} m join ${roles} r on r.id = m.role_id where m.organization_id = ${organizations.id} and r.key not in ('PATIENT','AI_AGENT'))`,
        doctors: sql<number>`(select count(*)::int from ${doctors} d where d.organization_id = ${organizations.id})`,
        conversationsThisMonth: sql<number>`(select count(*)::int from ${conversations} c where c.organization_id = ${organizations.id} and c.created_at >= ${since.toISOString()} and c.channel <> 'PLAYGROUND')`,
        aiCostMicro: sql<number>`(select coalesce(sum(u.cost_micro_usd),0)::bigint from ${usageRecords} u where u.organization_id = ${organizations.id} and u.created_at >= ${since.toISOString()})`,
        lastActivity: sql<string | null>`(select max(c.last_message_at) from ${conversations} c where c.organization_id = ${organizations.id})`,
      })
      .from(organizations)
      .leftJoin(subscriptions, eq(subscriptions.organizationId, organizations.id))
      .leftJoin(plans, eq(plans.id, subscriptions.planId))
      .leftJoin(clinics, eq(clinics.organizationId, organizations.id))
      .where(search ? or(ilike(organizations.name, likeTerm(search)), ilike(clinics.name, likeTerm(search)), ilike(clinics.slug, likeTerm(search))) : undefined)
      .orderBy(desc(organizations.createdAt))
      .limit(200);
    return rows.map((r) => ({
      id: r.org.id,
      name: r.org.name,
      createdAt: r.org.createdAt,
      clinic: r.clinic,
      plan: r.plan ? { key: r.plan.key, name: r.plan.name } : null,
      subscription: r.sub ? { status: r.sub.status, interval: r.sub.interval, trialEndsAt: r.sub.trialEndsAt, currentPeriodEnd: r.sub.currentPeriodEnd, graceEndsAt: r.sub.graceEndsAt, suspendedReason: r.sub.suspendedReason } : null,
      users: r.users,
      doctors: r.doctors,
      conversationsThisMonth: r.conversationsThisMonth,
      aiCostUsd: Number(r.aiCostMicro) / 1e6,
      lastActivity: r.lastActivity,
    }));
  }

  async tenant(orgId: string) {
    const [t] = (await this.tenants()).filter((x) => x.id === orgId);
    if (!t) throw new NotFoundError('Organization', orgId);
    const inv = await this.db.select().from(invoices).where(eq(invoices.organizationId, orgId)).orderBy(desc(invoices.issuedAt)).limit(12);
    const usage = await this.db
      .select({ kind: usageRecords.kind, quantity: sql<number>`coalesce(sum(${usageRecords.quantity}),0)::int`, costMicro: sql<number>`coalesce(sum(${usageRecords.costMicroUsd}),0)::bigint` })
      .from(usageRecords)
      .where(and(eq(usageRecords.organizationId, orgId), gte(usageRecords.createdAt, monthStart())))
      .groupBy(usageRecords.kind);
    const admins = await this.db
      .select({ id: users.id, name: users.name, email: users.email, lastLoginAt: users.lastLoginAt, role: roles.key })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .innerJoin(roles, eq(roles.id, memberships.roleId))
      .where(and(eq(memberships.organizationId, orgId), inArray(roles.key, ['CLINIC_ADMIN', 'RECEPTIONIST', 'DOCTOR'])));
    return { ...t, invoices: inv, usage: usage.map((u) => ({ ...u, costUsd: Number(u.costMicro) / 1e6 })), team: admins, aiBudget: await this.lifecycle.aiBudget(orgId) };
  }

  private async auditBoth(orgId: string, action: Parameters<AuditService['log']>[0]['action'], metadata: Record<string, unknown>) {
    const operator = TenantContext.principal();
    await this.audit.log({ action, entityType: 'Organization', entityId: orgId, metadata });
    await TenantContext.run({ organizationId: orgId }, () =>
      this.audit.log({ action, entityType: 'Organization', entityId: orgId, organizationId: orgId, actor: { type: 'USER', id: operator.id, name: `${operator.name} (Alejandro AI soporte)` }, metadata }),
    );
  }

  async changePlan(orgId: string, dto: z.infer<typeof adminPlanSchema>) {
    const [plan] = await this.db.select().from(plans).where(eq(plans.key, dto.planKey));
    await this.tenant(orgId);
    await this.billing.applyPlan(orgId, plan.id, dto.interval, { paid: false });
    await this.auditBoth(orgId, 'platform.plan_changed', { plan: dto.planKey, interval: dto.interval });
    return this.tenant(orgId);
  }

  async extendTrial(orgId: string, days: number) {
    const [sub] = await this.db.select().from(subscriptions).where(eq(subscriptions.organizationId, orgId));
    if (!sub) throw new NotFoundError('Subscription');
    if (sub.status === 'ACTIVE') throw new BusinessRuleError('ALREADY_ACTIVE', 'The tenant already has an active paid plan');
    const base = sub.trialEndsAt && sub.trialEndsAt > new Date() ? sub.trialEndsAt : new Date();
    const trialEndsAt = new Date(base.getTime() + days * 86_400_000);
    await this.db
      .update(subscriptions)
      .set({ status: 'TRIALING', trialEndsAt, currentPeriodEnd: trialEndsAt, graceEndsAt: null, dunningStage: 0, suspendedReason: null })
      .where(eq(subscriptions.id, sub.id));
    await this.lifecycle.invalidate(orgId);
    await this.auditBoth(orgId, 'platform.trial_extended', { days, trialEndsAt: trialEndsAt.toISOString() });
    return this.tenant(orgId);
  }

  async suspend(orgId: string, reason: string) {
    await this.db.update(subscriptions).set({ status: 'SUSPENDED', suspendedReason: reason }).where(eq(subscriptions.organizationId, orgId));
    await this.lifecycle.invalidate(orgId);
    await this.auditBoth(orgId, 'platform.suspended', { reason });
    return this.tenant(orgId);
  }

  async reactivate(orgId: string) {
    const now = new Date();
    await this.db
      .update(subscriptions)
      .set({ status: 'ACTIVE', suspendedReason: null, graceEndsAt: null, dunningStage: 0, currentPeriodStart: now, currentPeriodEnd: new Date(now.getTime() + 30 * 86_400_000) })
      .where(eq(subscriptions.organizationId, orgId));
    await this.lifecycle.invalidate(orgId);
    await this.auditBoth(orgId, 'platform.reactivated', {});
    return this.tenant(orgId);
  }

  /** 30-minute access token as the tenant's clinic admin (no refresh token). Reason is mandatory and audited on both sides. */
  async impersonate(orgId: string, reason: string) {
    const admin = TenantContext.principal();
    const [target] = await this.db
      .select({ userId: users.id, name: users.name, clinicId: clinics.id })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .innerJoin(roles, eq(roles.id, memberships.roleId))
      .innerJoin(clinics, eq(clinics.organizationId, memberships.organizationId))
      .where(and(eq(memberships.organizationId, orgId), eq(roles.key, 'CLINIC_ADMIN'), eq(memberships.status, 'ACTIVE')))
      .limit(1);
    if (!target) throw new NotFoundError('Clinic admin');
    const payload: AccessTokenPayload = { sub: target.userId, name: target.name, org: orgId, clinic: target.clinicId, role: 'CLINIC_ADMIN', imp: admin.id!, impName: admin.name };
    const accessToken = await this.jwt.signAsync(payload, { secret: env().JWT_SECRET, expiresIn: '30m' });
    await this.auditBoth(orgId, 'platform.impersonated', { reason, asUserId: target.userId });
    return { accessToken, expiresIn: 1800, asUser: target.name };
  }
}
