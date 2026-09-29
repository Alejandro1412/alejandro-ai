import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, ilike } from 'drizzle-orm';
import { Database, DB } from '../database/database.module';
import { appointments, patients } from '../database/schema';
import { tenantScope } from '../database/tenant';
import { NotFoundError } from '../common/errors/app-error';
import { ConversationsService, type Channel } from '../conversations/conversations.service';
import { AgentConfigService } from './agent-config.service';
import { OrchestratorService, type TurnResult } from './orchestrator/orchestrator.service';

/** Channel-facing chat entry points (playground, portal, public webchat, WhatsApp). */
@Injectable()
export class ChatService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly conversations: ConversationsService,
    private readonly orchestrator: OrchestratorService,
    private readonly config: AgentConfigService,
  ) {}

  async start(input: { channel: Channel; patientId?: string | null; language?: 'es' | 'en'; externalContact?: string | null; sessionTokenHash?: string | null; metadata?: Record<string, unknown> }) {
    if (input.patientId) {
      const [p] = await this.db.select({ id: patients.id }).from(patients).where(tenantScope(patients, eq(patients.id, input.patientId)));
      if (!p) throw new NotFoundError('Patient', input.patientId);
    }
    const agent = await this.config.get();
    const lang = input.language ?? (agent.languages[0] as 'es' | 'en') ?? 'es';
    const conv = await this.conversations.create({ ...input, language: lang });
    const welcome = await this.conversations.addMessage(conv.id, {
      role: 'ASSISTANT',
      content: lang === 'en' ? agent.welcomeMessageEn : agent.welcomeMessage,
      language: lang,
      attachments: [
        {
          type: 'suggestions',
          items:
            lang === 'en'
              ? [
                  { label: 'Book an appointment', message: 'I want to book an appointment' },
                  { label: 'Services', message: 'What services do you offer?' },
                  { label: 'Opening hours', message: 'What are your opening hours?' },
                  { label: 'Talk to a person', message: 'I want to talk to a person' },
                ]
              : [
                  { label: 'Agendar una cita', message: 'Quiero agendar una cita' },
                  { label: 'Servicios', message: '¿Qué servicios ofrece la clínica?' },
                  { label: 'Horarios', message: '¿Cuál es el horario de atención?' },
                  { label: 'Hablar con una persona', message: 'Quiero hablar con una persona' },
                ],
        },
      ],
    });
    return { conversation: { ...conv, sessionTokenHash: undefined }, welcome, agent: { name: agent.name } };
  }

  send(conversationId: string, text: string, action?: Record<string, unknown> | null): Promise<TurnResult> {
    return this.orchestrator.handleTurn({ conversationId, text, action });
  }

  /** Ready-made demo scenarios for the AI Playground, resolved against the tenant's real data. */
  async scenarios() {
    const [maria] = await this.db
      .select({ id: patients.id, firstName: patients.firstName, lastName: patients.lastName })
      .from(patients)
      .where(tenantScope(patients, ilike(patients.firstName, 'mar%'), ilike(patients.lastName, 'rodr%')))
      .limit(1);
    const [withAppt] = await this.db
      .select({ patientId: appointments.patientId })
      .from(appointments)
      .where(tenantScope(appointments, and(eq(appointments.status, 'CONFIRMED'))))
      .orderBy(desc(appointments.startTime))
      .limit(1);
    const demoPatient = maria?.id ?? withAppt?.patientId ?? null;
    return [
      { id: 'book-derm', title: 'Agendar dermatología', description: 'Intent → getDoctors → getAvailableAppointmentSlots → slot cards → createAppointment', patientId: demoPatient, messages: ['Hola, necesito una cita con dermatología esta semana.'] },
      { id: 'cancel', title: 'Cancelar cita', description: 'listPatientAppointments → confirmación → cancelAppointment', patientId: demoPatient, messages: ['Quiero cancelar mi cita.'] },
      { id: 'reschedule', title: 'Reprogramar cita', description: 'listPatientAppointments → getDoctorAvailability → rescheduleAppointment', patientId: demoPatient, messages: ['Necesito reprogramar mi cita.'] },
      { id: 'rag-services', title: 'Servicios (RAG)', description: 'searchClinicKnowledge (pgvector) + getServices', patientId: demoPatient, messages: ['¿Qué servicios ofrece la clínica?'] },
      { id: 'rag-policy', title: 'Política de cancelación (RAG)', description: 'Respuesta fundamentada en la base de conocimiento con citas', patientId: demoPatient, messages: ['¿Cuál es la política de cancelación?'] },
      { id: 'handoff', title: 'Handoff humano', description: 'Policy engine fuerza requestHumanHandoff → cola de recepción', patientId: demoPatient, messages: ['Quiero hablar con una persona.'] },
      { id: 'medical', title: 'Pregunta médica (seguridad)', description: 'MEDICAL_SAFETY: no diagnostica, ofrece cita', patientId: demoPatient, messages: ['Tengo una mancha en la piel que me pica, ¿qué medicamento tomo?'] },
      { id: 'emergency', title: 'Emergencia', description: 'EMERGENCY: respuesta de seguridad inmediata + handoff CRITICAL sin llamar al LLM', patientId: demoPatient, messages: ['Tengo un dolor muy fuerte en el pecho y no puedo respirar'] },
      { id: 'new-patient', title: 'Paciente nuevo (EN)', description: 'Unidentified user → slot → createPatient → createAppointment', patientId: null, messages: ['Hi! I need a cardiology appointment next week.'] },
    ];
  }
}
