import { describe, expect, it } from 'vitest';
import { absDelta, buildSummary, deltaTone, hoursSaved, isValidMonth, monthOf, pctDelta, ppDelta, shiftMonth } from './valueReport';

describe('value report helpers', () => {
  it('validates and shifts months across years', () => {
    expect(isValidMonth('2026-10')).toBe(true);
    expect(isValidMonth('2026-13')).toBe(false);
    expect(isValidMonth('26-10')).toBe(false);
    expect(isValidMonth(null)).toBe(false);
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
    expect(shiftMonth('2026-12', 1)).toBe('2027-01');
    expect(shiftMonth('2026-10', -13)).toBe('2025-09');
    expect(monthOf(new Date(2026, 9, 13))).toBe('2026-10');
  });

  it('computes deltas', () => {
    expect(pctDelta(120, 100)).toEqual({ kind: 'pct', value: 20 });
    expect(pctDelta(5, 0)).toEqual({ kind: 'new' });
    expect(pctDelta(0, 0)).toEqual({ kind: 'pct', value: 0 });
    expect(pctDelta(null, 3)).toBeNull();
    expect(ppDelta(12.5, 10)).toEqual({ kind: 'pp', value: 2.5 });
    expect(absDelta(4.6, 4.3)).toEqual({ kind: 'abs', value: 0.3 });
  });

  it('reads lower-is-better metrics inverted', () => {
    expect(deltaTone({ kind: 'pp', value: -2 }, true)).toBe('good');
    expect(deltaTone({ kind: 'pp', value: 2 }, true)).toBe('bad');
    expect(deltaTone({ kind: 'pct', value: 10 })).toBe('good');
    expect(deltaTone({ kind: 'pct', value: 0 })).toBe('neutral');
    expect(deltaTone(null)).toBe('neutral');
  });

  it('formats hours and the clipboard summary', () => {
    expect(hoursSaved(90)).toBe(1.5);
    expect(buildSummary({ title: 'T', headline: 'H', lines: [['A', '1']] })).toBe('T\n\nH\n\n• A: 1');
  });
});
