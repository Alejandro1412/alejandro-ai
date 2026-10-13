# Deployment

## Topology

```
            HTTPS
Users ──► CDN / load balancer ──► frontend (nginx, SPA + proxy /api, /socket.io)
                                        │
                                        ▼
                                  backend (NestJS) ×N ──► PostgreSQL 16 + pgvector (managed)
                                        │           └──► Redis 7 (managed)
                                        └──► LLM / Google / Meta / Stripe / Resend / Twilio
```

- The **frontend image** serves the static build and reverse-proxies `/api` and `/socket.io` to `backend:3000`, so the browser talks to a single origin. You can also host the SPA on a CDN and point `/api` to the backend through your load balancer — keep them on the same site so the `SameSite=Strict` refresh cookie works.
- The **backend image** runs migrations on start (`dist/database/migrate.js`), then the API. It is stateless; scale horizontally. With more than one replica, keep Redis configured (BullMQ, cache) and enable sticky sessions or the Socket.IO Redis adapter for websockets.

## Images

```bash
docker build -f backend/Dockerfile  -t alejandro-ai-backend  .
docker build -f frontend/Dockerfile -t alejandro-ai-frontend .
```

Both are multi-stage (Node 22 slim; nginx alpine for the SPA), run as non-root (backend) and include health checks (`/api/health`, `/healthz`).

## Local stack with Docker Compose

```bash
cp .env.example .env              # optional; compose has safe local defaults
docker compose up --build
open http://localhost:8080
```

Services: `postgres` (pgvector/pgvector:pg16), `redis` (7-alpine), `backend` (:3000), `frontend` (:8080). The demo tenant is seeded only when the database is empty (`SEED_DEMO_DATA=true`). Set `SEED_DEMO_DATA=false` for real environments.

Useful commands:

```bash
docker compose logs -f backend
docker compose exec postgres psql -U postgres alejandro
docker compose down -v            # removes data volumes
```

## Environment for production

| Variable | Notes |
|---|---|
| `NODE_ENV=production` | Secure cookies and seed protection (the demo seed refuses to run unless `SEED_FORCE=true`) |
| `DATABASE_URL` | Managed Postgres 16 with the `vector`, `btree_gist` and `pgcrypto` extensions allowed (Neon, Supabase, RDS, Cloud SQL, Azure Flexible Server all support them) |
| `REDIS_URL` | Managed Redis (Upstash, ElastiCache, Memorystore…) |
| `JWT_SECRET`, `JWT_REFRESH_SECRET` | Unique random values ≥ 32 chars, from a secret manager |
| `ENCRYPTION_KEY` | `openssl rand -hex 32`; **back it up** — integration credentials cannot be decrypted without it |
| `APP_URL`, `API_URL`, `CORS_ORIGINS` | Public URLs; CORS must list the exact web origin |
| `SWAGGER_ENABLED` | `false` or protect `/api/docs` |
| `AI_DEFAULT_PROVIDER` + key | `openai`, `anthropic` or `gemini` with its API key; clinics choose model/temperature in Settings → AI |
| `EMBEDDINGS_PROVIDER` | `local` (default) or `openai`. Changing it requires re-processing knowledge sources (Knowledge → Reprocess) |

See `.env.example` for the complete list.

## Database migrations

- Applied automatically by the backend container on start (`node dist/database/migrate.js`), or manually with `npm run db:migrate`.
- After changing `backend/src/database/schema.ts`: `npm run db:generate --workspace backend`, review the generated SQL, commit it. Hand-written SQL (constraints, indexes Drizzle cannot express) goes in its own migration file.
- Migrations are forward-only; take a backup before deploying schema changes.

## Integrations checklist

### LLM
Set `AI_DEFAULT_PROVIDER` and the matching key. Without a key the clinic keeps working on the mock provider (the Playground shows `providerFallback`).

