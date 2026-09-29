import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { HiOutlineClipboardDocumentList, HiPlus } from 'react-icons/hi2';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { DataTable } from '@/components/ui/DataTable';
import { Avatar, Badge, Card, PageHeader, Pagination, Segmented, statusTone } from '@/components/ui/Display';
import { EmptyState, ErrorState, SkeletonRows } from '@/components/ui/Feedback';
import { Select } from '@/components/ui/Field';
import { useAuth } from '@/contexts/AuthContext';
import { usePreferences, useT } from '@/contexts/PreferencesContext';
import { api } from '@/lib/api';
import { doctorName, fmtDate, fmtTime, fullName } from '@/lib/format';
import type { Appointment, Doctor } from '@/types';
import { NewAppointmentDialog } from './NewAppointmentDialog';

export default function AppointmentsPage() {
  const t = useT();
  const { prefs } = usePreferences();
  const { me, can } = useAuth();
  const nav = useNavigate();
  const tz = me?.clinic.timezone;
  const [when, setWhen] = useState<'upcoming' | 'past'>('upcoming');
  const [status, setStatus] = useState('');
  const [doctorId, setDoctorId] = useState('');
  const [source, setSource] = useState('');
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const nowIso = useMemo(() => new Date(Math.floor(Date.now() / 300_000) * 300_000).toISOString(), []);

  const doctors = useQuery({ queryKey: ['doctors', 'all'], queryFn: () => api.get<Doctor[]>('/doctors') });
  const q = useQuery({
    queryKey: ['appointments', { when, status, doctorId, source, page }],
    queryFn: () =>
      api.page<Appointment>('/appointments', {
        page,
        pageSize: 25,
        status,
        doctorId,
        source,
        ...(when === 'upcoming' ? { from: nowIso, order: 'asc' } : { to: nowIso, order: 'desc' }),
      }),
    placeholderData: keepPreviousData,
  });

  return (
    <div className="space-y-5">
      <PageHeader
        title={t('appointments.title')}
        subtitle={t('appointments.subtitle')}
        actions={
          can('appointments.create') && (
            <Button icon={<HiPlus aria-hidden="true" />} onClick={() => setCreating(true)}>
              {t('appointments.new')}
            </Button>
          )
        }
      />
      <Card>
        <div className="flex flex-col gap-2 border-b border-border p-3 lg:flex-row lg:items-center">
          <Segmented
            label={t('common.filters')}
            value={when}
            onChange={(v) => {
              setWhen(v);
              setPage(1);
            }}
            options={[
              { value: 'upcoming', label: t('appointments.upcoming') },
              { value: 'past', label: t('appointments.past') },
            ]}
          />
          <div className="grid flex-1 grid-cols-3 gap-2 lg:ml-auto lg:max-w-2xl [&_select]:py-2 [&_select]:text-sm max-sm:[&_select]:pl-2.5 max-sm:[&_select]:pr-7 max-sm:[&_select]:text-xs">
            <Select aria-label={t('common.status')} value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">{t('appointments.allStatuses')}</option>
              {['PENDING', 'CONFIRMED', 'COMPLETED', 'CANCELLED', 'NO_SHOW', 'RESCHEDULED'].map((s) => (
                <option key={s} value={s}>
                  {t(`status.${s}` as never)}
                </option>
              ))}
            </Select>
            <Select aria-label={t('appointments.doctor')} value={doctorId} onChange={(e) => setDoctorId(e.target.value)}>
              <option value="">{t('appointments.allDoctors')}</option>
              {doctors.data?.map((d) => (
                <option key={d.id} value={d.id}>
                  {doctorName(d)}
                </option>
              ))}
            </Select>
            <Select aria-label={t('common.source')} value={source} onChange={(e) => setSource(e.target.value)}>
              <option value="">{t('appointments.allSources')}</option>
              {['HUMAN', 'AI', 'WHATSAPP', 'WEB', 'API'].map((s) => (
                <option key={s} value={s}>
                  {t(`source.${s}` as never)}
                </option>
              ))}
            </Select>
          </div>
        </div>
        {q.isLoading ? (
          <SkeletonRows rows={8} className="p-4" />
        ) : q.isError ? (
          <ErrorState error={q.error} onRetry={() => void q.refetch()} />
        ) : !q.data?.items.length ? (
          <EmptyState icon={<HiOutlineClipboardDocumentList />} title={t('appointments.empty')} body={t('appointments.emptyBody')} action={can('appointments.create') && <Button onClick={() => setCreating(true)}>{t('appointments.new')}</Button>} />
        ) : (
          <>
            <DataTable
              caption={t('appointments.title')}
              rows={q.data.items}
              rowKey={(a) => a.id}
              onRowClick={(a) => nav(`/appointments/${a.id}`)}
              columns={[
                {
                  key: 'when',
                  header: t('appointments.when'),
                  cell: (a) => (
                    <div>
                      <p className="font-semibold cap-first">{fmtDate(a.startTime, prefs.lang, tz)}</p>
                      <p className="text-xs text-ink-3">{fmtTime(a.startTime, prefs.lang, tz)}</p>
                    </div>
                  ),
                },
                {
                  key: 'patient',
                  header: t('appointments.patient'),
                  cell: (a) => (
                    <div className="flex items-center gap-2.5">
                      <Avatar name={fullName(a.patient)} size={30} />
                      <span className="font-medium">{fullName(a.patient)}</span>
                    </div>
                  ),
                },
                {
                  key: 'doctor',
                  header: t('appointments.doctor'),
                  cell: (a) => (
                    <div className="flex items-center gap-2">
                      <span className="h-2.5 w-2.5 rounded-full" style={{ background: a.doctor.color }} aria-hidden="true" />
                      <div>
                        <p>{doctorName(a.doctor)}</p>
                        <p className="text-xs text-ink-3">{a.service?.name ?? a.doctor.specialty?.name}</p>
                      </div>
                    </div>
                  ),
                },
                { key: 'source', header: t('common.source'), hideBelow: 'lg', cell: (a) => <Badge tone={a.source === 'AI' || a.source === 'WHATSAPP' ? 'primary' : 'neutral'}>{t(`source.${a.source}` as never)}</Badge> },
                {
                  key: 'status',
                  header: t('common.status'),
                  cell: (a) => (
                    <Badge tone={statusTone(a.status)} dot>
                      {t(`status.${a.status}` as never)}
                    </Badge>
                  ),
                },
              ]}
              mobileCard={(a) => (
                <div className="flex items-start gap-3">
                  <div className="w-14 shrink-0 text-center">
                    <p className="text-xs font-medium cap-first text-ink-3">{fmtDate(a.startTime, prefs.lang, tz).split(' ').slice(0, 2).join(' ')}</p>
                    <p className="text-sm font-bold">{fmtTime(a.startTime, prefs.lang, tz)}</p>
                  </div>
                  <span className="w-1 self-stretch rounded-full" style={{ background: a.doctor.color }} aria-hidden="true" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold">{fullName(a.patient)}</p>
                    <p className="truncate text-sm text-ink-2">{doctorName(a.doctor)}</p>
                    <div className="mt-1.5 flex gap-1.5">
                      <Badge tone={statusTone(a.status)} dot>
                        {t(`status.${a.status}` as never)}
                      </Badge>
                      <Badge>{t(`source.${a.source}` as never)}</Badge>
                    </div>
                  </div>
                </div>
              )}
            />
            <Pagination page={page} totalPages={q.data.meta.totalPages} onChange={setPage} />
          </>
        )}
      </Card>
      <NewAppointmentDialog open={creating} onClose={() => setCreating(false)} />
    </div>
  );
}
