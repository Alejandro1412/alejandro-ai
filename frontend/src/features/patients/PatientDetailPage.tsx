import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { HiArrowLeft, HiOutlineLockClosed, HiOutlinePencilSquare, HiPlus } from 'react-icons/hi2';
import { Link, useParams } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { Avatar, Badge, Card, CardHeader, statusTone } from '@/components/ui/Display';
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/Feedback';
import { useAuth } from '@/contexts/AuthContext';
import { usePreferences, useT } from '@/contexts/PreferencesContext';
import { api } from '@/lib/api';
import { doctorName, fmtDate, fmtDateTime, fmtRelative, fullName } from '@/lib/format';
import type { Patient } from '@/types';
import { NewAppointmentDialog } from '../appointments/NewAppointmentDialog';
import { PatientFormDialog } from './PatientFormDialog';

export default function PatientDetailPage() {
  const { id = '' } = useParams();
  const t = useT();
  const { prefs } = usePreferences();
  const { me, can } = useAuth();
  const tz = me?.clinic.timezone;
  const [editing, setEditing] = useState(false);
  const [booking, setBooking] = useState(false);
  const q = useQuery({ queryKey: ['patients', id], queryFn: () => api.get<Patient>(`/patients/${id}`) });

  if (q.isLoading) return <Skeleton className="h-96 rounded-2xl" />;
  if (q.isError || !q.data) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  const p = q.data;

  return (
    <div className="space-y-4">
      <Link to="/patients" className="inline-flex items-center gap-1.5 text-sm font-medium text-ink-2 hover:text-ink">
        <HiArrowLeft aria-hidden="true" /> {t('patients.title')}
      </Link>
      <Card>
        <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center">
          <Avatar name={fullName(p)} size={64} />
          <div className="min-w-0 flex-1">
            <h1 className="text-2xl font-bold">{fullName(p)}</h1>
            <p className="text-ink-2">
              {p.phone} {p.email && `· ${p.email}`}
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {p.tags.map((x) => (
                <Badge key={x}>{x}</Badge>
              ))}
              <Badge tone="info">{p.preferredLanguage.toUpperCase()}</Badge>
              <Badge>{t(`source.${p.source}` as never)}</Badge>
            </div>
          </div>
          <div className="flex gap-2">
            {can('patients.update') && (
              <Button variant="secondary" icon={<HiOutlinePencilSquare aria-hidden="true" />} onClick={() => setEditing(true)}>
                {t('common.edit')}
              </Button>
            )}
            {can('appointments.create') && (
              <Button icon={<HiPlus aria-hidden="true" />} onClick={() => setBooking(true)}>
                {t('appointments.new')}
              </Button>
            )}
          </div>
        </div>
        <p className="flex items-center gap-1.5 border-t border-border px-5 py-2.5 text-xs text-ink-3">
          <HiOutlineLockClosed aria-hidden="true" /> {t('patients.privacyNote')}
        </p>
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <Card aria-labelledby="pa-h">
          <CardHeader id="pa-h" title={t('patients.appointments')} />
          {!p.appointments?.length ? (
            <EmptyState title={t('patients.noAppointments')} className="py-8" />
          ) : (
            <ul className="divide-y divide-border px-2 pb-2">
              {p.appointments.map((a) => (
                <li key={a.id}>
                  <Link to={`/appointments/${a.id}`} className="flex items-center gap-3 rounded-xl px-3 py-2.5 hover:bg-surface-2" data-no-underline>
                    <span className="h-9 w-1 rounded-full" style={{ background: a.doctor.color }} aria-hidden="true" />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium cap-first">{fmtDateTime(a.startTime, prefs.lang, tz)}</span>
                      <span className="block truncate text-xs text-ink-3">
                        {doctorName(a.doctor)} · {a.service?.name}
                      </span>
                    </span>
                    <Badge tone={statusTone(a.status)} dot>
                      {t(`status.${a.status}` as never)}
                    </Badge>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <div className="space-y-4">
          <Card aria-labelledby="pi-h">
            <CardHeader id="pi-h" title={t('common.details')} />
            <dl className="grid grid-cols-2 gap-3 px-5 pb-5 text-sm">
              <div>
                <dt className="text-xs text-ink-3">{t('patients.document')}</dt>
                <dd className="font-medium">{p.documentId ?? '—'}</dd>
              </div>
              <div>
                <dt className="text-xs text-ink-3">{t('patients.birthDate')}</dt>
                <dd className="font-medium">{p.dateOfBirth ? fmtDate(`${p.dateOfBirth}T12:00:00`, prefs.lang) : '—'}</dd>
              </div>
              <div>
                <dt className="text-xs text-ink-3">{t('patients.gender')}</dt>
                <dd className="font-medium">{p.gender ? t(`patients.genders.${p.gender}` as never) : '—'}</dd>
              </div>
              <div>
                <dt className="text-xs text-ink-3">{t('patients.since')}</dt>
                <dd className="font-medium">{fmtDate(p.createdAt, prefs.lang)}</dd>
              </div>
              {p.notes && (
                <div className="col-span-2">
                  <dt className="text-xs text-ink-3">{t('appointments.administrativeNotes')}</dt>
                  <dd>{p.notes}</dd>
                </div>
              )}
            </dl>
          </Card>
          <Card aria-labelledby="pc-h">
            <CardHeader id="pc-h" title={t('patients.conversations')} />
            <ul className="divide-y divide-border px-2 pb-2">
              {!p.conversations?.length && <li className="px-3 py-3 text-sm text-ink-3">—</li>}
              {p.conversations?.map((c) => (
                <li key={c.id}>
                  <Link to={`/conversations/${c.id}`} className="flex items-center gap-2 rounded-xl px-3 py-2.5 text-sm hover:bg-surface-2" data-no-underline>
                    <span className="min-w-0 flex-1 truncate">{c.subject ?? t(`channel.${c.channel}` as never)}</span>
                    <Badge tone={statusTone(c.status)}>{t(`status.${c.status}` as never)}</Badge>
                    <span className="text-xs text-ink-3">{fmtRelative(c.lastMessageAt, prefs.lang)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>
      <PatientFormDialog open={editing} onClose={() => setEditing(false)} patient={p} />
      <NewAppointmentDialog open={booking} onClose={() => setBooking(false)} defaultPatientId={p.id} />
    </div>
  );
}
