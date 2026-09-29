# API

Base URL: `/api`. Interactive OpenAPI documentation: **`/api/docs`** (JSON: `/api/docs-json`), generated from the same zod schemas that validate requests.

## Conventions

- **Auth:** `Authorization: Bearer <accessToken>` (15 min). The refresh token is an httpOnly cookie `aai_rt` scoped to `/api/auth`, rotated on every `POST /api/auth/refresh`.
- **Tenant:** derived from the token; never sent by the client.
- **Success envelope:** `{ "success": true, "data": … }`. Paginated lists return `{ "success": true, "data": [ … ], "meta": { "page", "pageSize", "total", "totalPages" } }` and accept `page`, `pageSize` (≤ 100) and `search`.
- **Error envelope:**

```json
{ "success": false, "error": { "code": "APPOINTMENT_CONFLICT", "message": "The selected time is no longer available", "details": {} } }
```

| HTTP | Typical codes |
|---|---|
| 400 | `VALIDATION_ERROR` (details lists each invalid field) |
| 401 | `UNAUTHORIZED`, `INVALID_CREDENTIALS`, `TOKEN_INVALID`, `REFRESH_REUSED`, `REFRESH_EXPIRED`, `INVALID_SIGNATURE`, `CHAT_SESSION_REQUIRED` |
| 402 | `PLAN_LIMIT_REACHED` (plan quota for doctors, users, knowledge sources or features) |
| 403 | `FORBIDDEN` (missing permission), `NOT_PLAYGROUND`, `TENANT_MISMATCH` |
| 404 | `NOT_FOUND` (also returned for other tenants’ ids) |
| 409 | `APPOINTMENT_CONFLICT`, `OUTSIDE_WORKING_HOURS`, `TOO_SOON`, `DOCTOR_UNAVAILABLE` (slot checks), `DUPLICATE` |
| 422 | Business rules: `APPOINTMENT_CLOSED`, `SERVICE_NOT_OFFERED`, `CALENDAR_NOT_CONFIGURED`, `CONVERSATION_CLOSED`, … |
| 429 | `RATE_LIMITED` |
| 5xx | `INTERNAL_ERROR`, `EXTERNAL_SERVICE_ERROR` (no internals leaked) |

- **Dates:** ISO-8601 UTC in and out; clinic time zone in `clinic.timezone`.
- **Rate limits:** global `RATE_LIMIT_MAX` per `RATE_LIMIT_TTL_MS`; stricter on login/register/refresh and public chat.

## Example: book through the API

```bash
TOKEN=$(curl -s localhost:3000/api/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"recepcion@novacare.co","password":"NovaCare2026!"}' | jq -r .data.accessToken)

curl -s "localhost:3000/api/appointments/slots?specialtyId=<id>&days=7" -H "Authorization: Bearer $TOKEN"

curl -s localhost:3000/api/appointments -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"doctorId":"<id>","patientId":"<id>","startTime":"2026-10-01T15:00:00.000Z"}'
```

## Example: talk to the agent

```bash
curl -s localhost:3000/api/ai/chat -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"message":"Hola, necesito una cita con dermatología esta semana.","patientId":"<id>"}'
# → data.assistantMessage (content + attachments), data.trace (intent, policy, steps, tokens, cost)
# Continue with data.conversationId; send card actions as
#   {"conversationId":"…","message":"…","action":{"type":"book_slot","doctorId":"…","startTime":"…"}}
```

## Public web chat (no login)

1. `POST /api/public/chat/{slug}/session` → `{ sessionToken, conversationId, welcome }` (store the token client-side).
2. `POST /api/public/chat/{slug}/messages` with header `X-Chat-Session: <token>` and `{ "message": "…" }`.
Traces are never returned on public endpoints.

## Webhooks

| Endpoint | Verification |
|---|---|
| `GET /api/webhooks/whatsapp` | Meta subscription challenge (`hub.verify_token` = `WHATSAPP_VERIFY_TOKEN`) |
| `POST /api/webhooks/whatsapp` | `X-Hub-Signature-256` HMAC-SHA256 of the raw body with `WHATSAPP_APP_SECRET`; idempotent by message id |
| `POST /api/webhooks/stripe` | `Stripe-Signature` (timestamped HMAC, 5-minute tolerance) with `STRIPE_WEBHOOK_SECRET`; idempotent by event id |

