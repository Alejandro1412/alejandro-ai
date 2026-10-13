import { estimateTokens, type ChatMessage, type LLMProvider, type LLMRequest, type LLMResponse, type ToolCall } from './llm-provider';
import { norm } from '../policy/text';

type ToolOutcome = { ok: boolean; data?: Record<string, unknown>; error?: { code: string; message: string } };
type Lang = 'es' | 'en';

interface Slot {
  doctorId: string;
  doctorName: string;
  specialty: string | null;
  start: string;
}
interface Card {
  id: string;
  doctorId: string;
  doctorName: string;
  specialty: string | null;
  when: string;
}

const YES = /^(si|sí|claro|dale|ok|okay|por favor|yes|sure|please|de acuerdo|perfecto)\b/;

/**
 * Deterministic "LLM" used when no provider key is configured. It implements a real
 * tool-calling policy over the same contract as OpenAI/Anthropic/Gemini (it receives tool
 * specs and tool results and decides the next tool call or the final answer), so the whole
 * agent pipeline — orchestration, policy, validation, audit, cards — runs end-to-end locally.
 */
export class MockLLMProvider implements LLMProvider {
  readonly name = 'mock' as const;

  async complete(req: LLMRequest): Promise<LLMResponse> {
    const started = Date.now();
    const decision = this.decide(req);
    // Simulate a tiny bit of model latency so observability panels show realistic numbers.
    await new Promise((r) => setTimeout(r, 25 + Math.min(80, Date.now() - started)));
    const promptText = req.system + JSON.stringify(req.messages) + JSON.stringify(req.tools);
    const outText = decision.content + JSON.stringify(decision.toolCalls);
    return {
      content: decision.content,
      toolCalls: decision.toolCalls,
      usage: { inputTokens: estimateTokens(promptText), outputTokens: estimateTokens(outText) },
      model: req.model,
      finishReason: decision.toolCalls.length ? 'tool_calls' : 'stop',
    };
  }

