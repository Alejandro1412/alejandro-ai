import { Body, Controller, Get, Headers, HttpCode, Module, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import type { Request } from 'express';
import { z } from 'zod';
import { Public, RawResponse, RequirePermissions } from '../common/decorators/auth.decorators';
import { ApiZodBody, zv } from '../common/pipes/zod.pipe';
import { ValidationError } from '../common/errors/app-error';
import { AiModule } from '../ai/ai.module';
import { ConversationsModule } from '../conversations/conversations.module';
import { PatientsModule } from '../patients/patients.module';
import { mockOutbox } from '../notifications/providers/channel-providers';
import { WhatsAppService } from './whatsapp.service';

const simulateSchema = z.object({ from: z.string().trim().regex(/^\+?\d{7,15}$/), text: z.string().trim().min(1).max(1000), name: z.string().max(80).optional() });

@ApiTags('WhatsApp')
@Controller()
export class WhatsAppController {
  constructor(private readonly whatsapp: WhatsAppService) {}

  /** Meta webhook verification handshake. */
  @Public()
  @RawResponse()
  @Get('webhooks/whatsapp')
  verify(@Query('hub.mode') mode?: string, @Query('hub.verify_token') token?: string, @Query('hub.challenge') challenge?: string) {
    return this.whatsapp.verifyChallenge(mode, token, challenge);
  }

  @Public()
  @SkipThrottle()
  @Post('webhooks/whatsapp')
  @HttpCode(200)
  @ApiOperation({ summary: 'WhatsApp Cloud API webhook (X-Hub-Signature-256 validated when configured)' })
  receive(@Req() req: Request & { rawBody?: Buffer }, @Body() body: unknown, @Headers('x-hub-signature-256') signature?: string) {
    if (!req.rawBody) throw new ValidationError('Raw body required');
    return this.whatsapp.handleWebhook(req.rawBody, signature, body);
  }

  @Get('integrations/whatsapp')
  @ApiBearerAuth()
  @RequirePermissions('integrations.manage')
  async status() {
    return { ...this.whatsapp.status(), planAllowsWhatsapp: await this.whatsapp.canUse(), outbox: mockOutbox.filter((m) => m.channel === 'WHATSAPP').slice(-20).reverse() };
  }

  /** Sends a simulated inbound WhatsApp message through the real pipeline (works with the mock provider). */
  @Post('integrations/whatsapp/simulate')
  @ApiBearerAuth()
  @RequirePermissions('integrations.manage')
  @ApiZodBody(simulateSchema)
  simulate(@Body(zv(simulateSchema)) dto: z.infer<typeof simulateSchema>) {
    return this.whatsapp.processInbound({ from: dto.from, text: dto.text, name: dto.name ?? null });
  }
}

@Module({
  imports: [AiModule, ConversationsModule, PatientsModule],
  controllers: [WhatsAppController],
  providers: [WhatsAppService],
})
export class WhatsAppModule {}