## Endpoints

### AI

| Method | Path | Notes |
|---|---|---|
| `POST` | `/api/ai/chat` | Talk to Alejandro AI as a patient (playground). Returns the full observability trace. |
| `POST` | `/api/ai/playground/start` |  |
| `GET` | `/api/ai/playground/scenarios` |  |
| `GET` | `/api/ai/config` |  |
| `PATCH` | `/api/ai/config` |  |
| `GET` | `/api/ai/tools` |  |
| `PATCH` | `/api/ai/tools/{name}` |  |
| `POST` | `/api/conversations/{id}/summary` |  |
| `GET` | `/api/ai/usage` |  |

### Analytics

| Method | Path | Notes |
|---|---|---|
| `GET` | `/api/analytics/overview` |  |
| `GET` | `/api/analytics/timeseries` |  |
| `GET` | `/api/analytics/insights` |  |
| `GET` | `/api/analytics/recent-activity` |  |

### Appointments

| Method | Path | Notes |
|---|---|---|
| `GET` | `/api/appointments` |  |
| `POST` | `/api/appointments` |  |
| `GET` | `/api/appointments/slots` | Real-time available slots (schedule − time off − appointments − external calendar) |
| `GET` | `/api/appointments/{id}` |  |
| `PATCH` | `/api/appointments/{id}` |  |
| `DELETE` | `/api/appointments/{id}` |  |
| `POST` | `/api/appointments/{id}/reschedule` |  |
| `POST` | `/api/appointments/{id}/cancel` |  |

### Audit

| Method | Path | Notes |
|---|---|---|
| `GET` | `/api/audit-logs` |  |

### Auth

| Method | Path | Notes |
|---|---|---|
| `POST` | `/api/auth/login` | Email + password login |
| `POST` | `/api/auth/register` | Create an account, organization and clinic (starts a trial) |
| `POST` | `/api/auth/patient/register` | Patient portal self-registration |
| `POST` | `/api/auth/refresh` | Rotate the refresh cookie and get a new access token |
| `POST` | `/api/auth/logout` |  |
| `GET` | `/api/auth/me` |  |
| `PATCH` | `/api/auth/me` |  |
| `POST` | `/api/auth/change-password` |  |

### Billing

| Method | Path | Notes |
|---|---|---|
| `GET` | `/api/billing/plans` |  |
| `GET` | `/api/billing/overview` |  |
| `POST` | `/api/billing/checkout` |  |
| `POST` | `/api/billing/portal` |  |
| `POST` | `/api/billing/cancel` |  |

### Calendars

| Method | Path | Notes |
|---|---|---|
| `GET` | `/api/calendars/integrations` |  |
| `POST` | `/api/calendars/connect` |  |
| `POST` | `/api/calendars/google/auth-url` |  |
| `GET` | `/api/calendars/google/callback` |  |
| `DELETE` | `/api/calendars/integrations/{id}` |  |

### Clinics

| Method | Path | Notes |
|---|---|---|
| `GET` | `/api/clinics` |  |
| `GET` | `/api/clinics/current` |  |
| `PATCH` | `/api/clinics/current` |  |
| `POST` | `/api/clinics/current/onboarding/complete` |  |
| `GET` | `/api/locations` |  |
| `POST` | `/api/locations` |  |
| `PATCH` | `/api/locations/{id}` |  |
| `DELETE` | `/api/locations/{id}` |  |
| `GET` | `/api/specialties` |  |
| `POST` | `/api/specialties` |  |
| `PATCH` | `/api/specialties/{id}` |  |
| `DELETE` | `/api/specialties/{id}` |  |
| `GET` | `/api/services` |  |
| `POST` | `/api/services` |  |
| `PATCH` | `/api/services/{id}` |  |
| `DELETE` | `/api/services/{id}` |  |

### Conversations

| Method | Path | Notes |
|---|---|---|
| `GET` | `/api/conversations` |  |
| `GET` | `/api/conversations/{id}` |  |
| `POST` | `/api/conversations/{id}/messages` |  |
| `POST` | `/api/conversations/{id}/status` |  |
| `GET` | `/api/handoffs` |  |
| `POST` | `/api/handoffs/{id}/assign` |  |
| `POST` | `/api/handoffs/{id}/resolve` |  |

