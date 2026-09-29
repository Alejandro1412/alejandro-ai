import { Module } from '@nestjs/common';
import { EmbeddingService } from '../ai/embeddings/embedding-provider';
import { KnowledgeController } from './knowledge.controller';
import { KnowledgeService } from './knowledge.service';

@Module({
  controllers: [KnowledgeController],
  providers: [KnowledgeService, EmbeddingService],
  exports: [KnowledgeService],
})
export class KnowledgeModule {}
