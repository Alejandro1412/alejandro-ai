# Alejandro AI — agent design

Alejandro AI is an administrative receptionist, not a clinician. It answers from verified data, acts only through explicit tools and hands over to people when it should.

## Turn lifecycle

```
1  ChatService.send()            persist user message, load conversation + agent config
2  Language detection            es / en per message (conversation language updated)
3  IntentClassifier              intent, category, confidence, entities
                                 (specialty, doctor, service, relative/absolute dates in clinic TZ,
                                  name, phone, email, document id), flags (emergency, wants human,
                                  medical mention, complaint)
4  PolicyEngine                  decides BEFORE any model call:
                                   emergency        → no LLM, forced requestHumanHandoff(CRITICAL) + safety message
                                   wants human / clinic keyword / complaint → forced requestHumanHandoff
                                   repeated failures → handoff (LOW_CONFIDENCE)
                                   medical mention  → guardrail instructions (no diagnosis)
5  PromptBuilder                 system prompt = identity + SAFETY_RULES + clinic facts + tone +
                                 guardrails + patient context (allow-listed fields) + tool policy
6  Orchestrator loop             provider.complete(messages, tools) → tool calls
   (≤ AI_MAX_TOOL_ITERATIONS)     → ToolRegistry.execute(): enabled? permission? patient required?
                                    zod input → run with timeout → zod output → ToolExecution row + audit
                                  → results appended → repeat until a final answer
7  ResponseValidator             blocks claims not backed by a successful tool call in this turn
                                 (booked/cancelled/rescheduled), prices not returned by tools,
                                 diagnostic language → rewritten to a safe answer
8  Attachments                   UI cards built from tool results only (slots, doctors,
                                 appointment, appointment list, services, citations, handoff,
                                 emergency, suggestions)
9  Usage & audit                 tokens, latency, provider/model, estimated cost (micro-USD),
                                 conversation id, tenant → usage_records; trace stored on message
```

Every turn returns a **trace** (intent, category, confidence, entities, policy decision, retrieved documents, steps with arguments/results/latency, tokens, cost, provider, model, errors). The Playground and conversation detail pages render it. Traces never include API keys, tokens or system secrets.

## Safety rules (always in the system prompt)

1. Not a doctor: never diagnose, interpret symptoms/results/images or recommend, dose or adjust medication.
2. Never invent prices, availability, doctors, services, policies or appointment details.
3. Availability, appointments and patient data are dynamic → always via tools, never RAG or memory.
4. Never confirm an action unless the tool succeeded in this conversation.
5. Only the current clinic and the current identified patient.
6. Emergencies → tell the user to call local emergency services and escalate.
7. If unresolved or the user asks for a person → `requestHumanHandoff`.

Rules 1, 4 and 6 are also enforced in code (policy engine and response validator), so they do not depend on model compliance.

## Categories

`ADMINISTRATIVE`, `GENERAL_INFORMATION`, `APPOINTMENT`, `BILLING`, `SUPPORT`, `MEDICAL_SAFETY`, `EMERGENCY`, `HUMAN_HANDOFF`.

## Tools

| Tool | Permission | Needs identified patient | Purpose |
|---|---|---|---|
| searchClinicKnowledge | knowledge.read | – | Hybrid RAG search with citations |
| getClinicInformation | – | – | Name, contact, description |
| getBusinessHours | – | – | Opening hours (clinic time zone) |
| getClinicLocations | – | – | Sites and addresses |
| getServices / getServiceInformation | services.read | – | Services, durations, published prices |
| getDoctors / getDoctorProfile | doctors.read | – | Doctors by specialty, profile |
| getDoctorAvailability | appointments.read | – | Availability of one doctor |
| getAvailableAppointmentSlots | appointments.read | – | Real slots across doctors/specialty/service |
| createAppointment | appointments.create | ✓ | Books a slot (source `AI`/`WHATSAPP`/`WEB`) |
| rescheduleAppointment | appointments.update | ✓ | Moves an owned appointment |
| cancelAppointment | appointments.delete | ✓ | Cancels an owned appointment |
| getAppointment / listPatientAppointments | appointments.read | ✓ | Patient’s own appointments |
| sendAppointmentReminder | appointments.read | ✓ | Sends a reminder on the patient’s channels |
| getPatient / createPatient / updatePatient | patients.* | update ✓ | Identify or register the caller; update allow-listed fields |
| createLead | leads.write | – | Captures prospects |
| requestHumanHandoff | conversations.handoff | – | Hands over with reason, urgency and factual summary |
| createSupportTicket | conversations.handoff | – | Non-urgent administrative follow-up |
| getConversationHistory / summarizeConversation | – | – | Context for the agent and for staff |

