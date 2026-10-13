import { Inject, Injectable } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import { env } from '../config/env';
import { Database, DB } from '../database/database.module';
import { agents, clinics, conversations } from '../database/schema';
import { TenantContext, tenantScope } from '../database/tenant';
import { NotFoundError, UnauthorizedError } from '../common/errors/app-error';
import { safeEqual } from '../common/utils/crypto';
import { createHmac } from 'node:crypto';
import { ROLE_DEFINITIONS } from '../rbac/permissions';
import { AuditService } from '../audit/audit.service';
import { BillingService } from '../billing/billing.service';
import { UsageService } from '../usage/usage.service';
import { ChatService } from '../ai/chat.service';
import { ConversationsService } from '../conversations/conversations.service';
import { PatientsService } from '../patients/patients.service';
import { renderForWhatsApp } from '../whatsapp/whatsapp.service';

type Option = { label: string; action: Record<string, unknown> | null };

/** XML-escapes text for TwiML. */
const x = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Turns chat markdown/cards into something pleasant to hear. */
export function toSpeech(text: string): string {
  return text
    .replace(/\*\*|__|`/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, '')
    .replace(/^\s*[-•]\s*/gm, '')
    .replace(/(\d+)\) /g, 'Opción $1: ')
    .replace(/\n{2,}/g, '. ')
    .replace(/\n/g, '. ')
    .replace(/\s{2,}/g, ' ')
    .replace(/\.\s*\./g, '.')
    .replace(/:\s*\./g, ':')
    .trim()
    .slice(0, 1500);
}

/**
 * Validates Twilio's X-Twilio-Signature: base64(HMAC-SHA1(authToken, url + sorted(key+value))).
 * https://www.twilio.com/docs/usage/webhooks/webhooks-security
 */
export function validTwilioSignature(authToken: string, url: string, params: Record<string, string>, signature: string | undefined): boolean {
  if (!signature) return false;
  const data = url + Object.keys(params).sort().map((k) => k + params[k]).join('');
  const expected = createHmac('sha1', authToken).update(Buffer.from(data, 'utf8')).digest('base64');
  return safeEqual(expected, signature);
}

/**
 * Voice receptionist over Twilio Programmable Voice: the caller speaks (or presses digits), Twilio
 * transcribes (<Gather input="speech">), the same orchestrator answers, and Twilio reads it back (<Say>).
 * Handoffs transfer the call to the clinic's phone. No audio is stored by this service.
 */
@Injectable()
export class VoiceService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly chat: ChatService,
    private readonly conversations: ConversationsService,
    private readonly patients: PatientsService,
    private readonly billing: BillingService,
    private readonly usage: UsageService,
    private readonly audit: AuditService,
  ) {}

  verify(url: string, params: Record<string, string>, signature: string | undefined) {
    const token = env().TWILIO_AUTH_TOKEN ?? env().SMS_API_KEY?.split(':')[1];
    if (!token) {
      if (env().NODE_ENV === 'production') throw new UnauthorizedError('VOICE_NOT_CONFIGURED', 'Voice webhook is not configured');
      return; // local development / simulator
    }
    if (!validTwilioSignature(token, url, params, signature)) throw new UnauthorizedError('INVALID_SIGNATURE', 'Invalid Twilio signature');
  }

  async inClinic<T>(slug: string, fn: (clinic: typeof clinics.$inferSelect) => Promise<T>): Promise<T> {
    const [clinic] = await this.db.select().from(clinics).where(eq(clinics.slug, slug));
    if (!clinic) throw new NotFoundError('Clinic', slug);
    return TenantContext.run(
      {
        ...TenantContext.current(),
        organizationId: clinic.organizationId,
        clinicId: clinic.id,
        principal: { kind: 'WEBHOOK', id: null, name: 'Voice', role: 'SYSTEM', permissions: new Set(ROLE_DEFINITIONS.RECEPTIONIST.permissions) },
      },
      () => fn(clinic),
    );
  }

  private voiceLang(lang: string) {
    return lang === 'en' ? env().VOICE_LANGUAGE_EN : env().VOICE_LANGUAGE_ES;
  }

  private gather(say: string, lang: string, actionUrl: string) {
    const l = this.voiceLang(lang);
    return `<?xml version="1.0" encoding="UTF-8"?><Response><Gather input="speech dtmf" language="${l}" speechTimeout="auto" numDigits="1" action="${x(actionUrl)}" method="POST"><Say language="${l}">${x(say)}</Say></Gather><Say language="${l}">${x(lang === 'en' ? "I didn't hear anything. Goodbye!" : 'No escuché respuesta. ¡Hasta luego!')}</Say><Hangup/></Response>`;
  }

  /** New call → new PHONE conversation → welcome + first <Gather>. */
  async incoming(clinic: typeof clinics.$inferSelect, params: Record<string, string>, baseUrl: string, opts: { simulation?: boolean } = {}) {
    const [agent] = await this.db.select().from(agents).where(eq(agents.clinicId, clinic.id));
    const from = params.From ?? 'unknown';
    if (!opts.simulation && !(await this.billing.hasFeature('voice'))) {
      const l = this.voiceLang('es');
      return `<?xml version="1.0" encoding="UTF-8"?><Response><Say language="${l}">${x(`Gracias por llamar a ${clinic.name}.`)}</Say>${clinic.phone ? `<Dial>${x(clinic.phone)}</Dial>` : '<Hangup/>'}</Response>`;
    }
    const patient = from.startsWith('+') ? await this.patients.findByContact({ phone: from }) : null;
    const lang = patient?.preferredLanguage === 'en' ? 'en' : ((agent?.languages[0] as 'es' | 'en') ?? 'es');
    const started = await this.chat.start({ channel: 'PHONE', patientId: patient?.id ?? null, externalContact: from, language: lang, metadata: { callSid: params.CallSid ?? null, ...(patient || !from.startsWith('+') ? {} : { partialIdentity: { phone: from } }) } });
    await this.audit.log({ action: 'voice.call_started', entityType: 'Conversation', entityId: started.conversation.id, patientId: patient?.id ?? null, metadata: { callSid: params.CallSid } });
    const welcome = (lang === 'en' ? agent?.welcomeMessageEn : agent?.welcomeMessage) ?? '';
    const hint = lang === 'en' ? ' You can speak naturally, for example: I need an appointment with dermatology.' : ' Puedes hablarme con naturalidad, por ejemplo: necesito una cita de dermatología.';
    return this.gather(toSpeech(welcome) + hint, lang, `${baseUrl}/gather?conversationId=${started.conversation.id}`);
  }

  /** Caller said something (SpeechResult) or pressed a digit (Digits). */
  async gathered(clinic: typeof clinics.$inferSelect, conversationId: string, params: Record<string, string>, baseUrl: string) {
    const conv = await this.conversations.getRaw(conversationId);
    const callSid = (conv.metadata as { callSid?: string }).callSid;
    if (conv.channel !== 'PHONE' || (callSid && params.CallSid && callSid !== params.CallSid)) throw new NotFoundError('Call');
    const speech = (params.SpeechResult ?? '').trim();
    const digits = (params.Digits ?? '').trim();
    const meta = conv.metadata as { waOptions?: Option[] };
    const option = digits && meta.waOptions ? meta.waOptions[Number(digits) - 1] : undefined;
    const text = option ? option.label : speech || digits;
    const lang = conv.language === 'en' ? 'en' : 'es';
    if (!text) return this.gather(lang === 'en' ? 'Sorry, I did not catch that. Could you repeat?' : 'Perdón, no te entendí. ¿Me lo repites?', lang, `${baseUrl}/gather?conversationId=${conv.id}`);
    const result = await this.chat.send(conv.id, text, option?.action ?? null);
    const l = this.voiceLang(lang);
    if (result.conversationStatus === 'HANDOFF' || !result.assistantMessage) {
      const msg = result.assistantMessage ? toSpeech(result.assistantMessage.content) : '';
      const transfer = lang === 'en' ? 'Transferring you to the front desk.' : 'Te comunico con recepción.';
      return `<?xml version="1.0" encoding="UTF-8"?><Response><Say language="${l}">${x(`${msg} ${transfer}`.trim())}</Say>${clinic.phone ? `<Dial>${x(clinic.phone)}</Dial>` : '<Hangup/>'}</Response>`;
    }
    const { text: rendered, options } = renderForWhatsApp(result.assistantMessage.content, result.assistantMessage.attachments, lang);
    const fresh = await this.conversations.getRaw(conv.id);
    await this.conversations.patch(conv.id, { metadata: { ...(fresh.metadata as Record<string, unknown>), waOptions: options } });
    const spoken = toSpeech(rendered.replace(/Responde con el número de tu opción\.|Reply with the number of your choice\./, lang === 'en' ? 'Say or press the option number.' : 'Di o marca el número de la opción.'));
    if (result.trace.intent === 'goodbye') return `<?xml version="1.0" encoding="UTF-8"?><Response><Say language="${l}">${x(spoken)}</Say><Hangup/></Response>`;
    return this.gather(spoken, lang, `${baseUrl}/gather?conversationId=${conv.id}`);
  }

  /** Staff simulator: runs one spoken turn without Twilio and returns the TwiML that would be played. */
  async simulate(text: string, conversationId: string | undefined, slug: string) {
    return this.inClinic(slug, async (clinic) => {
      const base = `${env().API_URL}/api/webhooks/voice/${slug}`;
      let convId = conversationId;
      let twiml: string;
      if (!convId) {
        twiml = await this.incoming(clinic, { From: '+10000000000', CallSid: `SIM${Date.now()}` }, base, { simulation: true });
        const [row] = await this.db
          .select({ id: conversations.id })
          .from(conversations)
          .where(tenantScope(conversations, and(eq(conversations.channel, 'PHONE'), sql`${conversations.metadata}->>'callSid' like 'SIM%'`)))
          .orderBy(sql`${conversations.createdAt} desc`)
          .limit(1);
        convId = row.id;
        if (!text) return { conversationId: convId, twiml, say: extractSay(twiml), planIncludesVoice: await this.billing.hasFeature('voice') };
      }
      twiml = await this.gathered(clinic, convId!, { SpeechResult: /^\d$/.test(text) ? '' : text, Digits: /^\d$/.test(text) ? text : '' }, base);
      return { conversationId: convId, twiml, say: extractSay(twiml), planIncludesVoice: await this.billing.hasFeature('voice') };
    });
  }
}

/** What the caller hears this turn (the prompt inside <Gather>, or the closing <Say> lines). */
export const extractSay = (twiml: string) => {
  const unescape = (t: string) => t.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
  const inGather = /<Gather[^>]*>[\s\S]*?<Say[^>]*>([\s\S]*?)<\/Say>/.exec(twiml);
  if (inGather) return unescape(inGather[1]);
  return [...twiml.matchAll(/<Say[^>]*>([\s\S]*?)<\/Say>/g)].map((m) => unescape(m[1])).join(' ');
};
