import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { HiArrowLeft, HiOutlinePencilSquare, HiOutlineTrash, HiPlus } from 'react-icons/hi2';
import { Link, useParams } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { Avatar, Badge, Card, CardHeader, statusTone } from '@/components/ui/Display';
import { ErrorState, Skeleton } from '@/components/ui/Feedback';
import { Field, Input, Select } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Overlay';
import { useToast } from '@/components/ui/Toast';
import { useAuth } from '@/contexts/AuthContext';
import { usePreferences, useT } from '@/contexts/PreferencesContext';
import { api, errorMessage } from '@/lib/api';
import { doctorName, fmtDateTime } from '@/lib/format';
import type { Doctor, Schedule } from '@/types';
import { SlotPicker } from '../appointments/SlotPicker';
import { DoctorFormDialog } from './DoctorFormDialog';

function ScheduleEditor({ doctor, editable }: { doctor: Doctor; editable: boolean }) {
  const t = useT();
  const toast = useToast();
  const qc = useQueryClient();
  const [rows, setRows] = useState<Schedule[]>(doctor.schedules);
  useEffect(() => setRows(doctor.schedules), [doctor.schedules]);
  const save = useMutation({
    mutationFn: () => api.put(`/doctors/${doctor.id}/schedule`, { intervals: rows.map(({ dayOfWeek, startTime, endTime }) => ({ dayOfWeek, startTime, endTime })) }),
    onSuccess: () => {
      toast.success(t('common.saved'));
      void qc.invalidateQueries({ queryKey: ['doctors'] });
      void qc.invalidateQueries({ queryKey: ['slots'] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const update = (i: number, patch: Partial<Schedule>) => setRows((r) => r.map((x, j) => (j === i ? { ...x, ...patch } : x)));

  return (
    <div className="space-y-3 px-5 pb-5">
      <p className="text-xs text-ink-3">{t('doctors.scheduleHint')}</p>
      {[1, 2, 3, 4, 5, 6, 7].map((day) => {
        const blocks = rows.map((r, i) => ({ r, i })).filter(({ r }) => r.dayOfWeek === day);
        return (
          <div key={day} className="flex flex-col gap-2 border-b border-border/60 pb-3 last:border-0 sm:flex-row sm:items-start">
            <p className="w-28 shrink-0 pt-2 text-sm font-medium">{t(`days.${day}` as never)}</p>
            <div className="flex flex-1 flex-wrap items-center gap-2">
              {!blocks.length && <span className="pt-2 text-sm text-ink-3">{t('doctors.closed')}</span>}
              {blocks.map(({ r, i }) => (
                <div key={i} className="flex items-center gap-1.5 rounded-xl border border-border bg-surface-2 p-1">
                  <input aria-label={`${t(`days.${day}` as never)} ${t('doctors.starts')}`} type="time" value={r.startTime} disabled={!editable} onChange={(e) => update(i, { startTime: e.target.value })} className="rounded-lg bg-transparent px-1.5 py-1 text-sm" />
                  <span className="text-ink-3">–</span>
                  <input aria-label={`${t(`days.${day}` as never)} ${t('doctors.ends')}`} type="time" value={r.endTime} disabled={!editable} onChange={(e) => update(i, { endTime: e.target.value })} className="rounded-lg bg-transparent px-1.5 py-1 text-sm" />
                  {editable && (
                    <button type="button" onClick={() => setRows((x) => x.filter((_, j) => j !== i))} className="rounded-lg p-1.5 text-ink-3 hover:bg-danger-soft hover:text-danger" aria-label={t('common.remove')}>
                      <HiOutlineTrash aria-hidden="true" />
                    </button>
                  )}
                </div>
              ))}
              {editable && (
                <button type="button" onClick={() => setRows((x) => [...x, { dayOfWeek: day, startTime: '08:00', endTime: '12:00' }])} className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-medium text-primary hover:bg-primary-soft">
                  <HiPlus aria-hidden="true" /> {t('doctors.addBlock')}
                </button>
              )}
            </div>
          </div>
        );
      })}
      {editable && (
        <div className="flex justify-end">
          <Button loading={save.isPending} onClick={() => save.mutate()}>
            {t('common.save')}
          </Button>
        </div>
      )}
    </div>
  );
}

export default function DoctorDetailPage() {
  const { id = '' } = useParams();
  const t = useT();
  const { prefs } = usePreferences();
  const { me, can } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [offOpen, setOffOpen] = useState(false);
  const [off, setOff] = useState({ type: 'BLOCK', startsAt: '', endsAt: '', reason: '' });
  const q = useQuery({ queryKey: ['doctors', id], queryFn: () => api.get<Doctor>(`/doctors/${id}`) });
  const addOff = useMutation({
    mutationFn: () => api.post(`/doctors/${id}/time-off`, { ...off, startsAt: new Date(off.startsAt).toISOString(), endsAt: new Date(off.endsAt).toISOString(), reason: off.reason || null }),
    onSuccess: () => {
      setOffOpen(false);
      void qc.invalidateQueries({ queryKey: ['doctors', id] });
      void qc.invalidateQueries({ queryKey: ['slots'] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const removeOff = useMutation({ mutationFn: (offId: string) => api.delete(`/doctors/${id}/time-off/${offId}`), onSuccess: () => void qc.invalidateQueries({ queryKey: ['doctors', id] }) });

  if (q.isLoading) return <Skeleton className="h-96 rounded-2xl" />;
  if (q.isError || !q.data) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  const d = q.data;
  const editable = can('doctors.update');

  return (
    <div className="space-y-4">
      <Link to="/doctors" className="inline-flex items-center gap-1.5 text-sm font-medium text-ink-2 hover:text-ink">
        <HiArrowLeft aria-hidden="true" /> {t('doctors.title')}
      </Link>
      <Card>
        <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center">
          <Avatar name={doctorName(d)} color={d.color} size={72} />
          <div className="min-w-0 flex-1">
            <h1 className="text-2xl font-bold">{doctorName(d)}</h1>
            <p className="text-ink-2">
              {d.specialty?.name}
              {d.location ? ` · ${d.location.name}` : ''}
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <Badge tone={statusTone(d.status)} dot>
                {t(`doctorStatus.${d.status}`)}
              </Badge>
              <Badge>{d.languages.join(' · ').toUpperCase()}</Badge>
              <Badge>
                {d.defaultDurationMinutes} {t('common.minutes')}
              </Badge>
              <Badge tone="info">{d.calendar ? `${t('doctors.connectedCalendar')}: ${d.calendar.provider}` : t('doctors.clinicCalendar')}</Badge>
            </div>
          </div>
          {editable && (
            <Button variant="secondary" icon={<HiOutlinePencilSquare aria-hidden="true" />} onClick={() => setEditing(true)}>
              {t('common.edit')}
            </Button>
          )}
        </div>
        {d.bio && <p className="border-t border-border px-5 py-4 text-sm text-ink-2">{d.bio}</p>}
      </Card>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <Card aria-labelledby="sched-h">
          <CardHeader id="sched-h" title={t('doctors.schedule')} />
          <ScheduleEditor doctor={d} editable={editable} />
        </Card>
        <div className="space-y-4">
          <Card aria-labelledby="avail-h">
            <CardHeader id="avail-h" title={t('doctors.availability')} />
            <div className="px-5 pb-5">
              <SlotPicker doctorId={d.id} value={null} onChange={() => undefined} days={7} />
            </div>
          </Card>
          <Card aria-labelledby="off-h">
            <CardHeader
              id="off-h"
              title={t('doctors.timeOff')}
              action={
                editable && (
                  <Button size="sm" variant="ghost" icon={<HiPlus aria-hidden="true" />} onClick={() => setOffOpen(true)}>
                    {t('doctors.addTimeOff')}
                  </Button>
                )
              }
            />
            <ul className="divide-y divide-border px-5 pb-4">
              {!d.timeOff?.length && <li className="py-2 text-sm text-ink-3">{t('doctors.noTimeOff')}</li>}
              {d.timeOff?.map((o) => (
                <li key={o.id} className="flex items-center gap-3 py-2.5 text-sm">
                  <Badge tone={o.type === 'VACATION' ? 'accent' : 'neutral'}>{o.type}</Badge>
                  <span className="min-w-0 flex-1">
                    <span className="block">
                      {fmtDateTime(o.startsAt, prefs.lang, me?.clinic.timezone)} → {fmtDateTime(o.endsAt, prefs.lang, me?.clinic.timezone)}
                    </span>
                    {o.reason && <span className="block text-xs text-ink-3">{o.reason}</span>}
                  </span>
                  {editable && (
                    <button type="button" onClick={() => removeOff.mutate(o.id)} className="rounded-lg p-1.5 text-ink-3 hover:bg-danger-soft hover:text-danger" aria-label={t('common.delete')}>
                      <HiOutlineTrash aria-hidden="true" />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </Card>
          <Card aria-labelledby="svc-h">
            <CardHeader id="svc-h" title={t('doctors.services')} />
            <ul className="flex flex-wrap gap-2 px-5 pb-5">
              {d.services.map((s) => (
                <li key={s.id}>
                  <Badge tone="primary">
                    {s.name} · {s.durationMinutes}′
                  </Badge>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>

      <DoctorFormDialog open={editing} onClose={() => setEditing(false)} doctor={d} />
      <Modal
        open={offOpen}
        onClose={() => setOffOpen(false)}
        title={t('doctors.addTimeOff')}
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setOffOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button disabled={!off.startsAt || !off.endsAt} loading={addOff.isPending} onClick={() => addOff.mutate()}>
              {t('common.save')}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label={t('doctors.type')}>
            <Select value={off.type} onChange={(e) => setOff({ ...off, type: e.target.value })}>
              <option value="BLOCK">BLOCK</option>
              <option value="BREAK">BREAK</option>
              <option value="VACATION">VACATION</option>
            </Select>
          </Field>
          <Field label={t('doctors.starts')} required>
            <Input type="datetime-local" value={off.startsAt} onChange={(e) => setOff({ ...off, startsAt: e.target.value })} />
          </Field>
          <Field label={t('doctors.ends')} required>
            <Input type="datetime-local" value={off.endsAt} onChange={(e) => setOff({ ...off, endsAt: e.target.value })} />
          </Field>
          <Field label={t('doctors.reason')}>
            <Input value={off.reason} onChange={(e) => setOff({ ...off, reason: e.target.value })} />
          </Field>
        </div>
      </Modal>
    </div>
  );
}
