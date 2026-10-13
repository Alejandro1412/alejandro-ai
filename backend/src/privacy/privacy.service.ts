import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import { Database, DB } from '../database/database.module';
import { appointments, clinics, consentRecords, conversations, intakeResponses, messages, patients, reviewRequests, waitlistEntries } from '../database/schema';
import { TenantContext, tenantScope, withTenant } from '../database/tenant';
import { BusinessRuleError, NotFoundError } from '../common/errors/app-error';
import { AuditService } from '../audit/audit.service';

export type ConsentKind = 'DATA_PROCESSING' | 'MARKETING';

export interface ConsentInput {
  patientId?: string | null;
  conversationId?: string | null;
  kind: ConsentKind;
  granted: boolean;
  channel: string;
}

/**
 * Privacy operations: versioned consent evidence, data-subject export (access/portability) and
 * anonymization (erasure while keeping non-identifying operational history).
 * These are technical controls that support compliance programs (Ley 1581 / GDPR / HIPAA-style);
 * they do not by themselves make a deployment compliant.
 */
@Injectable()
export class PrivacyService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly audit: AuditService,
  ) {}

  async clinicPolicy() {
    const [c] = await this.db
      .select({ name: clinics.name, version: clinics.consentVersion, privacyPolicyUrl: clinics.privacyPolicyUrl, slug: clinics.slug })
      .from(clinics)
      .where(and(eq(clinics.id, TenantContext.clinicId()), eq(clinics.organizationId, TenantContext.orgId())));
    return c;
  }

  /** Text shown to the patient before any personal data is stored from a chat. */
  async consentText(lang: 'es' | 'en') {
    const c = await this.clinicPolicy();
    const privacyUrl = c.privacyPolicyUrl ?? `/legal/privacy?clinic=${c.slug}`;
    const text =
      lang === 'en'
        ? `To book I need your name and phone. ${c.name} will use them only to manage your appointments and contact you about them, according to its privacy policy. You can ask for a copy or deletion of your data at any time.`
        : `Para agendar necesito tu nombre y teléfono. ${c.name} los usará solo para gestionar tus citas y contactarte sobre ellas, según su política de privacidad. Puedes pedir una copia o la eliminación de tus datos cuando quieras.`;
    return { version: c.version, privacyUrl, text };
  }

  async record(input: ConsentInput) {
    const { version } = await this.clinicPolicy();
    const ctx = TenantContext.current();
    await this.db.insert(consentRecords).values(
      withTenant({
        clinicId: TenantContext.clinicId(),
        patientId: input.patientId ?? null,
        conversationId: input.conversationId ?? null,
        kind: input.kind,
        granted: input.granted,
        version,
        channel: input.channel,
        ip: ctx?.ip ?? null,
        userAgent: ctx?.userAgent?.slice(0, 300) ?? null,
      }),
    );
    if (input.patientId) {
      const now = new Date();
      const patch =
        input.kind === 'MARKETING'
          ? { marketingConsentAt: input.granted ? now : null }
          : input.granted
            ? { consentAt: now, consentVersion: version }
            : { consentAt: null };
      await this.db.update(patients).set(patch).where(tenantScope(patients, eq(patients.id, input.patientId)));
    }
    await this.audit.log({
      action: input.granted ? 'consent.granted' : 'consent.withdrawn',
      entityType: 'Patient',
      entityId: input.patientId ?? undefined,
      patientId: input.patientId ?? null,
      metadata: { kind: input.kind, version, channel: input.channel, conversationId: input.conversationId ?? null },
    });
  }

  /** Links consent captured in a conversation before the patient existed. */
  async attachConversationConsent(conversationId: string, patientId: string) {
    const rows = await this.db
      .update(consentRecords)
      .set({ patientId })
      .where(tenantScope(consentRecords, eq(consentRecords.conversationId, conversationId)))
      .returning();
    const granted = rows.filter((r) => r.kind === 'DATA_PROCESSING' && r.granted).at(-1);
    if (granted) await this.db.update(patients).set({ consentAt: granted.createdAt, consentVersion: granted.version }).where(tenantScope(patients, eq(patients.id, patientId)));
  }

  async history(patientId: string) {
    return this.db.select().from(consentRecords).where(tenantScope(consentRecords, eq(consentRecords.patientId, patientId))).orderBy(desc(consentRecords.createdAt));
  }

  /** Everything the clinic stores about one patient, in a portable JSON document. */
  async export(patientId: string) {
    const [patient] = await this.db.select().from(patients).where(tenantScope(patients, eq(patients.id, patientId)));
    if (!patient) throw new NotFoundError('Patient', patientId);
    const convs = await this.db.select().from(conversations).where(tenantScope(conversations, eq(conversations.patientId, patientId))).orderBy(asc(conversations.createdAt));
    const msgs = convs.length
      ? await this.db
          .select({ conversationId: messages.conversationId, role: messages.role, content: messages.content, createdAt: messages.createdAt })
          .from(messages)
          .where(tenantScope(messages, inArray(messages.conversationId, convs.map((c) => c.id))))
          .orderBy(asc(messages.createdAt))
      : [];
    const appts = await this.db.query.appointments.findMany({
      where: tenantScope(appointments, eq(appointments.patientId, patientId)),
      with: { doctor: true, service: true },
      orderBy: [asc(appointments.startTime)],
    });
    const intake = appts.length ? await this.db.select().from(intakeResponses).where(tenantScope(intakeResponses, inArray(intakeResponses.appointmentId, appts.map((a) => a.id)))) : [];
    const reviews = await this.db.select().from(reviewRequests).where(tenantScope(reviewRequests, eq(reviewRequests.patientId, patientId)));
    const consents = await this.history(patientId);
    await this.audit.log({ action: 'patient.exported', entityType: 'Patient', entityId: patientId, patientId });
    const { preferences, ...profile } = patient;
    return {
      exportedAt: new Date().toISOString(),
      format: 'alejandro-ai/patient-export@1',
      profile,
      preferences,
      consents: consents.map((c) => ({ kind: c.kind, granted: c.granted, version: c.version, channel: c.channel, at: c.createdAt })),
      appointments: appts.map((a) => ({
        id: a.id,
        start: a.startTime,
        end: a.endTime,
        status: a.status,
        source: a.source,
        doctor: `${a.doctor.title} ${a.doctor.firstName} ${a.doctor.lastName}`,
        service: a.service?.name ?? null,
        intake: intake.find((i) => i.appointmentId === a.id)?.answers ?? null,
      })),
      conversations: convs.map((c) => ({
        id: c.id,
        channel: c.channel,
        startedAt: c.createdAt,
        messages: msgs.filter((m) => m.conversationId === c.id).map(({ role, content, createdAt }) => ({ role, content, at: createdAt })),
      })),
      reviews: reviews.map((r) => ({ rating: r.rating, comment: r.comment, at: r.respondedAt })),
    };
  }

  /**
   * Right to erasure without breaking the clinic's operational history: personal fields are wiped,
   * the patient's own chat messages are redacted, future appointments are cancelled, and appointment
   * rows remain (dates/doctor only) for scheduling statistics. Irreversible.
   */
  async anonymize(patientId: string, reason: string) {
    const [patient] = await this.db.select().from(patients).where(tenantScope(patients, eq(patients.id, patientId)));
    if (!patient) throw new NotFoundError('Patient', patientId);
    if (patient.anonymizedAt) throw new BusinessRuleError('ALREADY_ANONYMIZED', 'This patient was already anonymized');
    await this.db.transaction(async (tx) => {
      await tx
        .update(patients)
        .set({
          firstName: 'Anonimizado',
          lastName: patient.id.slice(0, 8),
          email: null,
          phone: null,
          documentId: null,
          dateOfBirth: null,
          gender: null,
          notes: null,
          tags: ['anonymized'],
          preferences: {},
          userId: null,
          marketingConsentAt: null,
          anonymizedAt: new Date(),
        })
        .where(tenantScope(patients, eq(patients.id, patientId)));
      const convIds = (await tx.select({ id: conversations.id }).from(conversations).where(tenantScope(conversations, eq(conversations.patientId, patientId)))).map((c) => c.id);
      if (convIds.length) {
        await tx.update(messages).set({ content: '[anonimizado]', attachments: [], action: null, trace: null }).where(tenantScope(messages, inArray(messages.conversationId, convIds)));
        await tx.update(conversations).set({ externalContact: null, subject: null, summary: null, metadata: {} }).where(tenantScope(conversations, inArray(conversations.id, convIds)));
      }
      await tx
        .update(appointments)
        .set({ status: 'CANCELLED', cancelledAt: new Date(), cancellationReason: 'Patient data erased on request', notes: null })
        .where(tenantScope(appointments, eq(appointments.patientId, patientId), inArray(appointments.status, ['PENDING', 'CONFIRMED'])));
      await tx.update(appointments).set({ notes: null }).where(tenantScope(appointments, eq(appointments.patientId, patientId)));
      const apptIds = (await tx.select({ id: appointments.id }).from(appointments).where(tenantScope(appointments, eq(appointments.patientId, patientId)))).map((a) => a.id);
      if (apptIds.length) await tx.delete(intakeResponses).where(tenantScope(intakeResponses, inArray(intakeResponses.appointmentId, apptIds)));
      await tx.update(reviewRequests).set({ comment: null }).where(tenantScope(reviewRequests, eq(reviewRequests.patientId, patientId)));
      await tx.delete(waitlistEntries).where(tenantScope(waitlistEntries, eq(waitlistEntries.patientId, patientId)));
    });
    await this.audit.log({ action: 'patient.anonymized', entityType: 'Patient', entityId: patientId, patientId, metadata: { reason } });
    return { anonymized: true, patientId };
  }
}
