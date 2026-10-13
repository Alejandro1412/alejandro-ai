import { parseCsv, pick } from './csv';

describe('parseCsv', () => {
  it('handles quotes, escaped quotes, CRLF, BOM and normalizes headers', () => {
    const { headers, rows } = parseCsv('﻿Nombre,Teléfono,"Notas"\r\n"Ana María",+57 300,"dice ""hola"", ok"\r\n\r\nLuis,,\r\n');
    expect(headers).toEqual(['nombre', 'telefono', 'notas']);
    expect(rows).toEqual([
      { nombre: 'Ana María', telefono: '+57 300', notas: 'dice "hola", ok' },
      { nombre: 'Luis', telefono: '', notas: '' },
    ]);
  });
  it('auto-detects semicolons (Excel in Spanish locales)', () => {
    expect(parseCsv('a;b\n1;2').rows).toEqual([{ a: '1', b: '2' }]);
  });
  it('pick returns the first non-empty alias', () => {
    expect(pick({ phone: '', telefono: '123' }, 'phone', 'telefono')).toBe('123');
  });
});
