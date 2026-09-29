import { ExternalServiceError, TimeoutError } from '../errors/app-error';

/** Rejects if `promise` does not settle within `ms`. */
export async function withTimeout<T>(promise: Promise<T>, ms: number, operation: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new TimeoutError(operation, ms)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export interface RetryOptions {
  retries: number;
  baseDelayMs: number;
  /** Return false to stop retrying (e.g. 4xx errors). */
  shouldRetry?: (err: unknown) => boolean;
}

/** Exponential backoff with full jitter. */
export async function retry<T>(fn: () => Promise<T>, opts: RetryOptions): Promise<T> {
  let attempt = 0;
  for (;;) {
    try {
      return await fn();
    } catch (err) {
      attempt++;
      if (attempt > opts.retries || (opts.shouldRetry && !opts.shouldRetry(err))) throw err;
      const delay = Math.random() * opts.baseDelayMs * 2 ** (attempt - 1);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
}

type BreakerState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

/**
 * Minimal circuit breaker: after `failureThreshold` consecutive failures the circuit opens
 * for `resetAfterMs`, failing fast so a degraded provider does not stall every request.
 */
export class CircuitBreaker {
  private state: BreakerState = 'CLOSED';
  private failures = 0;
  private openedAt = 0;

  constructor(
    readonly name: string,
    private readonly failureThreshold = 5,
    private readonly resetAfterMs = 30_000,
  ) {}

  get status(): BreakerState {
    if (this.state === 'OPEN' && Date.now() - this.openedAt >= this.resetAfterMs) this.state = 'HALF_OPEN';
    return this.state;
  }

  async exec<T>(fn: () => Promise<T>): Promise<T> {
    if (this.status === 'OPEN') throw new ExternalServiceError(this.name, 'circuit open — provider temporarily unavailable');
    try {
      const result = await fn();
      this.failures = 0;
      this.state = 'CLOSED';
      return result;
    } catch (err) {
      this.failures++;
      if (this.state === 'HALF_OPEN' || this.failures >= this.failureThreshold) {
        this.state = 'OPEN';
        this.openedAt = Date.now();
      }
      throw err;
    }
  }
}

/** fetch() wrapper returning parsed JSON with timeout + typed errors. */
export async function fetchJson<T>(url: string, init: RequestInit & { timeoutMs?: number; service: string }): Promise<T> {
  const controller = new AbortController();
  const ms = init.timeoutMs ?? 20_000;
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    const text = await res.text();
    if (!res.ok) throw new ExternalServiceError(init.service, `HTTP ${res.status}`, { status: res.status, body: text.slice(0, 500) });
    return (text ? JSON.parse(text) : {}) as T;
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw new TimeoutError(init.service, ms);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export const isRetryableHttp = (err: unknown) => {
  const status = (err as ExternalServiceError)?.details?.status as number | undefined;
  return err instanceof TimeoutError || status === undefined || status === 429 || status >= 500;
};
