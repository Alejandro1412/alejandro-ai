import { DateTime } from 'luxon';
import { norm } from '../policy/text';

/**
 * Lets patients answer cards in their own words ("el viernes a las 8", "la segunda", "3 pm",
 * "the first one") instead of tapping. Works on the options the assistant actually showed in the
 * previous turn (stored in conversation metadata), so it can never pick something that wasn't offered.
 */

export interface ShownSlot {
  doctorId: string;
  doctorName: string;
  start: string;
  day: string;
  time: string;
}

export interface ShownSlots {
  mode: 'book' | 'reschedule';
  appointmentId?: string | null;
  serviceId?: string | null;
  timezone: string;
  slots: ShownSlot[];
}

export interface ShownAppointment {
  id: string;
  doctorId: string;
  doctorName: string;
  specialty?: string | null;
  start: string;
  when: string;
}

const ORDINAL_WORDS: [RegExp, number][] = [
  [/\b(primer[oa]?|first)\b/, 0],
  [/\b(segund[oa]|second)\b/, 1],
  [/\b(tercer[oa]?|third)\b/, 2],
  [/\b(cuart[oa]|fourth)\b/, 3],
  [/\b(quint[oa]|fifth)\b/, 4],
  [/\b(sext[oa]|sixth)\b/, 5],
];