Each tool file defines `name`, `description`, `inputSchema` and `outputSchema` (zod → JSON Schema for providers and Swagger), `permission`, `requiresPatient` and `execute(input, ctx)`; the registry applies a uniform execution timeout. Tools call application services — never the database — so tenant scoping, RBAC and business rules are identical to the REST API. Clinics can switch tools on/off in **Settings → AI**; disabled tools are not offered to the model and are rejected by the registry.

**Adding a tool:** create a definition in `src/ai/tools/definitions`, export it from the registry factory in `ai.module.ts`, add a unit test for the mock policy if the mock should use it, and document it here.

## Booking flow

1. Intent `book_appointment` with specialty “dermatología” and a date range (“esta semana” → clinic TZ).
2. `getDoctors(specialty)` → `getAvailableAppointmentSlots(doctorIds, from, to)`.
3. The response shows slot cards. Nothing is booked yet.
4. The user picks a slot; the UI asks for confirmation and sends a structured action `{type:"book_slot", doctorId, startTime, serviceId}`.
5. If the caller is not identified, the agent asks for name + phone/email, `getPatient` / `createPatient`, then resumes the pending action.
6. `createAppointment` → success → confirmation card + notifications. On `APPOINTMENT_CONFLICT` the agent offers fresh slots.

Cancel and reschedule follow the same pattern (`listPatientAppointments` → explicit confirmation action → tool).

## Human handoff

Triggers: explicit request, clinic keywords, complaints/sensitive topics, repeated failures (low confidence), emergencies, or the model choosing `requestHumanHandoff`. The handoff stores reason, urgency (`LOW…CRITICAL`), conversation, assigned staff and timestamps, pauses the AI for that conversation and notifies reception in real time.

The **summary** is built deterministically from stored facts — intent history, identified patient, successful and failed tool executions, pending actions and the last user messages — plus an administrative recommendation derived from the reason. It never contains information that is not in the conversation or tool results.

## Memory

| Level | Content | Storage |
|---|---|---|
| Short-term | Recent turns of this conversation, token-budgeted | messages |
| Long-term | Allow-listed administrative preferences (preferred doctor, contact channel, time of day) | patients.preferences |
| Knowledge | Clinic documents | knowledge_chunks |
| Operational | Appointments, schedules, patients | database via tools |

Transcripts are not promoted to long-term memory.

## LLM providers

`LLMProvider.complete({ system, messages, tools, model, temperature, maxTokens })` → `{ content, toolCalls, usage }`.

- `OpenAIProvider` (Chat Completions tools), `AnthropicProvider` (Messages API tool use), `GeminiProvider` (function calling) — plain `fetch` with timeout, retry and circuit breaker.
- `MockLLMProvider` — deterministic implementation of the same tool-calling policy in ES/EN; default when no keys are configured and used in tests.
- Per clinic: provider, model, temperature, max tokens (Settings → AI). Keys live only in the backend environment.
- Cost estimation per model in `ai/llm/pricing.ts`; usage and cost are recorded per turn for metering and plan quotas.

## Unanswered questions & analytics

When the agent cannot ground an answer (no relevant knowledge, no tool data) the message is flagged `unanswered`. Analytics aggregates top questions, unanswered questions, tool usage and errors so the clinic knows what to add to its knowledge base.

## WhatsApp

Inbound webhook → signature validation → idempotency by message id → patient lookup by phone → same orchestrator → response rendered for WhatsApp (cards become numbered options; replying “2” selects the second slot).

## Conversation design (v2)

**Open conversation, always guided.** The system prompt lets the model talk naturally about anything the user brings up (greetings, small talk, how it works, general questions, everyday topics) while keeping the safety rules, and requires every reply to end with one concrete next step. The local engine implements the same behaviour deterministically: capabilities, small talk (how are you, who are you, are you a bot, jokes, compliments, frustration), acknowledgements, polite answers to off-topic questions, preparation guidance, and follow-ups.

