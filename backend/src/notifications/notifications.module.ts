import { Global, Module } from '@nestjs/common';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { ChannelProviders } from './providers/channel-providers';

@Global()
@Module({
  controllers: [NotificationsController],
  providers: [NotificationsService, ChannelProviders],
  exports: [NotificationsService, ChannelProviders],
})
export class NotificationsModule {}