  private decide(req: LLMRequest): { content: string; toolCalls: ToolCall[] } {
    const h = req.hints;
    const L: Lang = h.language;
    const lastUserIdx = findLastIndex(req.messages, (m) => m.role === 'user');
    const userText = lastUserIdx >= 0 ? (req.messages[lastUserIdx] as { content: string }).content : '';
    const turn = req.messages.slice(lastUserIdx + 1);
    const results = new Map<string, ToolOutcome>();
    let callCount = 0;
    for (const m of turn) {
      if (m.role === 'tool') {
        results.set(m.name, safeParse(m.content));
      }
      if (m.role === 'assistant' && m.toolCalls) callCount += m.toolCalls.length;
    }
    const available = new Set(req.tools.map((t) => t.name));
    const called = (n: string) => results.has(n);
    const res = (n: string) => results.get(n);
    const call = (name: string, args: Record<string, unknown>) =>
      available.has(name) && callCount < 8
        ? { content: '', toolCalls: [{ id: `mock_${name}_${callCount + 1}`, name, arguments: args }] }
        : { content: t(L, 'Esa acción no está disponible en este momento. ¿Quieres que te comunique con recepción?', "That action isn't available right now. Would you like me to connect you with the front desk?"), toolCalls: [] };
    const say = (content: string) => ({ content: tidy(content), toolCalls: [] as ToolCall[] });
    const e = h.entities as Record<string, string | undefined>;
    const patientName = h.patient?.name?.split(' ')[0];

    // 1) Policy-forced tool (e.g. explicit human handoff).
    if (h.forcedTool) {
      if (!called(h.forcedTool.name)) return call(h.forcedTool.name, h.forcedTool.args);
      const r = res(h.forcedTool.name)!;
      return say(
        r.ok
          ? t(L, 'Listo. Ya le avisé a nuestro equipo de recepción: una persona continuará esta conversación en breve. Mientras tanto, puedo ayudarte con algo más si lo necesitas.', "Done. I've notified our front-desk team — a person will continue this conversation shortly. Meanwhile, I'm happy to help with anything else.")
          : t(L, `No pude transferir la conversación (${r.error?.message}). Por favor llama a la clínica directamente.`, `I couldn't transfer the conversation (${r.error?.message}). Please call the clinic directly.`),
      );
    }

    // 2) Explicit card actions.
    const a = h.action as Record<string, string> | null;
    if (a?.type === 'book_slot') {
      if (!h.patient && !called('createPatient')) return this.identifyOrAsk(e, L, call, say);
      if (!called('createAppointment')) return call('createAppointment', compact({ doctorId: a.doctorId, startTime: a.startTime, serviceId: a.serviceId }));
      return this.afterBooking(res('createAppointment')!, a.doctorId, L, called, res, call, say);
    }
    if (a?.type === 'confirm_cancel') {
      if (!called('cancelAppointment')) return call('cancelAppointment', { appointmentId: a.appointmentId });
      const r = res('cancelAppointment')!;
      const appt = r.data?.appointment as Card | undefined;
      return say(
        r.ok
          ? t(L, `Tu cita con ${appt?.doctorName} del ${appt?.when} quedó cancelada. Te enviamos la confirmación. ¿Quieres agendar una nueva fecha?`, `Your appointment with ${appt?.doctorName} on ${appt?.when} has been cancelled. We've sent you a confirmation. Would you like to book a new date?`)
          : t(L, `No pude cancelar la cita: ${r.error?.message}.`, `I couldn't cancel the appointment: ${r.error?.message}.`),
      );
    }
    if (a?.type === 'confirm_attendance') {
      if (!called('confirmAttendance')) return call('confirmAttendance', { appointmentId: a.appointmentId });
      const r = res('confirmAttendance')!;
      return say(
        r.ok
          ? t(L, `¡Gracias! Quedó confirmada tu asistencia a la cita con ${r.data?.doctorName} el ${r.data?.when}. ¿Necesitas algo más?`, `Thanks! Your attendance with ${r.data?.doctorName} on ${r.data?.when} is confirmed. Anything else?`)
          : t(L, `No pude confirmar la asistencia: ${r.error?.message}.`, `I couldn't confirm attendance: ${r.error?.message}.`),
      );
    }
    if (a?.type === 'start_reschedule') {
      if (!called('getDoctorAvailability')) return call('getDoctorAvailability', { doctorId: a.doctorId, rescheduleAppointmentId: a.appointmentId });
      return this.slotsAnswer(res('getDoctorAvailability')!, L, true);
    }
    if (a?.type === 'reschedule_to') {
      if (!called('rescheduleAppointment')) return call('rescheduleAppointment', compact({ appointmentId: a.appointmentId, newStartTime: a.startTime, doctorId: a.doctorId }));
      const r = res('rescheduleAppointment')!;
      const appt = r.data?.appointment as Card | undefined;
      return say(
        r.ok
          ? t(L, `¡Listo! Tu cita quedó reprogramada para el ${appt?.when} con ${appt?.doctorName}. Te llegará la confirmación.`, `Done! Your appointment is now on ${appt?.when} with ${appt?.doctorName}. You'll receive a confirmation.`)
          : t(L, `No pude reprogramar: ${r.error?.message}. ¿Quieres ver otros horarios?`, `I couldn't reschedule: ${r.error?.message}. Would you like to see other times?`),
      );
    }
    if (a?.type === 'select_doctor') {
      if (!called('getDoctorAvailability')) return call('getDoctorAvailability', { doctorId: a.doctorId });
      return this.slotsAnswer(res('getDoctorAvailability')!, L, false);
    }

    // 3) Identification (explicit or pending from a previous turn).
    const pending = h.pending as { type?: string; action?: Record<string, string>; intent?: string } | null;
    if ((!h.patient || called('createPatient')) && (h.intent === 'identify' || (pending && (e.phone || e.firstName)))) {
      if (!called('createPatient')) return this.identifyOrAsk(e, L, call, say);
      const r = res('createPatient')!;
      if (!r.ok) return say(t(L, `No pude registrar tus datos: ${r.error?.message}`, `I couldn't register your details: ${r.error?.message}`));
      const name = String(r.data?.name ?? '').split(' ')[0];
      if (pending?.type === 'book_slot' && pending.action) {
        if (!called('createAppointment')) return call('createAppointment', compact({ doctorId: pending.action.doctorId, startTime: pending.action.startTime, serviceId: pending.action.serviceId }));
        return this.afterBooking(res('createAppointment')!, pending.action.doctorId, L, called, res, call, say);
      }
      if (pending?.type === 'intent' && pending.intent) {
        const purpose = pending.intent === 'cancel_appointment' ? 'cancel' : pending.intent === 'reschedule_appointment' ? 'reschedule' : 'list';
        if (!called('listPatientAppointments')) return call('listPatientAppointments', { purpose });
        return this.appointmentsAnswer(res('listPatientAppointments')!, purpose, L, called, res, call, say);
      }
      return say(t(L, `Gracias, ${name}. Ya te identifiqué. ¿En qué te puedo ayudar?`, `Thanks, ${name}. You're identified. How can I help?`));
    }

    // 4) Affirmative follow-up to a handoff offer.
    if (YES.test(norm(userText)) && h.lastAssistantMessage && /(recepcion|front desk|comunique|connect you)/.test(norm(h.lastAssistantMessage))) {
      if (!called('requestHumanHandoff')) return call('requestHumanHandoff', { reason: t(L, 'El usuario aceptó hablar con recepción', 'User accepted to talk to the front desk'), urgency: 'MEDIUM' });
      return say(t(L, 'Listo, ya avisé a recepción. Una persona te escribirá en breve.', "Done, I've notified the front desk. A person will reach out shortly."));
    }

    // 5) Intent flows.
    const dates = compact({ fromDate: e.dateFrom, toDate: e.dateTo, timeOfDay: e.timeOfDay });
    switch (h.intent) {
      case 'book_appointment':
      case 'check_availability': {
        if (e.doctorId) {
          if (!called('getDoctorAvailability')) return call('getDoctorAvailability', compact({ doctorId: e.doctorId, serviceId: e.serviceId, ...dates }));
          return this.slotsAnswer(res('getDoctorAvailability')!, L, false);
        }
        if (e.specialtyName || e.serviceId) {
          if (e.specialtyName && !called('getDoctors')) return call('getDoctors', { specialty: e.specialtyName });
          const docs = res('getDoctors');
          if (docs?.ok && !((docs.data?.doctors as unknown[]) ?? []).length) {
            return say(t(L, `Por ahora no tenemos especialistas disponibles en ${e.specialtyName}. ¿Te ayudo con otra especialidad o te comunico con recepción?`, `We currently have no specialists available in ${e.specialtyName}. Can I help with another specialty or connect you with the front desk?`));
          }
          if (!called('getAvailableAppointmentSlots')) return call('getAvailableAppointmentSlots', compact({ specialty: e.specialtyName, serviceId: e.serviceId, ...dates }));
          return this.slotsAnswer(res('getAvailableAppointmentSlots')!, L, false, e.dateLabel);
        }
        const specs = h.catalog.specialties.map((s) => (L === 'en' ? (s.nameEn ?? s.name) : s.name)).join(', ');
        return say(t(L, `¡Con gusto te ayudo a agendar! ¿Con qué especialidad necesitas la cita? Tenemos: ${specs}.`, `Happy to help you book! Which specialty do you need? We offer: ${specs}.`));
      }
      case 'join_waitlist': {
        if (!h.patient) return this.askIdentification(L, say);
        if (!e.specialtyName && !e.doctorId && !e.serviceId)
          return say(t(L, '¡Claro! Te anoto en la lista de espera. ¿Para qué especialidad o con qué doctor?', 'Sure! I will add you to the waitlist. For which specialty or doctor?'));
        if (!called('addToWaitlist')) return call('addToWaitlist', compact({ specialty: e.doctorId ? undefined : e.specialtyName, doctorId: e.doctorId, serviceId: e.serviceId, ...dates }));
        const r = res('addToWaitlist')!;
        if (!r.ok)
          return say(
            r.error?.code === 'ALREADY_ON_WAITLIST'
              ? t(L, 'Ya estás en la lista de espera para eso. Te escribiré apenas se libere un cupo. ¿Te ayudo con algo más?', "You're already on that waitlist. I'll message you as soon as a slot opens. Anything else?")
              : t(L, `No pude anotarte: ${r.error?.message}. ¿Te comunico con recepción?`, `I couldn't add you: ${r.error?.message}. Shall I connect you with the front desk?`),
          );
        return say(
          t(
            L,
            `Listo, quedaste en la lista de espera de ${r.data?.target} hasta el ${r.data?.to}. Si se libera un cupo te enviaré un enlace para tomarlo (el primero que lo acepte se lo queda). ¿Quieres que mientras tanto te muestre el próximo horario disponible?`,
            `Done, you're on the ${r.data?.target} waitlist until ${r.data?.to}. If a slot opens I'll send you a link to take it (first come, first served). Meanwhile, want me to show the next available time?`,
          ),
        );
      }
      case 'confirm_attendance': {
        if (!h.patient) return this.askIdentification(L, say);
        if (!called('listPatientAppointments')) return call('listPatientAppointments', { purpose: 'list' });
        const next = ((res('listPatientAppointments')?.data?.appointments as Card[]) ?? [])[0];
        if (!next) return say(t(L, 'No encuentro citas próximas a tu nombre. ¿Quieres agendar una?', "I can't find upcoming appointments for you. Would you like to book one?"));
        if (!called('confirmAttendance')) return call('confirmAttendance', { appointmentId: next.id });
        const r = res('confirmAttendance')!;
        return say(
          r.ok
            ? t(L, `¡Gracias! Confirmé tu asistencia a la cita con ${r.data?.doctorName} el ${r.data?.when}. Te esperamos. ¿Necesitas algo más?`, `Thanks! Your attendance with ${r.data?.doctorName} on ${r.data?.when} is confirmed. See you then. Anything else?`)
            : t(L, `No pude confirmar: ${r.error?.message}.`, `I couldn't confirm: ${r.error?.message}.`),
        );
      }
      case 'cancel_appointment':
      case 'reschedule_appointment':
      case 'my_appointments': {
        const purpose = h.intent === 'cancel_appointment' ? 'cancel' : h.intent === 'reschedule_appointment' ? 'reschedule' : 'list';
        if (!h.patient) return this.askIdentification(L, say);
        if (!called('listPatientAppointments')) return call('listPatientAppointments', { purpose });
        return this.appointmentsAnswer(res('listPatientAppointments')!, purpose, L, called, res, call, say);
      }
      case 'services_info': {
        if (!called('searchClinicKnowledge')) return call('searchClinicKnowledge', { query: userText.slice(0, 300) });
        if (!called('getServices')) return call('getServices', compact({ specialty: e.specialtyName }));
        const kb = res('searchClinicKnowledge')!;
        const list = ((res('getServices')?.data?.services as { specialty: string | null }[]) ?? []);
        const areas = [...new Set(list.map((x) => x.specialty).filter(Boolean))] as string[];
        const areaText = areas.length ? joinList(areas, L) : '';
        const extra = kb.ok && kb.data?.found ? extractAnswer(kb, userText, 220, areas) : '';
        return say(
          t(
            L,
            `${areaText ? `En ${h.clinicName} ofrecemos atención en ${areaText}, con ${list.length} servicios disponibles.` : `Estos son los servicios de ${h.clinicName}.`}${extra ? ` Según la información de la clínica: ${extra}` : ''}\n\nSi quieres, te ayudo a agendar cualquiera de ellos.`,
            `${areaText ? `At ${h.clinicName} we offer care in ${areaText}, with ${list.length} services available.` : `Here are ${h.clinicName}'s services.`}${extra ? ` From the clinic's information: ${extra}` : ''}\n\nI can help you book any of them.`,
          ),
        );
      }
      case 'pricing': {
        if (e.serviceName || e.serviceId) {
          if (!called('getServiceInformation')) return call('getServiceInformation', compact({ serviceId: e.serviceId, name: e.serviceName }));
          const r = res('getServiceInformation')!;
          if (r.ok) {
            const d = r.data!;
            return say(
              d.price
                ? t(L, `${d.name} tiene un valor de ${d.price} y dura aproximadamente ${d.durationMinutes} minutos. ¿Quieres que busque un horario para agendarlo?`, `${d.name} costs ${d.price} and takes about ${d.durationMinutes} minutes. Shall I look for a time to book it?`)
                : t(L, `El valor de ${d.name} no está publicado. Recepción puede confirmártelo; ¿quieres que te comunique?`, `The price for ${d.name} isn't published. The front desk can confirm it — would you like me to connect you?`),
            );
          }
        }
        if (!called('getServices')) return call('getServices', compact({ specialty: e.specialtyName }));
        return say(t(L, 'Estos son los servicios con su valor cuando está publicado. Si un precio no aparece, recepción puede confirmarlo.', 'Here are the services with their price when published. If a price is missing, the front desk can confirm it.'));
      }
      case 'hours': {
        if (!called('getBusinessHours')) return call('getBusinessHours', {});
        const days = (res('getBusinessHours')?.data?.days as { day: string; open: boolean; intervals: string[] }[]) ?? [];
        const lines = days.map((d) => `• ${d.day}: ${d.open ? d.intervals.join(', ') : t(L, 'cerrado', 'closed')}`).join('\n');
        return say(t(L, `Nuestro horario de atención es:\n${lines}\n\nYo atiendo 24/7 por aquí. ${this.nextStep(h, L)}`, `Our opening hours are:\n${lines}\n\nI'm available 24/7 here. ${this.nextStep(h, L)}`));
      }
      case 'location': {
        if (!called('getClinicLocations')) return call('getClinicLocations', {});
        const locs = (res('getClinicLocations')?.data?.locations as { name: string; address: string; city: string | null; phone: string | null }[]) ?? [];
        if (!locs.length) {
          if (!called('getClinicInformation')) return call('getClinicInformation', {});
          const c = res('getClinicInformation')?.data ?? {};
          return say(t(L, `Estamos en ${c.address ?? 'la dirección registrada de la clínica'}${c.city ? `, ${c.city}` : ''}.`, `We're located at ${c.address ?? "the clinic's registered address"}${c.city ? `, ${c.city}` : ''}.`));
        }
        const lines = locs.map((l) => `• ${l.name}: ${l.address}${l.city ? `, ${l.city}` : ''}${l.phone ? ` (${l.phone})` : ''}`).join('\n');
        return say(t(L, `Nuestras sedes:\n${lines}\n\n${this.nextStep(h, L)}`, `Our locations:\n${lines}\n\n${this.nextStep(h, L)}`));
      }
      case 'doctor_info': {
        if (e.doctorId) {
          if (!called('getDoctorProfile')) return call('getDoctorProfile', { doctorId: e.doctorId });
          const d = res('getDoctorProfile')?.data ?? {};
          return say(t(L, `${d.name} es especialista en ${d.specialty ?? 'medicina'}. ${d.bio ?? ''} ¿Quieres ver su disponibilidad?`, `${d.name} specializes in ${d.specialty ?? 'medicine'}. ${d.bio ?? ''} Would you like to see their availability?`));
        }
        if (!called('getDoctors')) return call('getDoctors', compact({ specialty: e.specialtyName }));
        const n = ((res('getDoctors')?.data?.doctors as unknown[]) ?? []).length;
        return say(t(L, `Contamos con ${n} especialista(s)${e.specialtyName ? ` en ${e.specialtyName}` : ''}. Toca uno para ver su disponibilidad.`, `We have ${n} specialist(s)${e.specialtyName ? ` in ${e.specialtyName}` : ''}. Tap one to see their availability.`));
      }
      case 'medical_advice':
        return say(
          t(
            L,
            `Entiendo tu preocupación${patientName ? `, ${patientName}` : ''}. No puedo dar diagnósticos ni recomendar tratamientos: eso debe evaluarlo un profesional.${e.specialtyName ? ` Puedo buscarte una cita con ${e.specialtyName}.` : ' Puedo ayudarte a agendar una cita con el especialista adecuado.'} Si los síntomas son intensos o empeoran, llama a la línea de emergencias de tu país.`,
            `I understand your concern${patientName ? `, ${patientName}` : ''}. I can't provide a diagnosis or treatment advice — a professional needs to evaluate that.${e.specialtyName ? ` I can find you an appointment with ${e.specialtyName}.` : ' I can help you book with the right specialist.'} If symptoms are severe or getting worse, please call your local emergency number.`,
          ),
        );
      case 'third_party_data':
        return say(
          t(
            L,
            'Por privacidad no puedo compartir datos ni citas de otras personas, aunque sean familiares. Si eres el paciente, puedo ayudarte con tus propias citas una vez te identifique; si gestionas citas de un familiar, recepción puede orientarte sobre la autorización necesaria. ¿Quieres que te comunique con recepción?',
            "For privacy reasons I can't share other people's data or appointments, even family members'. If you are the patient I can help with your own appointments once you're identified; if you manage a relative's appointments, the front desk can explain the authorization needed. Shall I connect you with the front desk?",
          ),
        );
      case 'support': {
        if (!called('createSupportTicket')) return call('createSupportTicket', { subject: userText.slice(0, 80), description: userText.slice(0, 1500), priority: 'MEDIUM' });
        const r = res('createSupportTicket')!;
        return say(
          r.ok
            ? t(L, 'Registré tu solicitud y el equipo de la clínica le dará seguimiento. ¿Hay algo más en lo que pueda ayudarte?', "I've logged your request and the clinic team will follow up. Is there anything else I can help with?")
            : t(L, 'No pude registrar la solicitud. ¿Quieres que te comunique con recepción?', "I couldn't log the request. Would you like me to connect you with the front desk?"),
        );
      }
      case 'greeting':
        return say(
          t(
            L,
            `¡Hola${patientName ? ` ${patientName}` : ''}! 👋 Soy Alejandro AI, el asistente de ${h.clinicName}. Puedo agendar, reprogramar o cancelar tus citas, contarte sobre servicios y precios, y guiarte en todo el proceso. ¿Qué necesitas hoy?`,
            `Hi${patientName ? ` ${patientName}` : ''}! 👋 I'm Alejandro AI, ${h.clinicName}'s assistant. I can book, reschedule or cancel your appointments, tell you about services and prices, and guide you through the whole process. What do you need today?`,
          ),
        );
      case 'thanks':
        return say(t(L, `¡Con mucho gusto${patientName ? `, ${patientName}` : ''}! ${this.nextStep(h, L)}`, `You're very welcome${patientName ? `, ${patientName}` : ''}! ${this.nextStep(h, L)}`));
      case 'preparation': {
        const q = `${userText} ${e.serviceName ?? ''} ${e.specialtyName ?? ''} ${t(L, 'preparación cita llegar documentos', 'preparation appointment arrive documents')}`;
        if (!called('searchClinicKnowledge')) return call('searchClinicKnowledge', { query: q.slice(0, 300) });
        const kb = res('searchClinicKnowledge')!;
        if (kb.ok && kb.data?.found) {
          const focused = (e.serviceName && sectionAbout(kb, e.serviceName.replace(/\(.*\)/, ''))) || (e.specialtyName ? sectionAbout(kb, e.specialtyName) : '');
          const general = sectionAbout(kb, t(L, 'llegada', 'arriv')) || sectionAbout(kb, 'documentos');
          const prep = [focused, general].filter(Boolean).join(' ') || extractAnswer(kb, q, 420);
          return say(
            t(
              L,
              `Así puedes prepararte${e.serviceName ? ` para ${lcFirst(e.serviceName)}` : e.specialtyName ? ` para tu cita de ${e.specialtyName}` : ''}, según la información de ${h.clinicName}: ${prep}\n\nSi tienes una duda médica sobre tu preparación (medicamentos, ayuno por un examen), confírmala con el especialista. ¿Te ayudo con algo más de tu cita?`,
              `Here's how to prepare${e.serviceName ? ` for ${lcFirst(e.serviceName)}` : e.specialtyName ? ` for your ${e.specialtyName} appointment` : ''}, according to ${h.clinicName}'s information: ${prep}\n\nIf you have a medical question about your preparation (medications, fasting for a test), please confirm it with the specialist. Anything else about your appointment?`,
            ),
          );
        }
        return say(t(L, `Te recomiendo llegar 15 minutos antes con tu documento de identidad. ${this.nextStep(h, L)}`, `I recommend arriving 15 minutes early with your ID. ${this.nextStep(h, L)}`));
      }
      case 'capabilities':
        return say(
          t(
            L,
            `Soy ${h.clinicName === '' ? 'tu asistente' : `el asistente de ${h.clinicName}`} y puedo ayudarte con muchas cosas:\n• **Agendar** una cita con disponibilidad real\n• **Reprogramar o cancelar** tus citas\n• Contarte sobre **servicios, precios, horarios y sedes**\n• Explicarte **cómo prepararte** para tu consulta\n• **Recordarte** tus citas y comunicarte con una **persona del equipo**\n\n¿Por dónde empezamos?`,
            `I'm ${h.clinicName}'s assistant and I can help with a lot:\n• **Book** an appointment with real availability\n• **Reschedule or cancel** your appointments\n• Tell you about **services, prices, hours and locations**\n• Explain **how to prepare** for your visit\n• **Remind** you of appointments and connect you with **a team member**\n\nWhere shall we start?`,
          ),
        );
      case 'small_talk':
        return say(this.smallTalk(String(e.topic ?? ''), h, L, patientName));
      case 'affirm':
      case 'deny':
        return say(
          h.intent === 'deny'
            ? t(L, `Entendido. ${this.nextStep(h, L)}`, `Got it. ${this.nextStep(h, L)}`)
            : t(L, `¡Perfecto! ${this.nextStep(h, L)}`, `Great! ${this.nextStep(h, L)}`),
        );
      case 'goodbye':
        return say(t(L, '¡Hasta pronto! Que tengas un excelente día.', 'Goodbye! Have a great day.'));
      default: {
        // billing, general_question, unknown → grounded answer from the knowledge base or honest fallback.
        if (!called('searchClinicKnowledge')) return call('searchClinicKnowledge', { query: userText.slice(0, 300) });
        const kb = res('searchClinicKnowledge')!;
        if (kb.ok && kb.data?.found) {
          return say(t(L, `Según la información de ${h.clinicName}: ${extractAnswer(kb, userText, 420)}`, `According to ${h.clinicName}'s information: ${extractAnswer(kb, userText, 420)}`));
        }
        const clinicRelated = /(clinica|clinic|cita|appointment|doctor|medic|servicio|service|precio|price|horario|hours|sede|pago|payment|seguro|insurance|examen|exam|consulta|resultado|parqueadero|parking)/.test(norm(userText));
        return say(
          clinicRelated
            ? t(
                L,
                'No tengo esa información confirmada y prefiero no darte un dato incorrecto. Puedo comunicarte con recepción para confirmarlo, o ayudarte con tu cita mientras tanto. ¿Qué prefieres?',
                "I don't have confirmed information about that and I'd rather not guess. I can connect you with the front desk to confirm it, or help you with your appointment meanwhile. What would you prefer?",
              )
            : t(
                L,
                `Buena pregunta 🙂 Ese tema se sale de lo que puedo responder con certeza como asistente de ${h.clinicName}, y no quiero inventarte nada. ${this.nextStep(h, L)}`,
                `Good question 🙂 That's outside what I can answer reliably as ${h.clinicName}'s assistant, and I don't want to make anything up. ${this.nextStep(h, L)}`,
              ),
        );
      }
    }
  }

