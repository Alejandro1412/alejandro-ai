import { describe, expect, it } from 'vitest';
import { countByStatus, dayRangeToIso, formatCountdown } from './waitlist';

describe('waitlist helpers', () => {
  it('counts every status', () => {
    expect(countByStatus([{ status: 'WAITING' }, { status: 'WAITING' }, { status: 'BOOKED' }])).toEqual({ WAITING: 2, OFFERED: 0, BOOKED: 1, EXPIRED: 0, CANCELLED: 0 });
  });

  it('formats offer countdowns', () => {
    expect(formatCountdown(0)).toBeNull();
    expect(formatCountdown(45_000)).toBe('45 s');
    expect(formatCountdown(12 * 60_000 + 5_000)).toBe('12 min');
    expect(formatCountdown(65 * 60_000)).toBe('1 h 05 min');
  });

  it('turns a day range into an inclusive instant range', () => {
    const r = dayRangeToIso('2026-10-13', '2026-10-13');
    expect(r).not.toBeNull();
    expect(new Date(r!.toDate).getTime()).toBeGreaterThan(new Date(r!.fromDate).getTime());
    expect(dayRangeToIso('2026-10-14', '2026-10-13')).toBeNull();
    expect(dayRangeToIso('', '2026-10-13')).toBeNull();
  });
});
