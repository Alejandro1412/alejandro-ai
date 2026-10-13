import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, gte, ilike, inArray, lt, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { Database, DB } from '../database/database.module';
import { appointments, calendarIntegrations, doctors, doctorSchedules, doctorServices, services, specialties, timeOff } from '../database/schema';
import { normalizeHeader, parseCsv, pick } from '../common/utils/csv';
import { PlanLimitError } from '../common/errors/app-error';
import { TenantContext, tenantScope, withTenant } from '../database/tenant';
import { NotFoundError, ValidationError } from '../common/errors/app-error';
import { likeTerm } from '../common/utils/pagination';
import { AuditService } from '../audit/audit.service';
import { BillingService } from '../billing/billing.service';
import { doctorListSchema, doctorSchema, scheduleSchema, timeOffSchema } from './doctors.schemas';

@Injectable()
export class DoctorsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly audit: AuditService,
    private readonly billing: BillingService,
  ) {}

  async list(q: z.infer<typeof doctorListSchema> = {}) {
    const where = tenantScope(
      doctors,
      eq(doctors.clinicId, TenantContext.clinicId()),
      q.specialtyId ? eq(doctors.specialtyId, q.specialtyId) : undefined,
      q.status ? eq(doctors.status, q.status) : undefined,
      q.search ? or(ilike(doctors.firstName, likeTerm(q.search)), ilike(doctors.lastName, likeTerm(q.search))) : undefined,
    );
    const rows = await this.db.query.doctors.findMany({
      where,
      with: { specialty: true, location: true, services: { with: { service: true } }, schedules: true },
      orderBy: [asc(doctors.lastName)],
    });
    const ids = rows.map((d) => d.id);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today.getTime() + 86_400_000);
    const [todayCounts, calendars] = ids.length
      ? await Promise.all([
          this.db
            .select({ doctorId: appointments.doctorId, n: sql<number>`count(*)::int` })
            .from(appointments)
            .where(
              tenantScope(
                appointments,
                inArray(appointments.doctorId, ids),
                gte(appointments.startTime, today),
                lt(appointments.startTime, tomorrow),
                inArray(appointments.status, ['CONFIRMED', 'PENDING', 'COMPLETED']),
              ),
            )
            .groupBy(appointments.doctorId),
          this.db
            .select({ doctorId: calendarIntegrations.doctorId, provider: calendarIntegrations.provider })
            .from(calendarIntegrations)
            .where(tenantScope(calendarIntegrations, eq(calendarIntegrations.status, 'CONNECTED'))),
        ])
      : [[], []];
    const clinicCal = calendars.find((c) => !c.doctorId)?.provider ?? null;
    return rows.map((d) => ({
      ...d,
      services: d.services.map((s) => s.service),
      appointmentsToday: todayCounts.find((c) => c.doctorId === d.id)?.n ?? 0,
      calendarProvider: calendars.find((c) => c.doctorId === d.id)?.provider ?? clinicCal,
    }));
  }

  async get(id: string) {
    const doctor = await this.db.query.doctors.findFirst({
      where: tenantScope(doctors, eq(doctors.id, id)),
      with: {
        specialty: true,
        location: true,
        services: { with: { service: true } },
        schedules: { orderBy: [asc(doctorSchedules.dayOfWeek), asc(doctorSchedules.startTime)] },
        timeOff: { where: gte(timeOff.endsAt, new Date()), orderBy: [asc(timeOff.startsAt)] },
      },
    });
    if (!doctor) throw new NotFoundError('Doctor', id);
    const [cal] = await this.db
      .select({ id: calendarIntegrations.id, provider: calendarIntegrations.provider, accountEmail: calendarIntegrations.accountEmail })
      .from(calendarIntegrations)
      .where(tenantScope(calendarIntegrations, eq(calendarIntegrations.doctorId, id), eq(calendarIntegrations.status, 'CONNECTED')));
    return { ...doctor, services: doctor.services.map((s) => s.service), calendar: cal ?? null };
  }

  async create(dto: z.infer<typeof doctorSchema>) {
    await this.billing.assertWithinLimit('doctors');
    const { serviceIds, ...data } = dto;
    const doctor = await this.db.transaction(async (tx) => {
      const [row] = await tx.insert(doctors).values(withTenant({ ...data, clinicId: TenantContext.clinicId() })).returning();
      if (serviceIds?.length) await this.replaceServices(tx, row.id, serviceIds);
      return row;
    });
    await this.audit.log({ action: 'doctor.created', entityType: 'Doctor', entityId: doctor.id });
    return this.get(doctor.id);
  }

  /**
   * Bulk import doctors from CSV. Headers (es/en): titulo|title, nombre|first_name, apellido|last_name,
   * especialidad|specialty (matched by name), email, telefono|phone, duracion|duration, horario|schedule
   * (e.g. "lun-vie 08:00-12:00"). Plan limits apply per row.
   */
  async importCsv(csv: string, dryRun = false) {
    const { rows } = parseCsv(csv, 500);
    const specs = await this.db.select().from(specialties).where(tenantScope(specialties, eq(specialties.clinicId, TenantContext.clinicId())));
    const findSpec = (name: string) => {
      const n = normalizeHeader(name);
      return n ? specs.find((s) => [s.name, s.nameEn ?? '', s.slug].map(normalizeHeader).some((x) => x && (x === n || x.startsWith(n) || n.startsWith(x)))) : undefined;
    };
    const DAYS: Record<string, number> = { lun: 1, mon: 1, mar: 2, tue: 2, mie: 3, wed: 3, jue: 4, thu: 4, vie: 5, fri: 5, sab: 6, sat: 6, dom: 7, sun: 7 };
    const result = { total: rows.length, created: 0, skipped: 0, errors: [] as { row: number; error: string }[] };
    for (const [i, r] of rows.entries()) {
      const titleRaw = pick(r, 'titulo', 'title', 'tratamiento');
      const title = (['Dr.', 'Dra.', 'Lic.', 'Psic.', 'Nut.', 'Ft.'] as const).find((t) => t.toLowerCase().replace('.', '') === titleRaw.toLowerCase().replace('.', '')) ?? 'Dr.';
      const specName = pick(r, 'especialidad', 'specialty', 'speciality');
      const spec = specName ? findSpec(specName) : undefined;
      const parsed = doctorSchema.safeParse({
        title,
        firstName: pick(r, 'nombre', 'nombres', 'first_name', 'firstname'),
        lastName: pick(r, 'apellido', 'apellidos', 'last_name', 'lastname'),
        email: pick(r, 'email', 'correo') || null,
        phone: pick(r, 'telefono', 'phone', 'celular') || null,
        specialtyId: spec?.id ?? null,
        defaultDurationMinutes: Number(pick(r, 'duracion', 'duration', 'duracion_minutos', 'minutes')) || 30,
      });
      if (!parsed.success) {
        result.errors.push({ row: i + 2, error: parsed.error.issues.map((x) => `${x.path.join('.')}: ${x.message}`).join('; ') });
        continue;
      }
      if (specName && !spec) result.errors.push({ row: i + 2, error: `specialty "${specName}" not found (imported without specialty)` });
      const [dupe] = await this.db
        .select({ id: doctors.id })
        .from(doctors)
        .where(tenantScope(doctors, eq(doctors.clinicId, TenantContext.clinicId()), ilike(doctors.firstName, parsed.data.firstName), ilike(doctors.lastName, parsed.data.lastName)));
      if (dupe) {
        result.skipped++;
        continue;
      }
      // "lun-vie 08:00-12:00; sab 08:00-12:00"
      const intervals: { dayOfWeek: number; startTime: string; endTime: string }[] = [];
      for (const part of pick(r, 'horario', 'schedule', 'hours').split(/[;|]/)) {
        const m = normalizeHeader(part.split(/\s+\d/)[0] ?? '').match(/^([a-z]{3})[a-z]*(?:_([a-z]{3})[a-z]*)?$/);
        const t = part.match(/(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})/);
        if (!m || !t || !DAYS[m[1]]) continue;
        const from = DAYS[m[1]];
        const to = m[2] ? (DAYS[m[2]] ?? from) : from;
        const pad = (x: string) => x.padStart(5, '0');
        for (let d = from; d <= to; d++) intervals.push({ dayOfWeek: d, startTime: pad(t[1]), endTime: pad(t[2]) });
      }
      if (dryRun) {
        result.created++;
        continue;
      }
      try {
        const doc = await this.create(parsed.data);
        if (intervals.length) await this.setSchedule(doc.id, { intervals });
        result.created++;
      } catch (err) {
        if (err instanceof PlanLimitError) {
          result.errors.push({ row: i + 2, error: 'plan limit reached — remaining rows not imported' });
          break;
        }
        result.errors.push({ row: i + 2, error: (err as Error).message });
      }
    }
    if (!dryRun) await this.audit.log({ action: 'doctor.imported', entityType: 'Doctor', metadata: { created: result.created, skipped: result.skipped } });
    return { ...result, dryRun, errors: result.errors.slice(0, 100) };
  }

  async update(id: string, dto: Partial<z.infer<typeof doctorSchema>>) {
    const { serviceIds, ...data } = dto;
    await this.db.transaction(async (tx) => {
      if (Object.keys(data).length) {
        const [row] = await tx.update(doctors).set(data).where(tenantScope(doctors, eq(doctors.id, id))).returning({ id: doctors.id });
        if (!row) throw new NotFoundError('Doctor', id);
      }
      if (serviceIds) await this.replaceServices(tx, id, serviceIds);
    });
    await this.audit.log({ action: 'doctor.updated', entityType: 'Doctor', entityId: id, metadata: { fields: Object.keys(dto) } });
    return this.get(id);
  }

  private async replaceServices(tx: Parameters<Parameters<Database['transaction']>[0]>[0], doctorId: string, serviceIds: string[]) {
    if (serviceIds.length) {
      const owned = await tx.select({ id: services.id }).from(services).where(tenantScope(services, inArray(services.id, serviceIds)));
      if (owned.length !== new Set(serviceIds).size) throw new ValidationError('One or more services do not exist');
    }
    await tx.delete(doctorServices).where(eq(doctorServices.doctorId, doctorId));
    if (serviceIds.length) await tx.insert(doctorServices).values([...new Set(serviceIds)].map((serviceId) => ({ doctorId, serviceId })));
  }

  async remove(id: string) {
    const [row] = await this.db.delete(doctors).where(tenantScope(doctors, eq(doctors.id, id))).returning({ id: doctors.id });
    if (!row) throw new NotFoundError('Doctor', id);
    await this.audit.log({ action: 'doctor.deleted', entityType: 'Doctor', entityId: id });
    return row;
  }

  async setSchedule(id: string, dto: z.infer<typeof scheduleSchema>) {
    await this.get(id);
    await this.db.transaction(async (tx) => {
      await tx.delete(doctorSchedules).where(tenantScope(doctorSchedules, eq(doctorSchedules.doctorId, id)));
      if (dto.intervals.length) await tx.insert(doctorSchedules).values(dto.intervals.map((i) => withTenant({ ...i, doctorId: id })));
    });
    await this.audit.log({ action: 'doctor.updated', entityType: 'Doctor', entityId: id, metadata: { schedule: dto.intervals.length } });
    return this.get(id);
  }

  async addTimeOff(id: string, dto: z.infer<typeof timeOffSchema>) {
    await this.get(id);
    const [row] = await this.db.insert(timeOff).values(withTenant({ ...dto, doctorId: id })).returning();
    return row;
  }

  async removeTimeOff(doctorId: string, timeOffId: string) {
    const [row] = await this.db
      .delete(timeOff)
      .where(tenantScope(timeOff, and(eq(timeOff.id, timeOffId), eq(timeOff.doctorId, doctorId))))
      .returning({ id: timeOff.id });
    if (!row) throw new NotFoundError('TimeOff', timeOffId);
    return row;
  }
}
