import { Injectable, Logger } from '@nestjs/common';
import { env } from '../../config/env';
import { fetchJson, isRetryableHttp, retry } from '../../common/utils/resilience';
import { hmacSha256Hex, safeEqual } from '../../common/utils/crypto';

// ───────────── Ports ─────────────
export interface EmailProvider {
  readonly name: string;
  send(msg: { to: string; subject: string; text: string; html?: string }): Promise<{ id: string }>;
}

export interface SmsProvider {
  readonly name: string;
  send(msg: { to: string; body: string }): Promise<{ id: string }>;
}

export interface InboundWhatsAppMessage {
  messageId: string;
  from: string;
  name: string | null;
  text: string;
  timestamp: Date;
  phoneNumberId: string | null;
}

export interface WhatsAppProvider {
  readonly name: 'mock' | 'meta';
  sendMessage(to: string, text: string): Promise<{ id: string }>;
  sendTemplate(to: string, template: string, language: string, params: string[]): Promise<{ id: string }>;
  /** Normalizes the provider webhook payload into inbound text messages. */
  receiveMessage(payload: unknown): InboundWhatsAppMessage[];
  /** Validates the webhook signature. Returns false when the signature is invalid. */
  validateWebhook(rawBody: Buffer, signatureHeader: string | undefined): boolean;
}

export interface OutboxEntry {
  channel: 'EMAIL' | 'SMS' | 'WHATSAPP';
  to: string;
  body: string;
  at: Date;
}

/** Shared in-memory outbox so mock deliveries are observable in dev and assertable in tests. */
export const mockOutbox: OutboxEntry[] = [];
const pushOutbox = (e: Omit<OutboxEntry, 'at'>) => {
  mockOutbox.push({ ...e, at: new Date() });
  if (mockOutbox.length > 500) mockOutbox.shift();
};

// ───────────── Mocks ─────────────
export class MockEmailProvider implements EmailProvider {
  readonly name = 'mock-email';
  private readonly logger = new Logger('MockEmail');
  async send(msg: { to: string; subject: string; text: string }) {
    pushOutbox({ channel: 'EMAIL', to: msg.to, body: `${msg.subject}\n${msg.text}` });
    this.logger.debug(`[email → ${msg.to}] ${msg.subject}`);
    return { id: `mock_email_${Date.now()}` };
  }
}

export class MockSmsProvider implements SmsProvider {
  readonly name = 'mock-sms';
  async send(msg: { to: string; body: string }) {
    pushOutbox({ channel: 'SMS', to: msg.to, body: msg.body });
    return { id: `mock_sms_${Date.now()}` };
  }
}

export class MockWhatsAppProvider implements WhatsAppProvider {
  readonly name = 'mock' as const;
  async sendMessage(to: string, text: string) {
    pushOutbox({ channel: 'WHATSAPP', to, body: text });
    return { id: `mock_wa_${Date.now()}` };
  }
  async sendTemplate(to: string, template: string, _language: string, params: string[]) {
    pushOutbox({ channel: 'WHATSAPP', to, body: `[template:${template}] ${params.join(' | ')}` });
    return { id: `mock_wa_tpl_${Date.now()}` };
  }
  receiveMessage(payload: unknown): InboundWhatsAppMessage[] {
    return new MetaWhatsAppProvider('', '', undefined).receiveMessage(payload);
  }
  validateWebhook(): boolean {
    return true;
  }
}

// ───────────── Real adapters ─────────────
/** Resend (https://resend.com) transactional email. */
export class ResendEmailProvider implements EmailProvider {
  readonly name = 'resend';
  constructor(
    private readonly apiKey: string,
    private readonly from: string,
  ) {}
  async send(msg: { to: string; subject: string; text: string; html?: string }) {
    return retry(
      () =>
        fetchJson<{ id: string }>('https://api.resend.com/emails', {
          method: 'POST',
          service: 'Resend',
          headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ from: this.from, to: [msg.to], subject: msg.subject, text: msg.text, html: msg.html }),
        }),
      { retries: 2, baseDelayMs: 500, shouldRetry: isRetryableHttp },
    );
  }
}

