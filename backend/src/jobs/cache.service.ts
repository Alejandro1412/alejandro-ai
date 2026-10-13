import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import { env } from '../config/env';

/** JSON cache backed by Redis, with an in-memory fallback for local/tests. */
@Injectable()
export class CacheService implements OnModuleDestroy {
  private readonly logger = new Logger(CacheService.name);
  private readonly redis: Redis | null;
  private readonly memory = new Map<string, { value: string; expires: number }>();

  constructor() {
    const url = env().REDIS_URL;
    this.redis =
      url && env().QUEUE_DRIVER === 'bullmq'
        ? new Redis(url, { lazyConnect: false, maxRetriesPerRequest: 2, enableOfflineQueue: false })
        : null;
    this.redis?.on('error', (e) => this.logger.warn(`Redis cache error: ${e.message}`));
  }

  /** 'up' | 'down' | 'memory' (no Redis configured). */
  async ping(): Promise<'up' | 'down' | 'memory'> {
    if (!this.redis) return 'memory';
    try {
      return (await Promise.race([this.redis.ping(), new Promise<string>((_, rej) => setTimeout(() => rej(new Error('timeout')), 1500))])) === 'PONG' ? 'up' : 'down';
    } catch {
      return 'down';
    }
  }

  async get<T>(key: string): Promise<T | null> {
    try {
      const raw = this.redis ? await this.redis.get(key) : this.memGet(key);
      return raw ? (JSON.parse(raw) as T) : null;
    } catch {
      return null;
    }
  }

  async set(key: string, value: unknown, ttlSeconds: number): Promise<void> {
    const raw = JSON.stringify(value);
    try {
      if (this.redis) await this.redis.set(key, raw, 'EX', ttlSeconds);
      else this.memory.set(key, { value: raw, expires: Date.now() + ttlSeconds * 1000 });
    } catch {
      /* cache is best-effort */
    }
  }

  async del(pattern: string): Promise<void> {
    try {
      if (this.redis) {
        const keys = await this.redis.keys(pattern);
        if (keys.length) await this.redis.del(...keys);
      } else {
        const re = new RegExp(`^${pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`);
        for (const k of this.memory.keys()) if (re.test(k)) this.memory.delete(k);
      }
    } catch {
      /* best-effort */
    }
  }

  async wrap<T>(key: string, ttlSeconds: number, fn: () => Promise<T>): Promise<T> {
    const hit = await this.get<T>(key);
    if (hit !== null) return hit;
    const value = await fn();
    await this.set(key, value, ttlSeconds);
    return value;
  }

  private memGet(key: string): string | null {
    const e = this.memory.get(key);
    if (!e) return null;
    if (e.expires < Date.now()) {
      this.memory.delete(key);
      return null;
    }
    return e.value;
  }

  async onModuleDestroy(): Promise<void> {
    await this.redis?.quit().catch(() => undefined);
  }
}