  /** The guiding sentence every conversational reply ends with, based on where the patient is. */
  private nextStep(h: LLMRequest['hints'], L: Lang): string {
    const step = h.journey ? `${h.journey.flow}:${h.journey.step}` : '';
    switch (step) {
      case 'booking:need':
        return t(L, '¿Para qué especialidad quieres la cita?', 'Which specialty would you like the appointment for?');
      case 'booking:time':
      case 'reschedule:time':
        return t(L, 'Cuando quieras, elige uno de los horarios que te mostré o dime qué día te queda mejor.', 'Whenever you like, pick one of the times I showed you or tell me which day suits you best.');
      case 'booking:details':
        return t(L, 'Para terminar tu reserva solo necesito tu nombre completo y tu celular.', 'To finish your booking I just need your full name and mobile number.');
      case 'booking:confirm':
      case 'reschedule:confirm':
      case 'cancel:confirm':
        return t(L, '¿Confirmamos la opción que te propuse?', 'Shall we confirm the option I suggested?');
      case 'booking:done':
        return t(L, 'Si quieres te explico cómo prepararte para tu cita.', 'If you like, I can explain how to prepare for your appointment.');
      default:
        return h.patient
          ? t(L, '¿Quieres agendar una cita, revisar tus citas o tienes alguna pregunta sobre la clínica?', 'Would you like to book an appointment, check your appointments or ask something about the clinic?')
          : t(L, '¿Te ayudo a agendar una cita o tienes alguna pregunta sobre la clínica?', 'Can I help you book an appointment, or do you have a question about the clinic?');
    }
  }

