import dns from 'node:dns/promises';
import net from 'node:net';
import { ValidationError } from '../common/errors/app-error';

/** Normalizes extracted text: unicode NFC, strips control chars, collapses whitespace but keeps paragraphs. */
export function normalizeText(raw: string): string {
  return raw
    .normalize('NFC')
    .replace(/\r\n?/g, '\n')
    // eslint-disable-next-line no-control-regex -- stripping control characters is the point
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export interface Chunk {
  content: string;
  index: number;
  heading: string | null;
}

/**
 * Structure-aware chunker: splits on headings/paragraphs, packs paragraphs up to `target`
 * characters and carries a small overlap so answers spanning boundaries are still retrievable.
 */
export function chunkText(text: string, target = 900, overlap = 150): Chunk[] {
  const paragraphs = text.split(/\n{2,}|\n(?=#{1,6} |[A-ZÁÉÍÓÚÑ][^\n]{2,60}:\n)/).map((p) => p.trim()).filter(Boolean);
  const chunks: Chunk[] = [];
  let current = '';
  let heading: string | null = null;
  let currentHeading: string | null = null;

  const flush = () => {
    if (!current.trim()) return;
    chunks.push({ content: current.trim(), index: chunks.length, heading: currentHeading });
    const tail = current.slice(-overlap);
    current = tail.includes(' ') ? tail.slice(tail.indexOf(' ') + 1) : '';
  };

  for (const p of paragraphs) {
    const h = p.match(/^#{1,6}\s+(.+)$/m) ?? p.match(/^([^\n]{2,80}):$/m);
    if (h && p.length < 100) {
      flush();
      current = '';
      heading = h[1].trim();
      currentHeading = heading;
      current = `${heading}\n`;
      continue;
    }
    if (p.length > target) {
      // Long paragraph: split on sentence boundaries.
      for (const sentence of p.split(/(?<=[.!?])\s+/)) {
        if ((current + ' ' + sentence).length > target) flush();
        current += (current ? ' ' : '') + sentence;
      }
      continue;
    }
    if ((current + '\n' + p).length > target) {
      flush();
      currentHeading = heading;
    }
    current += (current ? '\n' : '') + p;
  }
  flush();
  return chunks;
}

/** FAQs are chunked one Q/A per chunk: precise retrieval and clean citations. */
export function faqToChunks(items: { question: string; answer: string }[]): Chunk[] {
  return items.map((f, index) => ({ content: `P: ${f.question}\nR: ${f.answer}`, index, heading: f.question }));
}

export const tokenCount = (s: string) => Math.ceil(s.length / 4);

const PRIVATE_RANGES = [/^10\./, /^127\./, /^169\.254\./, /^172\.(1[6-9]|2\d|3[01])\./, /^192\.168\./, /^0\./, /^::1$/, /^fc/i, /^fd/i, /^fe80/i];

/** SSRF guard for URL ingestion: http(s) only, public hosts only, no credentials in the URL. */
export async function assertPublicUrl(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ValidationError('Invalid URL');
  }
  if (!['http:', 'https:'].includes(url.protocol)) throw new ValidationError('Only http(s) URLs are allowed');
  if (url.username || url.password) throw new ValidationError('URLs with credentials are not allowed');
  const host = url.hostname;
  if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal')) throw new ValidationError('Private hosts are not allowed');
  const addresses = net.isIP(host) ? [host] : (await dns.lookup(host, { all: true })).map((a) => a.address);
  if (addresses.some((a) => PRIVATE_RANGES.some((r) => r.test(a)))) throw new ValidationError('Private network addresses are not allowed');
  return url;
}

/** Minimal HTML → text (removes scripts/styles/nav, keeps headings and paragraphs). */
export function htmlToText(html: string): { title: string | null; text: string } {
  const title = html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1]?.trim() ?? null;
  const text = html
    .replace(/<(script|style|noscript|nav|footer|header|svg|iframe)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<h[1-6][^>]*>/gi, '\n\n## ')
    .replace(/<\/(p|div|li|h[1-6]|section|article|tr)>/gi, '\n\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
  return { title, text: normalizeText(text) };
}
