import { resolveAppointmentChoice, resolveSlotChoice, type ShownSlots } from './choice-resolver';

const TZ = 'America/Bogota';
// Thu 2026-10-01 and Fri 2026-10-02 (Bogotá = UTC-5)
const shown: ShownSlots = {
  mode: 'book',
  timezone: TZ,
  slots: [
    { doctorId: 'd1', doctorName: 'Dra. María García', start: '2026-10-01T15:30:00.000Z', day: 'jue 1 oct', time: '10:30 a. m.' },
    { doctorId: 'd1', doctorName: 'Dra. María García', start: '2026-10-02T13:00:00.000Z', day: 'vie 2 oct', time: '8:00 a. m.' },
    { doctorId: 'd1', doctorName: 'Dra. María García', start: '2026-10-02T20:00:00.000Z', day: 'vie 2 oct', time: '3:00 p. m.' },
  ],
};
const pick = (text: string) => {
  const r = resolveSlotChoice(text, shown);
  return r && 'match' in r ? r.match.start : r && 'ambiguous' in r ? `ambiguous:${r.ambiguous.length}` : null;
};

describe('typed slot choice', () => {
  it.each([
    ['el viernes a las 8', '2026-10-02T13:00:00.000Z'],
    ['viernes 3 pm', '2026-10-02T20:00:00.000Z'],
    ['a las 3 de la tarde', '2026-10-02T20:00:00.000Z'],
    ['10:30', '2026-10-01T15:30:00.000Z'],
    ['la segunda', '2026-10-02T13:00:00.000Z'],
    ['opción 3', '2026-10-02T20:00:00.000Z'],
    ['the first one', '2026-10-01T15:30:00.000Z'],
    ['el jueves', '2026-10-01T15:30:00.000Z'],
    ['la última', '2026-10-02T20:00:00.000Z'],
    ['8', '2026-10-02T13:00:00.000Z'],
    ['2', '2026-10-02T13:00:00.000Z'],
  ])('%s', (text, expected) => expect(pick(text)).toBe(expected));

  it('asks to disambiguate when a day has several options', () => {
    expect(pick('el viernes está bien')).toBe('ambiguous:2');
  });

  it('ignores unrelated sentences and contact data', () => {
    expect(pick('quiero una cita por la tarde con otro médico de otra especialidad diferente')).toBeNull();
    expect(pick('3001234567')).toBeNull();
    expect(pick('el lunes')).toBeNull();
    expect(pick('a las 11')).toBeNull();
  });
});

describe('typed appointment choice', () => {
  const items = [
    { id: 'a1', doctorId: 'd1', doctorName: 'Dra. María García', start: '2026-10-01T15:30:00.000Z', when: 'jueves' },
    { id: 'a2', doctorId: 'd2', doctorName: 'Dr. Juan Rodríguez', start: '2026-10-05T15:30:00.000Z', when: 'lunes' },
  ];
  it('matches by doctor, weekday or position', () => {
    expect(resolveAppointmentChoice('la de Rodríguez', items, TZ)).toEqual({ match: items[1] });
    expect(resolveAppointmentChoice('la del jueves', items, TZ)).toEqual({ match: items[0] });
    expect(resolveAppointmentChoice('la segunda', items, TZ)).toEqual({ match: items[1] });
  });
  it('a single appointment can be confirmed with "sí, cancélala"', () => {
    expect(resolveAppointmentChoice('sí, cancélala', [items[0]], TZ)).toEqual({ match: items[0] });
  });
});
