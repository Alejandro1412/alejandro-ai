import type { Appointment, Service } from '@/types';

/** v3 appointment fields (deposits, video, attendance confirmation, series, intake). */
export type DepositStatus = 'NONE' | 'PENDING' | 'PAID' | 'REFUNDED' | 'EXPIRED';

export interface IntakeField {
  key: string;
  label: string;
  type: 'text' | 'textarea' | 'select' | 'checkbox' | 'date';
  required?: boolean;
  options?: string[];
}

export type AppointmentV3 = Omit<Appointment, 'service'> & {
  patientConfirmedAt: string | null;
  depositCents: number | null;
  depositStatus: DepositStatus;
  paymentRef: string | null;
  videoUrl: string | null;
  seriesId: string | null;
  reviewRequestedAt: string | null;
  service: (Service & { intakeFields?: IntakeField[]; depositCents?: number | null; isVirtual?: boolean }) | null;
};

export interface IntakeResponse {
  answers: Record<string, string | boolean>;
  submittedAt: string;
}

export type Frequency = 'WEEKLY' | 'BIWEEKLY' | 'MONTHLY';

export interface SeriesResult {
  seriesId: string;
  booked: Appointment[];
  skipped: { startTime: string; reason: string }[];
}

export const DEPOSIT_TONE: Record<DepositStatus, 'neutral' | 'warning' | 'success' | 'info' | 'danger'> = {
  NONE: 'neutral',
  PENDING: 'warning',
  PAID: 'success',
  REFUNDED: 'info',
  EXPIRED: 'danger',
};

export const SKIP_REASONS = ['APPOINTMENT_CONFLICT', 'OUTSIDE_WORKING_HOURS', 'TOO_SOON', 'SERVICE_NOT_OFFERED', 'DOCTOR_UNAVAILABLE'] as const;
export const skipReasonKey = (code: string) => ((SKIP_REASONS as readonly string[]).includes(code) ? (code as (typeof SKIP_REASONS)[number]) : 'other');

/** Intake answers in the order of the service's fields, then any extra keys the form no longer has. */
export function intakeRows(fields: IntakeField[], answers: Record<string, string | boolean>): { key: string; label: string; value: string | boolean }[] {
  const known = fields.filter((f) => f.key in answers).map((f) => ({ key: f.key, label: f.label, value: answers[f.key] }));
  const extra = Object.keys(answers)
    .filter((k) => !fields.some((f) => f.key === k))
    .map((k) => ({ key: k, label: k, value: answers[k] }));
  return [...known, ...extra];
}

/** Can staff mark attendance as confirmed? (backend rejects closed appointments and unpaid deposits) */
export const canConfirmAttendance = (a: Pick<AppointmentV3, 'status' | 'patientConfirmedAt' | 'depositStatus'>) => (a.status === 'CONFIRMED' || a.status === 'PENDING') && !a.patientConfirmedAt;
