# v3 — Growth, compliance & operations

This release turns Alejandro AI from "a receptionist that answers" into "a receptionist that fills the agenda and
runs as a business". Everything below works locally with mock providers; real providers switch on with credentials.

## Patient links (`/a/:token`)

Every message sent to a patient can carry one-tap links: **confirm attendance, cancel, take a waitlist slot, fill the
pre-visit form, leave a review, pay a deposit**.

- 256-bit random tokens; only their SHA-256 is stored (`action_tokens`), so a database leak cannot be replayed.
- Scoped to one tenant + purpose + record; expire (confirm/cancel at the appointment time, waitlist offers in ≤2 h,
  payments in `DEPOSIT_HOLD_MINUTES`); cancel / waitlist / review / payment links are **single-use** (consumed atomically).
- The page never shows internal ids; `GET` has no side effects; every `POST` is audited (`action_link.used`).

## Consent & privacy

- **Before any personal data is stored from a chat** (web chat, WhatsApp, phone) the assistant shows a consent card
  (versioned text + privacy-policy link). `createPatient` is blocked in code until the person accepts — it does not
  depend on the model. "No" stores nothing and the assistant keeps answering general questions.
- Evidence in `consent_records`: kind (`DATA_PROCESSING` / `MARKETING`), granted, text version, channel, IP, user agent, time.
- Portal sign-up requires accepting the privacy notice; marketing consent is separate and optional, and can be withdrawn
  from the portal or by replying **BAJA / STOP** on WhatsApp.
- Staff: consent history per patient, **JSON export** (access/portability) and **anonymization** (erasure that keeps
  non-identifying scheduling history; irreversible, requires typing `ANONYMIZE`, `patients.delete` permission).
- Legal templates at `/legal/terms`, `/legal/privacy`, `/legal/dpa` (`?clinic=slug` shows the clinic as controller).
  They are **reference templates that a lawyer must review**; the product provides technical controls that support
  compliance programs (Ley 1581/2012, GDPR-style rights, HIPAA-style safeguards) — it does not certify compliance.

## Interactive reminders

Reminders include confirm / cancel links (and the video link for virtual visits). On WhatsApp the patient can answer
**1** (confirm), **2** (reschedule — the assistant shows new times) or **3** (cancel). Confirmed attendance is shown on
the appointment, in the agenda and in the value report.

## Waitlist auto-fill

Patients (or the assistant, with the `addToWaitlist` tool) join a waitlist for a doctor, specialty or service, a date
range and a time of day. When an appointment is cancelled (or a deposit hold expires) a job offers the freed slot to the
first 3 matching patients; the first one to accept gets it (the booking still goes through the slot engine and the DB
exclusion constraint, so two acceptances can never double-book). Unanswered offers return to *waiting*.

## Deposits

Clinics can enable deposits (Settings → Clínica) and set a deposit per service. Self-service bookings (assistant, web,
WhatsApp, phone, portal) of those services are **held** (`PENDING`) with a payment link (Stripe Checkout `mode=payment`,
or a clearly labelled simulated payment without Stripe). The Stripe webhook (`checkout.session.completed`,
`metadata.kind=deposit`) confirms the appointment; unpaid holds are released after `DEPOSIT_HOLD_MINUTES` and the slot is
offered to the waitlist. Staff bookings never require a deposit.

## Intake forms, virtual visits, recurring series

- Per-service intake form builder (text, long text, select, checkbox, date). The link is sent with the confirmation;
  answers appear on the appointment. Administrative questions only — the form is not a clinical record.
- Virtual services get a unique video-consultation link (`VIDEO_BASE_URL`, Jitsi Meet by default) in the card,
  notifications and calendar event.
- Recurring series (weekly / every 2 weeks / monthly, 2–24 occurrences); conflicting dates are skipped and reported;
  "cancel series" cancels the remaining ones.

## Reviews & campaigns

- After a completed visit, patients **with marketing consent** get a 10-second review request. Ratings ≥4 are invited to
  publish on Google (`googleReviewUrl`); ratings ≤3 stay private and alert the clinic admin.
- Campaigns: *reactivation* (patients without a visit for N months and nothing booked, optionally by specialty) and
  *review requests*. Audience preview, consent re-checked at send time, opt-out text, attribution of bookings within
  14 days. Professional and Clinic plans. Real WhatsApp marketing outside the 24 h window needs Meta-approved templates.

