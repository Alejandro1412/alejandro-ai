/** Pre-visit intake form builder helpers. Rules mirror the backend `serviceSchema.intakeFields`. */
export const INTAKE_TYPES = ['text', 'textarea', 'select', 'checkbox', 'date'] as const;
export type IntakeType = (typeof INTAKE_TYPES)[number];
export const MAX_INTAKE_FIELDS = 15;
export const KEY_RE = /^[a-z][a-zA-Z0-9_]{0,39}$/;

export interface IntakeField {
  key: string;
  label: string;
  type: IntakeType;
  required?: boolean;
  options?: string[];
}

/** Editor row: options kept as raw text while typing; `keyEdited` stops auto-generation once the user edits the key. */
export interface IntakeDraft {
  id: string;
  key: string;
  label: string;
  type: IntakeType;
  required: boolean;
  optionsText: string;
  keyEdited: boolean;
}

export type IntakeError = 'label' | 'key' | 'keyDup' | 'options';

/** "¿Toma algún medicamento?" → "tomaAlgunMedicamento" (ASCII camelCase, starts with a lowercase letter, ≤ 40 chars). */
export function keyFromLabel(label: string): string {
  const words = label
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  let key = words.map((w, i) => (i === 0 ? w.toLowerCase() : w[0].toUpperCase() + w.slice(1).toLowerCase())).join('');
  key = key.replace(/^[^a-z]+/i, '');
  if (!key) return '';
  key = key[0].toLowerCase() + key.slice(1);
  return key.slice(0, 40);
}

export const parseOptions = (text: string) =>
  text
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);

export function validateIntake(drafts: IntakeDraft[]): Record<string, IntakeError[]> {
  const errors: Record<string, IntakeError[]> = {};
  const counts = new Map<string, number>();
  drafts.forEach((d) => counts.set(d.key, (counts.get(d.key) ?? 0) + 1));
  for (const d of drafts) {
    const e: IntakeError[] = [];
    const label = d.label.trim();
    if (label.length < 2 || label.length > 160) e.push('label');
    if (!KEY_RE.test(d.key)) e.push('key');
    else if ((counts.get(d.key) ?? 0) > 1) e.push('keyDup');
    if (d.type === 'select') {
      const opts = parseOptions(d.optionsText);
      if (!opts.length || opts.length > 20 || opts.some((o) => o.length > 80)) e.push('options');
    }
    if (e.length) errors[d.id] = e;
  }
  return errors;
}

export function toIntakeFields(drafts: IntakeDraft[]): IntakeField[] {
  return drafts.map((d) => ({
    key: d.key,
    label: d.label.trim(),
    type: d.type,
    ...(d.required ? { required: true } : {}),
    ...(d.type === 'select' ? { options: parseOptions(d.optionsText) } : {}),
  }));
}

let seq = 0;
export function toDrafts(fields: IntakeField[] = []): IntakeDraft[] {
  return fields.map((f) => ({ id: `f${++seq}`, key: f.key, label: f.label, type: f.type, required: Boolean(f.required), optionsText: (f.options ?? []).join(', '), keyEdited: true }));
}

export function newDraft(): IntakeDraft {
  return { id: `f${++seq}`, key: '', label: '', type: 'text', required: false, optionsText: '', keyEdited: false };
}

export function moveItem<T>(xs: T[], from: number, to: number): T[] {
  if (to < 0 || to >= xs.length) return xs;
  const copy = [...xs];
  const [it] = copy.splice(from, 1);
  copy.splice(to, 0, it);
  return copy;
}

/** "120.000" / "120000,50" → cents; '' → null; invalid → NaN. */
export function moneyToCents(input: string): number | null {
  const s = input.trim();
  if (!s) return null;
  // Accept both decimal separators; a trailing group of exactly 3 digits after a separator is treated as thousands.
  let norm = s.replace(/\s/g, '');
  const lastSep = Math.max(norm.lastIndexOf(','), norm.lastIndexOf('.'));
  if (lastSep >= 0 && norm.length - lastSep - 1 !== 3) {
    norm = norm.slice(0, lastSep).replace(/[.,]/g, '') + '.' + norm.slice(lastSep + 1);
  } else {
    norm = norm.replace(/[.,]/g, '');
  }
  const n = Number(norm);
  if (!Number.isFinite(n) || n < 0) return NaN;
  return Math.round(n * 100);
}
