import { describe, expect, it } from 'vitest';
import { ApiError } from '@/lib/api';
import { classifyLoadError, clinicMonogram, initialIntakeValues, isLowRating, normalizeIntake, pickLinkLanguage, validateIntake } from './helpers';
import type { IntakeField } from './types';

const fields: IntakeField[] = [
  { key: 'reason', label: 'Motivo', type: 'textarea', required: true },
  { key: 'allergies', label: 'Alergias', type: 'text' },
  { key: 'insurance', label: 'Aseguradora', type: 'select', options: ['Sura', 'Sanitas'] },
  { key: 'birthDate', label: 'Fecha de nacimiento', type: 'date', required: true },
  { key: 'accept', label: 'Acepto', type: 'checkbox', required: true },
];

describe('classifyLoadError', () => {
  it('maps link errors to friendly states', () => {
    expect(classifyLoadError(new ApiError(404, 'NOT_FOUND', 'Link not found'))).toBe('not_found');
    expect(classifyLoadError(new ApiError(410, 'ACTION_LINK_USED', 'used'))).toBe('used');
    expect(classifyLoadError(new ApiError(410, 'ACTION_LINK_EXPIRED', 'expired'))).toBe('expired');
    expect(classifyLoadError(new ApiError(0, 'NETWORK_ERROR', 'offline'))).toBe('network');
    expect(classifyLoadError(new ApiError(500, 'INTERNAL', 'boom'))).toBe('other');
    expect(classifyLoadError(new Error('x'))).toBe('other');
  });
});

describe('pickLinkLanguage', () => {
  it('applies the appointment language when the visitor has not chosen one', () => {
    expect(pickLinkLanguage('en', 'es', 'es', null)).toBe('en');
    expect(pickLinkLanguage('es', 'en', 'es', 'en')).toBe('es');
  });
  it('keeps an explicit choice and ignores unknown languages', () => {
    expect(pickLinkLanguage('es', 'en', 'es', 'es')).toBeNull();
    expect(pickLinkLanguage('es', 'es', 'es', null)).toBeNull();
    expect(pickLinkLanguage('fr', 'es', 'es', null)).toBeNull();
    expect(pickLinkLanguage(null, 'es', 'en', null)).toBeNull();
  });
});

describe('intake validation (mirrors the backend)', () => {
  it('prefills previous answers and coerces checkboxes', () => {
    expect(initialIntakeValues(fields, { reason: 'Dolor', accept: 'true' })).toEqual({ reason: 'Dolor', allergies: '', insurance: '', birthDate: '', accept: true });
  });
  it('flags required, invalid options and malformed dates', () => {
    const errs = validateIntake(fields, { reason: '  ', allergies: '', insurance: 'Otra', birthDate: '12/01/1990', accept: false });
    expect(errs).toEqual({ reason: 'required', insurance: 'invalidOption', birthDate: 'invalidDate', accept: 'required' });
  });
  it('passes valid input and normalizes the body', () => {
    const values = { reason: ' Control anual ', allergies: '', insurance: 'Sura', birthDate: '1990-01-12', accept: true };
    expect(validateIntake(fields, values)).toEqual({});
    expect(normalizeIntake(fields, values)).toEqual({ reason: 'Control anual', insurance: 'Sura', birthDate: '1990-01-12', accept: true });
  });
});

describe('misc helpers', () => {
  it('builds a clinic monogram', () => {
    expect(clinicMonogram('NovaCare Clínica Integral')).toBe('NC');
    expect(clinicMonogram('Centro Médico de la Aurora')).toBe('CM');
    expect(clinicMonogram('')).toBe('•');
  });
  it('detects low ratings', () => {
    expect(isLowRating(3)).toBe(true);
    expect(isLowRating(4)).toBe(false);
    expect(isLowRating(0)).toBe(false);
  });
});