## Monthly value report

`/reports/value` (and an email/in-app summary on the 1st of each month): conversations handled, % resolved without a
person, after-hours conversations, appointments booked by the AI and their list-price value, reminders and confirmed
attendance, no-show rate, slots refilled from the waitlist, reviews, and front-desk hours saved
(`minutesSavedPerConversation`, configurable). All values are estimates computed from the clinic's own data.

## Voice receptionist (Twilio)

Point a Twilio number's *A call comes in* webhook to `{API_URL}/api/webhooks/voice/{slug}/incoming`. The caller talks
(speech recognition by `<Gather input="speech dtmf">`), the **same orchestrator** answers, Twilio reads the reply
(`<Say>`), cards become "Option 1… Option 2…" (say or press the number). The caller's number pre-fills identification.
Handoffs transfer the call to the clinic phone. Requests are validated with `X-Twilio-Signature`
(`TWILIO_AUTH_TOKEN`); in production unsigned calls are rejected. Settings → Integraciones has a call simulator. Clinic plan.

## Multi-tenant WhatsApp

Each clinic connects its own WhatsApp Business number (Phone number ID + optional permanent token, encrypted with
AES-256-GCM). Inbound webhooks are routed by `metadata.phone_number_id`; replies and notifications go out from the
clinic's number. A number belongs to exactly one clinic; unknown numbers never fall through to another tenant.

## Billing lifecycle

| Event | Result |
|---|---|
| Trial ends in ≤3 days | Email + in-app warning to clinic admins |
| Trial ends / payment fails | `PAST_DUE` with a grace period (`BILLING_GRACE_DAYS`), reminders every 3 days |
| Grace period over | `EXPIRED`: **read-only** (GET works, writes return 402 `SUBSCRIPTION_INACTIVE`), the public assistant politely redirects patients to the clinic phone. Data is never deleted or held hostage; export keeps working |
| Period end | AI-conversation overage invoiced (USD 0.04 each); without Stripe the period renews locally |
| Monthly AI budget reached (`aiMonthlyBudgetUsd` per plan) | The clinic keeps working on the local engine; one alert per month |

## Platform console (`/admin`, SUPER_ADMIN)

MRR / ARR, tenants by status and plan, AI cost, signups, open invoices; per tenant usage, invoices, team and AI budget;
actions: change plan, extend trial, suspend / reactivate, and **impersonate** (reason required, 30-minute access token
without refresh, banner in the UI, audited in both organizations).

## Staff push notifications

Web Push (VAPID) for new handoffs, bookings, low reviews and billing alerts, even with the dashboard closed. Enable per
device in Settings → Integraciones. Requires `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY`.

## Imports

CSV import of patients and doctors (Spanish or English headers, `,` or `;`, dry run first, duplicates skipped, plan
limits respected) and **website import** for the knowledge base (reads the home page and the most relevant same-site
pages: services, prices, hours, contact, team, FAQ; SSRF-protected).

## Operations

- `GET /api/health/deep`: database, pgvector, migrations, Redis, queue driver and which integrations are live or mocked
  (never credentials).
- Optional **Sentry** (`SENTRY_DSN`): request bodies, headers, cookies and user data are stripped before sending.
- **Socket.IO Redis adapter**: realtime events fan out across API instances.
- `TRUST_PROXY` for correct client IPs (rate limits, audit) behind Render / Vercel / nginx.
- **Backups**: `scripts/backup.sh` (pg_dump custom format, integrity check, optional AES-256 encryption, S3-compatible
  upload, retention) and `scripts/restore.sh`; `docker compose --profile backup up -d` runs it nightly.
- **Render free tier sleeps** after inactivity: the first request (and WhatsApp/Twilio webhooks) can take ~50 s and
  scheduled jobs pause while asleep. For production use a paid instance (always on) or an external uptime ping to
  `/api/health`.

## AI evaluation suite

`npm run eval -w backend` runs 21 golden, clinical-safety, prompt-injection and privacy conversations against the real
application and writes `backend/eval/report.json`. `EVAL_PROVIDER=anthropic ANTHROPIC_API_KEY=… npm run eval -w backend`
runs the same cases against a real model. The command fails if any safety/injection/privacy case fails or the golden
pass rate drops below 90 %.