  private smallTalk(topic: string, h: LLMRequest['hints'], L: Lang, name?: string): string {
    const next = this.nextStep(h, L);
    const hi = name ? `, ${name}` : '';
    switch (topic) {
      case 'how_are_you':
        return t(L, `¡Muy bien, gracias por preguntar${hi}! Listo para ayudarte. ${next}`, `I'm doing great, thanks for asking${hi}! Ready to help. ${next}`);
      case 'who_are_you':
        return t(L, `Soy Alejandro AI, el asistente inteligente de ${h.clinicName}. Atiendo 24/7, consulto la agenda real de los médicos y puedo gestionar tus citas de principio a fin. ${next}`, `I'm Alejandro AI, ${h.clinicName}'s intelligent assistant. I'm available 24/7, I check the doctors' real schedules and can handle your appointments end to end. ${next}`);
      case 'are_you_bot':
        return t(L, `Soy un asistente de inteligencia artificial, no una persona. Trabajo con los datos reales de la clínica y, si en algún momento prefieres hablar con alguien del equipo, te comunico de inmediato. ${next}`, `I'm an AI assistant, not a person. I work with the clinic's real data, and whenever you'd rather talk to someone on the team I'll connect you right away. ${next}`);
      case 'joke':
        return t(L, `¿Sabes por qué el libro de matemáticas fue al médico? ¡Porque tenía demasiados problemas! 😄 Por suerte, agendar una cita conmigo no es ninguno. ${next}`, `Why did the math book go to the doctor? It had too many problems! 😄 Luckily, booking with me isn't one of them. ${next}`);
      case 'compliment':
        return t(L, `¡Muchas gracias${hi}, me alegra ayudarte! ${next}`, `Thank you so much${hi}, I'm glad to help! ${next}`);
      case 'frustration':
        return t(L, 'Lamento no haberte entendido bien. Vamos paso a paso: dime en pocas palabras qué necesitas (por ejemplo, "cita de dermatología el viernes") o, si prefieres, te comunico con una persona del equipo.', "Sorry I didn't get that right. Let's go step by step: tell me briefly what you need (for example, \"dermatology appointment on Friday\") or, if you prefer, I'll connect you with a team member.");
      case 'ack':
        return t(L, `¡Perfecto! ${next}`, `Perfect! ${next}`);
      default:
        return next;
    }
  }

