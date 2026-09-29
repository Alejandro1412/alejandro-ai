import { Inject, Injectable } from '@nestjs/common';
import { and, count, desc, eq, ilike, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { Database, DB } from '../database/database.module';
import { appointments, conversations, patients, PatientPreferences } from '../database/schema';
import { TenantContext, tenantScope, withTenant } from '../database/tenant';
import { NotFoundError } from '../common/errors/app-error';
import { likeTerm, offsetOf, Paginated, paginationSchema } from '../common/utils/pagination';
import { AuditService } from '../audit/audit.service';

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

  async create(dto: z.infer<typeof patientSchema>, source = 'HUMAN') {
    const [row] = await this.db
      .insert(patients)
      .values(withTenant({ ...dto, phone: dto.phone ? normalizePhone(dto.phone) : dto.phone, clinicId: TenantContext.clinicId(), source }))
      .returning();
    await this.audit.log({ action: 'patient.created', entityType: 'Patient', entityId: row.id, patientId: row.id, metadata: { source } });
    return row;
  }

  async update(id: string, dto: Partial<z.infer<typeof patientSchema>>) {
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
      contact.phone ? eq(patients.phone, normalizePhone(contact.phone)) : undefined,
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

  async updatePreferences(id: string, prefs: Partial<PatientPreferences>) {
    const clean = Object.fromEntries(Object.entries(prefs).filter(([k]) => ALLOWED_PREFERENCE_KEYS.includes(k as keyof PatientPreferences)));
    if (!Object.keys(clean).length) return;
    await this.db
      .update(patients)
      .set({ preferences: sql`${patients.preferences} || ${JSON.stringify(clean)}::jsonb` })
      .where(tenantScope(patients, and(eq(patients.id, id))));
  }
}
