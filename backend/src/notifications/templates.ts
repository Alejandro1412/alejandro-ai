export type NotificationType =
  | 'APPOINTMENT_BOOKED'
  | 'APPOINTMENT_CHANGED'
  | 'APPOINTMENT_CANCELLED'
  | 'APPOINTMENT_REMINDER'
  | 'HUMAN_HANDOFF'
  | 'SYSTEM_ALERT'
  | 'DEPOSIT_REQUIRED'
  | 'DEPOSIT_RELEASED'
  | 'WAITLIST_OFFER'
  | 'REVIEW_REQUEST'
  | 'REVIEW_LOW_RATING'
  | 'CAMPAIGN'
  | 'BILLING_TRIAL_ENDING'
  | 'BILLING_PAYMENT_FAILED'
  | 'BILLING_SUSPENDED'
  | 'MONTHLY_REPORT'
  | 'ATTENDANCE_CONFIRMED';

export interface TemplateVars {
  patientName?: string;
  doctorName?: string;
  serviceName?: string;
  when?: string;
  clinicName?: string;
  reason?: string;
  urgency?: string;
  message?: string;
  amount?: string;
  link?: string;
  /** Extra lines appended to the body (action links, video link, intake form…). */
  extra?: string;
}

type Lang = 'es' | 'en';

