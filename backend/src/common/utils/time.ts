import { DateTime } from 'luxon';

export const formatWhen = (date: Date, timezone: string, lang: string) =>
  DateTime.fromJSDate(date, { zone: timezone })
    .setLocale(lang === 'en' ? 'en-US' : 'es-CO')
    .toFormat(lang === 'en' ? "cccc, LLLL d 'at' h:mm a" : "cccc d 'de' LLLL, h:mm a");

export const formatDay = (date: Date, timezone: string, lang: string) =>
  DateTime.fromJSDate(date, { zone: timezone })
    .setLocale(lang === 'en' ? 'en-US' : 'es-CO')
    .toFormat(lang === 'en' ? 'cccc, LLL d' : "cccc d 'de' LLL");

export const formatTime = (date: Date, timezone: string, lang: string) =>
  DateTime.fromJSDate(date, { zone: timezone })
    .setLocale(lang === 'en' ? 'en-US' : 'es-CO')
    .toFormat('h:mm a');

export const doctorDisplayName = (d: { title: string; firstName: string; lastName: string }) => `${d.title} ${d.firstName} ${d.lastName}`;
export const personName = (p: { firstName: string; lastName: string }) => `${p.firstName} ${p.lastName}`;
