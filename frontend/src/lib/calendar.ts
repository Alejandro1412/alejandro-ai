import type { CardAppointment } from '@/types';

const stamp = (iso: string) => new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

/** Cards from older messages may lack exact times; calendar actions are only offered when they are valid. */
export const hasValidTimes = (a: Pick<CardAppointment, 'start' | 'end'>) => !Number.isNaN(Date.parse(a.start)) && !Number.isNaN(Date.parse(a.end));
const esc = (s: string) => s.replace(/[\\,;]/g, (m) => `\\${m}`).replace(/\n/g, '\\n');

/** RFC 5545 event for "add to my calendar" (works with Apple Calendar, Outlook, Google import). */
export function appointmentIcs(a: CardAppointment, clinicName = 'Alejandro AI'): string {
  const title = `${a.serviceName ?? a.specialty ?? 'Cita'} — ${a.doctorName}`;
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Alejandro AI//Appointments//ES',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${a.id}@alejandro.ai`,
    `DTSTAMP:${stamp(new Date().toISOString())}`,
    `DTSTART:${stamp(a.start)}`,
    `DTEND:${stamp(a.end)}`,
    `SUMMARY:${esc(title)}`,
    a.location ? `LOCATION:${esc(`${clinicName} · ${a.location}`)}` : `LOCATION:${esc(clinicName)}`,
    `DESCRIPTION:${esc(`${a.when}\n${a.doctorName}${a.specialty ? ` · ${a.specialty}` : ''}`)}`,
    'BEGIN:VALARM',
    'TRIGGER:-PT2H',
    'ACTION:DISPLAY',
    `DESCRIPTION:${esc(title)}`,
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');
}

export function downloadIcs(a: CardAppointment): void {
  const blob = new Blob([appointmentIcs(a)], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `cita-${a.start.slice(0, 10)}.ics`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function googleCalendarUrl(a: CardAppointment): string {
  const p = new URLSearchParams({
    action: 'TEMPLATE',
    text: `${a.serviceName ?? a.specialty ?? 'Cita'} — ${a.doctorName}`,
    dates: `${stamp(a.start)}/${stamp(a.end)}`,
    details: `${a.when} · ${a.doctorName}`,
    ...(a.location ? { location: a.location } : {}),
  });
  return `https://calendar.google.com/calendar/render?${p.toString()}`;
}
