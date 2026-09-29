import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { HiOutlineCheckCircle } from 'react-icons/hi2';
import { Button, ButtonLink } from '@/components/ui/Button';
import { Card, CardHeader } from '@/components/ui/Display';
import { useToast } from '@/components/ui/Toast';
import { usePreferences, useT } from '@/contexts/PreferencesContext';
import { api, errorMessage } from '@/lib/api';
import { cn, fmtDateLong, fmtTime } from '@/lib/format';
import type { Specialty } from '@/types';
import { SlotPicker } from '../appointments/SlotPicker';

export default function PortalBook() {
  const t = useT();
  const { prefs } = usePreferences();
  const toast = useToast();
  const qc = useQueryClient();
  const [specialtyId, setSpecialtyId] = useState<string | null>(null);
  const [slot, setSlot] = useState<{ doctorId: string; doctorName: string; start: string } | null>(null);
  const [done, setDone] = useState(false);
  const specialties = useQuery({ queryKey: ['portal', 'specialties'], queryFn: () => api.get<Specialty[]>('/portal/specialties') });
  const book = useMutation({
    mutationFn: () => api.post('/portal/appointments', { doctorId: slot!.doctorId, startTime: slot!.start }),
    onSuccess: () => {
      setDone(true);
      void qc.invalidateQueries({ queryKey: ['portal'] });
    },
    onError: (e) => toast.error(t('common.errorGeneric'), errorMessage(e)),
  });

  if (done && slot)
    return (
      <Card className="p-8 text-center">
        <HiOutlineCheckCircle className="mx-auto text-5xl text-success" aria-hidden="true" />
        <h1 className="mt-3 text-2xl font-bold">{t('portal.booked')}</h1>
        <p className="mt-2 cap-first text-ink-2">
          {fmtDateLong(slot.start, prefs.lang)} · {fmtTime(slot.start, prefs.lang)} — {slot.doctorName}
        </p>
        <p className="mt-2 text-sm text-ink-3">{t('portal.remindersNote')}</p>
        <ButtonLink to="/portal/appointments" className="mt-6">
          {t('portal.myAppointments')}
        </ButtonLink>
      </Card>
    );

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">{t('portal.bookTitle')}</h1>
      <Card>
        <CardHeader title={t('portal.chooseSpecialty')} />
        <div role="radiogroup" aria-label={t('portal.chooseSpecialty')} className="grid grid-cols-2 gap-2 px-5 pb-5 sm:grid-cols-3">
          {specialties.data?.map((s) => (
            <button
              key={s.id}
              type="button"
              role="radio"
              aria-checked={specialtyId === s.id}
              onClick={() => {
                setSpecialtyId(s.id);
                setSlot(null);
              }}
              className={cn('rounded-2xl border p-4 text-left transition', specialtyId === s.id ? 'border-primary bg-primary-soft' : 'border-border hover:border-primary')}
            >
              <p className="font-semibold">{prefs.lang === 'en' && s.nameEn ? s.nameEn : s.name}</p>
              {s.description && <p className="mt-1 line-clamp-2 text-xs text-ink-3">{s.description}</p>}
            </button>
          ))}
        </div>
      </Card>
      {specialtyId && (
        <Card>
          <CardHeader title={t('portal.chooseSlot')} />
          <div className="px-5 pb-5">
            <SlotPicker endpoint="/portal/slots" specialtyId={specialtyId} value={slot?.start ?? null} onChange={(s) => setSlot(s)} />
          </div>
        </Card>
      )}
      {slot && (
        <div className="sticky bottom-20 lg:bottom-4">
          <Card className="flex flex-col gap-3 p-4 shadow-pop sm:flex-row sm:items-center">
            <div className="flex-1">
              <p className="text-xs text-ink-3">{t('portal.confirm')}</p>
              <p className="font-semibold cap-first">
                {fmtDateLong(slot.start, prefs.lang)} · {fmtTime(slot.start, prefs.lang)}
              </p>
              <p className="text-sm text-ink-2">{slot.doctorName}</p>
            </div>
            <Button size="lg" loading={book.isPending} onClick={() => book.mutate()}>
              {t('common.confirm')}
            </Button>
          </Card>
        </div>
      )}
    </div>
  );
}
