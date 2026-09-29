import { Inject, Injectable } from '@nestjs/common';
import { and, eq, gt, inArray, lt, ne } from 'drizzle-orm';
import { Database, DB } from '../database/database.module';
import { agents, appointments, clinics, doctors, doctorSchedules, doctorServices, services, timeOff } from '../database/schema';
import { TenantContext, tenantScope } from '../database/tenant';
import { NotFoundError } from '../common/errors/app-error';
import { doctorDisplayName } from '../common/utils/time';
import { CalendarsService } from '../calendars/calendars.service';
import { DEFAULT_BOOKING_RULES } from '../ai/agent-defaults';
import { computeSlots, fitsSchedule, partOfDay, Range } from './slot-engine';

export interface SlotSearch {
  doctorIds?: string[];
  specialtyId?: string;
  serviceId?: string;
  from: Date;
  to: Date;
  limit?: number;
  perDoctorLimit?: number;
  timeOfDay?: 'MORNING' | 'AFTERNOON';
  /** Appointment to ignore when checking conflicts (rescheduling). */
  excludeAppointmentId?: string;
}

export interface Slot {
  doctorId: string;
  doctorName: string;
  specialty: string | null;
  serviceId: string | null;
  start: string;
  end: string;
}

/**
 * Real-time availability = weekly schedule − time off − active appointments − external calendar busy.
 * This is dynamic operational data: the AI must always obtain it through tools, never from RAG.
 */
