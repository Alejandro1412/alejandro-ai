import type { BookingRules, HandoffRules, NotificationRules } from '../database/schema';

export const DEFAULT_HANDOFF_RULES: HandoffRules = {
  onUserRequest: true,
  onLowConfidence: true,
  onSensitiveTopic: true,
  maxFailedTurns: 2,
  keywords: ['queja', 'reclamo', 'abogado', 'complaint', 'lawyer', 'refund', 'reembolso'],
};

export const DEFAULT_BOOKING_RULES: BookingRules = {
  minNoticeHours: 2,
  maxDaysAhead: 60,
  slotStepMinutes: 30,
  requireConfirmation: true,
  maxSlotsToOffer: 6,
};

export const DEFAULT_NOTIFICATION_RULES: NotificationRules = {
  onBooking: ['IN_APP', 'EMAIL', 'WHATSAPP'],
  onCancel: ['IN_APP', 'EMAIL'],
  reminderHoursBefore: 24,
};

export const DEFAULT_CANCELLATION_POLICY =
  'Las citas pueden cancelarse o reprogramarse sin costo hasta 24 horas antes. / Appointments can be cancelled or rescheduled free of charge up to 24 hours in advance.';