/** "la segunda", "opción 3", "#2", "number 1" or a bare "2" → zero-based index. */
function ordinalIndex(t: string): number | null {
  const word = ORDINAL_WORDS.find(([re]) => re.test(t));
  if (word) return word[1];
  const num = t.match(/(?:opcion|option|numero|number|#|no\.?)\s*(\d)\b/) ?? t.match(/^\s*(\d)\s*[.)]?\s*$/);
  return num ? Number(num[1]) - 1 : null;
}
const MONTHS = 'enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre';
const LAST = /\b(ultim[oa]|last one|the last)\b/;
const WEEKDAYS: Record<string, number> = {
  lunes: 1, martes: 2, miercoles: 3, jueves: 4, viernes: 5, sabado: 6, domingo: 7,
  monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6, sunday: 7,
  lun: 1, mar: 2, mie: 3, jue: 4, vie: 5, sab: 6, dom: 7, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6, sun: 7,
};

/** A message is a candidate "choice" only if it is short and does not look like contact data. */
export function looksLikeChoice(text: string): boolean {
  const t = text.trim();
  return t.length > 0 && t.length <= 80 && !/\d{6,}/.test(t.replace(/[\s().-]/g, '')) && !/@/.test(t);
}

function parseTime(t: string): { h: number; m: number | null } | null {
  // "8", "8:30", "8.30", "a las 3", "3 pm", "15:00", "3 de la tarde", "10 y media"
  const m = t.match(/(?:a las |las |at |@ )?\b(\d{1,2})(?:[:.h](\d{2}))?\s*(a\.?\s?m\.?|p\.?\s?m\.?|am|pm|de la manana|de la tarde|de la noche|y media)?\b/);
  if (!m) return null;
  let h = Number(m[1]);
  if (h > 23) return null;
  let min: number | null = m[2] !== undefined ? Number(m[2]) : null;
  const suffix = (m[3] ?? '').replace(/[\s.]/g, '');
  if (suffix === 'ymedia') min = 30;
  if ((suffix.startsWith('pm') || suffix === 'delatarde' || suffix === 'delanoche') && h < 12) h += 12;
  if ((suffix.startsWith('am') || suffix === 'delamanana') && h === 12) h = 0;
  return { h, m: min };
}

export type ChoiceResult<T> = { match: T } | { ambiguous: T[] } | null;

export function resolveSlotChoice(text: string, shown: ShownSlots): ChoiceResult<ShownSlot> {
  if (!shown.slots.length || !looksLikeChoice(text)) return null;
  const t = norm(text);
  const local = (s: ShownSlot) => DateTime.fromISO(s.start, { zone: shown.timezone });

  let pool = shown.slots;
  // Weekday filter ("el viernes")
  const day = Object.entries(WEEKDAYS).find(([name]) => new RegExp(`\\b${name}\\b`).test(t));
  if (day) pool = pool.filter((s) => local(s).weekday === day[1]);
  // Day-of-month filter ("el 3", "3 de octubre") only when a month or "el día" is mentioned
  const dom = t.match(new RegExp(`\\b(\\d{1,2}) de (${MONTHS})\\b`));
  if (dom) pool = pool.filter((s) => local(s).day === Number(dom[1]));
  // Doctor filter by last name
  const byDoctor = pool.filter((s) => norm(s.doctorName).split(' ').some((w) => w.length > 3 && t.includes(w) && !['dra.', 'dr.'].includes(w)));
  if (byDoctor.length && byDoctor.length < pool.length) pool = byDoctor;

  let ordIdx = ordinalIndex(t);
  // A bare number is read as a time when some offered slot starts at that hour, otherwise as a position.
  const bare = /^\s*\d{1,2}\s*$/.test(t);
  const timeFirst = bare && pool.some((s) => [Number(t), Number(t) + 12].includes(local(s).hour));
  if (timeFirst) ordIdx = null;
  const time = ordIdx === null || /\d[:.]\d{2}|\b(am|pm|a las|at)\b/.test(t) ? parseTime(t.replace(new RegExp(`\\b\\d{1,2} de (${MONTHS})\\b`), '')) : null;
  if (time) {
    const hits = pool.filter((s) => {
      const d = local(s);
      const hourOk = d.hour === time.h || (time.h < 12 && d.hour === time.h + 12 && !/(manana|am\b|a\.m)/.test(t));
      return hourOk && (time.m === null || d.minute === time.m);
    });
    if (hits.length === 1) return { match: hits[0] };
    if (hits.length > 1) return { ambiguous: hits.slice(0, 6) };
    if (day || dom) return null;
  }

  if (ordIdx !== null && !time) {
    const list = day || dom ? pool : shown.slots;
    if (list[ordIdx]) return { match: list[ordIdx] };
  }
  if (LAST.test(t)) return { match: (day ? pool : shown.slots)[(day ? pool : shown.slots).length - 1] };
  if ((day || dom) && pool.length === 1) return { match: pool[0] };
  if ((day || dom) && pool.length > 1 && /\b(ese|esa|that|this|ok|si|dale|bien|sirve|works|fine|good)\b/.test(t)) return { ambiguous: pool.slice(0, 6) };
  return null;
}

export function resolveAppointmentChoice(text: string, items: ShownAppointment[], timezone: string): ChoiceResult<ShownAppointment> {
  if (!items.length || !looksLikeChoice(text)) return null;
  const t = norm(text);
  if (items.length === 1 && /(^(si|sí|yes|ok|dale|claro|confirmo)\b|esa|ese|that one|cancelala|cancelarla|cancel it|reprogramala|move it)/.test(t)) return { match: items[0] };
  const idx = ordinalIndex(t);
  if (idx !== null && items[idx]) return { match: items[idx] };
  const day = Object.entries(WEEKDAYS).find(([name]) => new RegExp(`\\b${name}\\b`).test(t));
  const byDoctorRaw = items.filter(
    (i) => norm(i.doctorName).split(' ').some((w) => w.length > 3 && t.includes(w)) || (i.specialty && t.includes(norm(i.specialty).slice(0, 6))),
  );
  const byDoctor = byDoctorRaw.length ? byDoctorRaw : items;
  let pool = byDoctor;
  if (day) pool = pool.filter((i) => DateTime.fromISO(i.start, { zone: timezone }).weekday === day[1]);
  const narrowed = byDoctor.length < items.length || Boolean(day);
  if (pool.length === 1 && narrowed) return { match: pool[0] };
  if (pool.length > 1 && narrowed) return { ambiguous: pool };
  return null;
}
