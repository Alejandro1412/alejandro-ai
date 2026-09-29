import { Controller, Get, Inject } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { sql } from 'drizzle-orm';
import { Public } from '../common/decorators/auth.decorators';
import { Database, DB } from '../database/database.module';
import { QueueService } from '../jobs/queue.service';

@ApiTags('Health')
@Controller('health')
export class HealthController {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly queue: QueueService,
  ) {}

  @Public()
  @SkipThrottle()
  @Get()
  async check() {
    const started = Date.now();
    let database = 'up';
    try {
      await this.db.execute(sql`select 1`);
    } catch {
      database = 'down';
    }
    return { status: database === 'up' ? 'ok' : 'degraded', database, queue: this.queue.driver, latencyMs: Date.now() - started, version: '1.0.0' };
  }
}
