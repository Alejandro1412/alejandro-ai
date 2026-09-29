import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { AuthUser, CurrentUser, RequirePermissions } from '../common/decorators/auth.decorators';
import { ApiZodBody, ApiZodQuery, zv } from '../common/pipes/zod.pipe';
import { TenantContext } from '../database/tenant';
import { ConversationsService, listConversationsSchema } from './conversations.service';
import { HandoffService } from './handoff.service';

const replySchema = z.object({ content: z.string().trim().min(1).max(4000) });
const statusSchema = z.object({ status: z.enum(['ACTIVE', 'RESOLVED', 'CLOSED']), returnToAi: z.boolean().default(false) });
const queueSchema = z.object({ status: z.enum(['open', 'resolved']).default('open') });
const resolveSchema = z.object({ returnToAi: z.boolean().default(false) });

@ApiTags('Conversations')
@ApiBearerAuth()
@Controller()
export class ConversationsController {
  constructor(
    private readonly conversations: ConversationsService,
    private readonly handoffs: HandoffService,
  ) {}

  @Get('conversations')
  @RequirePermissions('conversations.read')
  @ApiZodQuery(listConversationsSchema)
  list(@Query(zv(listConversationsSchema)) q: z.infer<typeof listConversationsSchema>) {
    return this.conversations.list(q);
  }

  @Get('conversations/:id')
  @RequirePermissions('conversations.read')
  get(@Param('id', ParseUUIDPipe) id: string) {
    // Debug traces are only exposed to roles that can use the playground.
    return this.conversations.get(id, { includeTrace: TenantContext.principal().permissions.has('ai.playground') });
  }

  @Post('conversations/:id/messages')
  @RequirePermissions('conversations.reply')
  @ApiZodBody(replySchema)
  reply(@Param('id', ParseUUIDPipe) id: string, @Body(zv(replySchema)) dto: z.infer<typeof replySchema>) {
    return this.conversations.staffReply(id, dto.content);
  }

  @Post('conversations/:id/status')
  @RequirePermissions('conversations.reply')
  @ApiZodBody(statusSchema)
  status(@Param('id', ParseUUIDPipe) id: string, @Body(zv(statusSchema)) dto: z.infer<typeof statusSchema>) {
    return this.conversations.setStatus(id, dto.status, { returnToAi: dto.returnToAi });
  }

  @Get('handoffs')
  @RequirePermissions('conversations.handoff')
  @ApiZodQuery(queueSchema)
  queue(@Query(zv(queueSchema)) q: z.infer<typeof queueSchema>) {
    return this.handoffs.queue(q.status === 'open' ? ['OPEN', 'ASSIGNED'] : ['RESOLVED']);
  }

  @Post('handoffs/:id/assign')
  @RequirePermissions('conversations.handoff')
  assign(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.handoffs.assign(id, user.userId);
  }

  @Post('handoffs/:id/resolve')
  @RequirePermissions('conversations.handoff')
  @ApiZodBody(resolveSchema)
  resolve(@Param('id', ParseUUIDPipe) id: string, @Body(zv(resolveSchema)) dto: z.infer<typeof resolveSchema>) {
    return this.handoffs.resolve(id, dto.returnToAi);
  }
}
