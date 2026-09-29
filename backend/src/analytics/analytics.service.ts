import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, gte, lt, ne, sql } from 'drizzle-orm';
import { DateTime } from 'luxon';
import { Database, DB } from '../database/database.module';
import { appointments, clinics, conversations, handoffs, messages, toolExecutions } from '../database/schema';
import { TenantContext, tenantScope } from '../database/tenant';
import { CacheService } from '../jobs/cache.service';

const n = (v: unknown) => Number(v ?? 0);
const pct = (a: number, b: number) => (b ? Math.round((a / b) * 1000) / 10 : 0);
const delta = (cur: number, prev: number) => (prev ? Math.round(((cur - prev) / prev) * 1000) / 10 : cur ? 100 : 0);

@Injectable()
export class AnalyticsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly cache: CacheService,
  ) {}

  private key(name: string, days: number) {
    return `analytics:${TenantContext.orgId()}:${TenantContext.clinicId()}:${name}:${days}`;
  }

  private async tz() {
    const [c] = await this.db.select({ tz: clinics.timezone }).from(clinics).where(eq(clinics.id, TenantContext.clinicId()));
    return c?.tz ?? 'UTC';
  }

  async overview(days: number) {
    return this.cache.wrap(this.key('overview', days), 60, async () => {
      const clinicId = TenantContext.clinicId();
      const tz = await this.tz();
      const now = new Date();
      const since = new Date(now.getTime() - days * 86_400_000);
      const prevSince = new Date(since.getTime() - days * 86_400_000);
      const dayStart = DateTime.now().setZone(tz).startOf('day').toJSDate();
      const dayEnd = DateTime.now().setZone(tz).endOf('day').toJSDate();
      const in7 = new Date(now.getTime() + 7 * 86_400_000);

      const convWhere = (from: Date, to: Date) => tenantScope(conversations, eq(conversations.clinicId, clinicId), ne(conversations.channel, 'PLAYGROUND'), gte(conversations.createdAt, from), lt(conversations.createdAt, to));
      const [[today], [upcoming], [conv], [convPrev], [aiBooked], [aiBookedPrev], [ho], [hoPrev], [openHo]] = await Promise.all([
        this.db
          .select({ n: sql<number>`count(*)::int`, completed: sql<number>`count(*) filter (where ${appointments.status} = 'COMPLETED')::int` })
          .from(appointments)
          .where(tenantScope(appointments, eq(appointments.clinicId, clinicId), gte(appointments.startTime, dayStart), lt(appointments.startTime, dayEnd), sql`${appointments.status} in ('CONFIRMED','PENDING','COMPLETED','NO_SHOW')`)),
        this.db
          .select({ n: sql<number>`count(*)::int` })
          .from(appointments)
          .where(tenantScope(appointments, eq(appointments.clinicId, clinicId), gte(appointments.startTime, now), lt(appointments.startTime, in7), sql`${appointments.status} in ('CONFIRMED','PENDING')`)),
        this.db
          .select({ n: sql<number>`count(*)::int`, resolved: sql<number>`count(*) filter (where ${conversations.resolvedByAi})::int`, booked: sql<number>`count(*) filter (where ${conversations.hasBooking})::int` })
          .from(conversations)
          .where(convWhere(since, now)),
        this.db
          .select({ n: sql<number>`count(*)::int`, resolved: sql<number>`count(*) filter (where ${conversations.resolvedByAi})::int` })
          .from(conversations)
          .where(convWhere(prevSince, since)),
        this.db
          .select({ n: sql<number>`count(*)::int` })
          .from(appointments)
          .where(tenantScope(appointments, eq(appointments.clinicId, clinicId), sql`${appointments.source} in ('AI','WHATSAPP')`, gte(appointments.createdAt, since))),
        this.db
          .select({ n: sql<number>`count(*)::int` })
          .from(appointments)
          .where(tenantScope(appointments, eq(appointments.clinicId, clinicId), sql`${appointments.source} in ('AI','WHATSAPP')`, gte(appointments.createdAt, prevSince), lt(appointments.createdAt, since))),
        this.db.select({ n: sql<number>`count(*)::int` }).from(handoffs).where(tenantScope(handoffs, eq(handoffs.clinicId, clinicId), gte(handoffs.createdAt, since))),
        this.db.select({ n: sql<number>`count(*)::int` }).from(handoffs).where(tenantScope(handoffs, eq(handoffs.clinicId, clinicId), gte(handoffs.createdAt, prevSince), lt(handoffs.createdAt, since))),
        this.db.select({ n: sql<number>`count(*)::int` }).from(handoffs).where(tenantScope(handoffs, eq(handoffs.clinicId, clinicId), sql`${handoffs.status} in ('OPEN','ASSIGNED')`)),
      ]);
      const resolution = pct(n(conv.resolved), n(conv.n));
      const resolutionPrev = pct(n(convPrev.resolved), n(convPrev.n));
      return {
        periodDays: days,
        todayAppointments: { value: n(today.n), completed: n(today.completed) },
        upcomingAppointments: { value: n(upcoming.n) },
        aiConversations: { value: n(conv.n), delta: delta(n(conv.n), n(convPrev.n)) },
        appointmentsBookedByAi: { value: n(aiBooked.n), delta: delta(n(aiBooked.n), n(aiBookedPrev.n)) },
        humanHandoffs: { value: n(ho.n), open: n(openHo.n), delta: delta(n(ho.n), n(hoPrev.n)) },
        aiResolutionRate: { value: resolution, delta: Math.round((resolution - resolutionPrev) * 10) / 10 },
        bookingConversion: { value: pct(n(conv.booked), n(conv.n)) },
      };
    });
  }

  async timeseries(days: number) {
    return this.cache.wrap(this.key('timeseries', days), 60, async () => {
      const clinicId = TenantContext.clinicId();
      const tz = await this.tz();
      const since = DateTime.now().setZone(tz).startOf('day').minus({ days: days - 1 });
      const bucket = (col: unknown) => sql<string>`to_char((${col} at time zone ${tz})::date, 'YYYY-MM-DD')`;
      const [convRows, apptRows, hoRows] = await Promise.all([
        this.db
          .select({ day: bucket(conversations.createdAt), total: sql<number>`count(*)::int`, resolved: sql<number>`count(*) filter (where ${conversations.resolvedByAi})::int` })
          .from(conversations)
          .where(tenantScope(conversations, eq(conversations.clinicId, clinicId), ne(conversations.channel, 'PLAYGROUND'), gte(conversations.createdAt, since.toJSDate())))
          .groupBy(sql`1`),
        this.db
          .select({
            day: bucket(appointments.createdAt),
            ai: sql<number>`count(*) filter (where ${appointments.source} in ('AI','WHATSAPP'))::int`,
            other: sql<number>`count(*) filter (where ${appointments.source} not in ('AI','WHATSAPP'))::int`,
            cancelled: sql<number>`count(*) filter (where ${appointments.status} = 'CANCELLED')::int`,
          })
          .from(appointments)
          .where(tenantScope(appointments, eq(appointments.clinicId, clinicId), gte(appointments.createdAt, since.toJSDate())))
          .groupBy(sql`1`),
        this.db
          .select({ day: bucket(handoffs.createdAt), n: sql<number>`count(*)::int` })
          .from(handoffs)
          .where(tenantScope(handoffs, eq(handoffs.clinicId, clinicId), gte(handoffs.createdAt, since.toJSDate())))
          .groupBy(sql`1`),
      ]);
      const out = [];
      for (let i = 0; i < days; i++) {
        const day = since.plus({ days: i }).toFormat('yyyy-LL-dd');
        const c = convRows.find((r) => r.day === day);
        const a = apptRows.find((r) => r.day === day);
        const h = hoRows.find((r) => r.day === day);
        out.push({
          date: day,
          conversations: n(c?.total),
          resolvedByAi: n(c?.resolved),
          resolutionRate: pct(n(c?.resolved), n(c?.total)),
          appointmentsAi: n(a?.ai),
          appointmentsOther: n(a?.other),
          cancellations: n(a?.cancelled),
          handoffs: n(h?.n),
        });
      }
      return out;
    });
  }

  async insights(days: number) {
    return this.cache.wrap(this.key('insights', days), 60, async () => {
      const clinicId = TenantContext.clinicId();
      const since = new Date(Date.now() - days * 86_400_000);
      const convOfClinic = sql`${messages.conversationId} in (select id from conversations where clinic_id = ${clinicId})`;
      const [intents, unanswered, tools, statuses, channels, specialties] = await Promise.all([
        this.db
          .select({ intent: messages.intent, n: sql<number>`count(*)::int` })
          .from(messages)
          .where(tenantScope(messages, eq(messages.role, 'USER'), gte(messages.createdAt, since), convOfClinic, sql`${messages.intent} not in ('greeting','thanks','goodbye','identify','action','unknown')`))
          .groupBy(messages.intent)
          .orderBy(desc(sql`count(*)`))
          .limit(8),
        this.db
          .select({ id: messages.id, conversationId: messages.conversationId, createdAt: messages.createdAt, question: sql<string>`(select u.content from messages u where u.conversation_id = ${messages.conversationId} and u.role = 'USER' and u.created_at <= ${messages.createdAt} order by u.created_at desc limit 1)` })
          .from(messages)
          .where(tenantScope(messages, eq(messages.unanswered, true), gte(messages.createdAt, since), convOfClinic))
          .orderBy(desc(messages.createdAt))
          .limit(10),
        this.db
          .select({
            tool: toolExecutions.toolName,
            calls: sql<number>`count(*)::int`,
            errors: sql<number>`count(*) filter (where ${toolExecutions.status} <> 'SUCCESS')::int`,
            avgLatencyMs: sql<number>`avg(${toolExecutions.latencyMs})::int`,
          })
          .from(toolExecutions)
          .where(tenantScope(toolExecutions, gte(toolExecutions.createdAt, since)))
          .groupBy(toolExecutions.toolName)
          .orderBy(desc(sql`count(*)`)),
        this.db
          .select({ status: appointments.status, n: sql<number>`count(*)::int` })
          .from(appointments)
          .where(tenantScope(appointments, eq(appointments.clinicId, clinicId), gte(appointments.createdAt, since)))
          .groupBy(appointments.status),
        this.db
          .select({ channel: conversations.channel, n: sql<number>`count(*)::int` })
          .from(conversations)
          .where(tenantScope(conversations, eq(conversations.clinicId, clinicId), gte(conversations.createdAt, since)))
          .groupBy(conversations.channel),
        this.db.execute<{ name: string; n: number }>(
          sql`select s.name, count(a.id)::int as n from appointments a join doctors d on d.id = a.doctor_id join specialties s on s.id = d.specialty_id
              where a.organization_id = ${TenantContext.orgId()} and a.clinic_id = ${clinicId} and a.created_at >= ${since} group by s.name order by n desc limit 8`,
        ),
      ]);
      const toolTotals = tools.reduce((acc, t) => ({ calls: acc.calls + t.calls, errors: acc.errors + t.errors }), { calls: 0, errors: 0 });
      const byStatus = Object.fromEntries(statuses.map((s) => [s.status, s.n]));
      return {
        topQuestions: intents.map((i) => ({ intent: i.intent, count: i.n })),
        unansweredQuestions: unanswered.filter((u) => u.question).map((u) => ({ id: u.id, conversationId: u.conversationId, question: u.question, createdAt: u.createdAt })),
        toolUsage: tools,
        aiErrors: { toolErrors: toolTotals.errors, toolCalls: toolTotals.calls, errorRate: pct(toolTotals.errors, toolTotals.calls) },
        appointments: {
          booked: Object.values(byStatus).reduce((a, b) => a + b, 0),
          cancelled: byStatus.CANCELLED ?? 0,
          rescheduled: byStatus.RESCHEDULED ?? 0,
          completed: byStatus.COMPLETED ?? 0,
          noShow: byStatus.NO_SHOW ?? 0,
        },
        channels: channels.map((c) => ({ channel: c.channel, count: c.n })),
        specialtyDemand: specialties.rows.map((r) => ({ specialty: r.name, count: Number(r.n) })),
      };
    });
  }

  async recentActivity() {
    const clinicId = TenantContext.clinicId();
    return this.db.query.appointments.findMany({
      where: tenantScope(appointments, and(eq(appointments.clinicId, clinicId))),
      with: { doctor: { with: { specialty: true } }, patient: true, service: true },
      orderBy: [desc(appointments.createdAt)],
      limit: 8,
    });
  }
}
