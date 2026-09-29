import { desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { leads, messages, supportTickets } from '../../../database/schema';
import { TenantContext, tenantScope, withTenant } from '../../../database/tenant';
import { personName } from '../../../common/utils/time';
import { defineTool, ToolFailure } from '../tool';
import type { ToolDeps } from '../tool-deps';

export function patientOpsTools(d: ToolDeps) {
  const getPatient = defineTool({
    name: 'getPatient',
    description: 'Get the identified patient administrative profile (name, contact, preferred language). Returns identified=false when unknown.',
    input: z.object({}),
    output: z.object({
      identified: z.boolean(),
      patient: z.object({ id: z.string(), name: z.string(), phone: z.string().nullable(), email: z.string().nullable(), preferredLanguage: z.string() }).nullable(),
    }),
    permission: 'patients.read',
    async execute(_i, ctx) {
      if (!ctx.patientId) return { identified: false, patient: null };
      const p = await d.patients.get(ctx.patientId, { audit: true });
      // Minimal disclosure: mask contact details back to the conversation.
      const mask = (s: string | null) => (s ? s.replace(/.(?=.{3})/g, '•') : null);
      return { identified: true, patient: { id: p.id, name: personName(p), phone: mask(p.phone), email: mask(p.email), preferredLanguage: p.preferredLanguage } };
    },
  });

  const createPatient = defineTool({
    name: 'createPatient',
    description:
      'Identify the person chatting: finds an existing patient by phone/email in this clinic or registers a new one, and binds it to the conversation. Requires full name and phone.',
    input: z.object({
      firstName: z.string().trim().min(1).max(80),
      lastName: z.string().trim().max(80).default(''),
      phone: z.string().trim().min(7).max(20),
      email: z.string().trim().email().max(254).optional(),
    }),
    output: z.object({ patientId: z.string(), name: z.string(), existing: z.boolean() }),
    permission: 'patients.create',
    sideEffect: true,
    async execute(input, ctx) {
      const existing = await d.patients.findByContact({ phone: input.phone, email: input.email });
      if (existing) {
        await ctx.bindPatient(existing.id);
        return { patientId: existing.id, name: personName(existing), existing: true };
      }
      const p = await d.patients.create(
        { firstName: input.firstName, lastName: input.lastName || '-', phone: input.phone, email: input.email ?? null, preferredLanguage: ctx.language, tags: ['ai-registered'] },
        ctx.channel === 'WHATSAPP' ? 'WHATSAPP' : 'AI',
      );
      await ctx.bindPatient(p.id);
      return { patientId: p.id, name: personName(p), existing: false };
    },
  });

  const updatePatient = defineTool({
    name: 'updatePatient',
    description: "Update the identified patient's contact details or preferred language (administrative data only).",
    input: z.object({
      phone: z.string().trim().min(7).max(20).optional(),
      email: z.string().trim().email().max(254).optional(),
      preferredLanguage: z.enum(['es', 'en']).optional(),
      preferredContactChannel: z.enum(['WHATSAPP', 'EMAIL', 'SMS', 'PHONE']).optional(),
    }),
    output: z.object({ updated: z.array(z.string()) }),
    permission: 'patients.update',
    sideEffect: true,
    requiresPatient: true,
    async execute(input, ctx) {
      const { preferredContactChannel, ...fields } = input;
      if (Object.keys(fields).length) await d.patients.update(ctx.patientId!, fields);
      if (preferredContactChannel) await d.patients.updatePreferences(ctx.patientId!, { preferredContactChannel });
      return { updated: Object.keys(input) };
    },
  });

  const createLead = defineTool({
    name: 'createLead',
    description: 'Capture a prospective patient lead (someone interested in a service who does not want to book yet).',
    input: z.object({ name: z.string().trim().min(2).max(120), phone: z.string().max(20).optional(), email: z.string().email().max(254).optional(), interest: z.string().max(300) }),
    output: z.object({ leadId: z.string() }),
    permission: 'leads.write',
    sideEffect: true,
    async execute(input, ctx) {
      if (!input.phone && !input.email) throw new ToolFailure('CONTACT_REQUIRED', 'A phone or email is required to create a lead');
      const [lead] = await d.db
        .insert(leads)
        .values(withTenant({ clinicId: TenantContext.clinicId(), ...input, source: ctx.channel, conversationId: ctx.conversationId }))
        .returning({ id: leads.id });
      await d.conversations.patch(ctx.conversationId, { leadId: lead.id });
      return { leadId: lead.id };
    },
  });

  const requestHumanHandoff = defineTool({
    name: 'requestHumanHandoff',
    description: 'Escalate the conversation to the clinic staff (human handoff queue) with a factual summary. Use when the user asks for a person, for complaints, sensitive or unresolvable issues.',
    input: z.object({ reason: z.string().min(3).max(300), urgency: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).default('MEDIUM') }),
    output: z.object({ handoffId: z.string(), urgency: z.string(), queued: z.boolean() }),
    permission: 'conversations.handoff',
    sideEffect: true,
    async execute({ reason, urgency }, ctx) {
      const summary = await d.summarizer.summarize(ctx.conversationId, { reason });
      const h = await d.handoff.handoffConversation({ conversationId: ctx.conversationId, reason, urgency, summary });
      return { handoffId: h.id, urgency: h.urgency, queued: true };
    },
    present: (out, _ctx, input) => [{ type: 'handoff', urgency: out.urgency, reason: input.reason }],
  });

  const createSupportTicket = defineTool({
    name: 'createSupportTicket',
    description: 'Open an administrative support ticket (billing question, portal access issue, document request…) for the staff to follow up.',
    input: z.object({ subject: z.string().min(3).max(160), description: z.string().min(3).max(2000), priority: z.enum(['LOW', 'MEDIUM', 'HIGH']).default('MEDIUM') }),
    output: z.object({ ticketId: z.string(), status: z.string() }),
    permission: 'conversations.handoff',
    sideEffect: true,
    async execute(input, ctx) {
      const [t] = await d.db
        .insert(supportTickets)
        .values(withTenant({ clinicId: TenantContext.clinicId(), conversationId: ctx.conversationId, patientId: ctx.patientId, ...input }))
        .returning();
      return { ticketId: t.id, status: t.status };
    },
  });

  const getConversationHistory = defineTool({
    name: 'getConversationHistory',
    description: 'Get the latest messages of the current conversation (for context recovery).',
    input: z.object({ limit: z.number().int().min(1).max(30).default(10) }),
    output: z.object({ messages: z.array(z.object({ role: z.string(), content: z.string(), at: z.string() })) }),
    permission: null,
    async execute({ limit }, ctx) {
      const rows = await d.db
        .select({ role: messages.role, content: messages.content, at: messages.createdAt })
        .from(messages)
        .where(tenantScope(messages, eq(messages.conversationId, ctx.conversationId)))
        .orderBy(desc(messages.createdAt))
        .limit(limit);
      return { messages: rows.reverse().map((m) => ({ role: m.role, content: m.content.slice(0, 500), at: m.at.toISOString() })) };
    },
  });

  const summarizeConversation = defineTool({
    name: 'summarizeConversation',
    description: 'Produce a factual administrative summary of the conversation (intent, patient, actions taken, pending actions).',
    input: z.object({}),
    output: z.object({ summary: z.string(), intent: z.string().nullable(), actionsTaken: z.array(z.string()), pendingActions: z.array(z.string()), recommendation: z.string() }),
    permission: null,
    async execute(_i, ctx) {
      const s = await d.summarizer.summarize(ctx.conversationId);
      return { summary: s.summary, intent: s.intent, actionsTaken: s.actionsTaken, pendingActions: s.pendingActions, recommendation: s.recommendation };
    },
  });

  return [getPatient, createPatient, updatePatient, createLead, requestHumanHandoff, createSupportTicket, getConversationHistory, summarizeConversation];
}
