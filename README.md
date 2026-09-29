<p align="center">
  <img src="frontend/public/logo.svg" alt="Alejandro AI" height="56" />
</p>

<h3 align="center">AI Clinic Operations Assistant</h3>
<p align="center"><em>Your intelligent clinic assistant.</em></p>

---

**Alejandro AI** is a multi-tenant SaaS that gives clinics an AI receptionist and an operations console. The agent answers questions, looks up doctors and availability, books, reschedules and cancels appointments, captures leads, sends reminders and hands conversations to a human when it should. It works 24/7 on web chat, is ready for WhatsApp, and never acts as a doctor.

The whole product runs locally **without any API key**. Every external integration (LLMs, Google Calendar, WhatsApp, Stripe, email, SMS) has a real adapter plus a mock that is used when credentials are missing.

## Contents

- [Highlights](#highlights)
- [Quick start](#quick-start)
- [Demo accounts & demo flow](#demo-accounts--demo-flow)
- [Architecture](#architecture)
- [Stack](#stack)
- [AI agent, tool calling & RAG](#ai-agent-tool-calling--rag)
- [Integrations](#integrations)
- [Pricing plans](#pricing-plans)
- [Environment](#environment)
- [Database](#database)
- [Tests & quality](#tests--quality)
- [Docker](#docker)
- [Deployment](#deployment)
- [Security notes](#security-notes)
- [Architecture decisions](#architecture-decisions)

## Highlights

| Area | What you get |
|---|---|
| **AI receptionist** | Agent loop: intent → policy engine → tool selection → validated tool execution → grounded response → audit. 24 explicit tools, no DB/SQL/filesystem access for the model. |
| **Agent observability** | AI Playground + trace panel: intent, confidence, policy decision, retrieved documents, every tool call with arguments/result/latency, tokens, cost, provider/model. |
| **Scheduling** | Doctors, schedules, breaks, time off, services with durations; real-time slot engine; Postgres exclusion constraint that makes double booking impossible even under races. |
| **Knowledge / RAG** | PDF, DOCX, TXT, FAQ, free text and URLs → normalize → chunk → embed → pgvector (HNSW) → hybrid retrieval with citations. Dynamic data is never answered from RAG. |
| **Human handoff** | Automatic and requested handoffs with a factual summary, urgency and a reception queue in real time (Socket.IO). |
| **Multi-tenancy & RBAC** | Organization → clinic isolation enforced centrally (AsyncLocalStorage tenant context + scoped queries). Six roles, 31 granular permissions checked in the backend. |
| **Patient portal** | Mobile-first app: book, cancel, reschedule, chat, profile and notification preferences. |
| **Operations** | Dashboard KPIs, analytics, notifications (in-app, email, WhatsApp, SMS), audit log, usage & AI cost tracking. |
| **Billing-ready** | Starter / Professional / Clinic plans, trials, limits, usage metering, invoices, Stripe adapter (Checkout, Portal, signed webhooks). |
| **UX** | Light/dark mode, Spanish/English, command palette (⌘K), skeletons, empty states, PWA, responsive from 320 px to 4K. |
| **Motion** | Cinematic landing: WebGL “tide” shader hero, masked headline reveals, 3D product tilt on scroll, momentum smooth scroll (Lenis), pinned scroll-scrubbed agent walkthrough, horizontal feature gallery, sticky stacking cards, scroll-lit statement, count-ups, magnetic buttons, cursor spotlight. In the app: page transitions, staggered KPIs and animated numbers. Everything turns off with *Reduce motion* (OS or in-app). |
| **Accessibility** | Semantic HTML, keyboard navigation, focus management, WCAG-aware contrast, high-contrast mode, text scaling up to 150 %, dyslexia/low-vision friendly font, underlined links, reduced motion, read-aloud for chat messages and voice dictation. |

## Quick start

Requirements: **Node 22+**, **PostgreSQL 16 with pgvector**, **Redis 7** (optional — jobs run in-process without it). Or just use Docker (below).

```bash
npm install
cp .env.example backend/.env           # works as-is for local development
npm run db:migrate                     # creates extensions, tables, constraints, indexes
npm run db:seed                        # NovaCare Medical Center demo data
npm run dev                            # API on :3000, web app on :5173
```

- Web app: http://localhost:5173
- API docs (Swagger): http://localhost:3000/api/docs
- Health: http://localhost:3000/api/health

> Need Postgres + Redis quickly? `docker compose up -d postgres redis` starts only the databases.

## Demo accounts & demo flow

All demo users share the password **`NovaCare2026!`**.

| Role | Email | Lands on |
|---|---|---|
| Clinic admin | `admin@novacare.co` | Dashboard |
| Receptionist | `recepcion@novacare.co` | Dashboard (handoff queue) |
| Doctor | `carlos.perez@novacare.co` | Dashboard (own agenda) |
| Patient | `maria.rodriguez@example.com` | Patient portal |
| Other tenant (isolation demo) | `admin@aurora.mx` | Clínica Aurora dashboard |

The login screen has one-click buttons for these accounts.

**Mandatory demo flow**

1. Sign in as the clinic admin → NovaCare dashboard with live KPIs and charts.
2. **Médicos** → Dr. Carlos Pérez (Cardiología), Dra. María García (Dermatología), Dr. Juan Rodríguez (Ortopedia).
3. **Citas** → list, calendar and detail views.
4. **AI Playground** → pick the patient *María Rodríguez* and write *“Hola, necesito una cita con dermatología esta semana.”* The trace shows `getDoctors → getAvailableAppointmentSlots`; slot cards appear.
5. Pick a slot → confirmation dialog → `createAppointment` → confirmation card. The appointment appears in the dashboard in real time.
6. *“Quiero cancelar mi cita.”* → `listPatientAppointments` → confirm → `cancelAppointment`.
7. *“¿Qué servicios ofrece la clínica?”* → `searchClinicKnowledge` (pgvector) + `getServices`, answer with citations.
8. *“Quiero hablar con una persona.”* → `requestHumanHandoff`; the conversation appears in **Conversaciones → Cola de recepción** with a factual summary.

The Playground also includes one-click scenarios (reschedule, emergency, pricing, cancellation policy, English patient…).

## Architecture

```
┌──────────────────────────── Frontend (React + Vite, PWA) ─────────────────────────────┐
│ Landing · Auth · Staff console · AI Playground · Patient portal · Public web chat     │
└───────────────▲─────────────────────────────── REST /api + Socket.IO ─────────────────┘
                │
┌───────────────┴──────────────────────── Backend (NestJS) ─────────────────────────────┐
│ Presentation   controllers (thin) · guards (JWT, RBAC) · zod pipes · envelope/filters  │
│ Application    services: appointments, doctors, patients, conversations, knowledge…   │
│ Domain         slot engine · policy engine · intent classifier · validators · RBAC    │
│ AI layer       orchestrator · prompt builder · tool registry · memory · usage/cost    │
│ Infrastructure LLMProvider · CalendarProvider · WhatsAppProvider · Email/SMS ·        │
│                BillingProvider · EmbeddingProvider  (real adapters + mocks)            │
└───────▲──────────────────────▲─────────────────────────▲──────────────────────────────┘
        │                      │                         │
  PostgreSQL 16 + pgvector   Redis (cache, BullMQ)   External APIs (optional)
```

- **Tenant isolation:** a request-scoped `TenantContext` (AsyncLocalStorage) is filled by the JWT guard. Data access goes through `tenantScope()` / `withTenant()` helpers, so every query is filtered by `organization_id` + `clinic_id` and every insert is stamped. Cross-tenant ids simply return 404.
- **Background jobs:** knowledge ingestion, reminders and notification delivery run on BullMQ (Redis) or an inline driver (tests / no Redis).
- **Realtime:** Socket.IO rooms per clinic (staff) and per patient; the dashboard, handoff queue and notifications update live.

Details: [docs/architecture.md](docs/architecture.md).

## Stack

| Layer | Technology |
|---|---|
| Frontend | React 19, TypeScript, Vite 7, React Router 7, Tailwind CSS 3, TanStack Query 5, React Hook Form + Zod, Headless UI, react-icons, Recharts, socket.io-client, GSAP (ScrollTrigger, SplitText) + Lenis for motion |
| Backend | NestJS 11, TypeScript, Drizzle ORM, PostgreSQL 16 + pgvector, Redis + BullMQ, Socket.IO, Swagger/OpenAPI, JWT + rotating refresh tokens, argon2id, Zod, helmet, throttler |
| AI | Provider-agnostic `LLMProvider` (OpenAI, Anthropic, Gemini, deterministic Mock), explicit tool calling, local or OpenAI embeddings |
| Quality | Jest (unit + e2e with a real Postgres), Vitest + Testing Library, ESLint (typescript-eslint, react-hooks, jsx-a11y), GitHub Actions |
| Delivery | Docker multi-stage images, nginx for the SPA, docker compose |

## AI agent, tool calling & RAG

```
User message
  → Conversation service (persist, language detection, short-term memory)
  → Intent classifier (ES/EN, entities: specialty, doctor, dates, contact data)
  → Policy engine (emergency bypass · medical guardrail · forced handoff · low confidence)
  → Orchestrator loop (≤ AI_MAX_TOOL_ITERATIONS)
        LLM proposes tool calls → registry validates (allow-list, RBAC, patient ownership, zod input)
        → tool executes through application services → zod-validated output → ToolExecution + audit log
  → Response validator (no unverified bookings/prices, no diagnosis)
  → Attachments generated from tool results (slot / doctor / appointment cards, citations)
  → Usage & cost record → audit
```

- **Tools (24):** `searchClinicKnowledge`, `getClinicInformation`, `getBusinessHours`, `getClinicLocations`, `getServices`, `getServiceInformation`, `getDoctors`, `getDoctorProfile`, `getDoctorAvailability`, `getAvailableAppointmentSlots`, `createAppointment`, `rescheduleAppointment`, `cancelAppointment`, `getAppointment`, `listPatientAppointments`, `getPatient`, `createPatient`, `updatePatient`, `createLead`, `sendAppointmentReminder`, `requestHumanHandoff`, `createSupportTicket`, `getConversationHistory`, `summarizeConversation`. Each has a description, zod input and output schemas, a required permission, a timeout, logging and typed errors. Clinics can disable tools in **Settings → AI**.
- **Dynamic vs. static data:** availability, appointments and patient data come only from tools. RAG covers policies, services, FAQs and general information.
- **RAG:** chunks (≈ 900 chars, overlap) with 384-dim embeddings in pgvector (HNSW, cosine) + full-text keyword score; hybrid ranking (0.7 vector + 0.3 keyword) with a relevance threshold; answers cite their sources.
- **Providers:** per-clinic provider, model, temperature and max tokens, configured only in the backend. Timeouts, retries and a circuit breaker; a provider without a configured key transparently falls back to the mock, and a provider that keeps failing produces a safe apology message plus a traced error instead of a broken conversation.
- **Memory:** short-term (recent turns of the conversation, token-budgeted), long-term (allowed administrative preferences only), knowledge (RAG), operational state (database). Full transcripts are not used as permanent memory.

Details: [docs/ai-agent.md](docs/ai-agent.md).

## Integrations

| Integration | Real adapter | Without credentials |
|---|---|---|
| LLM | OpenAI, Anthropic, Gemini | `MockLLMProvider` — deterministic agent with the same tool-calling policy |
| Embeddings | OpenAI `text-embedding-3-small` (384 dims) | Local hashing embeddings (offline, cross-lingual concept groups) |
| Calendar | Google Calendar (OAuth, free/busy, events) · Microsoft & Internal providers | `MockCalendarProvider` |
| WhatsApp | Meta Cloud API (send, templates, signed webhooks) | `MockWhatsAppProvider` + simulator in Settings → Integrations |
| Email / SMS | Resend / Twilio | Mock outbox visible in the UI |
| Billing | Stripe (Checkout, Billing Portal, signed webhooks) | Mock billing provider |

## Pricing plans

Plans live in one catalog (`backend/src/billing/plan-catalog.ts`) and are synced to the database; business code only asks the billing service for limits and features.

| Plan | Monthly | Yearly | Doctors / staff users | AI conversations / month | Knowledge sources | Highlights |
|---|---|---|---|---|---|---|
| **Starter** | USD 49 | USD 490 | 3 / 3 | 500 | 20 | Web chat receptionist, AI booking, knowledge base, patient portal, basic analytics, email notifications |
| **Professional** ⭐ | USD 149 | USD 1,490 | 15 / 15 | 3,000 | 200 | + WhatsApp channel, calendar sync, human handoff queue, advanced analytics, WhatsApp/SMS reminders, audit log |
| **Clinic** | USD 399 | USD 3,990 | Unlimited | 15,000 | Unlimited | + multi-location, custom branding, API access, priority support, dedicated onboarding |

New organizations get a 14-day trial. Overage is metered at USD 0.04 per AI conversation. To charge real money set `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET`, create the Stripe prices and point the webhook to `/api/webhooks/stripe` — see [docs/deployment.md](docs/deployment.md#billing-stripe).

## Environment

Copy [`.env.example`](.env.example). Required: `DATABASE_URL`, `JWT_SECRET`, `JWT_REFRESH_SECRET` (≥ 32 chars), `ENCRYPTION_KEY` (64 hex). Everything else is optional; the app validates the environment at boot and refuses to start with an invalid configuration.

## Database

- Schema: [`backend/src/database/schema.ts`](backend/src/database/schema.ts) (Drizzle) — organizations, clinics, locations, users, memberships, roles, permissions, doctors, schedules, time off, specialties, services, patients, appointments, calendar integrations, conversations, messages, agents, agent tools, tool executions, knowledge sources/chunks (vector), leads, handoffs, support tickets, notifications, audit logs, webhook events, plans, subscriptions, invoices, usage records.
- Migrations: [`backend/src/database/migrations`](backend/src/database/migrations) — extensions (`vector`, `btree_gist`, `pgcrypto`), tables and indexes, and hand-written constraints (no-overlap exclusion constraint, CHECKs, full-text index).
- Commands: `npm run db:migrate`, `npm run db:seed`, `npm run db:reset`, `npm run db:generate --workspace backend` (after schema changes).

## Tests & quality

```bash
npm run lint        # ESLint (backend + frontend)
npm run typecheck   # tsc, strict
npm test            # backend unit + e2e, frontend Vitest
npm run build       # nest build + vite build
```

- Backend **unit**: slot engine, intent classifier, policy engine, response validator, text processing & chunking, crypto, mock LLM tool policy, WhatsApp rendering.
- Backend **e2e** (real Postgres + pgvector; the test database `alejandro_test` is created, migrated and seeded automatically): auth (login, refresh rotation, reuse detection), RBAC, tenant isolation, booking, calendar conflicts and concurrent races, cancel, reschedule, the full AI demo flow, safety policies, knowledge ingestion & retrieval, WhatsApp webhook idempotency and signatures, public web chat, billing.
- Frontend: form validation, chat slot selection → confirmation → booking action, composer, preferences (theme, language, accessibility), i18n parity, data table.

Set `TEST_DATABASE_URL` to use another database for e2e tests.

## Docker

```bash
cp .env.example .env     # optional: add real keys here
docker compose up --build
```

- App: http://localhost:8080 (nginx serves the SPA and proxies `/api` and `/socket.io`)
- API: http://localhost:3000/api/docs
- The backend applies migrations on start and loads the demo data **only into an empty database** (`SEED_DEMO_DATA=true`, default in compose).

## Deployment

Build the two images, provide managed PostgreSQL (with pgvector) and Redis, set secrets through your platform’s secret manager and run the backend behind TLS. See [docs/deployment.md](docs/deployment.md).

## Security notes

Argon2id password hashing · short-lived access tokens + httpOnly rotating refresh cookies with reuse detection · RBAC enforced server-side · tenant isolation · AES-256-GCM encryption for integration secrets · helmet, CORS allow-list, rate limiting · zod validation on every input · signed webhooks (Meta, Stripe) with idempotency · SSRF protection for URL ingestion · audit log for sensitive actions · the LLM only reaches data through permissioned tools.

This project provides technical safeguards that help with privacy programs, but **it does not by itself make a deployment HIPAA, GDPR or Ley 1581 compliant**; compliance depends on your hosting, contracts (BAA/DPA), processes and jurisdiction. See [docs/security.md](docs/security.md).

## Architecture decisions

| # | Decision | Why |
|---|---|---|
| ADR-1 | **Drizzle ORM instead of Prisma** | The spec asked for Prisma, but Prisma’s engine binaries could not be downloaded in the build environment (binaries.prisma.sh blocked), which would also break air-gapped CI/Docker builds. Drizzle is pure TypeScript, has first-class pgvector support, SQL-safe query building and SQL migrations we can extend by hand (exclusion constraints). The schema maps 1:1 to the requested entities. |
| ADR-2 | Deterministic mock LLM | The product must work end-to-end without keys; the mock follows the same tool-calling contract as real providers, which also makes the agent testable. |
| ADR-3 | Local hashing embeddings by default | Offline, deterministic, zero cost; switch to OpenAI embeddings with one variable. Both use 384 dimensions so the index does not change. |
| ADR-4 | DB exclusion constraint for bookings | Application checks give good errors; the constraint guarantees no double booking under concurrency. |
| ADR-5 | Refresh token in httpOnly cookie, access token in memory | Limits XSS impact and supports silent refresh with rotation and theft detection. |
| ADR-6 | Zod everywhere | One schema language for DTO validation, tool input/output contracts, OpenAPI and frontend forms. |

## Repository layout

```
alejandro-ai/
├─ backend/            NestJS API (src/<module>, test/ e2e, Dockerfile)
├─ frontend/           React app (src/features/<feature>, public/ PWA assets, nginx.conf, Dockerfile)
├─ docs/               architecture · ai-agent · api · security · deployment
├─ docker-compose.yml
├─ .github/workflows/ci.yml
└─ .env.example
```
