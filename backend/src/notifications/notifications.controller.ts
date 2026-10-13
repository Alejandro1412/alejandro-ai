import { Body, Controller, Delete, Get, Headers, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { AuthUser, CurrentUser, RequirePermissions } from '../common/decorators/auth.decorators';
import { ApiZodBody, ApiZodQuery, zv } from '../common/pipes/zod.pipe';
import { PushService, pushSubscriptionSchema } from './push.service';
import { paginationSchema } from '../common/utils/pagination';
import { NotificationsService } from './notifications.service';
import { ChannelProviders } from './providers/channel-providers';

const listSchema = paginationSchema.extend({ unreadOnly: z.enum(['true', 'false']).optional().transform((v) => v === 'true') });

@ApiTags('Notifications')
@ApiBearerAuth()
@Controller('notifications')
export class NotificationsController {
  constructor(
    private readonly notifications: NotificationsService,
    private readonly providers: ChannelProviders,
    private readonly push: PushService,
  ) {}

  @Get('push/public-key')
  pushKey() {
    return this.push.publicKey();
  }

  @Post('push/subscribe')
  @ApiZodBody(pushSubscriptionSchema)
  subscribe(@CurrentUser() user: AuthUser, @Body(zv(pushSubscriptionSchema)) dto: z.infer<typeof pushSubscriptionSchema>, @Headers('user-agent') ua?: string) {
    return this.push.subscribe(user.userId, dto, ua);
  }

  @Delete('push/subscribe')
  unsubscribe(@CurrentUser() user: AuthUser, @Body(zv(z.object({ endpoint: z.string().url().max(1000) }))) dto: { endpoint: string }) {
    return this.push.unsubscribe(user.userId, dto.endpoint);
  }

  @Get()
  @ApiZodQuery(listSchema)
  list(@CurrentUser() user: AuthUser, @Query(zv(listSchema)) q: z.infer<typeof listSchema>) {
    return this.notifications.list(user.userId, q);
  }

  @Get('unread-count')
  unread(@CurrentUser() user: AuthUser) {
    return this.notifications.unreadCount(user.userId);
  }

  @Post(':id/read')
  read(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.notifications.markRead(user.userId, id);
  }

  @Post('read-all')
  readAll(@CurrentUser() user: AuthUser) {
    return this.notifications.markAllRead(user.userId);
  }

  @Get('deliveries')
  @RequirePermissions('integrations.manage')
  async deliveries() {
    return { providers: this.providers.status(), deliveries: await this.notifications.deliveries() };
  }
}
