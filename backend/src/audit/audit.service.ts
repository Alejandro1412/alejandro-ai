import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, desc, eq, gte, ilike, lte, or, SQL, sql } from 'drizzle-orm';
import { Database, DB } from '../database/database.module';
import { auditLogs } from '../database/schema';
import { TenantContext, tenantScope } from '../database/tenant';
import { likeTerm, offsetOf, Paginated } from '../common/utils/pagination';

export type AuditAction =
  | 'auth.login'
  | 'auth.login_failed'
  | 'auth.logout'
  | 'auth.register'
  | 'auth.refresh_reuse_detected'
  | 'patient.viewed'
  | 'patient.created'
  | 'patient.updated'
  | 'patient.deleted'
  | 'appointment.created'
  | 'appointment.updated'
  | 'appointment.rescheduled'
  | 'appointment.cancelled'
  | 'doctor.created'
  | 'doctor.updated'
  | 'doctor.deleted'
  | 'ai.tool_executed'
  | 'ai.tool_denied'
  | 'ai.policy_escalation'
  | 'handoff.created'
  | 'handoff.assigned'
  | 'handoff.resolved'
  | 'knowledge.uploaded'
  | 'knowledge.deleted'
  | 'knowledge.updated'
  | 'team.member_invited'
  | 'team.role_changed'
  | 'team.member_removed'
  | 'calendar.connected'
  | 'calendar.disconnected'
  | 'whatsapp.webhook_received'
  | 'whatsapp.webhook_rejected'
  | 'billing.plan_changed'
  | 'billing.webhook_received'
  | 'settings.clinic_updated'
  | 'settings.ai_updated'
  | 'conversation.staff_reply'
  | 'appointment.attendance_confirmed'
  | 'appointment.deposit_paid'
  | 'appointment.deposit_expired'
  | 'appointment.series_created'
  | 'appointment.intake_submitted'
  | 'consent.granted'
  | 'consent.withdrawn'
  | 'patient.exported'
  | 'patient.anonymized'
  | 'patient.imported'
  | 'doctor.imported'
  | 'knowledge.imported_url'
  | 'whatsapp.channel_updated'
  | 'waitlist.added'
  | 'waitlist.offered'
  | 'waitlist.booked'
  | 'review.received'
  | 'campaign.created'
  | 'campaign.sent'
  | 'billing.trial_expired'
  | 'billing.suspended'
  | 'billing.reactivated'
  | 'billing.overage_invoiced'
  | 'billing.ai_budget_reached'
  | 'platform.plan_changed'
  | 'platform.trial_extended'
  | 'platform.suspended'
  | 'platform.reactivated'
  | 'platform.impersonated'
  | 'voice.call_started'
  | 'push.subscribed'
  | 'action_link.used';

export interface AuditEntry {
  action: AuditAction;
  entityType?: string;
  entityId?: string;
  patientId?: string | null;
  result?: 'SUCCESS' | 'FAILURE' | 'DENIED';
  metadata?: Record<string, unknown>;
  /** Override actor (e.g. failed logins before a principal exists). */
  actor?: { type: 'USER' | 'AI_AGENT' | 'SYSTEM' | 'WEBHOOK' | 'PATIENT'; id?: string | null; name?: string };
  organizationId?: string | null;
}

const SENSITIVE_KEYS = /pass(word)?|token|secret|authorization|api[-_]?key|credential/i;

export function redact(value: unknown, depth = 0): unknown {
  if (depth > 5 || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => redact(v, depth + 1));
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, SENSITIVE_KEYS.test(k) ? '[REDACTED]' : redact(v, depth + 1)]),
  );
}

/** Append-only audit trail. Failures to write an audit record are logged but never break the business operation. */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(@Inject(DB) private readonly db: Database) {}

  async log(entry: AuditEntry): Promise<void> {
    const ctx = TenantContext.current();
    const p = ctx?.principal;
    try {
      await this.db.insert(auditLogs).values({
        organizationId: entry.organizationId !== undefined ? entry.organizationId : (ctx?.organizationId ?? null),
        actorType: entry.actor?.type ?? p?.kind ?? 'SYSTEM',
        actorId: entry.actor?.id ?? p?.id ?? null,
        actorName: entry.actor?.name ?? p?.name ?? 'System',
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId,
        patientId: entry.patientId ?? null,
        result: entry.result ?? 'SUCCESS',
        metadata: redact({ ...(entry.metadata ?? {}), ...(ctx?.requestId ? { requestId: ctx.requestId } : {}) }) as Record<string, unknown>,
        ip: ctx?.ip,
        userAgent: ctx?.userAgent,
      });
    } catch (err) {
      this.logger.error(`Failed to write audit log ${entry.action}: ${(err as Error).message}`);
    }
  }

  async list(q: { page: number; pageSize: number; search?: string; action?: string; actorType?: string; from?: Date; to?: Date }) {
    const conds: (SQL | undefined)[] = [
      q.action ? eq(auditLogs.action, q.action) : undefined,
      q.actorType ? eq(auditLogs.actorType, q.actorType as 'USER') : undefined,
      q.from ? gte(auditLogs.createdAt, q.from) : undefined,
      q.to ? lte(auditLogs.createdAt, q.to) : undefined,
      q.search ? or(ilike(auditLogs.action, likeTerm(q.search)), ilike(auditLogs.actorName, likeTerm(q.search))) : undefined,
    ];
    const where = tenantScope(auditLogs, ...conds);
    const [items, [{ count }]] = await Promise.all([
      this.db.select().from(auditLogs).where(where).orderBy(desc(auditLogs.createdAt)).limit(q.pageSize).offset(offsetOf(q)),
      this.db.select({ count: sql<number>`count(*)::int` }).from(auditLogs).where(and(where)),
    ]);
    return Paginated.of(items, count, q);
  }
}
