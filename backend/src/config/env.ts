import { createHash } from 'node:crypto';
import { z } from 'zod';

/**
 * Typed, validated environment. The app refuses to boot with an invalid configuration.
 * Every external integration falls back to a mock provider when its credentials are absent.
 */
const bool = z
  .string()
  .optional()
  .transform((v) => v === 'true' || v === '1');

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().default(3000),
  APP_URL: z.string().url().default('http://localhost:5173'),
  API_URL: z.string().url().default('http://localhost:3000'),
  CORS_ORIGINS: z.string().default('http://localhost:5173,http://localhost:4173'),

  DATABASE_URL: z.string().min(1),
  DATABASE_POOL_MAX: z.coerce.number().int().default(10),
  REDIS_URL: z.string().optional(),
  QUEUE_DRIVER: z.enum(['bullmq', 'inline']).default('bullmq'),

  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET must be at least 32 characters'),
  JWT_ACCESS_TTL: z.string().default('15m'),
  JWT_REFRESH_TTL_DAYS: z.coerce.number().int().default(14),
  /** 64 hex chars (32 bytes) used for AES-256-GCM encryption of integration secrets. */
  ENCRYPTION_KEY: z.string().regex(/^[0-9a-f]{64}$/i, 'ENCRYPTION_KEY must be 64 hex characters'),

  // AI
  AI_DEFAULT_PROVIDER: z.enum(['mock', 'openai', 'anthropic', 'gemini']).default('mock'),
  OPENAI_API_KEY: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  GEMINI_API_KEY: z.string().optional(),
  EMBEDDINGS_PROVIDER: z.enum(['local', 'openai']).default('local'),
  AI_REQUEST_TIMEOUT_MS: z.coerce.number().int().default(30000),
  AI_MAX_TOOL_ITERATIONS: z.coerce.number().int().default(6),
  AI_DEBUG_TRACES: bool,

  // Calendar
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  GOOGLE_REDIRECT_URI: z.string().optional(),

  // WhatsApp (Meta Cloud API)
  WHATSAPP_TOKEN: z.string().optional(),
  WHATSAPP_PHONE_NUMBER_ID: z.string().optional(),
  WHATSAPP_VERIFY_TOKEN: z.string().optional(),
  WHATSAPP_APP_SECRET: z.string().optional(),
  WHATSAPP_DEFAULT_CLINIC_SLUG: z.string().optional(),

  // Billing
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  /** Stripe Price ids (price_…) for each plan and interval; synced into the plans table at boot. */
  STRIPE_PRICE_STARTER_MONTHLY: z.string().optional(),
  STRIPE_PRICE_STARTER_YEARLY: z.string().optional(),
  STRIPE_PRICE_PROFESSIONAL_MONTHLY: z.string().optional(),
  STRIPE_PRICE_PROFESSIONAL_YEARLY: z.string().optional(),
  STRIPE_PRICE_CLINIC_MONTHLY: z.string().optional(),
  STRIPE_PRICE_CLINIC_YEARLY: z.string().optional(),

  // Notifications
  EMAIL_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().default('Alejandro AI <no-reply@alejandro.ai>'),
  /** Twilio credentials as ACCOUNT_SID:AUTH_TOKEN */
  SMS_API_KEY: z.string().optional(),
  SMS_FROM: z.string().optional(),

  // Security
  RATE_LIMIT_TTL_MS: z.coerce.number().int().default(60000),
  RATE_LIMIT_MAX: z.coerce.number().int().default(300),
  PUBLIC_CHAT_RATE_LIMIT_MAX: z.coerce.number().int().default(30),
  /** Express "trust proxy" setting: number of proxy hops (Render/Vercel/nginx = 1), or 'false'. */
  TRUST_PROXY: z
    .string()
    .default('1')
    .transform((v) => (v === 'false' ? false : v === 'true' ? true : Number(v))),

  // Voice receptionist (Twilio Programmable Voice). Auth token validates X-Twilio-Signature.
  TWILIO_AUTH_TOKEN: z.string().optional(),
  VOICE_LANGUAGE_ES: z.string().default('es-MX'),
  VOICE_LANGUAGE_EN: z.string().default('en-US'),

  // Web push for staff (VAPID). Generate with `npx web-push generate-vapid-keys`.
  VAPID_PUBLIC_KEY: z.string().optional(),
  VAPID_PRIVATE_KEY: z.string().optional(),
  VAPID_SUBJECT: z.string().default('mailto:ops@alejandro.ai'),

  // Billing lifecycle
  BILLING_GRACE_DAYS: z.coerce.number().int().min(0).default(7),
  /** Minutes a deposit-held appointment waits for payment before it is released. */
  DEPOSIT_HOLD_MINUTES: z.coerce.number().int().min(5).default(60),

  /** Video consultations for virtual services (Jitsi Meet: public instance or self-hosted). */
  VIDEO_BASE_URL: z.string().url().default('https://meet.jit.si'),

  // Observability
  SENTRY_DSN: z.string().url().optional(),
  SENTRY_TRACES_SAMPLE_RATE: z.coerce.number().min(0).max(1).default(0),

  SWAGGER_ENABLED: z
    .string()
    .optional()
    .transform((v) => v !== 'false'),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | null = null;

/**
 * Zero-config demo deployments (Vercel + a Postgres integration): when explicit secrets are not set,
 * derive stable ones from DATABASE_URL (itself a secret) so every serverless instance agrees.
 * Set JWT_SECRET / JWT_REFRESH_SECRET / ENCRYPTION_KEY explicitly for real production use.
 */
function withPlatformDefaults(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const out = { ...source };
  out.DATABASE_URL ||= source.POSTGRES_URL || source.DATABASE_URL_UNPOOLED || source.POSTGRES_URL_NON_POOLING;
  if (source.VERCEL && out.DATABASE_URL) {
    const derive = (label: string) => createHash('sha256').update(`alejandro-ai:${label}:${out.DATABASE_URL}`).digest('hex');
    out.JWT_SECRET ||= derive('jwt-access');
    out.JWT_REFRESH_SECRET ||= derive('jwt-refresh');
    out.ENCRYPTION_KEY ||= derive('encryption-key');
    const host = source.VERCEL_PROJECT_PRODUCTION_URL || source.VERCEL_URL;
    if (host) {
      out.APP_URL ||= `https://${host}`;
      out.API_URL ||= `https://${host}`;
      out.CORS_ORIGINS ||= [`https://${host}`, source.VERCEL_URL ? `https://${source.VERCEL_URL}` : ''].filter(Boolean).join(',');
    }
    out.NODE_ENV ||= 'production';
    out.SWAGGER_ENABLED ||= 'false';
    if (!out.REDIS_URL) out.QUEUE_DRIVER = 'inline';
  }
  return out;
}

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(withPlatformDefaults(source));
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  cached = parsed.data;
  return cached;
}

export function env(): Env {
  return cached ?? loadEnv();
}

/** Only for tests: forget the cached env so a new process.env is picked up. */
export function resetEnvCache(): void {
  cached = null;
}
