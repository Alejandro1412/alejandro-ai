/** Shapes returned by GET /public/actions/:token (see backend PublicActionsController.describe). */
export type ActionPurpose = 'confirm' | 'cancel' | 'waitlist' | 'intake' | 'review' | 'payment';
export type DepositStatus = 'NONE' | 'PENDING' | 'PAID' | 'REFUNDED' | 'EXPIRED';

export interface IntakeField {
  key: string;
  label: string;
  type: 'text' | 'textarea' | 'select' | 'checkbox' | 'date';
  required?: boolean;
  options?: string[];
}

export type IntakeAnswers = Record<string, string | boolean>;

export interface ActionClinic {
  name: string;
  slug: string;
  phone: string | null;
  timezone: string;
  privacyPolicyUrl: string | null;
}

export interface ActionAppointment {
  doctor: string;
  specialty: string | null;
  service: string | null;
  when: string;
  start: string;
  status: string;
  location: string | null;
  videoUrl: string | null;
  patientFirstName: string;
  patientConfirmed: boolean;
  depositStatus: DepositStatus;
  depositCents: number | null;
  currency: string;
  language: string | null;
}

export interface ActionInfo {
  purpose: ActionPurpose;
  expiresAt: string;
  clinic: ActionClinic;
  appointment?: ActionAppointment;
  simulated?: boolean;
  fields?: IntakeField[];
  answers?: IntakeAnswers | null;
  offer?: { doctor: string | null; when: string; start: string; available: boolean };
  review?: { doctor: string | null; answered: boolean };
}

export interface PanelProps {
  token: string;
  info: ActionInfo;
}
