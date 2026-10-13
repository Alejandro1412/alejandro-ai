import { describe, expect, it } from 'vitest';
import { canConfirmAttendance, intakeRows, skipReasonKey } from './v3';

describe('appointment v3 helpers', () => {
  it('orders intake answers by the form and keeps unknown keys', () => {
    const rows = intakeRows(
      [
        { key: 'reason', label: 'Motivo', type: 'text' },
        { key: 'allergies', label: 'Alergias', type: 'checkbox' },
        { key: 'unused', label: 'X', type: 'text' },
      ],
      { allergies: true, reason: 'Dolor', legacy: 'old' },
    );
    expect(rows.map((r) => r.label)).toEqual(['Motivo', 'Alergias', 'legacy']);
  });

  it('maps skip reasons with a fallback', () => {
    expect(skipReasonKey('APPOINTMENT_CONFLICT')).toBe('APPOINTMENT_CONFLICT');
    expect(skipReasonKey('WHATEVER')).toBe('other');
  });

  it('allows confirming attendance only on open, unconfirmed appointments', () => {
    expect(canConfirmAttendance({ status: 'CONFIRMED', patientConfirmedAt: null, depositStatus: 'NONE' })).toBe(true);
    expect(canConfirmAttendance({ status: 'CONFIRMED', patientConfirmedAt: '2026-10-01', depositStatus: 'NONE' })).toBe(false);
    expect(canConfirmAttendance({ status: 'COMPLETED', patientConfirmedAt: null, depositStatus: 'NONE' })).toBe(false);
  });
});
