import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { HiOutlineCalendarDays } from 'react-icons/hi2';
import { EmptyState, Skeleton } from '@/components/ui/Feedback';
import { usePreferences, useT } from '@/contexts/PreferencesContext';
import { api } from '@/lib/api';
import { cn, fmtTime, fmtWeekdayShort } from '@/lib/format';

interface Slot {
  doctorId: string;
  doctorName: string;
  specialty: string | null;
  start: string;
  end: string;
}

/** Real-time slot picker: day chips (horizontal scroll on mobile) + time grid. */
export function SlotPicker({
  doctorId,
  specialtyId,
  serviceId,
  value,
  onChange,
  endpoint = '/appointments/slots',
  days = 14,
}: {
  doctorId?: string;
  specialtyId?: string;
  serviceId?: string;
  value: string | null;
  onChange: (slot: Slot) => void;
  endpoint?: string;
  days?: number;
}) {
  const t = useT();
  const { prefs } = usePreferences();
  const q = useQuery({
    queryKey: ['slots', endpoint, doctorId, specialtyId, serviceId, days],
    queryFn: () => api.get<{ timezone: string; slots: Slot[] }>(endpoint, { doctorId, specialtyId, serviceId, days, limit: 200 }),
    enabled: Boolean(doctorId || specialtyId),
  });
  const tz = q.data?.timezone;
  const byDay = useMemo(() => {
    const m = new Map<string, Slot[]>();
    for (const s of q.data?.slots ?? []) {
      const key = new Date(s.start).toLocaleDateString('en-CA', { timeZone: tz });
      m.set(key, [...(m.get(key) ?? []), s]);
    }
    return [...m.entries()];
  }, [q.data, tz]);
  const [day, setDay] = useState<string | null>(null);
  const activeDay = day ?? byDay[0]?.[0] ?? null;
  const slots = byDay.find(([d]) => d === activeDay)?.[1] ?? [];

  if (!doctorId && !specialtyId) return null;
  if (q.isLoading)
    return (
      <div className="space-y-3">
        <Skeleton className="h-14" />
        <Skeleton className="h-28" />
      </div>
    );
  if (!byDay.length) return <EmptyState icon={<HiOutlineCalendarDays />} title={t('appointments.noSlots')} className="py-8" />;

  return (
    <div className="space-y-3">
      <div role="radiogroup" aria-label={t('common.date')} className="scrollbar-thin -mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
        {byDay.map(([d, list]) => (
          <button
            key={d}
            type="button"
            role="radio"
            aria-checked={d === activeDay}
            onClick={() => setDay(d)}
            className={cn('flex min-w-[76px] shrink-0 flex-col items-center rounded-xl border px-3 py-2 text-xs transition', d === activeDay ? 'border-primary bg-primary text-primary-fg' : 'border-border bg-surface hover:border-primary')}
          >
            <span className="font-semibold cap-first">{fmtWeekdayShort(`${d}T12:00:00`, prefs.lang)}</span>
            <span className={cn('mt-0.5', d === activeDay ? 'text-primary-fg/80' : 'text-ink-3')}>{list.length}</span>
          </button>
        ))}
      </div>
      <div role="radiogroup" aria-label={t('common.time')} className="grid grid-cols-3 gap-2 sm:grid-cols-4">
        {slots.map((s) => (
          <button
            key={`${s.doctorId}-${s.start}`}
            type="button"
            role="radio"
            aria-checked={value === s.start}
            onClick={() => onChange(s)}
            className={cn('rounded-xl border px-2 py-2.5 text-sm font-semibold transition', value === s.start ? 'border-primary bg-primary-soft text-primary ring-2 ring-primary/30' : 'border-border bg-surface-2 hover:border-primary')}
            title={s.doctorName}
          >
            {fmtTime(s.start, prefs.lang, tz)}
            {!doctorId && <span className="block truncate text-[0.65rem] font-normal text-ink-3">{s.doctorName.replace(/^(Dr\.|Dra\.)\s/, '')}</span>}
          </button>
        ))}
      </div>
    </div>
  );
}
