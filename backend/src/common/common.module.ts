import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuditService } from '../audit/audit.service';
import { CacheService } from '../jobs/cache.service';
import { QueueService } from '../jobs/queue.service';
import { RbacService } from '../rbac/rbac.service';
import { EventsService } from '../realtime/events.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';

/** Cross-cutting infrastructure shared by every feature module. */
@Global()
@Module({
  imports: [JwtModule.register({})],
  providers: [AuditService, CacheService, QueueService, RbacService, RealtimeGateway, EventsService],
  exports: [JwtModule, AuditService, CacheService, QueueService, RbacService, EventsService],
})
export class CommonModule {}
