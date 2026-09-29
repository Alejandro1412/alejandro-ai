export type NotificationType =
  | 'APPOINTMENT_BOOKED'
  | 'APPOINTMENT_CHANGED'
  | 'APPOINTMENT_CANCELLED'
  | 'APPOINTMENT_REMINDER'
  | 'HUMAN_HANDOFF'
  | 'SYSTEM_ALERT';

export interface TemplateVars {
  patientName?: string;
  doctorName?: string;
  serviceName?: string;
  when?: string;
  clinicName?: string;
  reason?: string;
  urgency?: string;
  message?: string;
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
};

export function renderTemplate(type: NotificationType, lang: string, vars: TemplateVars) {
  return T[type][lang === 'en' ? 'en' : 'es'](vars);
}
