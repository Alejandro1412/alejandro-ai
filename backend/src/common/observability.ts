import { Logger } from '@nestjs/common';
import { env } from '../config/env';

type SentryLike = typeof import('@sentry/node');
let sentry: SentryLike | null = null;

const PII_KEYS = /pass(word)?|token|secret|authorization|cookie|api[-_]?key|phone|email|document|content|message|text/i;
const scrub = (v: unknown, depth = 0): unknown => {
  if (depth > 6 || v === null || typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.map((x) => scrub(x, depth + 1));
  return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, PII_KEYS.test(k) ? '[scrubbed]' : scrub(x, depth + 1)]));
};

/**
 * Optional error monitoring. Enabled only when SENTRY_DSN is set. Request bodies, headers, cookies and
 * user details are never sent (patient data must not leave the platform through error reports).
 */
export async function initObservability(): Promise<void> {
  const dsn = env().SENTRY_DSN;
  if (!dsn) return;
  const S = await import('@sentry/node');
  S.init({
    dsn,
    environment: env().NODE_ENV,
    tracesSampleRate: env().SENTRY_TRACES_SAMPLE_RATE,
    sendDefaultPii: false,
    beforeSend(event) {
      if (event.request) {
        delete event.request.data;
        delete event.request.cookies;
        delete event.request.headers;
        delete event.request.query_string;
      }
      delete event.user;
      if (event.extra) event.extra = scrub(event.extra) as Record<string, unknown>;
      return event;
    },
  });
  sentry = S;
  new Logger('Observability').log('Sentry error reporting enabled');
}

export function captureException(err: unknown, tags: Record<string, string | undefined> = {}): void {
  if (!sentry) return;
  sentry.withScope((scope) => {
    for (const [k, v] of Object.entries(tags)) if (v) scope.setTag(k, v);
    sentry!.captureException(err);
  });
}
