/**
 * Guided patient journey. The orchestrator derives where the patient is in a flow from what really
 * happened (tool results, cards shown, pending confirmations), the UI renders it as a progress
 * stepper and the model receives it as context to always propose the next step.
 */
export type JourneyFlow = 'booking' | 'cancel' | 'reschedule';

export const JOURNEY_STEPS: Record<JourneyFlow, string[]> = {
  booking: ['need', 'time', 'details', 'confirm', 'done'],
  cancel: ['choose', 'confirm', 'done'],
  reschedule: ['choose', 'time', 'confirm', 'done'],
};

export interface Journey {
  flow: JourneyFlow;
  step: string;
  steps: string[];
}

export interface JourneySignals {
  previous: Journey | null;
  intent: string;
  okTools: Set<string>;
  slotsMode: 'book' | 'reschedule' | null;
  appointmentsPurpose: 'cancel' | 'reschedule' | 'list' | null;
  pendingConfirm: { type: string } | null;
  waitingIdentification: boolean;
  identified: boolean;
}

const make = (flow: JourneyFlow, step: string): Journey => ({ flow, step, steps: JOURNEY_STEPS[flow] });

export function deriveJourney(s: JourneySignals): Journey | null {
  if (s.okTools.has('createAppointment')) return make('booking', 'done');
  if (s.okTools.has('rescheduleAppointment')) return make('reschedule', 'done');
  if (s.okTools.has('cancelAppointment')) return make('cancel', 'done');
  if (s.pendingConfirm) {
    if (s.pendingConfirm.type === 'reschedule_to') return make('reschedule', 'confirm');
    if (s.pendingConfirm.type === 'confirm_cancel') return make('cancel', 'confirm');
    return make('booking', 'confirm');
  }
  if (s.waitingIdentification) return make('booking', 'details');
  if (s.slotsMode === 'reschedule') return make('reschedule', 'time');
  if (s.slotsMode === 'book') return make('booking', 'time');
  if (s.appointmentsPurpose === 'cancel') return make('cancel', 'confirm');
  if (s.appointmentsPurpose === 'reschedule') return make('reschedule', 'choose');
  if (['book_appointment', 'check_availability'].includes(s.intent)) return make('booking', 'need');
  if (['cancel_appointment'].includes(s.intent)) return make('cancel', 'choose');
  if (['reschedule_appointment'].includes(s.intent)) return make('reschedule', 'choose');
  // A finished journey is shown once, then cleared; an unfinished one persists through small talk.
  if (s.previous && s.previous.step !== 'done') return s.previous;
  return null;
}

/** One-line instruction for the model so every answer moves the patient forward. */
export function journeyGuidance(j: Journey | null, lang: 'es' | 'en'): string {
  if (!j) return lang === 'en' ? 'No active flow: offer the most useful next step (book, check appointments, ask about services).' : 'Sin flujo activo: ofrece el siguiente paso más útil (agendar, ver citas, preguntar por servicios).';
  const map: Record<string, string> = {
    'booking:need': 'Patient wants to book: find out the specialty or doctor and preferred dates, then search real availability.',
    'booking:time': 'Slots were shown: help the patient pick one (they can tap a card or say e.g. "Friday at 8"). Offer other days/times if none fit.',
    'booking:details': 'A slot is chosen but the patient is not identified: ask for full name and mobile number to finish the booking.',
    'booking:confirm': 'Waiting for the patient to confirm the selected slot.',
    'booking:done': 'Appointment booked: confirm details, mention reminders and preparation, offer to add it to their calendar.',
    'cancel:choose': 'Patient wants to cancel: identify which appointment.',
    'cancel:confirm': 'Ask the patient to confirm which appointment to cancel (cards have a confirm button).',
    'cancel:done': 'Cancelled: offer to book a new date.',
    'reschedule:choose': 'Patient wants to reschedule: identify which appointment.',
    'reschedule:time': 'New slots were shown for rescheduling: help the patient pick one.',
    'reschedule:confirm': 'Waiting for confirmation of the new time.',
    'reschedule:done': 'Rescheduled: confirm the new time.',
  };
  return `Patient journey → ${j.flow} / ${j.step}. ${map[`${j.flow}:${j.step}`] ?? ''}`;
}
