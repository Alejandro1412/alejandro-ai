import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { HiChevronLeft, HiChevronRight, HiOutlineCalendarDays, HiPlus } from 'react-icons/hi2';
import { Link } from 'react-router-dom';
import { Button, ButtonLink } from '@/components/ui/Button';
import { Badge, Card, PageHeader } from '@/components/ui/Display';
import { EmptyState, Skeleton } from '@/components/ui/Feedback';
import { Select } from '@/components/ui/Field';
import { useAuth } from '@/contexts/AuthContext';
import { usePreferences, useT } from '@/contexts/PreferencesContext';
import { api } from '@/lib/api';
import { cn, doctorName, fmtTime, fullName } from '@/lib/format';
import type { Appointment, Doctor } from '@/types';
import { NewAppointmentDialog } from '../appointments/NewAppointmentDialog';

const START_H = 7;
const END_H = 20;
const HOUR_PX = 56;

function dayKey(d: Date, tz: string) {
  return d.toLocaleDateString('en-CA', { timeZone: tz });
}
function minutesInTz(d: Date, tz: string) {
  const parts = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: tz }).formatToParts(d);
  const h = Number(parts.find((p) => p.type === 'hour')?.value ?? 0);
  const m = Number(parts.find((p) => p.type === 'minute')?.value ?? 0);
  return h * 60 + m;
}
function startOfWeek(date: Date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const dow = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - dow);
  return d;
}

