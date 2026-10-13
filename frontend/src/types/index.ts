export type Role = 'SUPER_ADMIN' | 'CLINIC_ADMIN' | 'DOCTOR' | 'RECEPTIONIST' | 'PATIENT' | 'AI_AGENT';

export interface Me {
  user: { id: string; email: string; name: string; locale: string; avatarUrl: string | null };
  organization: { id: string; name: string; slug: string };
  clinic: { id: string; name: string; slug: string; timezone: string; locale: string; onboardedAt: string | null };
  role: Role;
  permissions: string[];
  patientId: string | null;
  subscription: { status: string; planKey: string; planName: string; trialEndsAt: string | null; currentPeriodEnd: string } | null;
  /** Set when a platform admin is acting as this user (support). */
  impersonatedBy?: string | null;
  isPlatformAdmin?: boolean;
}

export interface Specialty {
  id: string;
  name: string;
  nameEn: string | null;
  slug: string;
  keywords: string[];
  description: string | null;
}

export interface Service {
  id: string;
  name: string;
  nameEn: string | null;
  description: string | null;
  specialtyId: string | null;
  specialty?: Specialty | null;
  durationMinutes: number;
  priceCents: number | null;
  currency: string;
  isActive: boolean;
}

export interface Location {
  id: string;
  name: string;
  address: string;
  city: string | null;
  phone: string | null;
  mapsUrl: string | null;
}

export interface Schedule {
  id?: string;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
}

export interface TimeOff {
  id: string;
  type: 'BLOCK' | 'BREAK' | 'VACATION';
  startsAt: string;
  endsAt: string;
  reason: string | null;
}

export interface Doctor {
  id: string;
  title: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  bio: string | null;
  avatarUrl: string | null;
  specialtyId: string | null;
  locationId: string | null;
  specialty: Specialty | null;
  location: Location | null;
  status: 'ACTIVE' | 'INACTIVE' | 'ON_LEAVE';
  defaultDurationMinutes: number;
  bufferMinutes: number;
  languages: string[];
  color: string;
  services: Service[];
  schedules: Schedule[];
  timeOff?: TimeOff[];
  appointmentsToday?: number;
  calendarProvider?: string | null;
  calendar?: { id: string; provider: string; accountEmail: string | null } | null;
}

export interface Patient {
  id: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  documentId: string | null;
  dateOfBirth: string | null;
  gender: string | null;
  preferredLanguage: string;
  notes: string | null;
  tags: string[];
  source: string;
  createdAt: string;
  appointmentCount?: number;
  nextAppointment?: string | null;
  appointments?: Appointment[];
  conversations?: Conversation[];
}

export type AppointmentStatus = 'PENDING' | 'CONFIRMED' | 'COMPLETED' | 'CANCELLED' | 'NO_SHOW' | 'RESCHEDULED';
export type AppointmentSource = 'HUMAN' | 'AI' | 'WEB' | 'WHATSAPP' | 'API';

export interface Appointment {
  id: string;
  doctorId: string;
  patientId: string;
  serviceId: string | null;
  locationId: string | null;
  calendarEventId: string | null;
  startTime: string;
  endTime: string;
  status: AppointmentStatus;
  source: AppointmentSource;
  notes: string | null;
  createdByType: string;
  conversationId: string | null;
  rescheduledFromId: string | null;
  cancellationReason: string | null;
  createdAt: string;
  doctor: Doctor;
  patient: Patient;
  service: Service | null;
  location: Location | null;
}

export interface CardAppointment {
  id: string;
  doctorId: string;
  doctorName: string;
  specialty: string | null;
  serviceName: string | null;
  start: string;
  end: string;
  when: string;
  status: string;
  location: string | null;
  /** Video consultation link (virtual services). */
  videoUrl?: string | null;
  /** Deposit payment link while the slot is held. */
  paymentUrl?: string | null;
  depositAmount?: string | null;
  /** Pre-visit intake form. */
  intakeUrl?: string | null;
  patientConfirmed?: boolean;
}

