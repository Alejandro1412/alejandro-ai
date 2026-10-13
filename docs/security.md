# Security & privacy

Alejandro AI may process personal and health-related administrative data (names, contact data, appointment reasons). Security is built into the design, not added at the end.

> **Compliance statement.** The platform provides technical controls that support privacy programs. It does **not** make a deployment automatically compliant with HIPAA, GDPR, Colombia’s Ley 1581, Mexico’s LFPDPPP or any other regulation. Compliance depends on hosting, contracts (BAA / DPA with every processor, including LLM vendors), policies, staff training and jurisdiction-specific requirements.

## Threat model (summary)

| Threat | Controls |
|---|---|
| Account takeover | argon2id hashing (19 MiB, t=2), login throttling, short-lived access tokens, rotating refresh tokens with reuse detection (a replayed token revokes the whole family), password change revokes sessions |
| XSS stealing sessions | Access token only in memory; refresh token in `httpOnly`, `SameSite=Strict`, `Secure` (production) cookie scoped to `/api/auth`; React escaping; strict CSP via helmet on the API; no `dangerouslySetInnerHTML` for user or model content |
| CSRF | `SameSite=Strict` refresh cookie; state-changing endpoints require a bearer token that a cross-site page cannot read |
| Cross-tenant access | Central `TenantContext`; all queries via `tenantScope()`; inserts via `withTenant()`; cross-tenant ids → 404; e2e tests for isolation |
| Privilege escalation | RBAC enforced by `PermissionsGuard` on every route; ownership checks for patients; admins cannot change their own role or remove themselves; UI hiding is cosmetic only |
| Prompt injection / tool abuse | The LLM has no SQL, DB, shell or filesystem access. It can only call allow-listed tools that run with `AI_AGENT` permissions, tenant scope and patient ownership checks; inputs and outputs are zod-validated; destructive actions need an explicit user confirmation action; emergencies and handoffs bypass the model |
| Hallucinated facts | Response validator rejects unverified confirmations, prices and diagnostic language; cards are built from tool data only |
| Data leakage to LLM vendors | Only the context needed for the turn is sent (allow-listed patient fields, recent turns); API keys stay server-side; the mock provider keeps data local |
| Webhook forgery / replay | Meta `X-Hub-Signature-256` and Stripe `Stripe-Signature` verified over the raw body (constant-time compare, timestamp tolerance for Stripe); events stored with unique `(provider, external_id)` for idempotency; rejected deliveries are audited |
| SSRF via URL ingestion | Only http/https, host resolved via DNS and rejected if any address is private, loopback, link-local or cloud-metadata; re-checked at fetch time (DNS rebinding); redirects refused; 15 s timeout and 2 MB cap |
| Malicious uploads | MIME/extension allow-list (PDF, DOCX, TXT, Markdown), 10 MB limit, memory storage, text extraction only — files are never executed or served back |
| Abuse / DoS | Global and per-route rate limits (stricter on auth and public chat), JSON body limit 1 MB, pagination caps, tool/LLM timeouts, circuit breakers |
| Secrets exposure | Secrets only from environment; env validated at boot; integration credentials encrypted with AES-256-GCM (`ENCRYPTION_KEY`); audit log redacts sensitive keys; debug traces never contain secrets |
| SQL injection | Drizzle query builder with parameters; raw SQL only for static DDL/constraints |

## Authentication

- `POST /api/auth/login` → access JWT (HS256, `JWT_ACCESS_TTL`, default 15 min) with `sub`, `org`, `clinic`, `role`, `patientId`.
- Refresh tokens are random 256-bit values stored as SHA-256 hashes with a `family_id`. Each refresh rotates the token; presenting an already-rotated token revokes the family.
- Logout revokes the current token; password change revokes all sessions.

## Authorization

Six roles (`SUPER_ADMIN`, `CLINIC_ADMIN`, `DOCTOR`, `RECEPTIONIST`, `PATIENT`, `AI_AGENT`) and 31 permissions defined in `backend/src/rbac/permissions.ts`. `AI_AGENT` has the minimum set needed by its tools. `SUPER_ADMIN` is a platform role and still operates inside an explicit tenant context.

## Data protection

- Transport: run behind TLS; HSTS is sent by the API; set `CORS_ORIGINS` to your exact web origin(s).
- At rest: use encrypted storage for PostgreSQL and backups (managed services do this by default). Integration secrets have an additional application-level encryption layer.
- Minimization: the agent stores only administrative data; long-term memory is limited to an allow-list of preferences; free-text notes are administrative (the UI labels them as such).
- Retention: conversations, audit logs and usage records have timestamps and tenant ids to support retention jobs per jurisdiction (implement deletion/anonymization policies per contract).
- Data subject requests: patient records are tenant-scoped and linked to appointments, conversations and notifications, which makes export and deletion queries straightforward.

## Audit log

Recorded events include: login / logout / failed login, patient record access and changes, appointment create / update / reschedule / cancel, every AI tool execution (actor `Alejandro AI`, arguments summary, result), handoffs, knowledge uploads and deletions, role and team changes, calendar connections, WhatsApp and Stripe webhooks (accepted and rejected), AI and clinic configuration changes. Each entry stores actor type/id/name, action, entity, result (`SUCCESS | FAILURE | DENIED`), IP, user agent and redacted metadata including the request id. Only roles with `audit.read` can view it.

## Hardening checklist for production

- [ ] Generate unique `JWT_SECRET`, `JWT_REFRESH_SECRET` (≥ 32 random bytes) and `ENCRYPTION_KEY` (`openssl rand -hex 32`); store them in a secret manager.
- [ ] `NODE_ENV=production`, `SWAGGER_ENABLED=false` (or protect `/api/docs` at the proxy).
- [ ] Exact `CORS_ORIGINS`; TLS everywhere; HSTS at the edge.
- [ ] Configure `WHATSAPP_APP_SECRET` and `STRIPE_WEBHOOK_SECRET` before exposing webhooks.
- [ ] Sign BAAs/DPAs with your cloud, LLM, email, SMS and WhatsApp providers or keep the mock/local options for PHI.
- [ ] Enable database backups, point-in-time recovery and log retention policies.
- [ ] Optional defense in depth: PostgreSQL row-level security on `organization_id` using a per-request `SET LOCAL app.org_id`.
- [ ] Monitor `audit_logs` for `DENIED` spikes and `webhook_events` for `REJECTED` entries.

## Reporting

Report vulnerabilities privately to the repository owner. Do not open public issues for security problems.

## v3 controls

- Patient action links: 256-bit tokens stored as SHA-256, scoped, expiring, single-use where it matters, audited.
- Consent before storing chat data; consent evidence (version, channel, IP, user agent); export and anonymization.
- Impersonation: platform-admin only, mandatory reason, 30-minute token with no refresh, visible banner, audited in both tenants.
- Expired/suspended tenants are read-only (no data hostage; export works).
- Per-clinic WhatsApp tokens encrypted with AES-256-GCM; a phone number can belong to only one clinic.
- Twilio webhooks validated with `X-Twilio-Signature`; unsigned calls are rejected in production.
- Sentry events have request bodies, headers, cookies and user data removed.
- Backups can be encrypted (AES-256, PBKDF2) before leaving the server; restores verify SHA-256 checksums.
- Compliance: these are technical controls that support a compliance program. The legal templates must be reviewed by a
  lawyer; nothing in the product certifies HIPAA/GDPR/Ley 1581 compliance.
