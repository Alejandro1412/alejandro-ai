import { Global, Module } from '@nestjs/common';
import { NotificationsController } from './notifications.controller';
import { PushService } from './push.service';
import { WhatsAppChannelsService } from './providers/whatsapp-channels.service';
import { NotificationsService } from './notifications.service';
import { ChannelProviders } from './providers/channel-providers';

@Global()
@Module({
  controllers: [NotificationsController],
  providers: [NotificationsService, ChannelProviders, PushService, WhatsAppChannelsService],
  exports: [NotificationsService, ChannelProviders, PushService, WhatsAppChannelsService],
})
export class NotificationsModule {}