@Injectable()
export class AvailabilityService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly calendars: CalendarsService,
  ) {}

  private async context() {
    const clinicId = TenantContext.clinicId();
    const [row] = await this.db
      .select({ timezone: clinics.timezone, rules: agents.bookingRules })
      .from(clinics)
      .leftJoin(agents, eq(agents.clinicId, clinics.id))
      .where(tenantScope(clinics, eq(clinics.id, clinicId)));
    if (!row) throw new NotFoundError('Clinic');
    return { clinicId, timezone: row.timezone, rules: { ...DEFAULT_BOOKING_RULES, ...(row.rules ?? {}) } };
  }

  async findSlots(q: SlotSearch): Promise<{ timezone: string; slots: Slot[] }> {
    const ctx = await this.context();
    const maxTo = new Date(Date.now() + ctx.rules.maxDaysAhead * 86_400_000);
    const to = q.to > maxTo ? maxTo : q.to;

    let service: typeof services.$inferSelect | undefined;
    if (q.serviceId) {
      [service] = await this.db.select().from(services).where(tenantScope(services, eq(services.id, q.serviceId)));
      if (!service) throw new NotFoundError('Service', q.serviceId);
    }

    const candidates = await this.db.query.doctors.findMany({
      where: tenantScope(
        doctors,
        eq(doctors.clinicId, ctx.clinicId),
        eq(doctors.status, 'ACTIVE'),
        q.doctorIds?.length ? inArray(doctors.id, q.doctorIds) : undefined,
        q.specialtyId ? eq(doctors.specialtyId, q.specialtyId) : undefined,
      ),
      with: { specialty: true, schedules: true, services: true },
    });
    // If a service is requested, keep doctors that offer it (doctors without explicit services offer all of their specialty).
    const eligible = service
      ? candidates.filter((d) => (d.services.length ? d.services.some((s) => s.serviceId === service!.id) : !service!.specialtyId || service!.specialtyId === d.specialtyId))
      : candidates;

    const slots: Slot[] = [];
    for (const d of eligible) {
      const busy = await this.busyFor(d.id, { start: q.from, end: to }, q.excludeAppointmentId);
      const duration = service?.durationMinutes ?? d.defaultDurationMinutes;
      let generated = computeSlots({
        timezone: ctx.timezone,
        schedules: d.schedules,
        busy,
        from: q.from,
        to,
        durationMinutes: duration,
        stepMinutes: ctx.rules.slotStepMinutes,
        bufferMinutes: d.bufferMinutes,
        minNoticeHours: ctx.rules.minNoticeHours,
      });
      if (q.timeOfDay) generated = generated.filter((s) => partOfDay(s.start, ctx.timezone) === q.timeOfDay);
      if (q.perDoctorLimit) generated = spreadAcrossDays(generated, q.perDoctorLimit, ctx.timezone);
      for (const s of generated)
        slots.push({
          doctorId: d.id,
          doctorName: doctorDisplayName(d),
          specialty: d.specialty?.name ?? null,
          serviceId: service?.id ?? null,
          start: s.start.toISOString(),
          end: s.end.toISOString(),
        });
    }
    slots.sort((a, b) => a.start.localeCompare(b.start));
    return { timezone: ctx.timezone, slots: q.limit ? slots.slice(0, q.limit) : slots };
  }

  /** Server-side guard used before any booking: schedule fit + no conflicts + notice rules. */
  async assertBookable(doctorId: string, range: Range, excludeAppointmentId?: string): Promise<{ ok: true } | { ok: false; reason: string }> {
    const ctx = await this.context();
    const [doctor] = await this.db.select().from(doctors).where(tenantScope(doctors, eq(doctors.id, doctorId)));
    if (!doctor) return { ok: false, reason: 'DOCTOR_NOT_FOUND' };
    if (doctor.status !== 'ACTIVE') return { ok: false, reason: 'DOCTOR_UNAVAILABLE' };
    if (range.start.getTime() < Date.now() + ctx.rules.minNoticeHours * 3_600_000 - 60_000) return { ok: false, reason: 'TOO_SOON' };
    const schedules = await this.db.select().from(doctorSchedules).where(tenantScope(doctorSchedules, eq(doctorSchedules.doctorId, doctorId)));
    if (!fitsSchedule(ctx.timezone, schedules, range)) return { ok: false, reason: 'OUTSIDE_WORKING_HOURS' };
    const busy = await this.busyFor(doctorId, range, excludeAppointmentId);
    const buffer = doctor.bufferMinutes * 60_000;
    if (busy.some((b) => range.start.getTime() < b.end.getTime() + buffer && b.start.getTime() - buffer < range.end.getTime())) {
      return { ok: false, reason: 'SLOT_TAKEN' };
    }
    return { ok: true };
  }

  async doctorOffersService(doctorId: string, serviceId: string): Promise<boolean> {
    const links = await this.db.select().from(doctorServices).where(eq(doctorServices.doctorId, doctorId));
    return !links.length || links.some((l) => l.serviceId === serviceId);
  }

  private async busyFor(doctorId: string, range: Range, excludeAppointmentId?: string): Promise<Range[]> {
    const [appts, offs, external] = await Promise.all([
      this.db
        .select({ start: appointments.startTime, end: appointments.endTime })
        .from(appointments)
        .where(
          tenantScope(
            appointments,
            eq(appointments.doctorId, doctorId),
            inArray(appointments.status, ['PENDING', 'CONFIRMED']),
            lt(appointments.startTime, range.end),
            gt(appointments.endTime, range.start),
            excludeAppointmentId ? ne(appointments.id, excludeAppointmentId) : undefined,
          ),
        ),
      this.db
        .select({ start: timeOff.startsAt, end: timeOff.endsAt })
        .from(timeOff)
        .where(tenantScope(timeOff, and(eq(timeOff.doctorId, doctorId), lt(timeOff.startsAt, range.end), gt(timeOff.endsAt, range.start)))),
      this.calendars.busy(doctorId, range),
    ]);
    return [...appts, ...offs, ...external];
  }
}

/** Picks up to `n` slots spread over distinct days/times so the patient gets real choice. */
export function spreadAcrossDays(slots: Range[], n: number, timezone: string): Range[] {
  const byDay = new Map<string, Range[]>();
  for (const s of slots) {
    const key = s.start.toLocaleDateString('en-CA', { timeZone: timezone });
    byDay.set(key, [...(byDay.get(key) ?? []), s]);
  }
  const days = [...byDay.values()];
  const picked: Range[] = [];
  let round = 0;
  while (picked.length < n && days.some((d) => d.length > round)) {
    for (const d of days) {
      if (picked.length >= n) break;
      // alternate morning / later slots across rounds for variety
      const idx = round === 0 ? 0 : Math.min(d.length - 1, Math.floor((d.length * round) / 2));
      const candidate = d[idx];
      if (candidate && !picked.includes(candidate)) picked.push(candidate);
    }
    round++;
  }
  return picked.sort((a, b) => a.start.getTime() - b.start.getTime());
}
