import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, gte, ilike, inArray, lt, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { Database, DB } from '../database/database.module';
import { appointments, calendarIntegrations, doctors, doctorSchedules, doctorServices, services, timeOff } from '../database/schema';
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
