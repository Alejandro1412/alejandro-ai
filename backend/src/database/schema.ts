/**
 * ALEJANDRO AI — relational data model (Drizzle ORM / PostgreSQL + pgvector).
 *
 * Every tenant-owned table carries `organizationId`. Isolation is enforced centrally
 * through TenantContext + the `tenantScope()` helper used by every repository
 * (see src/database/tenant.ts) and verified by the tenant-isolation e2e tests.
 */
import { relations, sql } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  vector,
} from 'drizzle-orm/pg-core';

export const EMBEDDING_DIMENSIONS = 384;

// ───────────────────────────── Enums ─────────────────────────────
export const membershipStatus = pgEnum('membership_status', ['ACTIVE', 'INVITED', 'SUSPENDED']);
export const doctorStatus = pgEnum('doctor_status', ['ACTIVE', 'INACTIVE', 'ON_LEAVE']);
export const timeOffType = pgEnum('time_off_type', ['BLOCK', 'BREAK', 'VACATION']);
export const appointmentStatus = pgEnum('appointment_status', [
  'PENDING',
  'CONFIRMED',
  'COMPLETED',
  'CANCELLED',
  'NO_SHOW',
  'RESCHEDULED',
]);
export const appointmentSource = pgEnum('appointment_source', ['HUMAN', 'AI', 'WEB', 'WHATSAPP', 'API']);
export const calendarProviderKind = pgEnum('calendar_provider_kind', ['MOCK', 'INTERNAL', 'GOOGLE', 'MICROSOFT']);
export const integrationStatus = pgEnum('integration_status', ['CONNECTED', 'DISCONNECTED', 'ERROR']);
export const conversationChannel = pgEnum('conversation_channel', ['WEB', 'PORTAL', 'PLAYGROUND', 'WHATSAPP']);
export const conversationStatus = pgEnum('conversation_status', ['ACTIVE', 'HANDOFF', 'RESOLVED', 'CLOSED']);
export const messageRole = pgEnum('message_role', ['USER', 'ASSISTANT', 'STAFF', 'SYSTEM', 'TOOL']);
export const toolExecutionStatus = pgEnum('tool_execution_status', ['SUCCESS', 'ERROR', 'DENIED']);
export const knowledgeSourceType = pgEnum('knowledge_source_type', ['PDF', 'TXT', 'DOCX', 'FAQ', 'TEXT', 'URL']);
export const knowledgeStatus = pgEnum('knowledge_status', ['UPLOADING', 'PROCESSING', 'INDEXED', 'FAILED', 'DISABLED']);
export const notificationChannel = pgEnum('notification_channel', ['IN_APP', 'EMAIL', 'WHATSAPP', 'SMS']);
export const notificationStatus = pgEnum('notification_status', ['PENDING', 'SENT', 'FAILED']);
export const actorType = pgEnum('actor_type', ['USER', 'AI_AGENT', 'SYSTEM', 'WEBHOOK', 'PATIENT']);
export const auditResult = pgEnum('audit_result', ['SUCCESS', 'FAILURE', 'DENIED']);
export const leadStatus = pgEnum('lead_status', ['NEW', 'CONTACTED', 'QUALIFIED', 'CONVERTED', 'LOST']);
export const handoffUrgency = pgEnum('handoff_urgency', ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']);
export const handoffStatus = pgEnum('handoff_status', ['OPEN', 'ASSIGNED', 'RESOLVED']);
export const ticketStatus = pgEnum('ticket_status', ['OPEN', 'IN_PROGRESS', 'CLOSED']);
export const webhookStatus = pgEnum('webhook_status', ['RECEIVED', 'PROCESSED', 'FAILED', 'REJECTED']);
export const subscriptionStatus = pgEnum('subscription_status', ['TRIALING', 'ACTIVE', 'PAST_DUE', 'CANCELED']);
export const billingInterval = pgEnum('billing_interval', ['MONTHLY', 'YEARLY']);
export const invoiceStatus = pgEnum('invoice_status', ['DRAFT', 'OPEN', 'PAID', 'VOID']);
export const usageKind = pgEnum('usage_kind', [
  'AI_COMPLETION',
  'AI_CONVERSATION',
  'EMBEDDING',
  'WHATSAPP_MESSAGE',
  'SMS_MESSAGE',
]);

const id = () => uuid('id').primaryKey().defaultRandom();
const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });
const createdAt = () => ts('created_at').notNull().defaultNow();
const updatedAt = () =>
  ts('updated_at')
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());
const orgId = () => uuid('organization_id').notNull();

