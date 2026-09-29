import { assertPublicUrl, chunkText, faqToChunks, htmlToText, normalizeText } from './text-processing';
import { LocalEmbeddingProvider } from '../ai/embeddings/embedding-provider';

describe('text processing', () => {
  it('normalizes whitespace and control characters', () => {
    expect(normalizeText('a\u0000b   c\r\n\n\n\nd')).toBe('ab c\n\nd');
  });

  it('chunks long documents with bounded size and keeps headings', () => {
    const text = ['# Políticas', ...Array.from({ length: 30 }, (_, i) => `Párrafo ${i} con información administrativa de la clínica que se repite para llenar espacio.`)].join('\n\n');
    const chunks = chunkText(text, 400, 60);
    expect(chunks.length).toBeGreaterThan(3);
    for (const ch of chunks) expect(ch.content.length).toBeLessThanOrEqual(520);
    expect(chunks[0].heading).toBe('Políticas');
  });

  it('creates one chunk per FAQ', () => {
    expect(faqToChunks([{ question: '¿Parqueadero?', answer: 'Sí' }])[0].content).toBe('P: ¿Parqueadero?\nR: Sí');
  });

  it('strips scripts and navigation from HTML', () => {
    const r = htmlToText('<title>Clínica</title><nav>menu</nav><script>alert(1)</script><h1>Servicios</h1><p>Cardiología</p>');
    expect(r.title).toBe('Clínica');
    expect(r.text).toContain('Cardiología');
    expect(r.text).not.toContain('alert');
    expect(r.text).not.toContain('menu');
  });

  it('blocks SSRF targets', async () => {
    await expect(assertPublicUrl('http://127.0.0.1/admin')).rejects.toThrow();
    await expect(assertPublicUrl('http://10.0.0.5')).rejects.toThrow();
    await expect(assertPublicUrl('file:///etc/passwd')).rejects.toThrow();
    await expect(assertPublicUrl('http://user:pass@example.com')).rejects.toThrow();
  });
});

describe('local embeddings', () => {
  const e = new LocalEmbeddingProvider();
  const cos = (a: number[], b: number[]) => a.reduce((s, x, i) => s + x * b[i], 0);
  it('produces normalized 384-d vectors', () => {
    const v = e.embedOne('Política de cancelación');
    expect(v).toHaveLength(384);
    expect(Math.abs(cos(v, v) - 1)).toBeLessThan(1e-9);
  });
  it('places cross-lingual concepts closer than unrelated text', () => {
    const q = e.embedOne('¿cuál es el precio de la consulta?');
    const related = e.embedOne('Consultation price and fees');
    const unrelated = e.embedOne('Parking is available at the north entrance');
    expect(cos(q, related)).toBeGreaterThan(cos(q, unrelated));
  });
});
