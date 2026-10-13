import { Inject, Injectable } from '@nestjs/common';
import { and, count, desc, eq, ilike, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { Database, DB } from '../database/database.module';
import { appointments, conversations, patients, PatientPreferences } from '../database/schema';
import { TenantContext, tenantScope, withTenant } from '../database/tenant';
import { NotFoundError } from '../common/errors/app-error';
import { likeTerm, offsetOf, Paginated, paginationSchema } from '../common/utils/pagination';
import { AuditService } from '../audit/audit.service';
import { PrivacyService } from '../privacy/privacy.service';
import { parseCsv, pick } from '../common/utils/csv';

export const patientSchema = z.object({
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().min(1).max(80),
  email: z.string().trim().toLowerCase().email().max(254).nullable().optional(),
  phone: z
    .string()
    .trim()
    .regex(/^\+?[0-9 ()-]{7,20}$/, 'Invalid phone number')
    .nullable()
    .optional(),
  documentId: z.string().trim().max(40).nullable().optional(),
  dateOfBirth: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional(),
  gender: z.enum(['F', 'M', 'X']).nullable().optional(),
  preferredLanguage: z.enum(['es', 'en']).default('es'),
  notes: z.string().trim().max(2000).nullable().optional(),
  tags: z.array(z.string().trim().max(30)).max(20).default([]),
  /** Staff attests that the patient authorized data processing (recorded as consent evidence). */
  consent: z.boolean().optional(),
  marketingConsent: z.boolean().optional(),
});

export const patientListSchema = paginationSchema.extend({ tag: z.string().max(30).optional() });

/** Keys the AI may persist as long-term administrative memory. Anything else is discarded. */
const ALLOWED_PREFERENCE_KEYS: (keyof PatientPreferences)[] = ['preferredDoctorId', 'preferredContactChannel', 'preferredTimeOfDay'];

export const normalizePhone = (phone: string) => phone.replace(/[^\d+]/g, '');

@Injectable()
export class PatientsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly audit: AuditService,
    private readonly privacy: PrivacyService,
  ) {}

  async list(q: z.infer<typeof patientListSchema>) {
    const where = tenantScope(
      patients,
      eq(patients.clinicId, TenantContext.clinicId()),
      q.search
        ? or(
            ilike(patients.firstName, likeTerm(q.search)),
            ilike(patients.lastName, likeTerm(q.search)),
            ilike(patients.email, likeTerm(q.search)),
            ilike(patients.phone, likeTerm(q.search)),
            ilike(sql`${patients.firstName} || ' ' || ${patients.lastName}`, likeTerm(q.search)),
          )
        : undefined,
      q.tag ? sql`${q.tag} = any(${patients.tags})` : undefined,
    );
    const [items, [{ total }]] = await Promise.all([
      this.db
        .select({
          patient: patients,
          appointmentCount: sql<number>`(select count(*)::int from ${appointments} a where a.patient_id = ${patients.id})`,
          nextAppointment: sql<string | null>`(select min(a.start_time) from ${appointments} a where a.patient_id = ${patients.id} and a.start_time > now() and a.status in ('CONFIRMED','PENDING'))`,
        })
        .from(patients)
        .where(where)
        .orderBy(desc(patients.createdAt))
        .limit(q.pageSize)
        .offset(offsetOf(q)),
      this.db.select({ total: count() }).from(patients).where(where),
    ]);
    return Paginated.of(
      items.map((r) => ({ ...r.patient, appointmentCount: r.appointmentCount, nextAppointment: r.nextAppointment })),
      total,
      q,
    );
  }

  /** Reading a patient record is an audited event. */
  async get(id: string, opts: { audit?: boolean } = { audit: true }) {
    const patient = await this.db.query.patients.findFirst({
      where: tenantScope(patients, eq(patients.id, id)),
      with: {
        appointments: { with: { doctor: true, service: true }, orderBy: [desc(appointments.startTime)], limit: 50 },
        conversations: { orderBy: [desc(conversations.lastMessageAt)], limit: 20 },
      },
    });
    if (!patient) throw new NotFoundError('Patient', id);
    if (opts.audit) await this.audit.log({ action: 'patient.viewed', entityType: 'Patient', entityId: id, patientId: id });
    return patient;
  }

  async create(input: z.infer<typeof patientSchema>, source = 'HUMAN') {
    const { consent, marketingConsent, ...dto } = input;
    const [row] = await this.db
      .insert(patients)
      .values(withTenant({ ...dto, phone: dto.phone ? normalizePhone(dto.phone) : dto.phone, clinicId: TenantContext.clinicId(), source }))
      .returning();
    if (consent) await this.privacy.record({ patientId: row.id, kind: 'DATA_PROCESSING', granted: true, channel: source });
    if (marketingConsent) await this.privacy.record({ patientId: row.id, kind: 'MARKETING', granted: true, channel: source });
    await this.audit.log({ action: 'patient.created', entityType: 'Patient', entityId: row.id, patientId: row.id, metadata: { source } });
    return row;
  }

  async update(id: string, input: Partial<z.infer<typeof patientSchema>>) {
    const { consent, marketingConsent, ...dto } = input;
    if (consent !== undefined) await this.privacy.record({ patientId: id, kind: 'DATA_PROCESSING', granted: consent, channel: 'STAFF' });
    if (marketingConsent !== undefined) await this.privacy.record({ patientId: id, kind: 'MARKETING', granted: marketingConsent, channel: 'STAFF' });
    if (!Object.keys(dto).length) return this.get(id, { audit: false });
    const [row] = await this.db
      .update(patients)
      .set({ ...dto, ...(dto.phone ? { phone: normalizePhone(dto.phone) } : {}) })
      .where(tenantScope(patients, eq(patients.id, id)))
      .returning();
    if (!row) throw new NotFoundError('Patient', id);
    await this.audit.log({ action: 'patient.updated', entityType: 'Patient', entityId: id, patientId: id, metadata: { fields: Object.keys(dto) } });
    return row;
  }

  async remove(id: string) {
    const [row] = await this.db.delete(patients).where(tenantScope(patients, eq(patients.id, id))).returning({ id: patients.id });
    if (!row) throw new NotFoundError('Patient', id);
    await this.audit.log({ action: 'patient.deleted', entityType: 'Patient', entityId: id, patientId: id });
    return row;
  }

  /** Exact match on normalized phone or email inside the current tenant. */
  async findByContact(contact: { phone?: string | null; email?: string | null }) {
    const conds = [
      // Same number with or without country code (+57 300… vs 300…): compare the last 10 digits.
      contact.phone && contact.phone.replace(/\D/g, '').length >= 7
        ? sql`right(regexp_replace(${patients.phone}, '\D', '', 'g'), 10) = ${contact.phone.replace(/\D/g, '').slice(-10)}`
        : undefined,
      contact.email ? eq(patients.email, contact.email.toLowerCase()) : undefined,
    ].filter(Boolean);
    if (!conds.length) return null;
    const [row] = await this.db
      .select()
      .from(patients)
      .where(tenantScope(patients, or(...conds)))
      .limit(1);
    return row ?? null;
  }

  /**
   * Bulk import from CSV (exports of other agendas / spreadsheets). Headers in Spanish or English:
   * nombre|first_name, apellido|last_name, telefono|phone, email|correo, documento|document_id,
   * fecha_nacimiento|date_of_birth, idioma|language, etiquetas|tags. Existing patients (same phone/email) are skipped.
   */
  async importCsv(csv: string, dryRun = false) {
    const { rows } = parseCsv(csv, 5000);
    const result = { total: rows.length, created: 0, skipped: 0, errors: [] as { row: number; error: string }[] };
    const seen = new Set<string>();
    for (const [i, r] of rows.entries()) {
      const full = pick(r, 'nombre_completo', 'full_name', 'name', 'paciente', 'patient');
      let firstName = pick(r, 'nombre', 'nombres', 'first_name', 'firstname');
      let lastName = pick(r, 'apellido', 'apellidos', 'last_name', 'lastname', 'surname');
      if (!firstName && full) {
        const parts = full.split(/\s+/);
        firstName = parts[0];
        lastName = lastName || parts.slice(1).join(' ');
      }
      const parsed = patientSchema.safeParse({
        firstName,
        lastName: lastName || '-',
        phone: pick(r, 'telefono', 'celular', 'movil', 'phone', 'mobile', 'whatsapp') || null,
        email: pick(r, 'email', 'correo', 'correo_electronico', 'e_mail') || null,
        documentId: pick(r, 'documento', 'cedula', 'document_id', 'document', 'id_number') || null,
        dateOfBirth: pick(r, 'fecha_nacimiento', 'nacimiento', 'date_of_birth', 'dob', 'birthdate') || null,
        preferredLanguage: /^en/i.test(pick(r, 'idioma', 'language', 'lang')) ? 'en' : 'es',
        tags: ['imported', ...pick(r, 'etiquetas', 'tags').split(/[|,]/).map((t) => t.trim()).filter(Boolean)].slice(0, 20),
      });
      if (!parsed.success) {
        result.errors.push({ row: i + 2, error: parsed.error.issues.map((x) => `${x.path.join('.')}: ${x.message}`).join('; ') });
        continue;
      }
      if (!parsed.data.phone && !parsed.data.email) {
        result.errors.push({ row: i + 2, error: 'phone or email required' });
        continue;
      }
      const keys = [parsed.data.phone ? normalizePhone(parsed.data.phone) : null, parsed.data.email ?? null].filter(Boolean) as string[];
      if (keys.some((k) => seen.has(k)) || (await this.findByContact({ phone: parsed.data.phone, email: parsed.data.email }))) {
        result.skipped++;
        continue;
      }
      keys.forEach((k) => seen.add(k));
      if (!dryRun) {
        await this.db
          .insert(patients)
          .values(withTenant({ ...parsed.data, phone: parsed.data.phone ? normalizePhone(parsed.data.phone) : null, clinicId: TenantContext.clinicId(), source: 'IMPORT' }));
      }
      result.created++;
    }
    if (!dryRun) await this.audit.log({ action: 'patient.imported', entityType: 'Patient', metadata: { created: result.created, skipped: result.skipped, errors: result.errors.length } });
    return { ...result, dryRun, errors: result.errors.slice(0, 100) };
  }

  async updatePreferences(id: string, prefs: Partial<PatientPreferences>) {
    const clean = Object.fromEntries(Object.entries(prefs).filter(([k]) => ALLOWED_PREFERENCE_KEYS.includes(k as keyof PatientPreferences)));
    if (!Object.keys(clean).length) return;
    await this.db
      .update(patients)
      .set({ preferences: sql`${patients.preferences} || ${JSON.stringify(clean)}::jsonb` })
      .where(tenantScope(patients, and(eq(patients.id, id))));
  }
}
