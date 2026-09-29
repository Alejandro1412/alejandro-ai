import { Inject, Injectable } from '@nestjs/common';
import { asc, eq } from 'drizzle-orm';
import { Database, DB } from '../../database/database.module';
import { conversations, HandoffSummary, messages, patients, toolExecutions } from '../../database/schema';
import { tenantScope } from '../../database/tenant';
import { NotFoundError } from '../../common/errors/app-error';
import { personName } from '../../common/utils/time';

const INTENT_LABEL: Record<string, { es: string; en: string }> = {
  book_appointment: { es: 'Agendar una cita', en: 'Book an appointment' },
  check_availability: { es: 'Consultar disponibilidad', en: 'Check availability' },
  cancel_appointment: { es: 'Cancelar una cita', en: 'Cancel an appointment' },
  reschedule_appointment: { es: 'Reprogramar una cita', en: 'Reschedule an appointment' },
  my_appointments: { es: 'Consultar sus citas', en: 'Review appointments' },
  services_info: { es: 'Información de servicios', en: 'Services information' },
  pricing: { es: 'Consultar precios', en: 'Pricing question' },
  hours: { es: 'Horarios de atención', en: 'Opening hours' },
  location: { es: 'Ubicación de la clínica', en: 'Clinic location' },
  doctor_info: { es: 'Información de médicos', en: 'Doctor information' },
  billing: { es: 'Pagos / seguros', en: 'Billing / insurance' },
  support: { es: 'Soporte / queja', en: 'Support / complaint' },
  medical_advice: { es: 'Consulta de tipo médico (no respondida por la IA)', en: 'Medical question (not answered by AI)' },
  emergency: { es: 'Posible emergencia', en: 'Possible emergency' },
  human: { es: 'Hablar con una persona', en: 'Talk to a person' },
  general_question: { es: 'Pregunta general', en: 'General question' },
};

const LOW_SIGNAL = new Set(['greeting', 'thanks', 'goodbye', 'identify', 'unknown', 'human']);

/**
 * Factual conversation summary for human handoff. Built ONLY from stored messages and
 * successful tool executions — it cannot invent data. Every field is traceable to a record.
 */
@Injectable()
export class SummarizerService {
  constructor(@Inject(DB) private readonly db: Database) {}

