import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { RequirePermissions } from '../common/decorators/auth.decorators';
import { ApiZodBody, ApiZodQuery, zv } from '../common/pipes/zod.pipe';
import { ForbiddenError } from '../common/errors/app-error';
import { TenantContext } from '../database/tenant';
import { UsageService } from '../usage/usage.service';
import { BillingService } from '../billing/billing.service';
import { updateAgentConfigSchema } from './agent-config';
import { AgentConfigService } from './agent-config.service';
import { ChatService } from './chat.service';
import { LLMFactory } from './llm/llm.factory';
import { SUPPORTED_MODELS } from './llm/pricing';
import { SummarizerService } from './orchestrator/summarizer.service';
import { ToolRegistry } from './tools/tool-registry';
import { ConversationsService } from '../conversations/conversations.service';

const actionSchema = z
  .object({ type: z.enum(['book_slot', 'confirm_cancel', 'start_reschedule', 'reschedule_to', 'select_doctor']) })
  .catchall(z.union([z.string().max(200), z.number(), z.null()]));

export const chatSchema = z.object({
  conversationId: z.string().uuid().optional(),
  message: z.string().trim().min(1).max(2000),
  action: actionSchema.optional(),
  patientId: z.string().uuid().nullable().optional(),
  language: z.enum(['es', 'en']).optional(),
});

const toolToggleSchema = z.object({ enabled: z.boolean() });
const usageQuery = z.object({ days: z.coerce.number().int().min(1).max(365).default(30) });

@ApiTags('AI')
@ApiBearerAuth()
@Controller()
export class AiController {
  constructor(
    private readonly chat: ChatService,
    private readonly config: AgentConfigService,
    private readonly tools: ToolRegistry,
    private readonly llm: LLMFactory,
    private readonly summarizer: SummarizerService,
    private readonly usage: UsageService,
    private readonly billing: BillingService,
    private readonly conversations: ConversationsService,
  ) {}

  @Post('ai/chat')
  @RequirePermissions('ai.playground')
  @ApiOperation({ summary: 'Talk to Alejandro AI as a patient (playground). Returns the full observability trace.' })
  @ApiZodBody(chatSchema)
  async send(@Body(zv(chatSchema)) dto: z.infer<typeof chatSchema>) {
    let conversationId = dto.conversationId;
    let welcome = null;
    if (!conversationId) {
      const started = await this.chat.start({ channel: 'PLAYGROUND', patientId: dto.patientId ?? null, language: dto.language });
      conversationId = started.conversation.id;
      welcome = started.welcome;
    } else {
      const conv = await this.conversations.getRaw(conversationId);
      if (conv.channel !== 'PLAYGROUND') throw new ForbiddenError('NOT_PLAYGROUND', 'Only playground conversations can be driven from this endpoint');
    }
    const result = await this.chat.send(conversationId, dto.message, dto.action ?? null);
    return { ...result, welcome };
  }

  @Post('ai/playground/start')
  @RequirePermissions('ai.playground')
  @ApiZodBody(z.object({ patientId: z.string().uuid().nullable().optional(), language: z.enum(['es', 'en']).optional() }))
  start(@Body(zv(z.object({ patientId: z.string().uuid().nullable().optional(), language: z.enum(['es', 'en']).optional() }))) dto: { patientId?: string | null; language?: 'es' | 'en' }) {
    return this.chat.start({ channel: 'PLAYGROUND', patientId: dto.patientId ?? null, language: dto.language });
  }

  @Get('ai/playground/scenarios')
  @RequirePermissions('ai.playground')
  scenarios() {
    return this.chat.scenarios();
  }

  @Get('ai/config')
  @RequirePermissions('settings.manage')
  async getConfig() {
    const agent = await this.config.get();
    return { agent, providers: this.llm.availability(), models: SUPPORTED_MODELS };
  }

  @Patch('ai/config')
  @RequirePermissions('settings.manage')
  @ApiZodBody(updateAgentConfigSchema)
  updateConfig(@Body(zv(updateAgentConfigSchema)) dto: z.infer<typeof updateAgentConfigSchema>) {
    return this.config.update(dto);
  }

  @Get('ai/tools')
  @RequirePermissions('ai.playground')
  async listTools() {
    return this.tools.catalog(await this.config.get());
  }

  @Patch('ai/tools/:name')
  @RequirePermissions('settings.manage')
  @ApiZodBody(toolToggleSchema)
  async toggleTool(@Param('name') name: string, @Body(zv(toolToggleSchema)) dto: z.infer<typeof toolToggleSchema>) {
    if (!this.tools.get(name)) throw new ForbiddenError('UNKNOWN_TOOL', 'Unknown tool');
    await this.tools.setEnabled(await this.config.get(), name, dto.enabled);
    return { name, enabled: dto.enabled };
  }

  @Post('conversations/:id/summary')
  @RequirePermissions('conversations.read')
  summarize(@Param('id', ParseUUIDPipe) id: string) {
    return this.summarizer.summarize(id);
  }

  @Get('ai/usage')
  @RequirePermissions('analytics.read')
  @ApiZodQuery(usageQuery)
  async usageSummary(@Query(zv(usageQuery)) q: z.infer<typeof usageQuery>) {
    const since = new Date(Date.now() - q.days * 86_400_000);
    const [rows, quota] = await Promise.all([this.usage.summary(since), this.billing.aiQuota()]);
    return { since, organizationId: TenantContext.orgId(), rows, quota };
  }
}