  private askIdentification(L: Lang, say: (c: string) => { content: string; toolCalls: ToolCall[] }) {
    return say(t(L, 'Para continuar necesito identificarte. ¿Me compartes tu nombre completo y número de celular?', 'To continue I need to identify you. Could you share your full name and mobile number?'));
  }

  private identifyOrAsk(
    e: Record<string, string | undefined>,
    L: Lang,
    call: (n: string, a: Record<string, unknown>) => { content: string; toolCalls: ToolCall[] },
    say: (c: string) => { content: string; toolCalls: ToolCall[] },
  ) {
    if (e.phone && e.firstName) return call('createPatient', compact({ firstName: e.firstName, lastName: e.lastName ?? '', phone: e.phone, email: e.email }));
    if (e.phone && !e.firstName) return say(t(L, 'Gracias. ¿Me indicas también tu nombre completo?', 'Thanks. Could you also tell me your full name?'));
    if (e.firstName && !e.phone) return say(t(L, `Gracias, ${e.firstName}. ¿Cuál es tu número de celular?`, `Thanks, ${e.firstName}. What's your mobile number?`));
    return this.askIdentification(L, say);
  }

  private afterBooking(
    r: ToolOutcome,
    doctorId: string | undefined,
    L: Lang,
    called: (n: string) => boolean,
    res: (n: string) => ToolOutcome | undefined,
    call: (n: string, a: Record<string, unknown>) => { content: string; toolCalls: ToolCall[] },
    say: (c: string) => { content: string; toolCalls: ToolCall[] },
  ) {
    if (r.ok) {
      const appt = r.data?.appointment as Card & { paymentUrl?: string | null; depositAmount?: string | null; videoUrl?: string | null; intakeUrl?: string | null };
      const extras = [
        appt.videoUrl ? t(L, ' Es una consulta por video: el enlace está en la tarjeta y en tu confirmación.', ' It is a video visit: the link is on the card and in your confirmation.') : '',
        appt.intakeUrl ? t(L, ' Te dejé un formulario corto para completar antes de la cita.', ' I left you a short form to fill in before the visit.') : '',
      ].join('');
      if (appt.paymentUrl)
        return say(
          t(
            L,
            `Separé tu cita con ${appt.doctorName}${appt.specialty ? ` (${appt.specialty})` : ''} para el ${appt.when}. Para confirmarla, paga el anticipo de ${appt.depositAmount} con el botón de la tarjeta; si no se recibe a tiempo, el horario se libera.${extras} ¿Te ayudo con algo más?`,
            `I'm holding your appointment with ${appt.doctorName}${appt.specialty ? ` (${appt.specialty})` : ''} on ${appt.when}. To confirm it, pay the ${appt.depositAmount} deposit with the button on the card; if it isn't received in time the slot is released.${extras} Anything else?`,
          ),
        );
      if (extras)
        return say(
          t(
            L,
            `¡Listo! Tu cita con ${appt.doctorName}${appt.specialty ? ` (${appt.specialty})` : ''} quedó confirmada para el ${appt.when}.${extras} ¿Necesitas algo más?`,
            `All set! Your appointment with ${appt.doctorName}${appt.specialty ? ` (${appt.specialty})` : ''} is confirmed for ${appt.when}.${extras} Anything else?`,
          ),
        );
      return say(
        t(
          L,
          `¡Listo! Tu cita con ${appt.doctorName}${appt.specialty ? ` (${appt.specialty})` : ''} quedó confirmada para el ${appt.when}. Te enviaremos un recordatorio antes de la cita. ¿Necesitas algo más?`,
          `All set! Your appointment with ${appt.doctorName}${appt.specialty ? ` (${appt.specialty})` : ''} is confirmed for ${appt.when}. We'll send you a reminder beforehand. Anything else?`,
        ),
      );
    }
    if (r.error?.code === 'PATIENT_NOT_IDENTIFIED') return this.askIdentification(L, say);
    if ((r.error?.code === 'APPOINTMENT_CONFLICT' || r.error?.code === 'TOO_SOON') && doctorId) {
      if (!called('getDoctorAvailability')) return call('getDoctorAvailability', { doctorId });
      return this.slotsAnswer(res('getDoctorAvailability')!, L, false, undefined, t(L, 'Ese horario acaba de ocuparse. ', 'That time was just taken. '));
    }
    return say(t(L, `No pude agendar la cita: ${r.error?.message}. ¿Quieres intentar con otro horario?`, `I couldn't book the appointment: ${r.error?.message}. Would you like to try another time?`));
  }

