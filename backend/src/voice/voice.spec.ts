import { extractSay, toSpeech } from './voice.service';
import { renderTemplate } from '../notifications/templates';

describe('voice rendering', () => {
  it('turns chat markdown and menus into speech', () => {
    const out = toSpeech('**Claro.** Elige uno:\n\n1) Lun 8:00 — Dr. X\n2) Mar 9:00\n\nMás info: https://x.co 🙂');
    expect(out).toBe('Claro. Elige uno: Opción 1: Lun 8:00 — Dr. X. Opción 2: Mar 9:00. Más info:');
  });
  it('extracts what the caller hears in this turn', () => {
    expect(extractSay('<Response><Gather><Say language="es">Hola &amp; bienvenido</Say></Gather><Say>Adiós</Say></Response>')).toBe('Hola & bienvenido');
  });
});

describe('notification templates', () => {
  it('never doubles the period after abbreviated times and appends extra lines', () => {
    const r = renderTemplate('APPOINTMENT_BOOKED', 'es', { patientName: 'Ana', doctorName: 'Dr. X', when: 'lunes, 8:00 a. m.', clinicName: 'NovaCare', extra: 'Confirmar: https://a' });
    expect(r.body).not.toMatch(/m\.\./);
    expect(r.body.endsWith('Confirmar: https://a')).toBe(true);
  });
});
