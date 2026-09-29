import { Body, Controller, Get, Headers, Inject, Module, Param, Post } from '@nestjs/common';
import { ApiHeader, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { env } from '../config/env';
import { Database, DB } from '../database/database.module';
import { agents, clinics } from '../database/schema';
import { TenantContext } from '../database/tenant';
import { Public } from '../common/decorators/auth.decorators';
import { ApiZodBody, zv } from '../common/pipes/zod.pipe';
import { NotFoundError, UnauthorizedError } from '../common/errors/app-error';
import { randomToken, sha256 } from '../common/utils/crypto';
import { AiModule } from '../ai/ai.module';
import { ChatService } from '../ai/chat.service';
import { chatSchema } from '../ai/ai.controller';
import { ClinicsModule } from '../clinics/clinics.module';
import { ClinicsService } from '../clinics/clinics.service';
import { ConversationsModule } from '../conversations/conversations.module';
import { ConversationsService } from '../conversations/conversations.service';

const sessionSchema = z.object({ language: z.enum(['es', 'en']).optional() });
const publicMessageSchema = chatSchema.pick({ message: true, action: true });

/**
 * Public, unauthenticated surface: clinic profile + embeddable webchat.
 * Webchat sessions use an opaque token (stored hashed) and strict rate limits.
 */
@ApiTags('Public')
@Public()
@Controller('public')
export class PublicController {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly clinics: ClinicsService,
    private readonly chat: ChatService,
    private readonly conversations: ConversationsService,
  ) {}

  private async withClinic<T>(slug: string, fn: () => Promise<T>): Promise<T> {
    const [clinic] = await this.db.select().from(clinics).where(eq(clinics.slug, slug));
    if (!clinic) throw new NotFoundError('Clinic', slug);
    return TenantContext.run(
      {
        ...TenantContext.current(),
        organizationId: clinic.organizationId,
        clinicId: clinic.id,
        principal: { kind: 'PATIENT', id: null, name: 'Web visitor', role: 'PUBLIC', permissions: new Set() },
      },
      fn,
    );
  }

  @Get('clinics/:slug')
  profile(@Param('slug') slug: string) {
    return this.withClinic(slug, async () => {
      const c = await this.clinics.current();
      const [agent] = await this.db.select().from(agents).where(eq(agents.clinicId, c.id));
      const services = await this.clinics.listServices();
      return {
        clinic: { name: c.name, slug: c.slug, description: c.description, phone: c.phone, email: c.email, website: c.website, address: c.address, city: c.city, timezone: c.timezone, businessHours: c.businessHours },
        locations: await this.clinics.listLocations(),
        specialties: (await this.clinics.listSpecialties()).map((s) => ({ id: s.id, name: s.name, nameEn: s.nameEn })),
        services: services.filter((s) => s.isActive).map((s) => ({ id: s.id, name: s.name, nameEn: s.nameEn, durationMinutes: s.durationMinutes, priceCents: s.priceCents, currency: s.currency, specialty: s.specialty?.name ?? null })),
        agent: agent ? { name: agent.name, welcomeMessage: agent.welcomeMessage, welcomeMessageEn: agent.welcomeMessageEn, languages: agent.languages } : null,
      };
    });
  }

  @Post('chat/:slug/session')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiZodBody(sessionSchema)
  session(@Param('slug') slug: string, @Body(zv(sessionSchema)) dto: z.infer<typeof sessionSchema>) {
    return this.withClinic(slug, async () => {
      const token = randomToken(32);
      const started = await this.chat.start({ channel: 'WEB', language: dto.language, sessionTokenHash: sha256(token) });
      return { sessionToken: token, conversationId: started.conversation.id, agentName: started.agent.name, welcome: started.welcome };
    });
  }

  @Post('chat/:slug/messages')
  @Throttle({ default: { limit: env().PUBLIC_CHAT_RATE_LIMIT_MAX, ttl: 60_000 } })
  @ApiHeader({ name: 'X-Chat-Session', required: true })
  @ApiZodBody(publicMessageSchema)
  send(@Param('slug') slug: string, @Headers('x-chat-session') token: string | undefined, @Body(zv(publicMessageSchema)) dto: z.infer<typeof publicMessageSchema>) {
    return this.withClinic(slug, async () => {
      const conv = await this.sessionConversation(token);
      const r = await this.chat.send(conv.id, dto.message, dto.action ?? null);
      return { conversationId: r.conversationId, userMessage: r.userMessage, assistantMessage: r.assistantMessage, conversationStatus: r.conversationStatus };
    });
  }

  @Get('chat/:slug/messages')
  @ApiHeader({ name: 'X-Chat-Session', required: true })
  history(@Param('slug') slug: string, @Headers('x-chat-session') token: string | undefined) {
    return this.withClinic(slug, async () => {
      const conv = await this.sessionConversation(token);
      const msgs = await this.conversations.messages(conv.id, 100);
      return { conversationId: conv.id, status: conv.status, messages: msgs.map((m) => ({ id: m.id, role: m.role, content: m.content, attachments: m.attachments, createdAt: m.createdAt })) };
    });
  }

  private async sessionConversation(token: string | undefined) {
    if (!token || token.length < 20) throw new UnauthorizedError('CHAT_SESSION_REQUIRED', 'Missing chat session');
    const conv = await this.conversations.findBySessionHash(sha256(token));
    if (!conv) throw new UnauthorizedError('CHAT_SESSION_INVALID', 'Chat session expired');
    return conv;
  }
}

@Module({ imports: [AiModule, ClinicsModule, ConversationsModule], controllers: [PublicController] })
export class PublicModule {}
