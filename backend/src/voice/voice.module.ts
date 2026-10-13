import { Body, Controller, Get, Header, HttpCode, Inject, Module, Param, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import type { Request } from 'express';
import { z } from 'zod';
import { env } from '../config/env';
import { Public, RawResponse, RequirePermissions } from '../common/decorators/auth.decorators';
import { ApiZodBody, zv } from '../common/pipes/zod.pipe';
import { TenantContext } from '../database/tenant';
import { Database, DB } from '../database/database.module';
import { clinics } from '../database/schema';
import { eq } from 'drizzle-orm';
import { AiModule } from '../ai/ai.module';
import { ConversationsModule } from '../conversations/conversations.module';
import { PatientsModule } from '../patients/patients.module';
import { VoiceService } from './voice.service';

const simulateSchema = z.object({ text: z.string().trim().max(500).default(''), conversationId: z.string().uuid().optional() });

@ApiTags('Voice')
@Controller()
export class VoiceController {
  constructor(
    private readonly voice: VoiceService,
    @Inject(DB) private readonly db: Database,
  ) {}

  private url(req: Request) {
    // Twilio signs the public URL it called (API_URL + path + query).
    return `${env().API_URL.replace(/\/$/, '')}${req.originalUrl}`;
  }

  @Public()
  @SkipThrottle()
  @RawResponse()
  @HttpCode(200)
  @Header('Content-Type', 'text/xml')
  @Post('webhooks/voice/:slug/incoming')
  @ApiOperation({ summary: 'Twilio Voice webhook: incoming call (X-Twilio-Signature validated)' })
  incoming(@Param('slug') slug: string, @Req() req: Request, @Body() body: Record<string, string>) {
    this.voice.verify(this.url(req), body ?? {}, req.header('x-twilio-signature'));
    return this.voice.inClinic(slug, (clinic) => this.voice.incoming(clinic, body ?? {}, `${env().API_URL.replace(/\/$/, '')}/api/webhooks/voice/${slug}`));
  }

  @Public()
  @SkipThrottle()
  @RawResponse()
  @HttpCode(200)
  @Header('Content-Type', 'text/xml')
  @Post('webhooks/voice/:slug/gather')
  gather(@Param('slug') slug: string, @Query('conversationId') conversationId: string, @Req() req: Request, @Body() body: Record<string, string>) {
    this.voice.verify(this.url(req), body ?? {}, req.header('x-twilio-signature'));
    return this.voice.inClinic(slug, (clinic) => this.voice.gathered(clinic, conversationId, body ?? {}, `${env().API_URL.replace(/\/$/, '')}/api/webhooks/voice/${slug}`));
  }

  /** Try the phone receptionist from the dashboard (no Twilio account needed). */
  @Post('integrations/voice/simulate')
  @ApiBearerAuth()
  @RequirePermissions('integrations.manage')
  @ApiZodBody(simulateSchema)
  async simulate(@Body(zv(simulateSchema)) dto: z.infer<typeof simulateSchema>) {
    const [clinic] = await this.db.select({ slug: clinics.slug }).from(clinics).where(eq(clinics.id, TenantContext.clinicId()));
    return this.voice.simulate(dto.text, dto.conversationId, clinic.slug);
  }

  @Get('integrations/voice/status')
  @ApiBearerAuth()
  @RequirePermissions('integrations.manage')
  async status() {
    const [clinic] = await this.db.select({ slug: clinics.slug }).from(clinics).where(eq(clinics.id, TenantContext.clinicId()));
    return {
      configured: Boolean(env().TWILIO_AUTH_TOKEN || env().SMS_API_KEY),
      webhookUrl: `${env().API_URL.replace(/\/$/, '')}/api/webhooks/voice/${clinic.slug}/incoming`,
      languages: { es: env().VOICE_LANGUAGE_ES, en: env().VOICE_LANGUAGE_EN },
    };
  }
}

@Module({ imports: [AiModule, ConversationsModule, PatientsModule], controllers: [VoiceController], providers: [VoiceService] })
export class VoiceModule {}