export interface SlotItem {
  start: string;
  end: string;
  time: string;
  day: string;
}

export type Attachment =
  | { type: 'slots'; mode: 'book' | 'reschedule'; appointmentId?: string; serviceId?: string | null; timezone: string; groups: { doctorId: string; doctorName: string; specialty: string | null; slots: SlotItem[] }[] }
  | { type: 'doctors'; doctors: { id: string; name: string; specialty: string | null; bio: string | null; languages: string[]; color: string; avatarUrl: string | null }[] }
  | { type: 'appointment'; appointment: CardAppointment; state: 'created' | 'cancelled' | 'rescheduled' | 'info' }
  | { type: 'appointments'; purpose: 'cancel' | 'reschedule' | 'list'; items: CardAppointment[] }
  | { type: 'citations'; sources: { sourceId: string; title: string; excerpt: string; score: number }[] }
  | { type: 'services'; items: { id: string; name: string; specialty: string | null; durationMinutes: number; price: string | null }[] }
  | { type: 'handoff'; urgency: string; reason: string }
  | { type: 'emergency' }
  | { type: 'suggestions'; items: { label: string; message: string }[] }
  | { type: 'consent'; version: string; privacyUrl: string; text: string; acceptLabel: string; declineLabel: string }
  | { type: 'confirm'; title: string; body: string; action: ChatAction; confirmLabel: string; cancelLabel: string; cancelMessage: string };

export interface Journey {
  flow: 'booking' | 'cancel' | 'reschedule';
  step: string;
  steps: string[];
}

/** Live agent progress received while a reply is being produced (streaming). */
export type AgentStep =
  | { type: 'status'; stage: 'thinking' | 'policy' | 'llm' | 'validating' }
  | { type: 'tool'; name: string; phase: 'start' | 'end'; status?: string; latencyMs?: number }
  | { type: 'policy'; mode: string; reasons: string[] };

export type ChatAction = { type: 'book_slot' | 'confirm_cancel' | 'start_reschedule' | 'reschedule_to' | 'select_doctor' | 'confirm_attendance' | 'give_consent'; [k: string]: string | number | null };

export interface TraceStep {
  type: 'llm' | 'tool' | 'policy' | 'validation';
  name: string;
  status: string;
  latencyMs: number;
  detail?: Record<string, unknown>;
}

export interface TurnTrace {
  requestId: string;
  language: 'es' | 'en';
  intent: string;
  category: string;
  confidence: number;
  entities: Record<string, unknown>;
  policy: { mode: string; reasons: string[]; forcedTool: string | null };
  retrieved: { title: string; score: number; excerpt: string }[];
  steps: TraceStep[];
  provider: string;
  model: string;
  providerFallback: boolean;
  tokens: { input: number; output: number };
  costUsd: number;
  llmLatencyMs: number;
  totalLatencyMs: number;
  violations: string[];
  errors: string[];
}

export interface Message {
  id: string;
  role: 'USER' | 'ASSISTANT' | 'STAFF' | 'SYSTEM' | 'TOOL';
  content: string;
  attachments: Attachment[];
  action?: ChatAction | null;
  intent?: string | null;
  unanswered?: boolean;
  trace?: TurnTrace | null;
  tokensIn?: number;
  tokensOut?: number;
  latencyMs?: number | null;
  feedback?: 1 | -1 | null;
  createdAt: string;
}

export interface HandoffSummary {
  summary: string;
  intent: string | null;
  patient: { id: string; name: string } | null;
  actionsTaken: string[];
  pendingActions: string[];
  relevantData: Record<string, string>;
  recommendation: string;
}

export interface Handoff {
  id: string;
  conversationId: string;
  reason: string;
  summary: HandoffSummary;
  urgency: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  status: 'OPEN' | 'ASSIGNED' | 'RESOLVED';
  assignedToId: string | null;
  createdAt: string;
  resolvedAt: string | null;
  conversation?: { id: string; channel: string; language: string; lastMessageAt: string; externalContact: string | null };
  patient?: { id: string; firstName: string; lastName: string; phone: string | null } | null;
  assignee?: { id: string; name: string } | null;
}

