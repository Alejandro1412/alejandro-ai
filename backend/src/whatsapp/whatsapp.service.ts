import { Inject, Injectable, Logger } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { env } from '../config/env';
import { Database, DB } from '../database/database.module';
import { clinics, webhookEvents } from '../database/schema';
import { TenantContext } from '../database/tenant';
import { ROLE_DEFINITIONS } from '../rbac/permissions';
import { AuditService } from '../audit/audit.service';
import { BillingService } from '../billing/billing.service';
import { UsageService } from '../usage/usage.service';
import { ChannelProviders, InboundWhatsAppMessage } from '../notifications/providers/channel-providers';
import { ConversationsService } from '../conversations/conversations.service';
import { PatientsService } from '../patients/patients.service';
import { ChatService } from '../ai/chat.service';
import type { Attachment } from '../ai/attachments';
import { UnauthorizedError } from '../common/errors/app-error';

type Option = { label: string; action: Record<string, unknown> };

/**
 * WhatsApp channel adapter. Inbound messages run through the exact same orchestrator as webchat;
 * rich cards are rendered as numbered options, and a numeric reply is mapped back to the card action.
 */
@Injectable()
export class WhatsAppService {
  private readonly logger = new Logger(WhatsAppService.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly channels: ChannelProviders,
    private readonly conversations: ConversationsService,
    private readonly patients: PatientsService,
    private readonly chat: ChatService,
    private readonly audit: AuditService,
    private readonly usage: UsageService,
    private readonly billing: BillingService,
  ) {}

  status() {
    const e = env();
    return {
      provider: this.channels.whatsapp.name,
      connected: this.channels.whatsapp.name === 'meta',
      phoneNumberId: e.WHATSAPP_PHONE_NUMBER_ID ? `…${e.WHATSAPP_PHONE_NUMBER_ID.slice(-4)}` : null,
      signatureValidation: Boolean(e.WHATSAPP_APP_SECRET),
      webhookUrl: `${e.API_URL}/api/webhooks/whatsapp`,
    };
  }

  verifyChallenge(mode?: string, token?: string, challenge?: string): string {
    const expected = env().WHATSAPP_VERIFY_TOKEN;
    if (mode === 'subscribe' && expected && token === expected && challenge) return challenge;
    throw new UnauthorizedError('WEBHOOK_VERIFY_FAILED', 'Invalid verify token');
  }

  /** Public webhook entry: signature check → idempotent event log → tenant resolution → processing. */
  async handleWebhook(rawBody: Buffer, signature: string | undefined, payload: unknown): Promise<{ received: true; processed: number }> {
    const provider = this.channels.whatsapp;
    const signed = provider.name === 'mock' ? true : provider.validateWebhook(rawBody, signature);
    if (!signed) {
      await this.db.insert(webhookEvents).values({ provider: 'whatsapp', eventType: 'rejected', payload: {}, signatureValid: false, status: 'REJECTED', error: 'invalid signature' });
      await this.audit.log({ action: 'whatsapp.webhook_rejected', result: 'DENIED', actor: { type: 'WEBHOOK', name: 'WhatsApp' }, organizationId: null });
      throw new UnauthorizedError('INVALID_SIGNATURE', 'Invalid webhook signature');
    }
    const inbound = provider.receiveMessage(payload);
    let processed = 0;
    for (const msg of inbound) {
      const inserted = await this.db
        .insert(webhookEvents)
        .values({ provider: 'whatsapp', eventType: 'message', externalId: msg.messageId, payload: { from: msg.from, text: msg.text.slice(0, 500) }, signatureValid: true })
        .onConflictDoNothing()
        .returning({ id: webhookEvents.id });
      if (!inserted.length) continue; // duplicate delivery (Meta retries)
      const clinic = await this.resolveClinic();
      if (!clinic) {
        await this.db.update(webhookEvents).set({ status: 'FAILED', error: 'No clinic mapped to this WhatsApp number' }).where(eq(webhookEvents.id, inserted[0].id));
        continue;
      }
      await TenantContext.run(
        {
          organizationId: clinic.organizationId,
          clinicId: clinic.id,
          principal: { kind: 'WEBHOOK', id: null, name: 'WhatsApp', role: 'SYSTEM', permissions: new Set(ROLE_DEFINITIONS.RECEPTIONIST.permissions) },
        },
        async () => {
          try {
            await this.processInbound(msg);
            await this.db.update(webhookEvents).set({ status: 'PROCESSED', processedAt: new Date(), organizationId: clinic.organizationId }).where(eq(webhookEvents.id, inserted[0].id));
            await this.audit.log({ action: 'whatsapp.webhook_received', actor: { type: 'WEBHOOK', name: 'WhatsApp' }, metadata: { messageId: msg.messageId } });
            processed++;
          } catch (err) {
            this.logger.error(`WhatsApp message ${msg.messageId} failed: ${(err as Error).message}`);
            await this.db.update(webhookEvents).set({ status: 'FAILED', error: (err as Error).message.slice(0, 500) }).where(eq(webhookEvents.id, inserted[0].id));
          }
        },
      );
    }
    return { received: true, processed };
  }