  private slotsAnswer(r: ToolOutcome, L: Lang, reschedule: boolean, dateLabel?: string, prefix = '') {
    if (!r.ok) return { content: t(L, `No pude consultar la disponibilidad: ${r.error?.message}`, `I couldn't check availability: ${r.error?.message}`), toolCalls: [] };
    const slots = (r.data?.slots as Slot[]) ?? [];
    if (!slots.length)
      return {
        content: t(
          L,
          'No encontré horarios disponibles en las próximas semanas. Puedo anotarte en la lista de espera y avisarte apenas se libere un cupo, o comunicarte con recepción. ¿Qué prefieres?',
          "I couldn't find available times in the coming weeks. I can put you on the waitlist and message you as soon as a slot opens, or connect you with the front desk. Which do you prefer?",
        ),
        toolCalls: [],
      };
    const doctors = [...new Set(slots.map((s) => s.doctorName))];
    const who = doctors.length === 1 ? t(L, ` con ${doctors[0]}`, ` with ${doctors[0]}`) : '';
    const ext = r.data?.extended ? t(L, 'Para las fechas que pediste ya no hay cupos, pero encontré estos próximos horarios', "There are no openings for the dates you asked, but I found these upcoming times") : '';
    const when = dateLabel === 'this_week' ? t(L, ' esta semana', ' this week') : '';
    const body = reschedule
      ? t(L, `Estos son los nuevos horarios disponibles${who}. Elige uno para mover tu cita:`, `Here are the new available times${who}. Pick one to move your appointment:`)
      : ext
        ? `${ext}${who}. ${t(L, 'Elige uno para reservarlo:', 'Pick one to book it:')}`
        : t(L, `Claro. Tengo estos horarios disponibles${who}${when}. Elige uno para reservarlo:`, `Sure. I have these available times${who}${when}. Pick one to book it:`);
    return { content: prefix + body, toolCalls: [] };
  }