### Google Calendar
1. Google Cloud console → OAuth consent screen + OAuth client (Web).
2. Authorized redirect URI: `https://<api-host>/api/calendars/google/callback` (or set `GOOGLE_REDIRECT_URI`).
3. Enable the Google Calendar API; set `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`.
4. In the app: Settings → Integrations → Connect Google Calendar. Tokens are stored encrypted.

### WhatsApp (Meta Cloud API)
1. Create a Meta app with WhatsApp; get a permanent token and the phone number id.
2. Set `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_VERIFY_TOKEN` (any random string), `WHATSAPP_APP_SECRET` (App settings → Basic) and `WHATSAPP_DEFAULT_CLINIC_SLUG`.
3. Webhook URL: `https://<api-host>/api/webhooks/whatsapp`, verify token as above, subscribe to `messages`.
4. Approve message templates for reminders outside the 24-hour window.

### Email (Resend) / SMS (Twilio)
`EMAIL_API_KEY` + `EMAIL_FROM` (verified domain); `SMS_API_KEY=ACCOUNT_SID:AUTH_TOKEN` + `SMS_FROM`.

### Billing (Stripe)
1. Create three products (Starter, Professional, Clinic) with a monthly and a yearly recurring price each (USD 49/490, 149/1,490, 399/3,990 — or your own prices; keep `plan-catalog.ts` in sync for the pricing page).
2. Set `STRIPE_SECRET_KEY` and the six `STRIPE_PRICE_<PLAN>_<MONTHLY|YEARLY>` ids. They are synced into the `plans` table on boot.
3. Webhook endpoint `https://<api-host>/api/webhooks/stripe` with events `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.paid`, `invoice.payment_failed`; set `STRIPE_WEBHOOK_SECRET`.
4. Enable the Customer Portal in Stripe (used by “Manage payment method”).
5. Test in Stripe test mode first (`sk_test_…`), e.g. with `stripe listen --forward-to localhost:3000/api/webhooks/stripe`.

Plan limits (doctors, users, AI conversations, knowledge sources, WhatsApp) are enforced by `BillingService`; AI usage per conversation is metered in `usage_records` for overage billing.

## CI/CD

`.github/workflows/ci.yml` runs on every pull request and on `main`: install → lint → typecheck → tests (with a pgvector Postgres service) → build, then builds both Docker images. To deploy, add a job that pushes the images to your registry and rolls them out (Fly.io, Render, Railway, ECS, Cloud Run, Kubernetes…). Run the backend with at least 512 MB RAM.

## Operations

- **Health:** `GET /api/health` → `{ status, database, queue }`; use it for readiness probes.
- **Logs:** Nest logs to stdout; every request has an `X-Request-Id` (echoed in the response and stored in audit entry metadata).
- **Backups:** daily Postgres snapshots + PITR; test restores.
- **Scaling knobs:** `DATABASE_POOL_MAX`, backend replicas, BullMQ concurrency, `AI_MAX_TOOL_ITERATIONS`, `RATE_LIMIT_*`.

## v3 operations checklist

- Set `TRUST_PROXY=1` behind Render/Vercel/nginx.
- Optional: `SENTRY_DSN`, `VAPID_*` (web push), `TWILIO_AUTH_TOKEN` (voice), `VIDEO_BASE_URL`.
- Stripe: add the `checkout.session.completed` event (used for deposits too) to the webhook endpoint.
- WhatsApp multi-tenant: one Meta app webhook for the platform; each clinic saves its Phone number ID (and optionally its own token) in Settings → Integrations.
- Twilio voice: number → *A call comes in* → `POST {API_URL}/api/webhooks/voice/{slug}/incoming`.
- Backups: `scripts/backup.sh` from cron/CI, or `docker compose --profile backup up -d`; test `scripts/restore.sh` regularly.
- Health: monitor `GET /api/health/deep`.
- Render free instances sleep: first requests/webhooks can take ~50 s and background jobs (reminders, waitlist offers, billing sweep) pause while asleep — use an always-on instance for production.