**Follow-ups keep context.** Elliptical messages ("¿y cuánto cuesta?", "¿y los sábados?", "and for an ECG?") inherit the previous informational intent and its subject (service, specialty, doctor). Booking refinements ("por la tarde", "otros días", "el sábado") keep the specialty/doctor already chosen.

**Answering cards in free text.** The options shown last turn (slots, appointment lists) are stored in the conversation metadata. `conversation/choice-resolver.ts` maps "el viernes a las 8", "3 pm", "la segunda", "the first one", "la de ortopedia" onto exactly one of them, asks to disambiguate when several match, and ignores unrelated text and contact data. A resolved booking or cancellation is **never executed directly**: the assistant replies with a `confirm` card and waits for "sí" or the button (when `bookingRules.requireConfirmation` is on, the default). "No" books nothing and re-shows the options.

**Guided journey.** `conversation/journey.ts` derives the patient's position from what actually happened (tool results, cards, pending confirmations): booking `need → time → details → confirm → done`, cancel `choose → confirm → done`, reschedule `choose → time → confirm → done`. It is returned with every turn (`journey`), rendered as a progress bar in every chat surface, and given to the model as an instruction for the next step. Suggestions (quick replies) are journey-aware.

**Memory for real models.** Previous assistant messages are replayed with a compact `[shown: …]` note listing the ids of cards they displayed, so Claude/GPT/Gemini can resolve "the second one" with the right `doctorId`/`startTime`.

## Streaming

`POST /api/ai/chat/stream`, `/api/portal/chat/stream` and `/api/public/chat/{slug}/messages/stream` return Server-Sent Events:

| Event | Payload |
|---|---|
| `step` | `{type:'status', stage}` · `{type:'tool', name, phase:'start'|'end', status, latencyMs}` · `{type:'policy', …}` (staff playground only) |
| `delta` | `{text}` chunks of the final answer |
| `done` | the same payload as the non-streaming endpoint |
| `error` | `{code, message}` |

Patient-facing streams never include the trace or policy reasons. The client (`api.stream`) falls back to the JSON endpoint only if the stream never started (proxy without SSE), never after a turn ran.

## Model providers (2026)

- **Anthropic** — default `claude-sonnet-5-5`; also `claude-haiku-4-5-20251001` (lowest cost) and `claude-opus-5-5`. Claude 5.x rejects non-default sampling parameters and enables adaptive thinking by default, so the provider omits `temperature` and sends `thinking: {type: "between_tools"}` + `output_config.effort: "low"` for receptionist-grade latency; Claude's own content blocks (including thinking signatures) are replayed verbatim inside the tool loop.
- **OpenAI** — `max_completion_tokens`; `temperature` only for GPT-4.x models.
- **Gemini** — model parts (with thought signatures) are echoed back unchanged during function calling.
- Any other model id can be typed in Settings → AI; ids are validated for shape, not against a fixed list.

## Feedback

Patients (portal, webchat) and staff (playground) can rate any assistant reply 👍/👎. Ratings are stored on the message (`feedback`, `feedback_at`) and reported as the satisfaction KPI in analytics and the dashboard briefing.

## v3 additions

- **Tools**: `confirmAttendance` (patient confirms an upcoming appointment) and `addToWaitlist` (offered when no slot fits).
- **Consent gate**: on web chat, WhatsApp and phone, `createPatient` is intercepted by the orchestrator until the person
  accepts the privacy notice (consent card / "acepto"); declining stores nothing. Portal and playground are exempt
  (consent captured at sign-up / staff testing).
- **Deposits & extras**: `createAppointment` may return a held appointment with `paymentUrl`; the prompt and the local
  engine say it is *held until the deposit is paid*, never "confirmed". `videoUrl` / `intakeUrl` are mentioned when present.
- **Intents**: `join_waitlist`, `confirm_attendance`, `opt_out` (BAJA/STOP withdraws marketing consent),
  `third_party_data` (requests for someone else's data are refused politely).
- **Self-harm language** gets a dedicated, supportive crisis message plus a critical handoff.
- **Budget cap**: when the plan's monthly AI budget is exhausted the turn runs on the local engine (trace step `ai_budget`).
- **Subscription inactive**: public channels get a polite redirect to the clinic phone without calling the model.
- **Phone channel**: same orchestrator; cards are rendered as spoken numbered options.
- **Evaluation**: `npm run eval -w backend` (golden, safety, injection and privacy cases).