  private appointmentsAnswer(
    r: ToolOutcome,
    purpose: string,
    L: Lang,
    called: (n: string) => boolean,
    res: (n: string) => ToolOutcome | undefined,
    call: (n: string, a: Record<string, unknown>) => { content: string; toolCalls: ToolCall[] },
    say: (c: string) => { content: string; toolCalls: ToolCall[] },
  ) {
    if (!r.ok) {
      if (r.error?.code === 'PATIENT_NOT_IDENTIFIED') return this.askIdentification(L, say);
      return say(t(L, `No pude consultar tus citas: ${r.error?.message}`, `I couldn't retrieve your appointments: ${r.error?.message}`));
    }
    const items = (r.data?.appointments as Card[]) ?? [];
    if (!items.length) return say(t(L, 'No encontré citas próximas a tu nombre. ¿Quieres agendar una?', "I couldn't find upcoming appointments under your name. Would you like to book one?"));
    if (purpose === 'cancel') {
      return say(
        items.length === 1
          ? t(L, `Encontré tu cita con ${items[0].doctorName} el ${items[0].when}. ¿Confirmas que deseas cancelarla? Usa el botón de la tarjeta para confirmar.`, `I found your appointment with ${items[0].doctorName} on ${items[0].when}. Do you confirm you want to cancel it? Use the button on the card to confirm.`)
          : t(L, `Encontré ${items.length} citas próximas. ¿Cuál deseas cancelar? Confirma en la tarjeta correspondiente.`, `I found ${items.length} upcoming appointments. Which one do you want to cancel? Confirm on the matching card.`),
      );
    }
    if (purpose === 'reschedule') {
      if (items.length === 1) {
        if (!called('getDoctorAvailability')) return call('getDoctorAvailability', { doctorId: items[0].doctorId, rescheduleAppointmentId: items[0].id });
        const slots = res('getDoctorAvailability')!;
        const ans = this.slotsAnswer(slots, L, true);
        return say(t(L, `Tu cita actual es el ${items[0].when} con ${items[0].doctorName}. `, `Your current appointment is on ${items[0].when} with ${items[0].doctorName}. `) + ans.content);
      }
      return say(t(L, `Tienes ${items.length} citas próximas. ¿Cuál quieres reprogramar?`, `You have ${items.length} upcoming appointments. Which one would you like to reschedule?`));
    }
    const lines = items.map((i) => `• ${i.when} — ${i.doctorName}${i.specialty ? ` (${i.specialty})` : ''}`).join('\n');
    return say(t(L, `Estas son tus próximas citas:\n${lines}`, `These are your upcoming appointments:\n${lines}`));
  }
}