  /** Runs an inbound WhatsApp text through the agent and replies. Must run inside a tenant context. */
  async processInbound(msg: Pick<InboundWhatsAppMessage, 'from' | 'text' | 'name'>) {
    const contact = msg.from.startsWith('+') ? msg.from : `+${msg.from}`;
    let conv = await this.conversations.findActiveByContact('WHATSAPP', contact);
    if (!conv) {
      const patient = await this.patients.findByContact({ phone: contact });
      const started = await this.chat.start({ channel: 'WHATSAPP', patientId: patient?.id ?? null, externalContact: contact, language: patient?.preferredLanguage === 'en' ? 'en' : 'es' });
      conv = await this.conversations.getRaw(started.conversation.id);
    }
    const meta = conv.metadata as { waOptions?: Option[] };
    const pick = msg.text.trim().match(/^(\d{1,2})$/);
    const option = pick && meta.waOptions ? meta.waOptions[Number(pick[1]) - 1] : undefined;
    const result = await this.chat.send(conv.id, option ? option.label : msg.text, option?.action ?? null);
    if (!result.assistantMessage) return { reply: null };
    const { text, options } = renderForWhatsApp(result.assistantMessage.content, result.assistantMessage.attachments, conv.language === 'en' ? 'en' : 'es');
    const fresh = await this.conversations.getRaw(conv.id);
    await this.conversations.patch(conv.id, { metadata: { ...(fresh.metadata as Record<string, unknown>), waOptions: options } });
    await this.channels.whatsapp.sendMessage(contact, text);
    await this.usage.record({ kind: 'WHATSAPP_MESSAGE', provider: this.channels.whatsapp.name, conversationId: conv.id });
    return { reply: text, conversationId: conv.id, trace: result.trace };
  }

  private async resolveClinic() {
    const slug = env().WHATSAPP_DEFAULT_CLINIC_SLUG;
    const [row] = slug ? await this.db.select().from(clinics).where(eq(clinics.slug, slug)) : await this.db.select().from(clinics).limit(1);
    return row ?? null;
  }

  canUse() {
    return this.billing.hasFeature('whatsapp');
  }
}

/** Converts cards to a WhatsApp-friendly numbered menu and remembers the action behind each number. */
export function renderForWhatsApp(content: string, attachments: Attachment[], lang: 'es' | 'en'): { text: string; options: Option[] } {
  const options: Option[] = [];
  const lines: string[] = [content];
  for (const a of attachments) {
    if (a.type === 'slots') {
      for (const g of a.groups)
        for (const s of g.slots.slice(0, 6)) {
          const label = `${s.day} ${s.time} — ${g.doctorName}`;
          options.push({
            label,
            action:
              a.mode === 'reschedule'
                ? { type: 'reschedule_to', appointmentId: a.appointmentId ?? null, startTime: s.start, doctorId: g.doctorId }
                : { type: 'book_slot', doctorId: g.doctorId, startTime: s.start, serviceId: a.serviceId ?? null },
          });
        }
    } else if (a.type === 'appointments' && a.purpose !== 'list') {
      for (const i of a.items)
        options.push({
          label: `${i.when} — ${i.doctorName}`,
          action: a.purpose === 'cancel' ? { type: 'confirm_cancel', appointmentId: i.id } : { type: 'start_reschedule', appointmentId: i.id, doctorId: i.doctorId },
        });
    }
  }
  if (options.length) {
    lines.push('');
    options.slice(0, 10).forEach((o, i) => lines.push(`${i + 1}) ${o.label}`));
    lines.push('', lang === 'en' ? 'Reply with the number of your choice.' : 'Responde con el número de tu opción.');
  }
  return { text: lines.join('\n'), options: options.slice(0, 10) };
}
