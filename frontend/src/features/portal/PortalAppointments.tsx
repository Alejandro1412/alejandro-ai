import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { HiOutlineCalendarDays } from 'react-icons/hi2';
import { Button, ButtonLink } from '@/components/ui/Button';
import { Badge, Card, Segmented, statusTone } from '@/components/ui/Display';
import { EmptyState, SkeletonRows } from '@/components/ui/Feedback';
import { ConfirmDialog, Modal } from '@/components/ui/Overlay';
import { useToast } from '@/components/ui/Toast';
import { usePreferences, useT } from '@/contexts/PreferencesContext';
import { api, errorMessage } from '@/lib/api';
import { doctorName, fmtDateLong, fmtDateTime, fmtTime } from '@/lib/format';
import type { Appointment } from '@/types';
import { SlotPicker } from '../appointments/SlotPicker';

export default function PortalAppointments() {
  const t = useT();
  const { prefs } = usePreferences();
  const toast = useToast();
  const qc = useQueryClient();
  const [tab, setTab] = useState<'upcoming' | 'history'>('upcoming');
  const [cancelling, setCancelling] = useState<Appointment | null>(null);
  const [moving, setMoving] = useState<Appointment | null>(null);
  const [newStart, setNewStart] = useState<string | null>(null);
  const q = useQuery({ queryKey: ['portal', 'appointments'], queryFn: () => api.get<Appointment[]>('/portal/appointments') });
  const refresh = () => void qc.invalidateQueries({ queryKey: ['portal'] });
  const cancel = useMutation({
    mutationFn: (id: string) => api.post(`/portal/appointments/${id}/cancel`, {}),
    onSuccess: () => (toast.success(t('appointments.cancelled')), setCancelling(null), refresh()),
    onError: (e) => toast.error(errorMessage(e)),
  });
  const reschedule = useMutation({
    mutationFn: () => api.post(`/portal/appointments/${moving!.id}/reschedule`, { startTime: newStart }),
    onSuccess: () => (toast.success(t('appointments.rescheduled')), setMoving(null), setNewStart(null), refresh()),
    onError: (e) => toast.error(errorMessage(e)),
  });

  const now = new Date();
  const list = (q.data ?? []).filter((a) => (tab === 'upcoming' ? new Date(a.startTime) >= now && ['CONFIRMED', 'PENDING'].includes(a.status) : new Date(a.startTime) < now || !['CONFIRMED', 'PENDING'].includes(a.status)));
  if (tab === 'upcoming') list.sort((a, b) => a.startTime.localeCompare(b.startTime));

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">{t('portal.myAppointments')}</h1>
      <Segmented
        label={t('portal.myAppointments')}
        value={tab}
        onChange={setTab}
        options={[
          { value: 'upcoming', label: t('portal.upcoming') },
          { value: 'history', label: t('portal.history') },
        ]}
      />
      {q.isLoading ? (
        <SkeletonRows />
      ) : !list.length ? (
        <Card>
          <EmptyState icon={<HiOutlineCalendarDays />} title={t('portal.noUpcoming')} action={<ButtonLink to="/portal/book">{t('portal.bookNow')}</ButtonLink>} />
        </Card>
      ) : (
        <ul className="space-y-3">
          {list.map((a) => (
            <li key={a.id} className="card p-4">
              <div className="flex items-start gap-3">
                <span className="mt-1 h-10 w-1 rounded-full" style={{ background: a.doctor.color }} aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <p className="font-semibold cap-first">{fmtDateLong(a.startTime, prefs.lang)}</p>
                  <p className="text-sm text-ink-2">
                    {fmtTime(a.startTime, prefs.lang)} · {doctorName(a.doctor)}
                  </p>
                  <p className="text-xs text-ink-3">
                    {a.service?.name}
                    {a.location ? ` · ${a.location.name}` : ''}
                  </p>
                </div>
                <Badge tone={statusTone(a.status)} dot>
                  {t(`status.${a.status}` as never)}
                </Badge>
              </div>
              {tab === 'upcoming' && (
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <Button variant="secondary" onClick={() => setMoving(a)}>
                    {t('appointments.reschedule')}
                  </Button>
                  <Button variant="ghost" className="text-danger hover:bg-danger-soft" onClick={() => setCancelling(a)}>
                    {t('appointments.cancel')}
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      <ConfirmDialog
        open={Boolean(cancelling)}
        onClose={() => setCancelling(null)}
        danger
        title={t('chat.confirmCancelTitle')}
        body={cancelling ? t('chat.confirmCancelBody', { when: fmtDateTime(cancelling.startTime, prefs.lang), doctor: doctorName(cancelling.doctor) }) : ''}
        loading={cancel.isPending}
        onConfirm={() => cancelling && cancel.mutate(cancelling.id)}
      />
      <Modal
        open={Boolean(moving)}
        onClose={() => setMoving(null)}
        title={t('appointments.reschedule')}
        size="lg"
        footer={
          <Button className="w-full sm:w-auto" disabled={!newStart} loading={reschedule.isPending} onClick={() => reschedule.mutate()}>
            {t('common.confirm')}
          </Button>
        }
      >
        {moving && <SlotPicker endpoint="/portal/slots" doctorId={moving.doctorId} serviceId={moving.serviceId ?? undefined} value={newStart} onChange={(s) => setNewStart(s.start)} />}
      </Modal>
    </div>
  );
}
