import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Job, Queue, Worker } from 'bullmq';
import { env } from '../config/env';
import { ROLE_DEFINITIONS } from '../rbac/permissions';
import { TenantContext } from '../database/tenant';

export type QueueName = 'knowledge-ingestion' | 'notifications' | 'reminders';

export interface TenantJob {
  organizationId: string;
  clinicId?: string;
}

type Handler<T extends TenantJob> = (data: T) => Promise<void>;

/**
 * Background jobs. `bullmq` driver (Redis) in dev/prod; `inline` driver for tests and
 * environments without Redis. Handlers always run inside a SYSTEM tenant context.
 */
@Injectable()
export class QueueService implements OnModuleDestroy {
  private readonly logger = new Logger(QueueService.name);
  private readonly handlers = new Map<QueueName, Handler<TenantJob>>();
  private readonly queues = new Map<QueueName, Queue>();
  private readonly workers: Worker[] = [];
  private readonly timers: NodeJS.Timeout[] = [];
  private readonly pending = new Set<Promise<void>>();
  readonly driver = env().REDIS_URL ? env().QUEUE_DRIVER : 'inline';

  private get connection() {
    const url = new URL(env().REDIS_URL!);
    return {
      host: url.hostname,
      port: Number(url.port || 6379),
      password: url.password || undefined,
      username: url.username || undefined,
      maxRetriesPerRequest: null,
    };
  }

  register<T extends TenantJob>(name: QueueName, handler: Handler<T>, concurrency = 4): void {
    const wrapped: Handler<TenantJob> = (data) => this.runInTenant(data, () => handler(data as T));
    this.handlers.set(name, wrapped);
    if (this.driver === 'bullmq') {
      const worker = new Worker(name, async (job: Job<TenantJob>) => wrapped(job.data), { connection: this.connection, concurrency });
      worker.on('failed', (job, err) => this.logger.error(`Job ${name}#${job?.id} failed: ${err.message}`));
      worker.on('error', (err) => this.logger.warn(`Worker ${name} error: ${err.message}`));
      this.workers.push(worker);
    }
  }

  async enqueue<T extends TenantJob>(name: QueueName, data: T, opts: { delayMs?: number; jobId?: string; attempts?: number } = {}): Promise<void> {
    if (this.driver === 'bullmq') {
      let queue = this.queues.get(name);
      if (!queue) {
        queue = new Queue(name, { connection: this.connection });
        this.queues.set(name, queue);
      }
      await queue.add(name, data, {
        delay: opts.delayMs,
        jobId: opts.jobId,
        attempts: opts.attempts ?? 3,
        backoff: { type: 'exponential', delay: 2000 },
        removeOnComplete: 500,
        removeOnFail: 1000,
      });
      return;
    }
    const handler = this.handlers.get(name);
    if (!handler) throw new Error(`No handler registered for queue ${name}`);
    const run = (async () => {
      if (opts.delayMs) await new Promise((r) => setTimeout(r, Math.min(opts.delayMs!, 1000)));
      await handler(data).catch((err: Error) => this.logger.error(`Inline job ${name} failed: ${err.message}`));
    })();
    this.pending.add(run);
    void run.finally(() => this.pending.delete(run));
  }

  /** Repeatable job (e.g. reminder sweep). */
  async every(name: QueueName, intervalMs: number, data: TenantJob): Promise<void> {
    if (this.driver === 'bullmq') {
      const queue = this.queues.get(name) ?? new Queue(name, { connection: this.connection });
      this.queues.set(name, queue);
      await queue.upsertJobScheduler(`${name}-sweep`, { every: intervalMs }, { name, data });
      return;
    }
    if (env().NODE_ENV === 'test') return;
    const handler = this.handlers.get(name);
    if (handler) this.timers.push(setInterval(() => void handler(data).catch(() => undefined), intervalMs));
  }

  /** Test helper: wait for all inline jobs to finish. */
  async drain(): Promise<void> {
    while (this.pending.size) await Promise.all([...this.pending]);
  }

  private runInTenant(data: TenantJob, fn: () => Promise<void>): Promise<void> {
    return TenantContext.run(
      {
        organizationId: data.organizationId,
        clinicId: data.clinicId,
        principal: {
          kind: 'SYSTEM',
          id: null,
          name: 'System',
          role: 'SYSTEM',
          permissions: new Set(ROLE_DEFINITIONS.CLINIC_ADMIN.permissions),
        },
      },
      fn,
    );
  }

  async onModuleDestroy(): Promise<void> {
    this.timers.forEach(clearInterval);
    await Promise.all(this.workers.map((w) => w.close()));
    await Promise.all([...this.queues.values()].map((q) => q.close()));
  }
}
