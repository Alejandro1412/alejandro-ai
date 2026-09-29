# Architecture

## Goals

Correctness and security first, then maintainability, UX, performance and scalability. The system is a modular monolith: one deployable API with strict module boundaries, one SPA, PostgreSQL as the system of record and Redis for cache and jobs. It can be split into services later along the module seams without changing the domain code.

## High-level view

```
Browser (SPA / PWA)                    WhatsApp (Meta)        Stripe
   │  REST /api   Socket.IO               │ webhooks           │ webhooks
   ▼                                      ▼                    ▼
┌──────────────────────────── NestJS API ─────────────────────────────┐
│ Middleware: request id + TenantContext (AsyncLocalStorage)           │
│ Guards:     Throttler → JwtAuth (fills tenant) → Permissions (RBAC)  │
│ Pipes:      zod validation   Interceptor: { success, data } envelope │
│ Filter:     typed errors → { success:false, error:{code,message,…} } │
├──────────────────────────────────────────────────────────────────────┤
│ auth · clinics · users(team) · doctors · patients · appointments     │
│ calendars · conversations · knowledge · ai · notifications · whatsapp│
│ analytics · audit · billing · usage · portal · public · health       │
├──────────────────────────────────────────────────────────────────────┤
│ Ports (interfaces) + adapters: LLMProvider, EmbeddingProvider,       │
│ CalendarProvider, WhatsAppProvider, EmailProvider, SmsProvider,      │
│ BillingProvider — each with a real adapter and a mock                │
└────────┬───────────────────────────┬──────────────────────┬──────────┘
         ▼                           ▼                      ▼
 PostgreSQL 16 + pgvector      Redis (cache, BullMQ)   Google / Microsoft / OpenAI / Anthropic / Gemini …
```

## Layers

| Layer | Where | Rules |
|---|---|---|
| Presentation | `*.controller.ts`, guards, pipes, interceptors | Thin: parse → authorize → call one service method. No business logic, no queries. |
| Application | `*.service.ts` | Use cases and transactions. Emits audit events, notifications and realtime events. |
| Domain | `appointments/slot-engine.ts`, `ai/policy/*`, `rbac/permissions.ts`, `knowledge/text-processing.ts` | Pure functions, no I/O, fully unit tested. |
| Infrastructure | `database/`, `*/providers/*`, `ai/llm/*`, `ai/embeddings/*`, `jobs/` | Adapters behind interfaces; the domain never imports an SDK. |

The AI layer (`src/ai`) depends on application services only through the tool registry (`ai/tools/tool-deps.ts`). It never imports the database module directly.

## Multi-tenancy

- Model: `Organization → Clinic → (locations, doctors, staff memberships, patients, appointments, conversations, knowledge, settings)`. Every tenant-owned table carries `organization_id` and `clinic_id`.
- `ContextMiddleware` opens an `AsyncLocalStorage` store per request; `JwtAuthGuard` verifies the token and assigns `{ organizationId, clinicId, principal }`.
- Services build queries with `tenantScope(table, …conditions)` and inserts with `withTenant(values)`; both read the current context and throw if it is missing. There is no code path that takes a tenant id from the request body.
- Cross-tenant ids return `404` (never `403`) so existence is not leaked. E2E tests assert this for patients, doctors, appointments, knowledge and public chat sessions.
- Background jobs carry the tenant ids in their payload and re-enter `TenantContext.run(...)` before executing.
- Postgres row-level security can be layered on later using the same columns (see security.md).

## RBAC

`rbac/permissions.ts` is the single source of truth (31 permissions, 6 roles). Roles are synced into `roles / permissions / role_permissions` at boot and seed time; `RbacService` caches resolved permission sets. Controllers declare `@RequirePermissions(...)`; `PermissionsGuard` enforces them. The AI agent runs as the `AI_AGENT` role with least privilege and each tool declares the permission it needs. Patients (`PATIENT`) can only reach `/portal/*` and only their own records (ownership checks in the service layer).

## Scheduling

