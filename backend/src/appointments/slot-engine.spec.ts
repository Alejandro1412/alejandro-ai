import { computeSlots, fitsSchedule } from './slot-engine';

const TZ = 'America/Bogota';
// Monday 2030-01-07 in Bogotá (UTC-5)
const mondayStart = new Date('2030-01-07T05:00:00.000Z');
const tuesdayStart = new Date('2030-01-08T05:00:00.000Z');
const schedules = [
  { dayOfWeek: 1, startTime: '08:00', endTime: '12:00' },
  { dayOfWeek: 1, startTime: '14:00', endTime: '16:00' },
];

describe('computeSlots', () => {
  const base = { timezone: TZ, schedules, busy: [], from: mondayStart, to: tuesdayStart, durationMinutes: 30, stepMinutes: 30, now: new Date('2029-12-31T00:00:00Z') };

  it('expands weekly intervals and models breaks as gaps', () => {
    const slots = computeSlots(base);
    expect(slots).toHaveLength(8 + 4);
    expect(slots[0].start.toISOString()).toBe('2030-01-07T13:00:00.000Z'); // 08:00 local
    expect(slots.some((s) => s.start.toISOString() === '2030-01-07T17:30:00.000Z')).toBe(false); // 12:30 is the break
  });

  it('excludes busy ranges (appointments, time off, external calendar)', () => {
    const busy = [{ start: new Date('2030-01-07T13:00:00Z'), end: new Date('2030-01-07T14:00:00Z') }];
    const slots = computeSlots({ ...base, busy });
    expect(slots.find((s) => s.start.toISOString() === '2030-01-07T13:00:00.000Z')).toBeUndefined();
    expect(slots.find((s) => s.start.toISOString() === '2030-01-07T13:30:00.000Z')).toBeUndefined();
    expect(slots.find((s) => s.start.toISOString() === '2030-01-07T14:00:00.000Z')).toBeDefined();
  });

  it('applies buffer around busy ranges', () => {
    const busy = [{ start: new Date('2030-01-07T14:00:00Z'), end: new Date('2030-01-07T14:30:00Z') }];
    const slots = computeSlots({ ...base, busy, bufferMinutes: 15 });
    expect(slots.find((s) => s.start.toISOString() === '2030-01-07T14:30:00.000Z')).toBeUndefined();
    expect(slots.find((s) => s.start.toISOString() === '2030-01-07T13:30:00.000Z')).toBeUndefined();
  });

  it('respects minimum notice', () => {
    const slots = computeSlots({ ...base, now: new Date('2030-01-07T14:10:00Z'), minNoticeHours: 1 });
    expect(slots[0].start.getTime()).toBeGreaterThanOrEqual(new Date('2030-01-07T15:10:00Z').getTime());
  });

  it('never returns a slot that would end after the interval', () => {
    const slots = computeSlots({ ...base, durationMinutes: 45 });
    for (const s of slots) expect(fitsSchedule(TZ, schedules, s)).toBe(true);
  });
});

describe('fitsSchedule', () => {
  it('accepts a slot fully inside an interval and rejects one crossing the break', () => {
    expect(fitsSchedule(TZ, schedules, { start: new Date('2030-01-07T16:30:00Z'), end: new Date('2030-01-07T17:00:00Z') })).toBe(true);
    expect(fitsSchedule(TZ, schedules, { start: new Date('2030-01-07T16:45:00Z'), end: new Date('2030-01-07T17:15:00Z') })).toBe(false);
    expect(fitsSchedule(TZ, schedules, { start: new Date('2030-01-08T13:00:00Z'), end: new Date('2030-01-08T13:30:00Z') })).toBe(false);
  });
});
