import { DateTime } from 'luxon';

export interface WeeklyInterval {
  dayOfWeek: number; // ISO 1..7
  startTime: string; // HH:MM clinic-local
  endTime: string;
}

export interface Range {
  start: Date;
  end: Date;
}

export interface SlotQuery {
  timezone: string;
  schedules: WeeklyInterval[];
  busy: Range[];
  from: Date;
  to: Date;
  durationMinutes: number;
  stepMinutes: number;
  bufferMinutes?: number;
  now?: Date;
  minNoticeHours?: number;
}

const overlaps = (a: Range, b: Range) => a.start < b.end && b.start < a.end;

/**
 * Pure slot generator (no I/O → fully unit-testable).
 * Walks each clinic-local day in [from, to), expands weekly working intervals (breaks are
 * simply gaps between intervals), and keeps slots that fit entirely inside an interval,
 * respect minimum notice, and do not overlap any busy range (+ buffer).
 */
export function computeSlots(q: SlotQuery): Range[] {
  const now = q.now ?? new Date();
  const earliest = new Date(now.getTime() + (q.minNoticeHours ?? 0) * 3_600_000);
  const buffer = (q.bufferMinutes ?? 0) * 60_000;
  const busy = q.busy.map((b) => ({ start: new Date(b.start.getTime() - buffer), end: new Date(b.end.getTime() + buffer) }));
  const out: Range[] = [];

  let day = DateTime.fromJSDate(q.from, { zone: q.timezone }).startOf('day');
  const last = DateTime.fromJSDate(q.to, { zone: q.timezone });
  while (day < last) {
    for (const iv of q.schedules.filter((s) => s.dayOfWeek === day.weekday)) {
      const [sh, sm] = iv.startTime.split(':').map(Number);
      const [eh, em] = iv.endTime.split(':').map(Number);
      const ivEnd = day.set({ hour: eh, minute: em });
      let cursor = day.set({ hour: sh, minute: sm });
      while (cursor.plus({ minutes: q.durationMinutes }) <= ivEnd) {
        const slot = { start: cursor.toJSDate(), end: cursor.plus({ minutes: q.durationMinutes }).toJSDate() };
        if (slot.start >= earliest && slot.start >= q.from && slot.start < q.to && !busy.some((b) => overlaps(slot, b))) out.push(slot);
        cursor = cursor.plus({ minutes: q.stepMinutes });
      }
    }
    day = day.plus({ days: 1 });
  }
  return out.sort((a, b) => a.start.getTime() - b.start.getTime());
}

/** True if [start,end) lies fully inside one weekly interval of its clinic-local day. */
export function fitsSchedule(timezone: string, schedules: WeeklyInterval[], range: Range): boolean {
  const s = DateTime.fromJSDate(range.start, { zone: timezone });
  const e = DateTime.fromJSDate(range.end, { zone: timezone });
  if (!s.hasSame(e.minus({ milliseconds: 1 }), 'day')) return false;
  const startHm = s.toFormat('HH:mm');
  const endHm = e.toFormat('HH:mm') === '00:00' ? '24:00' : e.toFormat('HH:mm');
  return schedules.some((iv) => iv.dayOfWeek === s.weekday && iv.startTime <= startHm && endHm <= iv.endTime);
}

export function partOfDay(date: Date, timezone: string): 'MORNING' | 'AFTERNOON' {
  return DateTime.fromJSDate(date, { zone: timezone }).hour < 12 ? 'MORNING' : 'AFTERNOON';
}
