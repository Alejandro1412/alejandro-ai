import type { Lang } from '@/contexts/PreferencesContext';

const loc = (lang: Lang) => (lang === 'en' ? 'en-US' : 'es-CO');

export const fmtDate = (d: string | Date, lang: Lang, tz?: string) =>
  new Intl.DateTimeFormat(loc(lang), { day: 'numeric', month: 'short', year: 'numeric', timeZone: tz }).format(new Date(d));

export const fmtDateLong = (d: string | Date, lang: Lang, tz?: string) =>
  new Intl.DateTimeFormat(loc(lang), { weekday: 'long', day: 'numeric', month: 'long', timeZone: tz }).format(new Date(d));

export const fmtWeekdayShort = (d: string | Date, lang: Lang, tz?: string) =>
  new Intl.DateTimeFormat(loc(lang), { weekday: 'short', day: 'numeric', month: 'short', timeZone: tz }).format(new Date(d));

export const fmtTime = (d: string | Date, lang: Lang, tz?: string) =>
  new Intl.DateTimeFormat(loc(lang), { hour: 'numeric', minute: '2-digit', timeZone: tz }).format(new Date(d));

export const fmtDateTime = (d: string | Date, lang: Lang, tz?: string) =>
  new Intl.DateTimeFormat(loc(lang), { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: tz }).format(new Date(d));

export const fmtNumber = (n: number, lang: Lang) => new Intl.NumberFormat(loc(lang)).format(n);

export const fmtMoney = (cents: number | null, currency: string, lang: Lang) =>
  cents === null ? null : new Intl.NumberFormat(loc(lang), { style: 'currency', currency, maximumFractionDigits: currency === 'COP' ? 0 : 2 }).format(cents / 100);

export function fmtRelative(d: string | Date, lang: Lang): string {
  const diff = (new Date(d).getTime() - Date.now()) / 1000;
  const rtf = new Intl.RelativeTimeFormat(loc(lang), { numeric: 'auto' });
  const abs = Math.abs(diff);
  if (abs < 60) return rtf.format(Math.round(diff), 'second');
  if (abs < 3600) return rtf.format(Math.round(diff / 60), 'minute');
  if (abs < 86_400) return rtf.format(Math.round(diff / 3600), 'hour');
  if (abs < 86_400 * 30) return rtf.format(Math.round(diff / 86_400), 'day');
  return fmtDate(d, lang);
}

export const initials = (name: string) =>
  name
    .replace(/^(Dr\.|Dra\.)\s*/, '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join('');

export const fullName = (p?: { firstName: string; lastName: string } | null) => (p ? `${p.firstName} ${p.lastName}` : '');
export const doctorName = (d?: { title: string; firstName: string; lastName: string } | null) => (d ? `${d.title} ${d.firstName} ${d.lastName}` : '');

export const cn = (...xs: (string | false | null | undefined)[]) => xs.filter(Boolean).join(' ');