/** Twilio SMS. SMS_API_KEY = "ACCOUNT_SID:AUTH_TOKEN". */
export class TwilioSmsProvider implements SmsProvider {
  readonly name = 'twilio';
  constructor(
    private readonly credentials: string,
    private readonly from: string,
  ) {}
  async send(msg: { to: string; body: string }) {
    const [sid] = this.credentials.split(':');
    const res = await fetchJson<{ sid: string }>(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: 'POST',
      service: 'Twilio',
      headers: { Authorization: `Basic ${Buffer.from(this.credentials).toString('base64')}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ To: msg.to, From: this.from, Body: msg.body }).toString(),
    });
    return { id: res.sid };
  }
}

/** WhatsApp Business Cloud API (Meta). */
export class MetaWhatsAppProvider implements WhatsAppProvider {
  readonly name = 'meta' as const;
  constructor(
    private readonly token: string,
    private readonly phoneNumberId: string,
    private readonly appSecret: string | undefined,
  ) {}

  private async post(body: Record<string, unknown>) {
    const res = await retry(
      () =>
        fetchJson<{ messages: { id: string }[] }>(`https://graph.facebook.com/v21.0/${this.phoneNumberId}/messages`, {
          method: 'POST',
          service: 'WhatsApp',
          headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ messaging_product: 'whatsapp', ...body }),
        }),
      { retries: 2, baseDelayMs: 500, shouldRetry: isRetryableHttp },
    );
    return { id: res.messages?.[0]?.id ?? '' };
  }

  sendMessage(to: string, text: string) {
    return this.post({ to, type: 'text', text: { body: text.slice(0, 4096), preview_url: false } });
  }

  sendTemplate(to: string, template: string, language: string, params: string[]) {
    return this.post({
      to,
      type: 'template',
      template: {
        name: template,
        language: { code: language },
        components: [{ type: 'body', parameters: params.map((p) => ({ type: 'text', text: p })) }],
      },
    });
  }

  receiveMessage(payload: unknown): InboundWhatsAppMessage[] {
    type Change = {
      value?: {
        metadata?: { phone_number_id?: string };
        contacts?: { wa_id: string; profile?: { name?: string } }[];
        messages?: { id: string; from: string; timestamp: string; type: string; text?: { body: string }; interactive?: { button_reply?: { title: string }; list_reply?: { title: string } } }[];
      };
    };
    const entries = (payload as { entry?: { changes?: Change[] }[] })?.entry ?? [];
    const out: InboundWhatsAppMessage[] = [];
    for (const entry of entries) {
      for (const change of entry.changes ?? []) {
        const v = change.value;
        for (const m of v?.messages ?? []) {
          const text = m.text?.body ?? m.interactive?.button_reply?.title ?? m.interactive?.list_reply?.title;
          if (!text) continue;
          out.push({
            messageId: m.id,
            from: m.from,
            name: v?.contacts?.find((c) => c.wa_id === m.from)?.profile?.name ?? null,
            text,
            timestamp: new Date(Number(m.timestamp) * 1000),
            phoneNumberId: v?.metadata?.phone_number_id ?? null,
          });
        }
      }
    }
    return out;
  }

  /** X-Hub-Signature-256: sha256=<hmac(appSecret, rawBody)> */
  validateWebhook(rawBody: Buffer, header: string | undefined): boolean {
    if (!this.appSecret || !header?.startsWith('sha256=')) return false;
    return safeEqual(header.slice(7), hmacSha256Hex(this.appSecret, rawBody));
  }
}

/** Chooses real adapters when credentials exist, mocks otherwise (switchable purely by env). */
@Injectable()
export class ChannelProviders {
  readonly email: EmailProvider;
  readonly sms: SmsProvider;
  readonly whatsapp: WhatsAppProvider;

  constructor() {
    const e = env();
    this.email = e.EMAIL_API_KEY ? new ResendEmailProvider(e.EMAIL_API_KEY, e.EMAIL_FROM) : new MockEmailProvider();
    this.sms = e.SMS_API_KEY && e.SMS_FROM ? new TwilioSmsProvider(e.SMS_API_KEY, e.SMS_FROM) : new MockSmsProvider();
    this.whatsapp =
      e.WHATSAPP_TOKEN && e.WHATSAPP_PHONE_NUMBER_ID
        ? new MetaWhatsAppProvider(e.WHATSAPP_TOKEN, e.WHATSAPP_PHONE_NUMBER_ID, e.WHATSAPP_APP_SECRET)
        : new MockWhatsAppProvider();
  }

  status() {
    return { email: this.email.name, sms: this.sms.name, whatsapp: this.whatsapp.name };
  }
}
