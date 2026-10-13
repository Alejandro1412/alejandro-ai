import type { Database } from '../../database/database.module';
import type { KnowledgeService } from '../../knowledge/knowledge.service';
import type { ClinicsService } from '../../clinics/clinics.service';
import type { DoctorsService } from '../../doctors/doctors.service';
import type { AvailabilityService } from '../../appointments/availability.service';
import type { AppointmentsService } from '../../appointments/appointments.service';
import type { PatientsService } from '../../patients/patients.service';
import type { NotificationsService } from '../../notifications/notifications.service';
import type { HandoffService } from '../../conversations/handoff.service';
import type { ConversationsService } from '../../conversations/conversations.service';
import type { SummarizerService } from '../orchestrator/summarizer.service';
import type { EngagementService } from '../../engagement/engagement.service';
import type { PrivacyService } from '../../privacy/privacy.service';
import type { CardAppointment } from '../attachments';
import { doctorDisplayName, formatDay, formatTime, formatWhen } from '../../common/utils/time';

export interface ToolDeps {
  db: Database;
  knowledge: KnowledgeService;
  clinics: ClinicsService;
  doctors: DoctorsService;
  availability: AvailabilityService;
  appointments: AppointmentsService;
  patients: PatientsService;
  notifications: NotificationsService;
  handoff: HandoffService;
  conversations: ConversationsService;
  summarizer: SummarizerService;
  engagement: EngagementService;
  privacy: PrivacyService;
}

type ApptLike = {
  id: string;
  doctorId: string;
  startTime: Date;
  endTime: Date;
  status: string;
  doctor: { title: string; firstName: string; lastName: string; specialty?: { name: string; nameEn?: string | null } | null };
  service?: { name: string } | null;
  location?: { name: string; address: string } | null;
  videoUrl?: string | null;
  depositCents?: number | null;
  depositStatus?: string;
  patientConfirmedAt?: Date | null;
  /** Links issued when the appointment was created (not persisted). */
  links?: { paymentUrl?: string | null; intakeUrl?: string | null; currency?: string };
};

export function toCard(a: ApptLike, timezone: string, lang: string): CardAppointment {
  return {
    id: a.id,
    doctorId: a.doctorId,
    doctorName: doctorDisplayName(a.doctor),
    specialty: (lang === 'en' ? a.doctor.specialty?.nameEn : null) ?? a.doctor.specialty?.name ?? null,
    serviceName: a.service?.name ?? null,
    start: a.startTime.toISOString(),
    end: a.endTime.toISOString(),
    when: formatWhen(a.startTime, timezone, lang),
    status: a.status,
    location: a.location ? `${a.location.name} — ${a.location.address}` : null,
    videoUrl: a.videoUrl ?? null,
    paymentUrl: a.depositStatus === 'PENDING' ? (a.links?.paymentUrl ?? null) : null,
    depositAmount: a.depositStatus === 'PENDING' && a.depositCents ? formatPrice(a.depositCents, a.links?.currency ?? 'COP', lang) : null,
    intakeUrl: a.links?.intakeUrl ?? null,
    patientConfirmed: Boolean(a.patientConfirmedAt),
  };
}

export function slotItem(start: string, end: string, timezone: string, lang: string) {
  const d = new Date(start);
  return { start, end, time: formatTime(d, timezone, lang), day: formatDay(d, timezone, lang) };
}

export const formatPrice = (cents: number | null, currency: string, lang: string) =>
  cents === null ? null : new Intl.NumberFormat(lang === 'en' ? 'en-US' : 'es-CO', { style: 'currency', currency, maximumFractionDigits: 0 }).format(cents / 100);