### Doctors

| Method | Path | Notes |
|---|---|---|
| `GET` | `/api/doctors` |  |
| `POST` | `/api/doctors` |  |
| `GET` | `/api/doctors/{id}` |  |
| `PATCH` | `/api/doctors/{id}` |  |
| `DELETE` | `/api/doctors/{id}` |  |
| `GET` | `/api/doctors/{id}/availability` |  |
| `PUT` | `/api/doctors/{id}/schedule` |  |
| `POST` | `/api/doctors/{id}/time-off` |  |
| `DELETE` | `/api/doctors/{id}/time-off/{timeOffId}` |  |

### Health

| Method | Path | Notes |
|---|---|---|
| `GET` | `/api/health` |  |

### Knowledge

| Method | Path | Notes |
|---|---|---|
| `GET` | `/api/knowledge/documents` |  |
| `POST` | `/api/knowledge/documents` |  |
| `GET` | `/api/knowledge/stats` |  |
| `GET` | `/api/knowledge/search` |  |
| `GET` | `/api/knowledge/documents/{id}` |  |
| `PATCH` | `/api/knowledge/documents/{id}` |  |
| `DELETE` | `/api/knowledge/documents/{id}` |  |
| `POST` | `/api/knowledge/text` |  |
| `POST` | `/api/knowledge/faq` |  |
| `POST` | `/api/knowledge/url` |  |
| `POST` | `/api/knowledge/documents/{id}/reprocess` |  |

### Notifications

| Method | Path | Notes |
|---|---|---|
| `GET` | `/api/notifications` |  |
| `GET` | `/api/notifications/unread-count` |  |
| `POST` | `/api/notifications/{id}/read` |  |
| `POST` | `/api/notifications/read-all` |  |
| `GET` | `/api/notifications/deliveries` |  |

### Patient portal

| Method | Path | Notes |
|---|---|---|
| `GET` | `/api/portal/me` |  |
| `PATCH` | `/api/portal/me` |  |
| `GET` | `/api/portal/appointments` |  |
| `POST` | `/api/portal/appointments` |  |
| `GET` | `/api/portal/doctors` |  |
| `GET` | `/api/portal/services` |  |
| `GET` | `/api/portal/specialties` |  |
| `GET` | `/api/portal/slots` |  |
| `POST` | `/api/portal/appointments/{id}/cancel` |  |
| `POST` | `/api/portal/appointments/{id}/reschedule` |  |
| `POST` | `/api/portal/chat` |  |
| `GET` | `/api/portal/chat` |  |

### Patients

| Method | Path | Notes |
|---|---|---|
| `GET` | `/api/patients` |  |
| `POST` | `/api/patients` |  |
| `GET` | `/api/patients/{id}` |  |
| `PATCH` | `/api/patients/{id}` |  |
| `DELETE` | `/api/patients/{id}` |  |

### Public

| Method | Path | Notes |
|---|---|---|
| `GET` | `/api/public/clinics/{slug}` |  |
| `POST` | `/api/public/chat/{slug}/session` |  |
| `POST` | `/api/public/chat/{slug}/messages` |  |
| `GET` | `/api/public/chat/{slug}/messages` |  |

### Team

| Method | Path | Notes |
|---|---|---|
| `GET` | `/api/team` |  |
| `POST` | `/api/team` |  |
| `GET` | `/api/team/roles` |  |
| `PATCH` | `/api/team/{membershipId}` |  |
| `DELETE` | `/api/team/{membershipId}` |  |

### WhatsApp

| Method | Path | Notes |
|---|---|---|
| `GET` | `/api/webhooks/whatsapp` |  |
| `POST` | `/api/webhooks/whatsapp` | WhatsApp Cloud API webhook (X-Hub-Signature-256 validated when configured) |
| `GET` | `/api/integrations/whatsapp` |  |
| `POST` | `/api/integrations/whatsapp/simulate |` |  |
| `POST` | `/api/webhooks/stripe` | Stripe events (hidden from Swagger) |
