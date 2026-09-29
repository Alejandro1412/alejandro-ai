import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { Database, DB } from '../database/database.module';
import { conversations, handoffs, HandoffSummary, patients, users } from '../database/schema';
import { TenantContext, tenantScope, withTenant } from '../database/tenant';
import { NotFoundError } from '../common/errors/app-error';
import { AuditService } from '../audit/audit.service';
import { EventsService } from '../realtime/events.service';
import { NotificationsService } from '../notifications/notifications.service';
import { CacheService } from '../jobs/cache.service';

export type Urgency = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

/** Human handoff queue: the AI escalates, reception picks up, resolves, and can hand back to the AI. */
@Injectable()
export class HandoffService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly audit: AuditService,
    private readonly events: EventsService,
    private readonly notifications: NotificationsService,
    private readonly cache: CacheService,
  ) {}

  /** Creates (or escalates) the open handoff for a conversation and pauses the AI on it. */
  async handoffConversation(input: { conversationId: string; reason: string; urgency: Urgency; summary: HandoffSummary }) {
    const [existing] = await this.db
      .select()
      .from(handoffs)
      .where(tenantScope(handoffs, eq(handoffs.conversationId, input.conversationId), inArray(handoffs.status, ['OPEN', 'ASSIGNED'])));
    const order: Urgency[] = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
    let handoff;
    if (existing) {
      const urgency = order.indexOf(input.urgency) > order.indexOf(existing.urgency) ? input.urgency : existing.urgency;
      [handoff] = await this.db.update(handoffs).set({ urgency, summary: input.summary, reason: input.reason }).where(eq(handoffs.id, existing.id)).returning();
    } else {
      [handoff] = await this.db
        .insert(handoffs)
        .values(withTenant({ clinicId: TenantContext.clinicId(), conversationId: input.conversationId, reason: input.reason, urgency: input.urgency, summary: input.summary }))
        .returning();
    }
    await this.db
      .update(conversations)
      .set({ status: 'HANDOFF', aiEnabled: false, summary: input.summary })
      .where(tenantScope(conversations, eq(conversations.id, input.conversationId)));
    await this.audit.log({
      action: 'handoff.created',
      entityType: 'Handoff',
      entityId: handoff.id,
      patientId: input.summary.patient?.id ?? null,
      metadata: { reason: input.reason, urgency: input.urgency, conversationId: input.conversationId },
    });
    await this.notifications.notifyStaff(
      'HUMAN_HANDOFF',
      { patientName: input.summary.patient?.name, reason: input.reason, urgency: input.urgency },
      { conversationId: input.conversationId, handoffId: handoff.id, urgency: input.urgency },
    );
    this.events.emit('handoff.created', { id: handoff.id, conversationId: input.conversationId, urgency: handoff.urgency });
    this.events.emit('conversation.updated', { id: input.conversationId, status: 'HANDOFF' });
    await this.cache.del(`analytics:${TenantContext.orgId()}:*`);
    return handoff;
  }

  async queue(status: ('OPEN' | 'ASSIGNED' | 'RESOLVED')[] = ['OPEN', 'ASSIGNED']) {
    const urgencyRank = sql`case ${handoffs.urgency} when 'CRITICAL' then 0 when 'HIGH' then 1 when 'MEDIUM' then 2 else 3 end`;
    return this.db
      .select({
        handoff: handoffs,
        conversation: { id: conversations.id, channel: conversations.channel, language: conversations.language, lastMessageAt: conversations.lastMessageAt, externalContact: conversations.externalContact },
        patient: { id: patients.id, firstName: patients.firstName, lastName: patients.lastName, phone: patients.phone },
        assignee: { id: users.id, name: users.name },
      })
      .from(handoffs)
      .innerJoin(conversations, eq(conversations.id, handoffs.conversationId))
      .leftJoin(patients, eq(patients.id, conversations.patientId))
      .leftJoin(users, eq(users.id, handoffs.assignedToId))
      .where(tenantScope(handoffs, eq(handoffs.clinicId, TenantContext.clinicId()), inArray(handoffs.status, status)))
      .orderBy(urgencyRank, status.includes('RESOLVED') ? desc(handoffs.updatedAt) : asc(handoffs.createdAt))
      .limit(100)
      .then((rows) => rows.map((r) => ({ ...r.handoff, conversation: r.conversation, patient: r.patient?.id ? r.patient : null, assignee: r.assignee?.id ? r.assignee : null })));
  }

  async assign(id: string, userId: string) {
    const [row] = await this.db
      .update(handoffs)
      .set({ status: 'ASSIGNED', assignedToId: userId })
      .where(tenantScope(handoffs, eq(handoffs.id, id)))
      .returning();
    if (!row) throw new NotFoundError('Handoff', id);
    await this.db.update(conversations).set({ assignedToId: userId }).where(eq(conversations.id, row.conversationId));
    await this.audit.log({ action: 'handoff.assigned', entityType: 'Handoff', entityId: id, metadata: { userId } });
    this.events.emit('handoff.updated', { id, status: 'ASSIGNED' });
    return row;
  }

  async resolve(id: string, returnToAi: boolean) {
    const [row] = await this.db
      .update(handoffs)
      .set({ status: 'RESOLVED', resolvedAt: new Date() })
      .where(tenantScope(handoffs, and(eq(handoffs.id, id))))
      .returning();
    if (!row) throw new NotFoundError('Handoff', id);
    await this.db
      .update(conversations)
      .set(returnToAi ? { status: 'ACTIVE', aiEnabled: true } : { status: 'RESOLVED' })
      .where(eq(conversations.id, row.conversationId));
    await this.audit.log({ action: 'handoff.resolved', entityType: 'Handoff', entityId: id, metadata: { returnToAi } });
    this.events.emit('handoff.updated', { id, status: 'RESOLVED' });
    this.events.emit('conversation.updated', { id: row.conversationId });
    return row;
  }
}