export default function CalendarPage() {
  const t = useT();
  const { prefs } = usePreferences();
  const { me, can } = useAuth();
  const tz = me?.clinic.timezone ?? 'UTC';
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()));
  const [doctorId, setDoctorId] = useState('');
  const [selectedDay, setSelectedDay] = useState(() => dayKey(new Date(), tz));
  const [creating, setCreating] = useState(false);
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => new Date(weekStart.getTime() + i * 86_400_000)), [weekStart]);
  const weekEnd = new Date(weekStart.getTime() + 7 * 86_400_000);

  const doctors = useQuery({ queryKey: ['doctors', 'all'], queryFn: () => api.get<Doctor[]>('/doctors') });
  const appts = useQuery({
    queryKey: ['calendar', weekStart.toISOString(), doctorId],
    queryFn: () => api.page<Appointment>('/appointments', { from: weekStart.toISOString(), to: weekEnd.toISOString(), doctorId, pageSize: 200, order: 'asc' }),
  });
  const integrations = useQuery({
    queryKey: ['calendar', 'integrations'],
    queryFn: () => api.get<{ integrations: { provider: string; status: string; doctorId: string | null }[] }>('/calendars/integrations'),
    enabled: can('integrations.manage'),
  });
  const connected = integrations.data?.integrations.filter((i) => i.status === 'CONNECTED') ?? [];

  const items = (appts.data?.items ?? []).filter((a) => a.status !== 'RESCHEDULED' && a.status !== 'CANCELLED');
  const byDay = useMemo(() => {
    const m = new Map<string, Appointment[]>();
    for (const a of items) {
      const k = dayKey(new Date(a.startTime), tz);
      m.set(k, [...(m.get(k) ?? []), a]);
    }
    return m;
  }, [items, tz]);
  const todayKey = dayKey(new Date(), tz);
  const weekLabel = `${days[0].toLocaleDateString(prefs.lang === 'en' ? 'en-US' : 'es-CO', { day: 'numeric', month: 'short' })} – ${days[6].toLocaleDateString(prefs.lang === 'en' ? 'en-US' : 'es-CO', { day: 'numeric', month: 'short', year: 'numeric' })}`;
  const shift = (n: number) => {
    const next = new Date(weekStart.getTime() + n * 7 * 86_400_000);
    setWeekStart(next);
    setSelectedDay(dayKey(next, tz));
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title={t('calendar.title')}
        subtitle={t('calendar.subtitle')}
        actions={
          can('appointments.create') && (
            <Button icon={<HiPlus aria-hidden="true" />} onClick={() => setCreating(true)}>
              {t('appointments.new')}
            </Button>
          )
        }
      />

      {can('integrations.manage') && integrations.isSuccess && !connected.some((c) => c.provider === 'GOOGLE' || c.provider === 'MICROSOFT') && (
        <Card className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-info-soft text-lg text-info">
            <HiOutlineCalendarDays aria-hidden="true" />
          </span>
          <div className="flex-1">
            <p className="flex items-center gap-2 text-sm font-semibold">
              {t('calendar.notConnected')} {connected.length > 0 && <Badge tone="accent">{connected[0].provider}</Badge>}
            </p>
            <p className="text-sm text-ink-2">{t('calendar.notConnectedBody')}</p>
          </div>
          <ButtonLink to="/settings/integrations" variant="secondary" size="sm">
            {t('calendar.connect')}
          </ButtonLink>
        </Card>
      )}

      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b border-border p-3">
          <div className="flex items-center gap-1">
            <button type="button" onClick={() => shift(-1)} className="grid h-9 w-9 place-items-center rounded-lg border border-border hover:bg-surface-2" aria-label={t('calendar.prev')}>
              <HiChevronLeft aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={() => {
                setWeekStart(startOfWeek(new Date()));
                setSelectedDay(todayKey);
              }}
              className="h-9 rounded-lg border border-border px-3 text-sm font-medium hover:bg-surface-2"
            >
              {t('calendar.today')}
            </button>
            <button type="button" onClick={() => shift(1)} className="grid h-9 w-9 place-items-center rounded-lg border border-border hover:bg-surface-2" aria-label={t('calendar.next')}>
              <HiChevronRight aria-hidden="true" />
            </button>
          </div>
          <h2 className="text-sm font-semibold cap-first sm:text-base" aria-live="polite">
            {weekLabel}
          </h2>
          <Select aria-label={t('appointments.doctor')} value={doctorId} onChange={(e) => setDoctorId(e.target.value)} className="ml-auto w-full sm:w-56">
            <option value="">{t('calendar.allDoctors')}</option>
            {doctors.data?.map((d) => (
              <option key={d.id} value={d.id}>
                {doctorName(d)}
              </option>
            ))}
          </Select>
        </div>

        {/* Legend */}
        <ul className="flex flex-wrap gap-x-4 gap-y-1 border-b border-border px-4 py-2 text-xs text-ink-2">
          {doctors.data?.map((d) => (
            <li key={d.id} className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-sm" style={{ background: d.color }} aria-hidden="true" />
              {doctorName(d)}
            </li>
          ))}
        </ul>

        {appts.isLoading ? (
          <Skeleton className="m-4 h-96" />
        ) : (
          <>
            {/* Mobile / tablet: day agenda, one-hand friendly */}
            <div className="lg:hidden">
              <div role="tablist" aria-label={t('calendar.day')} className="grid grid-cols-7 gap-1 border-b border-border p-2">
                {days.map((d) => {
                  const k = dayKey(d, tz);
                  const count = byDay.get(k)?.length ?? 0;
                  return (
                    <button
                      key={k}
                      type="button"
                      role="tab"
                      aria-selected={selectedDay === k}
                      onClick={() => setSelectedDay(k)}
                      className={cn('flex flex-col items-center rounded-xl py-2 text-xs transition', selectedDay === k ? 'bg-primary text-primary-fg' : k === todayKey ? 'bg-primary-soft text-primary' : 'text-ink-2 hover:bg-surface-2')}
                    >
                      <span className="uppercase">{d.toLocaleDateString(prefs.lang === 'en' ? 'en-US' : 'es-CO', { weekday: 'narrow' })}</span>
                      <span className="text-base font-bold">{d.getDate()}</span>
                      <span className={cn('mt-0.5 h-1.5 w-1.5 rounded-full', count ? (selectedDay === k ? 'bg-primary-fg' : 'bg-primary') : 'bg-transparent')} aria-hidden="true" />
                    </button>
                  );
                })}
              </div>
              <ul className="divide-y divide-border">
                {(byDay.get(selectedDay) ?? []).map((a) => (
                  <li key={a.id}>
                    <Link to={`/appointments/${a.id}`} className="flex items-center gap-3 px-4 py-3 active:bg-surface-2" data-no-underline>
                      <span className="w-16 shrink-0 text-sm font-bold tabular-nums">{fmtTime(a.startTime, prefs.lang, tz)}</span>
                      <span className="h-10 w-1 rounded-full" style={{ background: a.doctor.color }} aria-hidden="true" />
                      <span className="min-w-0">
                        <span className="block truncate font-medium">{fullName(a.patient)}</span>
                        <span className="block truncate text-xs text-ink-3">
                          {doctorName(a.doctor)} · {a.service?.name}
                        </span>
                      </span>
                    </Link>
                  </li>
                ))}
                {!(byDay.get(selectedDay) ?? []).length && <EmptyState icon={<HiOutlineCalendarDays />} title={t('appointments.empty')} className="py-10" />}
              </ul>
            </div>

            {/* Desktop: week grid */}
            <div className="scrollbar-thin hidden max-h-[calc(100dvh-330px)] overflow-auto lg:block">
              <div className="grid min-w-[900px] grid-cols-[56px_repeat(7,minmax(0,1fr))]">
                <div className="sticky top-0 z-10 border-b border-border bg-surface" />
                {days.map((d) => {
                  const k = dayKey(d, tz);
                  return (
                    <div key={k} className={cn('sticky top-0 z-10 border-b border-l border-border bg-surface px-2 py-2 text-center', k === todayKey && 'bg-primary-soft')}>
                      <p className="text-xs font-medium uppercase text-ink-3">{d.toLocaleDateString(prefs.lang === 'en' ? 'en-US' : 'es-CO', { weekday: 'short' })}</p>
                      <p className={cn('text-lg font-bold', k === todayKey && 'text-primary')}>{d.getDate()}</p>
                    </div>
                  );
                })}
                <div className="relative">
                  {Array.from({ length: END_H - START_H }, (_, i) => (
                    <div key={i} className="relative border-b border-border/60 pr-2 text-right text-[0.68rem] text-ink-3" style={{ height: HOUR_PX }}>
                      <span className="-translate-y-2 inline-block">{`${String(START_H + i).padStart(2, '0')}:00`}</span>
                    </div>
                  ))}
                </div>
                {days.map((d) => {
                  const k = dayKey(d, tz);
                  const list = byDay.get(k) ?? [];
                  return (
                    <div key={k} className="relative border-l border-border" style={{ height: (END_H - START_H) * HOUR_PX }}>
                      {Array.from({ length: END_H - START_H }, (_, i) => (
                        <div key={i} className="border-b border-border/60" style={{ height: HOUR_PX }} />
                      ))}
                      {list.map((a) => {
                        const s = minutesInTz(new Date(a.startTime), tz);
                        const e = minutesInTz(new Date(a.endTime), tz);
                        const top = ((s - START_H * 60) / 60) * HOUR_PX;
                        const height = Math.max(22, ((e - s) / 60) * HOUR_PX - 2);
                        // Overlapping appointments of different doctors are laid out side by side.
                        const overlapping = list.filter((b) => minutesInTz(new Date(b.startTime), tz) < e && s < minutesInTz(new Date(b.endTime), tz));
                        const idx = overlapping.findIndex((b) => b.id === a.id);
                        const w = 100 / overlapping.length;
                        return (
                          <Link
                            key={a.id}
                            to={`/appointments/${a.id}`}
                            className="absolute overflow-hidden rounded-lg border-l-[3px] px-1.5 py-1 text-[0.7rem] leading-tight shadow-sm transition hover:z-10 hover:shadow-pop"
                            style={{ top, height, left: `calc(${idx * w}% + 2px)`, width: `calc(${w}% - 4px)`, borderColor: a.doctor.color, background: `color-mix(in srgb, ${a.doctor.color} 14%, rgb(var(--surface)))` }}
                            title={`${fmtTime(a.startTime, prefs.lang, tz)} ${fullName(a.patient)} · ${doctorName(a.doctor)}`}
                            data-no-underline
                          >
                            <span className="block font-semibold text-ink">{fmtTime(a.startTime, prefs.lang, tz)}</span>
                            <span className="block truncate text-ink-2">{fullName(a.patient)}</span>
                          </Link>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            </div>
          </>
        )}
      </Card>
      <NewAppointmentDialog open={creating} onClose={() => setCreating(false)} defaultDoctorId={doctorId || undefined} />
    </div>
  );
}
