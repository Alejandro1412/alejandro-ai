import { renderForWhatsApp } from './whatsapp.service';

describe('renderForWhatsApp', () => {
  it('turns slot cards into a numbered menu with the matching booking action', () => {
    const { text, options } = renderForWhatsApp(
      'Tengo estos horarios:',
      [{ type: 'slots', mode: 'book', serviceId: null, timezone: 'UTC', groups: [{ doctorId: 'd1', doctorName: 'Dra. García', specialty: null, slots: [{ start: 's1', end: 'e1', time: '8:00', day: 'lun 1' }, { start: 's2', end: 'e2', time: '9:00', day: 'lun 1' }] }] }],
      'es',
    );
    expect(text).toContain('1) lun 1 8:00 — Dra. García');
    expect(text).toContain('Responde con el número');
    expect(options[1].action).toEqual({ type: 'book_slot', doctorId: 'd1', startTime: 's2', serviceId: null });
  });
});