const T: Record<NotificationType, Record<Lang, (v: TemplateVars) => { title: string; body: string }>> = {
  APPOINTMENT_BOOKED: {
    es: (v) => ({ title: 'Cita confirmada', body: `Hola ${v.patientName}, tu cita con ${v.doctorName} quedó confirmada para ${v.when} en ${v.clinicName}.` }),
    en: (v) => ({ title: 'Appointment confirmed', body: `Hi ${v.patientName}, your appointment with ${v.doctorName} is confirmed for ${v.when} at ${v.clinicName}.` }),
  },
  APPOINTMENT_CHANGED: {
    es: (v) => ({ title: 'Cita reprogramada', body: `Hola ${v.patientName}, tu cita con ${v.doctorName} fue reprogramada para ${v.when}.` }),
    en: (v) => ({ title: 'Appointment rescheduled', body: `Hi ${v.patientName}, your appointment with ${v.doctorName} was moved to ${v.when}.` }),
  },
  APPOINTMENT_CANCELLED: {
    es: (v) => ({ title: 'Cita cancelada', body: `Hola ${v.patientName}, tu cita con ${v.doctorName} del ${v.when} fue cancelada.` }),
    en: (v) => ({ title: 'Appointment cancelled', body: `Hi ${v.patientName}, your appointment with ${v.doctorName} on ${v.when} was cancelled.` }),
  },
  APPOINTMENT_REMINDER: {
    es: (v) => ({ title: 'Recordatorio de cita', body: `Hola ${v.patientName}, te recordamos tu cita con ${v.doctorName} el ${v.when} en ${v.clinicName}. Responde si necesitas reprogramar.` }),
    en: (v) => ({ title: 'Appointment reminder', body: `Hi ${v.patientName}, this is a reminder of your appointment with ${v.doctorName} on ${v.when} at ${v.clinicName}. Reply if you need to reschedule.` }),
  },
  HUMAN_HANDOFF: {
    es: (v) => ({ title: `Conversación requiere atención (${v.urgency})`, body: `${v.patientName ?? 'Un paciente'}: ${v.reason}` }),
    en: (v) => ({ title: `Conversation needs attention (${v.urgency})`, body: `${v.patientName ?? 'A patient'}: ${v.reason}` }),
  },
  SYSTEM_ALERT: {
    es: (v) => ({ title: 'Alerta del sistema', body: v.message ?? '' }),
    en: (v) => ({ title: 'System alert', body: v.message ?? '' }),
  },
  DEPOSIT_REQUIRED: {
    es: (v) => ({ title: 'Reserva pendiente de pago', body: `Hola ${v.patientName}, separamos tu cita con ${v.doctorName} para ${v.when}. Para confirmarla, paga el anticipo de ${v.amount} aquí: ${v.link}` }),
    en: (v) => ({ title: 'Deposit required', body: `Hi ${v.patientName}, we are holding your appointment with ${v.doctorName} on ${v.when}. To confirm it, pay the ${v.amount} deposit here: ${v.link}` }),
  },
  DEPOSIT_RELEASED: {
    es: (v) => ({ title: 'Reserva liberada', body: `Hola ${v.patientName}, no recibimos el anticipo de tu cita del ${v.when}, así que liberamos el horario. Puedes agendar de nuevo cuando quieras.` }),
    en: (v) => ({ title: 'Hold released', body: `Hi ${v.patientName}, we did not receive the deposit for your appointment on ${v.when}, so the time was released. You can book again anytime.` }),
  },
  WAITLIST_OFFER: {
    es: (v) => ({ title: 'Se liberó un horario', body: `Hola ${v.patientName}, se liberó un cupo con ${v.doctorName} el ${v.when}. Es para el primero que lo tome: ${v.link}` }),
    en: (v) => ({ title: 'A slot opened up', body: `Hi ${v.patientName}, a slot opened with ${v.doctorName} on ${v.when}. First come, first served: ${v.link}` }),
  },
  REVIEW_REQUEST: {
    es: (v) => ({ title: '¿Cómo te fue?', body: `Hola ${v.patientName}, gracias por visitarnos en ${v.clinicName}. ¿Nos cuentas cómo fue tu experiencia con ${v.doctorName}? Toma 10 segundos: ${v.link}` }),
    en: (v) => ({ title: 'How did it go?', body: `Hi ${v.patientName}, thanks for visiting ${v.clinicName}. How was your experience with ${v.doctorName}? It takes 10 seconds: ${v.link}` }),
  },
  REVIEW_LOW_RATING: {
    es: (v) => ({ title: 'Reseña baja recibida', body: `${v.patientName} calificó su visita con ${v.doctorName}: ${v.message}` }),
    en: (v) => ({ title: 'Low rating received', body: `${v.patientName} rated the visit with ${v.doctorName}: ${v.message}` }),
  },
  CAMPAIGN: {
    es: (v) => ({ title: v.clinicName ?? 'Mensaje de tu clínica', body: v.message ?? '' }),
    en: (v) => ({ title: v.clinicName ?? 'Message from your clinic', body: v.message ?? '' }),
  },
  BILLING_TRIAL_ENDING: {
    es: (v) => ({ title: 'Tu prueba está por terminar', body: `La prueba gratuita de ${v.clinicName} termina ${v.when}. Elige un plan para que Alejandro AI siga atendiendo a tus pacientes.` }),
    en: (v) => ({ title: 'Your trial is ending', body: `The free trial for ${v.clinicName} ends ${v.when}. Choose a plan so Alejandro AI keeps serving your patients.` }),
  },
  BILLING_PAYMENT_FAILED: {
    es: (v) => ({ title: 'No pudimos cobrar tu suscripción', body: `Actualiza tu método de pago antes de ${v.when} para evitar la suspensión del servicio de ${v.clinicName}.` }),
    en: (v) => ({ title: 'We could not charge your subscription', body: `Update your payment method before ${v.when} to avoid suspension of ${v.clinicName}.` }),
  },
  BILLING_SUSPENDED: {
    es: (v) => ({ title: 'Servicio suspendido', body: `La cuenta de ${v.clinicName} está suspendida (${v.reason}). Tus datos están a salvo; reactiva un plan para continuar.` }),
    en: (v) => ({ title: 'Service suspended', body: `The ${v.clinicName} account is suspended (${v.reason}). Your data is safe; reactivate a plan to continue.` }),
  },
  MONTHLY_REPORT: {
    es: (v) => ({ title: `Tu resumen de ${v.when}`, body: v.message ?? '' }),
    en: (v) => ({ title: `Your ${v.when} summary`, body: v.message ?? '' }),
  },
  ATTENDANCE_CONFIRMED: {
    es: (v) => ({ title: 'Asistencia confirmada', body: `${v.patientName} confirmó su cita con ${v.doctorName} (${v.when}).` }),
    en: (v) => ({ title: 'Attendance confirmed', body: `${v.patientName} confirmed the appointment with ${v.doctorName} (${v.when}).` }),
  },
};

export function renderTemplate(type: NotificationType, lang: string, vars: TemplateVars) {
  const raw = T[type][lang === 'en' ? 'en' : 'es'](vars);
  // "8:00 a. m.." → "8:00 a. m." (dates that end with an abbreviation followed by a sentence period).
  const out = { title: raw.title, body: raw.body.replace(/(?<!\.)\.\.(?!\.)/g, '.') };
  return vars.extra ? { title: out.title, body: `${out.body}\n\n${vars.extra}` } : out;
}
