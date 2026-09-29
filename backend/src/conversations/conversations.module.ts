import { Module } from '@nestjs/common';
import { ConversationsController } from './conversations.controller';
import { ConversationsService } from './conversations.service';
import { HandoffService } from './handoff.service';

@Module({
  controllers: [ConversationsController],
  providers: [ConversationsService, HandoffService],
  exports: [ConversationsService, HandoffService],
})
export class ConversationsModule {}
