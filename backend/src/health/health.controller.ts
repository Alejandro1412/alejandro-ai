import { Controller, Get, Inject } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { sql } from 'drizzle-orm';
import { Public } from '../common/decorators/auth.decorators';
import { Database, DB } from '../database/database.module';
import { QueueService } from '../jobs/queue.service';
import { CacheService } from '../jobs/cache.service';
import { ChannelProviders } from '../notifications/providers/channel-providers';
import { BillingProviderFactory } from '../billing/billing-provider';
import { LLMFactory } from '../ai/llm/llm.factory';
import { PushService } from '../notifications/push.service';
import { env } from '../config/env';

@ApiTags('Health')
@Controller('health')
export class HealthController {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly queue: QueueService,
    private readonly cache: CacheService,
    private readonly channels: ChannelProviders,
    private readonly billing: BillingProviderFactory,
    private readonly llm: LLMFactory,
    private readonly push: PushService,
  ) {}

  /**
   * Readiness probe with dependency detail (for uptime monitors / Render health checks). Reports which
   * integrations are live or mocked — never credentials. HTTP 200 even when degraded so the body is readable.
   */
  @Public()
  @SkipThrottle()
  @Get('deep')
  async deep() {
    const t0 = Date.now();
    const timed = async <T>(fn: () => Promise<T>) => {
      const s = Date.now();
      try {
        return { ok: true as const, value: await fn(), ms: Date.now() - s };
      } catch (err) {
        return { ok: false as const, error: (err as Error).message.slice(0, 120), ms: Date.now() - s };
      }
    };
    const db = await timed(() => this.db.execute(sql`select 1`));
    const vector = await timed(async () => (await this.db.execute(sql`select extversion from pg_extension where extname = 'vector'`)).rows?.[0] ?? null);
    const migrations = await timed(async () => (await this.db.execute(sql`select count(*)::int as n from drizzle.__drizzle_migrations`)).rows?.[0] ?? null);
    const redis = await this.cache.ping();
    const llm = this.llm.availability();
    const checks = {
      database: db.ok ? { status: 'up', latencyMs: db.ms } : { status: 'down', error: db.error },
      pgvector: vector.ok && vector.value ? { status: 'up', version: (vector.value as { extversion: string }).extversion } : { status: 'missing' },
      migrationsApplied: migrations.ok ? (migrations.value as { n: number } | null)?.n ?? null : null,
      redis: { status: redis },
      queue: { driver: this.queue.driver },
      integrations: {
        email: this.channels.email.name,
        sms: this.channels.sms.name,
        whatsapp: this.channels.whatsapp.name,
        payments: this.billing.get().name,
        webPush: this.push.enabled ? 'vapid' : 'disabled',
        llm: Object.entries(llm).filter(([, v]) => v).map(([k]) => k),
        defaultProvider: env().AI_DEFAULT_PROVIDER,
      },
    };
    const degraded = !db.ok || redis === 'down';
    return { status: degraded ? 'degraded' : 'ok', checks, uptimeSeconds: Math.round(process.uptime()), memoryMb: Math.round(process.memoryUsage().rss / 1e6), latencyMs: Date.now() - t0, version: '3.0.0' };
  }

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
    return { status: database === 'up' ? 'ok' : 'degraded', database, queue: this.queue.driver, latencyMs: Date.now() - started, version: '3.0.0' };
  }
}
