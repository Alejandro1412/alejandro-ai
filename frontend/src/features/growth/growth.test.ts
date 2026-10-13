import { describe, expect, it } from 'vitest';
import { clamp, conversionPct, criteriaFor, insertToken, renderMessage, responseRate } from './growth';

describe('campaign helpers', () => {
  it('renders both name placeholders', () => {
    expect(renderMessage('Hola {nombre} / {name}', 'Ana')).toBe('Hola Ana / Ana');
  });

  it('inserts the token at the caret with spacing', () => {
    expect(insertToken('Hola', 4)).toEqual({ text: 'Hola {nombre}', caret: 13 });
    expect(insertToken('Hola ', null)).toEqual({ text: 'Hola {nombre}', caret: 13 });
    expect(insertToken('', 0)).toEqual({ text: '{nombre}', caret: 8 });
  });

  it('sends only the criteria that apply to the kind, clamped', () => {
    expect(criteriaFor('REACTIVATION', { months: 99, days: 5, specialtyId: '' })).toEqual({ monthsSinceLastVisit: 60, specialtyId: null });
    expect(criteriaFor('REVIEW', { months: 6, days: 0, specialtyId: 'x' })).toEqual({ daysSinceVisit: 1 });
    expect(clamp(Number.NaN, 1, 5)).toBe(1);
  });

  it('computes rates safely', () => {
    expect(conversionPct({ recipients: 10, sent: 8, failed: 2, booked: 2 })).toBe(25);
    expect(conversionPct({ recipients: 0, sent: 0, failed: 0, booked: 0 })).toBeNull();
    expect(responseRate({ sent: 3, responded: 1 })).toBe(33);
  });
});
