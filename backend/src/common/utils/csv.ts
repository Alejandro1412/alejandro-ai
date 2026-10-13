/**
 * Minimal RFC 4180 CSV parser (quoted fields, escaped quotes, CRLF, ; or , separators auto-detected).
 * Returns objects keyed by the normalized header (lower-case, no accents/spaces).
 */
export function parseCsv(text: string, maxRows = 5000): { headers: string[]; rows: Record<string, string>[] } {
  const src = text.replace(/^\uFEFF/, '');
  const firstLine = src.split(/\r?\n/, 1)[0] ?? '';
  const sep = (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ';' : ',';
  const records: string[][] = [];
  let field = '';
  let record: string[] = [];
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
      continue;
    }
    if (c === '"' && field === '') quoted = true;
    else if (c === sep) {
      record.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      record.push(field);
      field = '';
      if (record.some((f) => f.trim() !== '')) records.push(record);
      record = [];
      if (records.length > maxRows) break;
    } else field += c;
  }
  if (field !== '' || record.length) {
    record.push(field);
    if (record.some((f) => f.trim() !== '')) records.push(record);
  }
  const [head = [], ...body] = records;
  const headers = head.map(normalizeHeader);
  return { headers, rows: body.slice(0, maxRows).map((r) => Object.fromEntries(headers.map((h, i) => [h, (r[i] ?? '').trim()]))) };
}

export const normalizeHeader = (h: string) =>
  h
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');

/** First non-empty value among header aliases (es/en). */
export const pick = (row: Record<string, string>, ...keys: string[]) => keys.map((k) => row[k]).find((v) => v !== undefined && v !== '') ?? '';
