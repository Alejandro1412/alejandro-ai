import { Inject, Injectable } from '@nestjs/common';
import { asc, count, desc, eq, ilike, inArray, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { Database, DB } from '../database/database.module';
import { conversations, handoffs, messages, patients, toolExecutions } from '../database/schema';
import { TenantContext, tenantScope, withTenant } from '../database/tenant';
import { BusinessRuleError, NotFoundError } from '../common/errors/app-error';
import { likeTerm, offsetOf, Paginated, paginationSchema } from '../common/utils/pagination';
import { AuditService } from '../audit/audit.service';
import { EventsService } from '../realtime/events.service';
import { ChannelProviders } from '../notifications/providers/channel-providers';

export const listConversationsSchema = paginationSchema.extend({
  status: z.enum(['ACTIVE', 'HANDOFF', 'RESOLVED', 'CLOSED']).optional(),
  channel: z.enum(['WEB', 'PORTAL', 'PLAYGROUND', 'WHATSAPP']).optional(),
  patientId: z.string().uuid().optional(),
});

export type Channel = 'WEB' | 'PORTAL' | 'PLAYGROUND' | 'WHATSAPP';
export type NewMessage = Omit<typeof messages.$inferInsert, 'organizationId' | 'conversationId' | 'id' | 'createdAt'>;

@Injectable()
export class ConversationsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly audit: AuditService,
    private readonly events: EventsService,
    private readonly channels: ChannelProviders,
  ) {}

  async list(q: z.infer<typeof listConversationsSchema>) {
    const where = tenantScope(
      conversations,
      eq(conversations.clinicId, TenantContext.clinicId()),
      q.status ? eq(conversations.status, q.status) : undefined,
      q.channel ? eq(conversations.channel, q.channel) : undefined,
      q.patientId ? eq(conversations.patientId, q.patientId) : undefined,
      q.search
        ? or(
            ilike(conversations.subject, likeTerm(q.search)),
            ilike(conversations.externalContact, likeTerm(q.search)),
            ilike(sql`${patients.firstName} || ' ' || ${patients.lastName}`, likeTerm(q.search)),
          )
        : undefined,
    );
    const lastMessage = sql<string | null>`(select m.content from ${messages} m where m.conversation_id = ${conversations.id} order by m.created_at desc limit 1)`;
    const messageCount = sql<number>`(select count(*)::int from ${messages} m where m.conversation_id = ${conversations.id})`;
    const [items, [{ total }]] = await Promise.all([
      this.db
        .select({
          conversation: conversations,
          patient: { id: patients.id, firstName: patients.firstName, lastName: patients.lastName, phone: patients.phone },
          lastMessage,
          messageCount,
        })
        .from(conversations)
        .leftJoin(patients, eq(patients.id, conversations.patientId))
        .where(where)
        .orderBy(desc(conversations.lastMessageAt))
        .limit(q.pageSize)
        .offset(offsetOf(q)),
      this.db.select({ total: count() }).from(conversations).leftJoin(patients, eq(patients.id, conversations.patientId)).where(where),
    ]);
    return Paginated.of(
      items.map((r) => ({ ...r.conversation, sessionTokenHash: undefined, patient: r.patient?.id ? r.patient : null, lastMessage: r.lastMessage, messageCount: r.messageCount })),
      total,
      q,
    );
  }

  async get(id: string, opts: { includeTrace?: boolean } = {}) {
    const conv = await this.db.query.conversations.findFirst({
      where: tenantScope(conversations, eq(conversations.id, id)),
      with: { patient: true, handoffs: { orderBy: [desc(handoffs.createdAt)] } },
    });
    if (!conv) throw new NotFoundError('Conversation', id);
    const msgs = await this.messages(id, 200);
    const tools = await this.db
      .select()
      .from(toolExecutions)
      .where(tenantScope(toolExecutions, eq(toolExecutions.conversationId, id)))
      .orderBy(asc(toolExecutions.createdAt));
    return {
      ...conv,
      sessionTokenHash: undefined,
      messages: opts.includeTrace ? msgs : msgs.map((m) => ({ ...m, trace: null })),
      toolExecutions: opts.includeTrace ? tools : tools.map((t) => ({ ...t, input: undefined, output: undefined })),
    };
  }

  async getRaw(id: string) {
    const [conv] = await this.db.select().from(conversations).where(tenantScope(conversations, eq(conversations.id, id)));
    if (!conv) throw new NotFoundError('Conversation', id);
    return conv;
  }

  messages(conversationId: string, limit = 50) {
    return this.db
      .select()
      .from(messages)
      .where(tenantScope(messages, eq(messages.conversationId, conversationId)))
      .orderBy(desc(messages.createdAt))
      .limit(limit)
      .then((rows) => rows.reverse());
  }

  async create(input: { channel: Channel; patientId?: string | null; language?: string; externalContact?: string | null; sessionTokenHash?: string | null; metadata?: Record<string, unknown> }) {
    const [row] = await this.db
      .insert(conversations)
      .values(
        withTenant({
          clinicId: TenantContext.clinicId(),
          channel: input.channel,
          patientId: input.patientId ?? null,
          language: input.language ?? 'es',
          externalContact: input.externalContact ?? null,
          sessionTokenHash: input.sessionTokenHash ?? null,
          metadata: input.metadata ?? {},
        }),
      )
      .returning();
    this.events.emit('conversation.updated', { id: row.id, change: 'created' });
    return row;
  }

  async findActiveByContact(channel: Channel, contact: string) {
    const [row] = await this.db
      .select()
      .from(conversations)
      .where(tenantScope(conversations, eq(conversations.channel, channel), eq(conversations.externalContact, contact), inArray(conversations.status, ['ACTIVE', 'HANDOFF'])))
      .orderBy(desc(conversations.lastMessageAt))
      .limit(1);
    return row ?? null;
  }

  async findBySessionHash(hash: string) {
    const [row] = await this.db.select().from(conversations).where(tenantScope(conversations, eq(conversations.sessionTokenHash, hash)));
    return row ?? null;
  }

  async addMessage(conversationId: string, msg: NewMessage) {
    const [row] = await this.db.insert(messages).values(withTenant({ ...msg, conversationId })).returning();
    await this.db.update(conversations).set({ lastMessageAt: new Date() }).where(tenantScope(conversations, eq(conversations.id, conversationId)));
    this.events.emit('message.created', { conversationId, messageId: row.id, role: row.role });
    return row;
  }

  async patch(conversationId: string, patch: Partial<typeof conversations.$inferInsert>) {
    const [row] = await this.db.update(conversations).set(patch).where(tenantScope(conversations, eq(conversations.id, conversationId))).returning();
    if (!row) throw new NotFoundError('Conversation', conversationId);
    this.events.emit('conversation.updated', { id: conversationId, status: row.status });
    return row;
  }

  /** Staff reply: stored as STAFF, delivered over the conversation's channel. Takes the conversation over from the AI. */
  async staffReply(conversationId: string, content: string) {
    const conv = await this.getRaw(conversationId);
    if (conv.status === 'CLOSED') throw new BusinessRuleError('CONVERSATION_CLOSED', 'This conversation is closed');
    const principal = TenantContext.principal();
    const msg = await this.addMessage(conversationId, { role: 'STAFF', content, authorUserId: principal.id, language: conv.language });
    if (conv.channel === 'WHATSAPP' && conv.externalContact) await this.channels.whatsapp.sendMessage(conv.externalContact, content);
    if (conv.patientId) this.events.emitToPatient(conv.patientId, 'message.created', { conversationId, messageId: msg.id });
    if (conv.aiEnabled || conv.status === 'ACTIVE') await this.patch(conversationId, { aiEnabled: false, status: 'HANDOFF', assignedToId: conv.assignedToId ?? principal.id });
    await this.audit.log({ action: 'conversation.staff_reply', entityType: 'Conversation', entityId: conversationId, patientId: conv.patientId });
    return msg;
  }

  async setStatus(conversationId: string, status: 'ACTIVE' | 'RESOLVED' | 'CLOSED', opts: { returnToAi?: boolean } = {}) {
    return this.patch(conversationId, { status, ...(opts.returnToAi ? { aiEnabled: true } : {}) });
  }
}