// ─────────────────────── Identity & tenancy ───────────────────────
export const users = pgTable('users', {
  id: id(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  name: text('name').notNull(),
  locale: text('locale').notNull().default('es'),
  avatarUrl: text('avatar_url'),
  isSuperAdmin: boolean('is_super_admin').notNull().default(false),
  lastLoginAt: ts('last_login_at'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const organizations = pgTable('organizations', {
  id: id(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export type BusinessHours = Partial<Record<'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun', [string, string][]>>;

export const clinics = pgTable(
  'clinics',
  {
    id: id(),
    organizationId: orgId().references(() => organizations.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    slug: text('slug').notNull().unique(),
    description: text('description'),
    timezone: text('timezone').notNull().default('America/Bogota'),
    locale: text('locale').notNull().default('es'),
    currency: text('currency').notNull().default('USD'),
    phone: text('phone'),
    email: text('email'),
    website: text('website'),
    address: text('address'),
    city: text('city'),
    country: text('country'),
    businessHours: jsonb('business_hours').$type<BusinessHours>().notNull().default({}),
    onboardedAt: ts('onboarded_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('clinics_org_idx').on(t.organizationId)],
);

export const locations = pgTable(
  'locations',
  {
    id: id(),
    organizationId: orgId(),
    clinicId: uuid('clinic_id')
      .notNull()
      .references(() => clinics.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    address: text('address').notNull(),
    city: text('city'),
    phone: text('phone'),
    mapsUrl: text('maps_url'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('locations_org_clinic_idx').on(t.organizationId, t.clinicId)],
);

export const roles = pgTable('roles', {
  id: id(),
  key: text('key').notNull().unique(),
  name: text('name').notNull(),
  description: text('description'),
  isSystem: boolean('is_system').notNull().default(true),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const permissions = pgTable('permissions', {
  id: id(),
  key: text('key').notNull().unique(),
  description: text('description'),
  createdAt: createdAt(),
});

export const rolePermissions = pgTable(
  'role_permissions',
  {
    roleId: uuid('role_id')
      .notNull()
      .references(() => roles.id, { onDelete: 'cascade' }),
    permissionId: uuid('permission_id')
      .notNull()
      .references(() => permissions.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.roleId, t.permissionId] })],
);

export const memberships = pgTable(
  'memberships',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    organizationId: orgId().references(() => organizations.id, { onDelete: 'cascade' }),
    clinicId: uuid('clinic_id').references(() => clinics.id, { onDelete: 'set null' }),
    roleId: uuid('role_id')
      .notNull()
      .references(() => roles.id),
    status: membershipStatus('status').notNull().default('ACTIVE'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('memberships_user_org_uq').on(t.userId, t.organizationId), index('memberships_org_idx').on(t.organizationId)],
);

export const refreshTokens = pgTable(
  'refresh_tokens',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull().unique(),
    familyId: uuid('family_id').notNull(),
    organizationId: uuid('organization_id'),
    expiresAt: ts('expires_at').notNull(),
    revokedAt: ts('revoked_at'),
    replacedBy: uuid('replaced_by'),
    userAgent: text('user_agent'),
    ip: text('ip'),
    createdAt: createdAt(),
  },
  (t) => [index('refresh_tokens_user_idx').on(t.userId), index('refresh_tokens_family_idx').on(t.familyId)],
);

// ─────────────────────────── Clinic core ───────────────────────────
export const specialties = pgTable(
  'specialties',
  {
    id: id(),
    organizationId: orgId(),
    clinicId: uuid('clinic_id')
      .notNull()
      .references(() => clinics.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    nameEn: text('name_en'),
    slug: text('slug').notNull(),
    keywords: text('keywords').array().notNull().default(sql`'{}'::text[]`),
    description: text('description'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('specialties_clinic_slug_uq').on(t.clinicId, t.slug), index('specialties_org_idx').on(t.organizationId)],
);

export const services = pgTable(
  'services',
  {
    id: id(),
    organizationId: orgId(),
    clinicId: uuid('clinic_id')
      .notNull()
      .references(() => clinics.id, { onDelete: 'cascade' }),
    specialtyId: uuid('specialty_id').references(() => specialties.id, { onDelete: 'set null' }),
    name: text('name').notNull(),
    nameEn: text('name_en'),
    description: text('description'),
    durationMinutes: integer('duration_minutes').notNull().default(30),
    /** Minor units (cents). NULL = price on request — the AI never invents a price. */
    priceCents: integer('price_cents'),
    currency: text('currency').notNull().default('USD'),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('services_org_clinic_idx').on(t.organizationId, t.clinicId)],
);

export const doctors = pgTable(
  'doctors',
  {
    id: id(),
    organizationId: orgId(),
    clinicId: uuid('clinic_id')
      .notNull()
      .references(() => clinics.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .unique()
      .references(() => users.id, { onDelete: 'set null' }),
    title: text('title').notNull().default('Dr.'),
    firstName: text('first_name').notNull(),
    lastName: text('last_name').notNull(),
    email: text('email'),
    phone: text('phone'),
    bio: text('bio'),
    avatarUrl: text('avatar_url'),
    specialtyId: uuid('specialty_id').references(() => specialties.id, { onDelete: 'set null' }),
    locationId: uuid('location_id').references(() => locations.id, { onDelete: 'set null' }),
    status: doctorStatus('status').notNull().default('ACTIVE'),
    defaultDurationMinutes: integer('default_duration_minutes').notNull().default(30),
    bufferMinutes: integer('buffer_minutes').notNull().default(0),
    languages: text('languages').array().notNull().default(sql`'{es}'::text[]`),
    color: text('color').notNull().default('#4f46e5'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('doctors_org_clinic_idx').on(t.organizationId, t.clinicId), index('doctors_specialty_idx').on(t.specialtyId)],
);

export const doctorServices = pgTable(
  'doctor_services',
  {
    doctorId: uuid('doctor_id')
      .notNull()
      .references(() => doctors.id, { onDelete: 'cascade' }),
    serviceId: uuid('service_id')
      .notNull()
      .references(() => services.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.doctorId, t.serviceId] })],
);

/** Weekly working intervals. Several rows per day model breaks (08:00-12:00 + 14:00-18:00). */
export const doctorSchedules = pgTable(
  'doctor_schedules',
  {
    id: id(),
    organizationId: orgId(),
    doctorId: uuid('doctor_id')
      .notNull()
      .references(() => doctors.id, { onDelete: 'cascade' }),
    /** ISO weekday: 1 = Monday … 7 = Sunday */
    dayOfWeek: integer('day_of_week').notNull(),
    startTime: text('start_time').notNull(),
    endTime: text('end_time').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('doctor_schedules_doctor_idx').on(t.organizationId, t.doctorId)],
);

export const timeOff = pgTable(
  'time_off',
  {
    id: id(),
    organizationId: orgId(),
    doctorId: uuid('doctor_id')
      .notNull()
      .references(() => doctors.id, { onDelete: 'cascade' }),
    type: timeOffType('type').notNull().default('BLOCK'),
    startsAt: ts('starts_at').notNull(),
    endsAt: ts('ends_at').notNull(),
    reason: text('reason'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('time_off_doctor_idx').on(t.organizationId, t.doctorId, t.startsAt)],
);

export type PatientPreferences = {
  preferredDoctorId?: string;
  preferredContactChannel?: 'WHATSAPP' | 'EMAIL' | 'SMS' | 'PHONE';
  preferredTimeOfDay?: 'MORNING' | 'AFTERNOON';
};

export const patients = pgTable(
  'patients',
  {
    id: id(),
    organizationId: orgId(),
    clinicId: uuid('clinic_id')
      .notNull()
      .references(() => clinics.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .unique()
      .references(() => users.id, { onDelete: 'set null' }),
    firstName: text('first_name').notNull(),
    lastName: text('last_name').notNull(),
    email: text('email'),
    phone: text('phone'),
    documentId: text('document_id'),
    dateOfBirth: text('date_of_birth'),
    gender: text('gender'),
    preferredLanguage: text('preferred_language').notNull().default('es'),
    /** Administrative notes only — never clinical records. */
    notes: text('notes'),
    tags: text('tags').array().notNull().default(sql`'{}'::text[]`),
    /** Long-term, allow-listed administrative memory. */
    preferences: jsonb('preferences').$type<PatientPreferences>().notNull().default({}),
    source: text('source').notNull().default('HUMAN'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('patients_org_clinic_idx').on(t.organizationId, t.clinicId),
    index('patients_org_phone_idx').on(t.organizationId, t.phone),
    index('patients_org_email_idx').on(t.organizationId, t.email),
    index('patients_org_last_name_idx').on(t.organizationId, t.lastName),
  ],
);

export const appointments = pgTable(
  'appointments',
  {
    id: id(),
    organizationId: orgId(),
    clinicId: uuid('clinic_id')
      .notNull()
      .references(() => clinics.id, { onDelete: 'cascade' }),
    doctorId: uuid('doctor_id')
      .notNull()
      .references(() => doctors.id, { onDelete: 'cascade' }),
    patientId: uuid('patient_id')
      .notNull()
      .references(() => patients.id, { onDelete: 'cascade' }),
    serviceId: uuid('service_id').references(() => services.id, { onDelete: 'set null' }),
    locationId: uuid('location_id').references(() => locations.id, { onDelete: 'set null' }),
    calendarEventId: text('calendar_event_id'),
    startTime: ts('start_time').notNull(),
    endTime: ts('end_time').notNull(),
    status: appointmentStatus('status').notNull().default('CONFIRMED'),
    source: appointmentSource('source').notNull().default('HUMAN'),
    notes: text('notes'),
    createdById: uuid('created_by_id'),
    createdByType: actorType('created_by_type').notNull().default('USER'),
    conversationId: uuid('conversation_id'),
    rescheduledFromId: uuid('rescheduled_from_id'),
    cancelledAt: ts('cancelled_at'),
    cancellationReason: text('cancellation_reason'),
    reminderSentAt: ts('reminder_sent_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('appointments_clinic_start_idx').on(t.organizationId, t.clinicId, t.startTime),
    index('appointments_doctor_start_idx').on(t.organizationId, t.doctorId, t.startTime),
    index('appointments_patient_idx').on(t.organizationId, t.patientId),
    index('appointments_status_idx').on(t.organizationId, t.status),
  ],
);

export const calendarIntegrations = pgTable(
  'calendar_integrations',
  {
    id: id(),
    organizationId: orgId(),
    clinicId: uuid('clinic_id').notNull(),
    doctorId: uuid('doctor_id').references(() => doctors.id, { onDelete: 'cascade' }),
    provider: calendarProviderKind('provider').notNull(),
    status: integrationStatus('status').notNull().default('CONNECTED'),
    externalCalendarId: text('external_calendar_id'),
    accountEmail: text('account_email'),
    /** AES-256-GCM encrypted OAuth credentials. Never returned by the API. */
    credentialsEncrypted: text('credentials_encrypted'),
    connectedAt: ts('connected_at').notNull().defaultNow(),
    lastSyncAt: ts('last_sync_at'),
    error: text('error'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('calendar_integrations_clinic_idx').on(t.organizationId, t.clinicId)],
);

// ─────────────────────────── Conversations ───────────────────────────
export type HandoffSummary = {
  summary: string;
  intent: string | null;
  patient: { id: string; name: string } | null;
  actionsTaken: string[];
  pendingActions: string[];
  relevantData: Record<string, string>;
  recommendation: string;
};

export const conversations = pgTable(
  'conversations',
  {
    id: id(),
    organizationId: orgId(),
    clinicId: uuid('clinic_id').notNull(),
    patientId: uuid('patient_id').references(() => patients.id, { onDelete: 'set null' }),
    leadId: uuid('lead_id'),
    channel: conversationChannel('channel').notNull().default('WEB'),
    status: conversationStatus('status').notNull().default('ACTIVE'),
    language: text('language').notNull().default('es'),
    subject: text('subject'),
    summary: jsonb('summary').$type<HandoffSummary>(),
    externalContact: text('external_contact'),
    sessionTokenHash: text('session_token_hash').unique(),
    assignedToId: uuid('assigned_to_id'),
    aiEnabled: boolean('ai_enabled').notNull().default(true),
    resolvedByAi: boolean('resolved_by_ai').notNull().default(false),
    hasBooking: boolean('has_booking').notNull().default(false),
    lastMessageAt: ts('last_message_at').notNull().defaultNow(),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('conversations_clinic_last_idx').on(t.organizationId, t.clinicId, t.lastMessageAt),
    index('conversations_status_idx').on(t.organizationId, t.status),
    index('conversations_contact_idx').on(t.organizationId, t.externalContact),
  ],
);

export const messages = pgTable(
  'messages',
  {
    id: id(),
    organizationId: orgId(),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    role: messageRole('role').notNull(),
    content: text('content').notNull(),
    /** Rich UI blocks (slot cards, doctor cards, appointment cards, citations…) */
    attachments: jsonb('attachments').$type<unknown[]>().notNull().default([]),
    /** Structured action triggered from a card (e.g. book_slot) */
    action: jsonb('action').$type<Record<string, unknown>>(),
    intent: text('intent'),
    category: text('category'),
    language: text('language'),
    unanswered: boolean('unanswered').notNull().default(false),
    /** Observability trace for the turn (never includes secrets) */
    trace: jsonb('trace').$type<Record<string, unknown>>(),
    tokensIn: integer('tokens_in').notNull().default(0),
    tokensOut: integer('tokens_out').notNull().default(0),
    latencyMs: integer('latency_ms'),
    authorUserId: uuid('author_user_id'),
    createdAt: createdAt(),
  },
  (t) => [
    index('messages_conversation_idx').on(t.organizationId, t.conversationId, t.createdAt),
    index('messages_intent_idx').on(t.organizationId, t.intent),
  ],
);

// ─────────────────────────── AI agent ───────────────────────────
export type HandoffRules = {
  onUserRequest: boolean;
  onLowConfidence: boolean;
  onSensitiveTopic: boolean;
  maxFailedTurns: number;
  keywords: string[];
};
export type BookingRules = {
  minNoticeHours: number;
  maxDaysAhead: number;
  slotStepMinutes: number;
  requireConfirmation: boolean;
  maxSlotsToOffer: number;
};
export type NotificationRules = {
  onBooking: ('IN_APP' | 'EMAIL' | 'WHATSAPP' | 'SMS')[];
  onCancel: ('IN_APP' | 'EMAIL' | 'WHATSAPP' | 'SMS')[];
  reminderHoursBefore: number;
};

export const agents = pgTable('agents', {
  id: id(),
  organizationId: orgId(),
  clinicId: uuid('clinic_id')
    .notNull()
    .unique()
    .references(() => clinics.id, { onDelete: 'cascade' }),
  name: text('name').notNull().default('Alejandro AI'),
  welcomeMessage: text('welcome_message')
    .notNull()
    .default('¡Hola! Soy Alejandro AI, el asistente de la clínica. ¿En qué puedo ayudarte?'),
  welcomeMessageEn: text('welcome_message_en').notNull().default("Hi! I'm Alejandro AI, the clinic assistant. How can I help you today?"),
  tone: text('tone').notNull().default('friendly_professional'),
  languages: text('languages').array().notNull().default(sql`'{es,en}'::text[]`),
  provider: text('provider').notNull().default('mock'),
  model: text('model').notNull().default('alejandro-mock-1'),
  temperature: real('temperature').notNull().default(0.3),
  maxTokens: integer('max_tokens').notNull().default(800),
  handoffRules: jsonb('handoff_rules').$type<HandoffRules>().notNull(),
  /** Tool names the clinic allows the agent to execute. Empty = all registered tools. */
  allowedActions: text('allowed_actions').array().notNull().default(sql`'{}'::text[]`),
  bookingRules: jsonb('booking_rules').$type<BookingRules>().notNull(),
  cancellationPolicy: text('cancellation_policy'),
  notificationRules: jsonb('notification_rules').$type<NotificationRules>().notNull(),
  systemPromptExtra: text('system_prompt_extra'),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/** Per-clinic enable/disable switch for individual agent tools. */
export const agentTools = pgTable(
  'agent_tools',
  {
    id: id(),
    agentId: uuid('agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'cascade' }),
    toolName: text('tool_name').notNull(),
    enabled: boolean('enabled').notNull().default(true),
  },
  (t) => [uniqueIndex('agent_tools_agent_tool_uq').on(t.agentId, t.toolName)],
);

export const toolExecutions = pgTable(
  'tool_executions',
  {
    id: id(),
    organizationId: orgId(),
    conversationId: uuid('conversation_id').references(() => conversations.id, { onDelete: 'cascade' }),
    messageId: uuid('message_id'),
    toolName: text('tool_name').notNull(),
    input: jsonb('input').$type<unknown>().notNull(),
    output: jsonb('output').$type<unknown>(),
    status: toolExecutionStatus('status').notNull(),
    errorCode: text('error_code'),
    latencyMs: integer('latency_ms').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index('tool_executions_tool_idx').on(t.organizationId, t.toolName, t.createdAt),
    index('tool_executions_conversation_idx').on(t.organizationId, t.conversationId),
  ],
);

// ─────────────────────────── Knowledge / RAG ───────────────────────────
export const knowledgeSources = pgTable(
  'knowledge_sources',
  {
    id: id(),
    organizationId: orgId(),
    clinicId: uuid('clinic_id').notNull(),
    title: text('title').notNull(),
    type: knowledgeSourceType('type').notNull(),
    status: knowledgeStatus('status').notNull().default('UPLOADING'),
    category: text('category'),
    sourceUrl: text('source_url'),
    fileName: text('file_name'),
    mimeType: text('mime_type'),
    sizeBytes: integer('size_bytes'),
    rawText: text('raw_text'),
    error: text('error'),
    isEnabled: boolean('is_enabled').notNull().default(true),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    chunkCount: integer('chunk_count').notNull().default(0),
    createdById: uuid('created_by_id'),
    processedAt: ts('processed_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('knowledge_sources_status_idx').on(t.organizationId, t.clinicId, t.status)],
);

/**
 * Chunk + embedding in the same row (pgvector). A single indexed query does retrieval.
 * `embeddingModel` records which model produced the vector so re-indexing is possible.
 */
export const knowledgeChunks = pgTable(
  'knowledge_chunks',
  {
    id: id(),
    organizationId: orgId(),
    clinicId: uuid('clinic_id').notNull(),
    sourceId: uuid('source_id')
      .notNull()
      .references(() => knowledgeSources.id, { onDelete: 'cascade' }),
    index: integer('chunk_index').notNull(),
    content: text('content').notNull(),
    tokenCount: integer('token_count').notNull(),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    embeddingModel: text('embedding_model').notNull(),
    embedding: vector('embedding', { dimensions: EMBEDDING_DIMENSIONS }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('knowledge_chunks_clinic_idx').on(t.organizationId, t.clinicId),
    index('knowledge_chunks_source_idx').on(t.sourceId),
    index('knowledge_chunks_embedding_idx').using('hnsw', t.embedding.op('vector_cosine_ops')),
  ],
);

// ─────────────────────────── Operations ───────────────────────────
export const leads = pgTable(
  'leads',
  {
    id: id(),
    organizationId: orgId(),
    clinicId: uuid('clinic_id').notNull(),
    name: text('name').notNull(),
    email: text('email'),
    phone: text('phone'),
    interest: text('interest'),
    source: text('source').notNull().default('AI'),
    status: leadStatus('status').notNull().default('NEW'),
    conversationId: uuid('conversation_id'),
    notes: text('notes'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('leads_status_idx').on(t.organizationId, t.clinicId, t.status)],
);

export const handoffs = pgTable(
  'handoffs',
  {
    id: id(),
    organizationId: orgId(),
    clinicId: uuid('clinic_id').notNull(),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    reason: text('reason').notNull(),
    summary: jsonb('summary').$type<HandoffSummary>().notNull(),
    urgency: handoffUrgency('urgency').notNull().default('MEDIUM'),
    status: handoffStatus('status').notNull().default('OPEN'),
    assignedToId: uuid('assigned_to_id').references(() => users.id, { onDelete: 'set null' }),
    resolvedAt: ts('resolved_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('handoffs_status_idx').on(t.organizationId, t.clinicId, t.status)],
);

export const supportTickets = pgTable(
  'support_tickets',
  {
    id: id(),
    organizationId: orgId(),
    clinicId: uuid('clinic_id').notNull(),
    conversationId: uuid('conversation_id'),
    patientId: uuid('patient_id').references(() => patients.id, { onDelete: 'set null' }),
    subject: text('subject').notNull(),
    description: text('description').notNull(),
    priority: text('priority').notNull().default('MEDIUM'),
    status: ticketStatus('status').notNull().default('OPEN'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('support_tickets_status_idx').on(t.organizationId, t.clinicId, t.status)],
);

export const notifications = pgTable(
  'notifications',
  {
    id: id(),
    organizationId: orgId(),
    clinicId: uuid('clinic_id'),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    channel: notificationChannel('channel').notNull().default('IN_APP'),
    recipient: text('recipient'),
    title: text('title').notNull(),
    body: text('body').notNull(),
    data: jsonb('data').$type<Record<string, unknown>>().notNull().default({}),
    status: notificationStatus('status').notNull().default('PENDING'),
    error: text('error'),
    readAt: ts('read_at'),
    sentAt: ts('sent_at'),
    createdAt: createdAt(),
  },
  (t) => [
    index('notifications_user_idx').on(t.organizationId, t.userId, t.readAt),
    index('notifications_created_idx').on(t.organizationId, t.createdAt),
  ],
);

export const auditLogs = pgTable(
  'audit_logs',
  {
    id: id(),
    organizationId: uuid('organization_id'),
    actorType: actorType('actor_type').notNull(),
    actorId: text('actor_id'),
    actorName: text('actor_name'),
    action: text('action').notNull(),
    entityType: text('entity_type'),
    entityId: text('entity_id'),
    patientId: uuid('patient_id'),
    result: auditResult('result').notNull().default('SUCCESS'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    ip: text('ip'),
    userAgent: text('user_agent'),
    createdAt: createdAt(),
  },
  (t) => [
    index('audit_logs_created_idx').on(t.organizationId, t.createdAt),
    index('audit_logs_action_idx').on(t.organizationId, t.action),
    index('audit_logs_patient_idx').on(t.organizationId, t.patientId),
  ],
);

export const webhookEvents = pgTable(
  'webhook_events',
  {
    id: id(),
    organizationId: uuid('organization_id'),
    provider: text('provider').notNull(),
    eventType: text('event_type').notNull(),
    externalId: text('external_id'),
    payload: jsonb('payload').$type<unknown>().notNull(),
    signatureValid: boolean('signature_valid').notNull(),
    status: webhookStatus('status').notNull().default('RECEIVED'),
    error: text('error'),
    processedAt: ts('processed_at'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('webhook_events_provider_external_uq').on(t.provider, t.externalId),
    index('webhook_events_created_idx').on(t.provider, t.createdAt),
  ],
);

// ─────────────────────────── Billing ───────────────────────────
export type PlanLimits = {
  doctors: number | null;
  users: number | null;
  aiConversationsPerMonth: number | null;
  knowledgeSources: number | null;
  whatsapp: boolean;
  customBranding: boolean;
  apiAccess: boolean;
  prioritySupport: boolean;
};

export const plans = pgTable('plans', {
  id: id(),
  key: text('key').notNull().unique(),
  name: text('name').notNull(),
  description: text('description'),
  priceMonthlyCents: integer('price_monthly_cents').notNull(),
  priceYearlyCents: integer('price_yearly_cents').notNull(),
  currency: text('currency').notNull().default('USD'),
  limits: jsonb('limits').$type<PlanLimits>().notNull(),
  features: text('features').array().notNull().default(sql`'{}'::text[]`),
  stripePriceMonthlyId: text('stripe_price_monthly_id'),
  stripePriceYearlyId: text('stripe_price_yearly_id'),
  isActive: boolean('is_active').notNull().default(true),
  isPopular: boolean('is_popular').notNull().default(false),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const subscriptions = pgTable('subscriptions', {
  id: id(),
  organizationId: orgId()
    .unique()
    .references(() => organizations.id, { onDelete: 'cascade' }),
  planId: uuid('plan_id')
    .notNull()
    .references(() => plans.id),
  status: subscriptionStatus('status').notNull().default('TRIALING'),
  interval: billingInterval('interval').notNull().default('MONTHLY'),
  currentPeriodStart: ts('current_period_start').notNull().defaultNow(),
  currentPeriodEnd: ts('current_period_end').notNull(),
  trialEndsAt: ts('trial_ends_at'),
  cancelAtPeriodEnd: boolean('cancel_at_period_end').notNull().default(false),
  stripeCustomerId: text('stripe_customer_id'),
  stripeSubscriptionId: text('stripe_subscription_id').unique(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const invoices = pgTable(
  'invoices',
  {
    id: id(),
    organizationId: orgId(),
    subscriptionId: uuid('subscription_id')
      .notNull()
      .references(() => subscriptions.id, { onDelete: 'cascade' }),
    number: text('number').notNull().unique(),
    amountCents: integer('amount_cents').notNull(),
    currency: text('currency').notNull().default('USD'),
    status: invoiceStatus('status').notNull().default('OPEN'),
    periodStart: ts('period_start').notNull(),
    periodEnd: ts('period_end').notNull(),
    stripeInvoiceId: text('stripe_invoice_id').unique(),
    hostedUrl: text('hosted_url'),
    issuedAt: ts('issued_at').notNull().defaultNow(),
    paidAt: ts('paid_at'),
    createdAt: createdAt(),
  },
  (t) => [index('invoices_org_idx').on(t.organizationId, t.issuedAt)],
);

export const usageRecords = pgTable(
  'usage_records',
  {
    id: id(),
    organizationId: orgId(),
    clinicId: uuid('clinic_id'),
    conversationId: uuid('conversation_id'),
    kind: usageKind('kind').notNull(),
    provider: text('provider'),
    model: text('model'),
    tokensIn: integer('tokens_in').notNull().default(0),
    tokensOut: integer('tokens_out').notNull().default(0),
    latencyMs: integer('latency_ms'),
    /** Estimated cost in micro-USD (1e-6 USD) to avoid float drift. */
    costMicroUsd: integer('cost_micro_usd').notNull().default(0),
    quantity: integer('quantity').notNull().default(1),
    createdAt: createdAt(),
  },
  (t) => [
    index('usage_records_kind_idx').on(t.organizationId, t.kind, t.createdAt),
    index('usage_records_conversation_idx').on(t.organizationId, t.conversationId),
  ],
);

// ─────────────────────────── Relations (query API) ───────────────────────────
export const doctorsRelations = relations(doctors, ({ one, many }) => ({
  specialty: one(specialties, { fields: [doctors.specialtyId], references: [specialties.id] }),
  location: one(locations, { fields: [doctors.locationId], references: [locations.id] }),
  services: many(doctorServices),
  schedules: many(doctorSchedules),
  timeOff: many(timeOff),
}));
export const doctorServicesRelations = relations(doctorServices, ({ one }) => ({
  doctor: one(doctors, { fields: [doctorServices.doctorId], references: [doctors.id] }),
  service: one(services, { fields: [doctorServices.serviceId], references: [services.id] }),
}));
export const doctorSchedulesRelations = relations(doctorSchedules, ({ one }) => ({
  doctor: one(doctors, { fields: [doctorSchedules.doctorId], references: [doctors.id] }),
}));
export const timeOffRelations = relations(timeOff, ({ one }) => ({
  doctor: one(doctors, { fields: [timeOff.doctorId], references: [doctors.id] }),
}));
export const servicesRelations = relations(services, ({ one, many }) => ({
  specialty: one(specialties, { fields: [services.specialtyId], references: [specialties.id] }),
  doctors: many(doctorServices),
}));
export const specialtiesRelations = relations(specialties, ({ many }) => ({
  doctors: many(doctors),
  services: many(services),
}));
export const appointmentsRelations = relations(appointments, ({ one }) => ({
  doctor: one(doctors, { fields: [appointments.doctorId], references: [doctors.id] }),
  patient: one(patients, { fields: [appointments.patientId], references: [patients.id] }),
  service: one(services, { fields: [appointments.serviceId], references: [services.id] }),
  location: one(locations, { fields: [appointments.locationId], references: [locations.id] }),
}));
export const patientsRelations = relations(patients, ({ many }) => ({
  appointments: many(appointments),
  conversations: many(conversations),
}));
export const conversationsRelations = relations(conversations, ({ one, many }) => ({
  patient: one(patients, { fields: [conversations.patientId], references: [patients.id] }),
  messages: many(messages),
  handoffs: many(handoffs),
}));
export const messagesRelations = relations(messages, ({ one }) => ({
  conversation: one(conversations, { fields: [messages.conversationId], references: [conversations.id] }),
}));
export const handoffsRelations = relations(handoffs, ({ one }) => ({
  conversation: one(conversations, { fields: [handoffs.conversationId], references: [conversations.id] }),
  assignedTo: one(users, { fields: [handoffs.assignedToId], references: [users.id] }),
}));
export const knowledgeSourcesRelations = relations(knowledgeSources, ({ many }) => ({
  chunks: many(knowledgeChunks),
}));
export const knowledgeChunksRelations = relations(knowledgeChunks, ({ one }) => ({
  source: one(knowledgeSources, { fields: [knowledgeChunks.sourceId], references: [knowledgeSources.id] }),
}));
export const membershipsRelations = relations(memberships, ({ one }) => ({
  user: one(users, { fields: [memberships.userId], references: [users.id] }),
  role: one(roles, { fields: [memberships.roleId], references: [roles.id] }),
  organization: one(organizations, { fields: [memberships.organizationId], references: [organizations.id] }),
}));
export const rolesRelations = relations(roles, ({ many }) => ({
  permissions: many(rolePermissions),
}));
export const rolePermissionsRelations = relations(rolePermissions, ({ one }) => ({
  role: one(roles, { fields: [rolePermissions.roleId], references: [roles.id] }),
  permission: one(permissions, { fields: [rolePermissions.permissionId], references: [permissions.id] }),
}));
export const subscriptionsRelations = relations(subscriptions, ({ one, many }) => ({
  plan: one(plans, { fields: [subscriptions.planId], references: [plans.id] }),
  invoices: many(invoices),
}));
export const agentsRelations = relations(agents, ({ one }) => ({
  clinic: one(clinics, { fields: [agents.clinicId], references: [clinics.id] }),
}));