  async summarize(conversationId: string, opts: { reason?: string } = {}): Promise<HandoffSummary> {
    const [conv] = await this.db.select().from(conversations).where(tenantScope(conversations, eq(conversations.id, conversationId)));
    if (!conv) throw new NotFoundError('Conversation', conversationId);
    const lang = conv.language === 'en' ? 'en' : 'es';
    const [patient] = conv.patientId ? await this.db.select().from(patients).where(eq(patients.id, conv.patientId)) : [];
    const msgs = await this.db.select().from(messages).where(tenantScope(messages, eq(messages.conversationId, conversationId))).orderBy(asc(messages.createdAt));
    const tools = await this.db
      .select()
      .from(toolExecutions)
      .where(tenantScope(toolExecutions, eq(toolExecutions.conversationId, conversationId)))
      .orderBy(asc(toolExecutions.createdAt));

    const userMsgs = msgs.filter((m) => m.role === 'USER');
    const intents = userMsgs.map((m) => m.intent).filter((i): i is string => Boolean(i));
    const mainIntent = [...intents].reverse().find((i) => !LOW_SIGNAL.has(i)) ?? intents[intents.length - 1] ?? null;
    const ok = tools.filter((t) => t.status === 'SUCCESS');
    const has = (name: string) => ok.some((t) => t.toolName === name);

    const actionsTaken: string[] = [];
    for (const t of ok) {
      const out = t.output as Record<string, unknown> | null;
      const appt = out?.appointment as { doctorName?: string; when?: string } | undefined;
      switch (t.toolName) {
        case 'createAppointment':
          actionsTaken.push(lang === 'en' ? `Appointment booked: ${appt?.doctorName} — ${appt?.when}` : `Cita creada: ${appt?.doctorName} — ${appt?.when}`);
          break;
        case 'cancelAppointment':
          actionsTaken.push(lang === 'en' ? `Appointment cancelled: ${appt?.doctorName} — ${appt?.when}` : `Cita cancelada: ${appt?.doctorName} — ${appt?.when}`);
          break;
        case 'rescheduleAppointment':
          actionsTaken.push(lang === 'en' ? `Appointment rescheduled to ${appt?.when}` : `Cita reprogramada para ${appt?.when}`);
          break;
        case 'createPatient':
          actionsTaken.push(
            (out?.existing ? (lang === 'en' ? 'Patient identified: ' : 'Paciente identificado: ') : lang === 'en' ? 'New patient registered: ' : 'Paciente nuevo registrado: ') + String(out?.name ?? ''),
          );
          break;
        case 'getAvailableAppointmentSlots':
        case 'getDoctorAvailability': {
          const n = (out?.slots as unknown[] | undefined)?.length ?? 0;
          actionsTaken.push(lang === 'en' ? `Checked availability (${n} slots offered)` : `Consultó disponibilidad (${n} horarios ofrecidos)`);
          break;
        }
        case 'searchClinicKnowledge':
          actionsTaken.push(
            lang === 'en'
              ? `Searched knowledge base: "${String((t.input as { query?: string }).query ?? '')}"${out?.found ? '' : ' (no answer found)'}`
              : `Buscó en la base de conocimiento: "${String((t.input as { query?: string }).query ?? '')}"${out?.found ? '' : ' (sin respuesta)'}`,
          );
          break;
        case 'createLead':
          actionsTaken.push(lang === 'en' ? 'Lead captured' : 'Lead registrado');
          break;
        case 'createSupportTicket':
          actionsTaken.push(lang === 'en' ? 'Support ticket opened' : 'Ticket de soporte creado');
          break;
        default:
          break;
      }
    }
    const dedupActions = [...new Set(actionsTaken)];

    const pendingActions: string[] = [];
    const wanted = new Set(intents);
    if ((wanted.has('book_appointment') || wanted.has('check_availability')) && !has('createAppointment')) pendingActions.push(lang === 'en' ? 'Book the requested appointment' : 'Agendar la cita solicitada');
    if (wanted.has('cancel_appointment') && !has('cancelAppointment')) pendingActions.push(lang === 'en' ? 'Cancel the appointment' : 'Cancelar la cita');
    if (wanted.has('reschedule_appointment') && !has('rescheduleAppointment')) pendingActions.push(lang === 'en' ? 'Reschedule the appointment' : 'Reprogramar la cita');
    for (const m of msgs.filter((x) => x.role === 'ASSISTANT' && x.unanswered)) {
      const q = userMsgs.filter((u) => u.createdAt <= m.createdAt).pop();
      if (q) pendingActions.push(lang === 'en' ? `Answer: "${q.content.slice(0, 120)}"` : `Responder: "${q.content.slice(0, 120)}"`);
    }
    if (opts.reason) pendingActions.push(lang === 'en' ? `Attend: ${opts.reason}` : `Atender: ${opts.reason}`);

    const relevantData: Record<string, string> = { channel: conv.channel, language: conv.language };
    if (patient?.phone) relevantData.phone = patient.phone;
    else if (conv.externalContact) relevantData.contact = conv.externalContact;
    if (patient?.email) relevantData.email = patient.email;
    const lastUser = userMsgs[userMsgs.length - 1];
    if (lastUser) relevantData.lastMessage = lastUser.content.slice(0, 200);

    const who = patient ? personName(patient) : lang === 'en' ? 'An unidentified user' : 'Un usuario no identificado';
    const intentLabel = mainIntent ? (INTENT_LABEL[mainIntent]?.[lang] ?? mainIntent) : lang === 'en' ? 'not determined' : 'no determinada';
    const summary =
      lang === 'en'
        ? `${who} contacted the clinic via ${conv.channel.toLowerCase()}. Main intent: ${intentLabel}. ${userMsgs.length} message(s) from the user; ${dedupActions.length} action(s) completed by the assistant.`
        : `${who} contactó a la clínica por ${conv.channel.toLowerCase()}. Intención principal: ${intentLabel}. ${userMsgs.length} mensaje(s) del usuario; ${dedupActions.length} acción(es) completadas por el asistente.`;

    let recommendation: string;
    if (intents.includes('emergency'))
      recommendation = lang === 'en' ? 'Contact the patient immediately and confirm they reached emergency services.' : 'Contactar al paciente de inmediato y confirmar que haya acudido a servicios de emergencia.';
    else if (intents.includes('support'))
      recommendation = lang === 'en' ? 'Review the complaint/issue and reply personally.' : 'Revisar la queja o incidencia y responder de forma personalizada.';
    else if (intents.includes('medical_advice'))
      recommendation = lang === 'en' ? 'Offer an appointment with the appropriate professional; do not give clinical advice by chat.' : 'Ofrecer una cita con el profesional adecuado; no dar indicaciones clínicas por chat.';
    else if (pendingActions.length)
      recommendation = lang === 'en' ? `Complete the pending action: ${pendingActions[0]}.` : `Completar la acción pendiente: ${pendingActions[0]}.`;
    else recommendation = lang === 'en' ? 'Confirm the user has everything they need and close the conversation.' : 'Confirmar que el usuario tiene todo lo que necesita y cerrar la conversación.';

    return {
      summary,
      intent: mainIntent,
      patient: patient ? { id: patient.id, name: personName(patient) } : null,
      actionsTaken: dedupActions,
      pendingActions: [...new Set(pendingActions)],
      relevantData,
      recommendation,
    };
  }
}