/** Collapses artifacts like "p. m.." produced when a formatted time ends a sentence. */
function tidy(s: string) {
  return s.replace(/\.\.(?!\.)/g, '.').replace(/[ \t]+\n/g, '\n');
}

const lcFirst = (x: string) => (/^[A-ZÁÉÍÓÚÑ][a-záéíóúñ]/.test(x) ? x[0].toLowerCase() + x.slice(1) : x);

function t(lang: Lang, es: string, en: string) {
  return lang === 'en' ? en : es;
}

function compact<T extends Record<string, unknown>>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== '')) as Partial<T>;
}

function safeParse(s: string): ToolOutcome {
  try {
    return JSON.parse(s) as ToolOutcome;
  } catch {
    return { ok: false, error: { code: 'PARSE', message: s } };
  }
}

function findLastIndex<T>(arr: T[], fn: (x: T) => boolean): number {
  for (let i = arr.length - 1; i >= 0; i--) if (fn(arr[i])) return i;
  return -1;
}

/** Picks the sentences of the best chunks that overlap most with the question (extractive, never invented). */
function joinList(xs: string[], L: Lang) {
  if (xs.length <= 1) return xs.join('');
  return `${xs.slice(0, -1).join(', ')} ${L === 'en' ? 'and' : 'y'} ${xs[xs.length - 1]}`;
}

export function extractAnswer(kb: ToolOutcome, question: string, maxLen: number, exclude: string[] = []): string {
  const results = (kb.data?.results as { content: string }[]) ?? [];
  const q = new Set(
    norm(question)
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length > 3),
  );
  const sentences = results
    .flatMap((r) => r.content.replace(/^P: .*\nR: /m, '').split('\n'))
    .map((line) => line.trim())
    // Drop headings / titles (short lines without terminal punctuation) and FAQ question lines.
    .filter((line) => line && !/^#/.test(line) && !/^P:/.test(line) && (/[.!?:]$/.test(line) || line.length > 80))
    .flatMap((line) => line.split(/(?<=[.!?])\s+/))
    .map((x) => x.replace(/^R:\s*/, '').trim())
    .filter((x) => x.length > 12 && !exclude.some((e) => norm(x).startsWith(`el servicio de ${norm(e)}`)));
  const scored = sentences.map((s, i) => ({ s, i, score: [...q].filter((w) => norm(s).includes(w.slice(0, Math.max(4, w.length - 2)))).length }));
  const chosen: typeof scored = [];
  let len = 0;
  for (const b of [...scored].sort((a, b) => b.score - a.score || a.i - b.i)) {
    if (chosen.some((c) => c.s === b.s)) continue;
    if (len + b.s.length + 1 > maxLen) break;
    chosen.push(b);
    len += b.s.length + 1;
  }
  // Keep the document's original order so the answer reads naturally.
  const out = chosen
    .sort((a, b) => a.i - b.i)
    .map((c) => c.s)
    .join(' ');
  return out || (results[0]?.content.slice(0, maxLen) ?? '');
}

export type { ChatMessage };

/** Body text of the knowledge section whose heading mentions `topic` (e.g. the specialty), limited in length. */
const GENERIC_WORDS = new Set(['consulta', 'consultation', 'control', 'para', 'cita', 'appointment', 'valoracion', 'assessment', 'tratamiento', 'treatment']);

export function sectionAbout(kb: ToolOutcome, topic: string, maxLen = 320): string {
  // Use the most specific word of the topic ("Consulta de ortopedia" → "ortopedia").
  const words = norm(topic)
    .split(/[^a-z]+/)
    .filter((w) => w.length > 3 && !GENERIC_WORDS.has(w))
    .sort((a, b) => b.length - a.length);
  const stem = (words[0] ?? norm(topic)).slice(0, 6);
  const results = (kb.data?.results as { content: string }[]) ?? [];
  for (const r of results) {
    let current = '';
    const bodies: Record<string, string[]> = {};
    for (const raw of r.content.split('\n')) {
      const line = raw.trim();
      if (!line) continue;
      if (/^#+\s/.test(line)) {
        current = norm(line.replace(/^#+\s/, ''));
        continue;
      }
      (bodies[current] ??= []).push(line);
    }
    const key = Object.keys(bodies).find((h) => h && h.includes(stem));
    if (key) {
      const text = bodies[key].join(' ');
      return text.length > maxLen ? `${text.slice(0, text.lastIndexOf('.', maxLen) + 1 || maxLen)}` : text;
    }
  }
  return '';
}