- `slot-engine.ts` computes candidate slots from weekly schedules (ISO weekday, multiple blocks per day = breaks), minus time off, minus existing `PENDING/CONFIRMED` appointments, minus external calendar busy times, respecting clinic booking rules (minimum notice, max days ahead, step) in the clinic time zone (Luxon).
- `AvailabilityService.assertBookable` re-checks a slot at write time and returns typed reasons (`SLOT_TAKEN`, `OUTSIDE_WORKING_HOURS`, `TOO_SOON`, …).
- The race window between check and insert is closed by `EXCLUDE USING gist (doctor_id WITH =, tstzrange(start_time, end_time) WITH &&) WHERE status IN ('PENDING','CONFIRMED')`. Violations become `409 APPOINTMENT_CONFLICT`.
- Rescheduling is a transaction: the old appointment becomes `RESCHEDULED`, a new `CONFIRMED` appointment links to it via `rescheduled_from_id`; the calendar event is moved.
- Calendar providers (`Mock`, `Internal`, `Google`, `Microsoft`) implement `getAvailability / getEvents / createEvent / updateEvent / deleteEvent`. External calendar failures never block a booking; they are logged and retried.

## Knowledge pipeline

`upload/text/FAQ/URL → extract (pdf-parse, mammoth, HTML→text) → normalize → chunk (≈900 chars, 150 overlap, heading-aware) → embed (384 dims) → store (knowledge_chunks.embedding vector(384), HNSW cosine) → retrieve (hybrid vector + full-text) → filter (threshold, enabled sources only, tenant) → cite`. Processing runs as a background job and the source moves through `UPLOADING → PROCESSING → INDEXED | FAILED` (`DISABLED` when turned off).

## Realtime

`RealtimeGateway` authenticates the Socket.IO handshake with the access token and joins `clinic:<id>` (staff) or `patient:<id>` rooms. `EventsService` publishes `appointment.*`, `conversation.*`, `handoff.*` and `notification.created`; the SPA invalidates the matching TanStack Query caches.

## Background jobs

`QueueService` abstracts BullMQ. Queues: knowledge ingestion, notification delivery, reminder sweep (repeatable). Without `REDIS_URL` (or with `QUEUE_DRIVER=inline`) jobs run in-process — used by tests and minimal installs.

## Error handling & resilience

- Typed errors (`AppError` subclasses: validation, not found, forbidden, conflict, business rule, external service) are mapped by `AllExceptionsFilter` to `{ success:false, error:{ code, message, details } }`. Unknown errors become `INTERNAL_ERROR` without leaking internals.
- External calls use `withTimeout`, `retry` (exponential backoff for retryable HTTP) and a `CircuitBreaker` per provider.
- The SPA has route-level error boundaries, query retries for idempotent reads and toasts for mutations.

## Frontend

- Feature folders (`src/features/<feature>`), shared UI kit (`src/components/ui`), chat components, charts, layouts.
- Data: TanStack Query with typed API client (`lib/api.ts`) that stores the access token in memory and refreshes it through the httpOnly cookie.
- Routing: lazy-loaded routes with `RequireAuth` for staff/patient areas and permission-aware navigation (the backend remains the authority).
- Design system: CSS variables for light, dark and high-contrast themes consumed by Tailwind tokens; charts use a colorblind-validated palette.
- PWA: manifest, icons, service worker that caches the app shell and never caches `/api`.
- Motion (`src/lib/motion`): GSAP + ScrollTrigger + SplitText and Lenis are loaded only by the landing chunk. `useGsap` scopes every tween to a component and reverts it on unmount; `useMotionEnabled` combines the OS `prefers-reduced-motion` setting with the in-app accessibility toggle, and every effect (shader, pins, reveals, count-ups, smooth scroll) falls back to a complete static layout when motion is off. App-wide effects (page transitions, spotlight, `AnimatedNumber`) are CSS/rAF based and add no library weight to the main bundle.

## Data model (main entities)

`users`, `organizations`, `clinics`, `locations`, `memberships`, `roles`, `permissions`, `role_permissions`, `refresh_tokens`, `specialties`, `services`, `doctors`, `doctor_services`, `doctor_schedules`, `time_off`, `patients`, `appointments`, `calendar_integrations`, `conversations`, `messages`, `agents`, `agent_tools`, `tool_executions`, `knowledge_sources`, `knowledge_chunks` (embedding), `leads`, `handoffs`, `support_tickets`, `notifications`, `audit_logs`, `webhook_events`, `plans`, `subscriptions`, `invoices`, `usage_records`. All have `created_at` / `updated_at` where relevant, UUID primary keys and composite indexes led by `organization_id` / `clinic_id`.