export interface Conversation {
  id: string;
  channel: 'WEB' | 'PORTAL' | 'PLAYGROUND' | 'WHATSAPP';
  status: 'ACTIVE' | 'HANDOFF' | 'RESOLVED' | 'CLOSED';
  language: string;
  subject: string | null;
  summary: HandoffSummary | null;
  externalContact: string | null;
  aiEnabled: boolean;
  resolvedByAi: boolean;
  hasBooking: boolean;
  lastMessageAt: string;
  createdAt: string;
  patientId: string | null;
  patient?: Pick<Patient, 'id' | 'firstName' | 'lastName' | 'phone'> | Patient | null;
  lastMessage?: string | null;
  messageCount?: number;
  messages?: Message[];
  handoffs?: Handoff[];
  toolExecutions?: { id: string; toolName: string; status: string; latencyMs: number; createdAt: string; input?: unknown; output?: unknown }[];
}

export interface TurnResult {
  conversationId: string;
  userMessage: Message;
  assistantMessage: Message | null;
  conversationStatus: string;
  journey?: Journey | null;
  trace?: TurnTrace;
  welcome?: Message | null;
}

export interface KnowledgeSource {
  id: string;
  title: string;
  type: 'PDF' | 'TXT' | 'DOCX' | 'FAQ' | 'TEXT' | 'URL';
  status: 'UPLOADING' | 'PROCESSING' | 'INDEXED' | 'FAILED' | 'DISABLED';
  category: string | null;
  sourceUrl: string | null;
  fileName: string | null;
  sizeBytes: number | null;
  error: string | null;
  isEnabled: boolean;
  chunkCount: number;
  processedAt: string | null;
  createdAt: string;
  updatedAt: string;
  rawText?: string | null;
  metadata?: Record<string, unknown>;
  chunks?: { id: string; index: number; content: string; tokenCount: number }[];
}

export interface Notification {
  id: string;
  type: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
  readAt: string | null;
  createdAt: string;
}

export interface Plan {
  id: string;
  key: 'STARTER' | 'PROFESSIONAL' | 'CLINIC';
  name: string;
  description: string | null;
  priceMonthlyCents: number;
  priceYearlyCents: number;
  currency: string;
  limits: { doctors: number | null; users: number | null; aiConversationsPerMonth: number | null; knowledgeSources: number | null; whatsapp: boolean; customBranding: boolean; apiAccess: boolean; prioritySupport: boolean };
  features: string[];
  isPopular: boolean;
}

export interface AgentConfig {
  id: string;
  name: string;
  welcomeMessage: string;
  welcomeMessageEn: string;
  tone: 'friendly_professional' | 'formal' | 'warm' | 'concise';
  languages: ('es' | 'en')[];
  provider: 'mock' | 'openai' | 'anthropic' | 'gemini';
  model: string;
  temperature: number;
  maxTokens: number;
  handoffRules: { onUserRequest: boolean; onLowConfidence: boolean; onSensitiveTopic: boolean; maxFailedTurns: number; keywords: string[] };
  allowedActions: string[];
  bookingRules: { minNoticeHours: number; maxDaysAhead: number; slotStepMinutes: number; requireConfirmation: boolean; maxSlotsToOffer: number };
  cancellationPolicy: string | null;
  notificationRules: { onBooking: string[]; onCancel: string[]; reminderHoursBefore: number };
  systemPromptExtra: string | null;
  isActive: boolean;
}

export interface Clinic {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  timezone: string;
  locale: string;
  currency: string;
  phone: string | null;
  email: string | null;
  website: string | null;
  address: string | null;
  city: string | null;
  country: string | null;
  businessHours: Partial<Record<'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun', [string, string][]>>;
  onboardedAt: string | null;
}
