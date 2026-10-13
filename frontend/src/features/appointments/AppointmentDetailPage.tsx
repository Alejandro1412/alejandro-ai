import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import {
  HiArrowLeft,
  HiOutlineArrowPath,
  HiOutlineBanknotes,
  HiOutlineChatBubbleLeftRight,
  HiOutlineCheck,
  HiOutlineCheckCircle,
  HiOutlineClipboardDocumentList,
  HiOutlineNoSymbol,
  HiOutlineVideoCamera,
  HiOutlineXMark,
} from 'react-icons/hi2';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Button, ButtonLink } from '@/components/ui/Button';
import { Avatar, Badge, Card, CardHeader, statusTone } from '@/components/ui/Display';
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/Feedback';
import { Field, Textarea } from '@/components/ui/Field';
import { ConfirmDialog, Modal } from '@/components/ui/Overlay';
import { useToast } from '@/components/ui/Toast';
import { useAuth } from '@/contexts/AuthContext';
import { usePreferences, useT } from '@/contexts/PreferencesContext';
import { api, errorMessage } from '@/lib/api';
import { doctorName, fmtDateLong, fmtDateTime, fmtMoney, fmtTime, fullName } from '@/lib/format';
import type { Appointment } from '@/types';
import { SlotPicker } from './SlotPicker';
import { canConfirmAttendance, DEPOSIT_TONE, intakeRows, type AppointmentV3, type IntakeResponse } from './v3';

export default function AppointmentDetailPage() {
  const { id = '' } = useParams();
  const t = useT();
  const { prefs } = usePreferences();
  const { me, can } = useAuth();
  const tz = me?.clinic.timezone;
  const qc = useQueryClient();
  const nav = useNavigate();
  const toast = useToast();
  const [cancelOpen, setCancelOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [rescheduleOpen, setRescheduleOpen] = useState(false);
  const [newStart, setNewStart] = useState<string | null>(null);
  const [seriesOpen, setSeriesOpen] = useState(false);

  const q = useQuery({ queryKey: ['appointments', id], queryFn: () => api.get<AppointmentV3>(`/appointments/${id}`) });
  const intake = useQuery({ queryKey: ['appointments', id, 'intake'], queryFn: () => api.get<IntakeResponse | null>(`/appointments/${id}/intake`) });
  const done = (msg: string) => () => {
    toast.success(msg);
    void qc.invalidateQueries({ queryKey: ['appointments'] });
  };
  const onErr = (e: unknown) => toast.error(t('common.errorGeneric'), errorMessage(e));
  const update = useMutation({ mutationFn: (status: string) => api.patch(`/appointments/${id}`, { status }), onSuccess: done(t('appointments.updated')), onError: onErr });
  const cancel = useMutation({
    mutationFn: () => api.post(`/appointments/${id}/cancel`, { reason: reason || undefined }),
    onSuccess: () => {
      setCancelOpen(false);
      done(t('appointments.cancelled'))();
    },
    onError: onErr,
  });
  const reschedule = useMutation({
    mutationFn: () => api.post<Appointment>(`/appointments/${id}/reschedule`, { startTime: newStart }),
    onSuccess: (a) => {
      setRescheduleOpen(false);
      done(t('appointments.rescheduled'))();
      nav(`/appointments/${a.id}`, { replace: true });
    },
    onError: onErr,
  });

  const confirmAttendance = useMutation({ mutationFn: () => api.post(`/appointments/${id}/confirm-attendance`), onSuccess: done(t('growth.appt.markedConfirmed')), onError: onErr });
  const cancelSeries = useMutation({
    mutationFn: (seriesId: string) => api.post<{ cancelled: number }>(`/appointments/series/${seriesId}/cancel`, { reason: reason || undefined }),
    onSuccess: (r) => {
      setSeriesOpen(false);
      done(t('growth.appt.seriesCancelled', { n: r.cancelled }))();
    },
    onError: onErr,
  });

  if (q.isLoading) return <Skeleton className="h-96 rounded-2xl" />;
  if (q.isError || !q.data) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  const a = q.data;
  const active = a.status === 'CONFIRMED' || a.status === 'PENDING';
  const intakeFields = a.service?.intakeFields ?? [];
  const answers = intake.data?.answers ?? null;
  const videoUrl = a.videoUrl && /^https?:\/\//i.test(a.videoUrl) ? a.videoUrl : null;
  const showIntake = intakeFields.length > 0 || Boolean(answers);
  const deposit = a.depositStatus && a.depositStatus !== 'NONE' ? a.depositStatus : null;
  const depositAmount = a.depositCents !== null && a.depositCents !== undefined ? fmtMoney(a.depositCents, a.service?.currency ?? 'COP', prefs.lang) : null;

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <Link to="/appointments" className="inline-flex items-center gap-1.5 text-sm font-medium text-ink-2 hover:text-ink">
        <HiArrowLeft aria-hidden="true" /> {t('appointments.title')}
      </Link>
      <Card className="overflow-hidden">
        <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-sm font-medium text-ink-3">{t('appointments.detail')}</p>
            <h1 className="mt-1 text-2xl font-bold cap-first">{fmtDateLong(a.startTime, prefs.lang, tz)}</h1>
            <p className="mt-1 text-lg text-ink-2">
              {fmtTime(a.startTime, prefs.lang, tz)} – {fmtTime(a.endTime, prefs.lang, tz)}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Badge tone={statusTone(a.status)} dot>
                {t(`status.${a.status}` as never)}
              </Badge>
              <Badge tone={a.source === 'AI' || a.source === 'WHATSAPP' ? 'primary' : 'neutral'}>{t(`source.${a.source}` as never)}</Badge>
              {deposit && (
                <Badge tone={DEPOSIT_TONE[deposit]}>
                  {t(`growth.appt.depositStatus.${deposit}`)}
                  {depositAmount ? ` · ${depositAmount}` : ''}
                </Badge>
              )}
              {a.patientConfirmedAt && (
                <Badge tone="success">
                  <HiOutlineCheckCircle aria-hidden="true" />
                  {t('growth.appt.confirmedAt', { when: fmtDateTime(a.patientConfirmedAt, prefs.lang, tz) })}
                </Badge>
              )}
              {a.seriesId && (
                <Badge tone="info">
                  <HiOutlineArrowPath aria-hidden="true" />
                  {t('growth.appt.series')}
                </Badge>
              )}
            </div>
            {videoUrl && active && (
              <a href={videoUrl} target="_blank" rel="noopener noreferrer" className="mt-4 inline-flex h-10 items-center gap-2 rounded-xl bg-accent px-4 text-[0.9375rem] font-medium text-white shadow-sm hover:bg-accent-strong dark:text-[#04201d]" data-no-underline>
                <HiOutlineVideoCamera aria-hidden="true" />
                {t('growth.appt.openVideo')}
              </a>
            )}
          </div>
          {active && (
            <div className="flex flex-wrap gap-2">
              {can('appointments.update') && (
                <>
                  <Button size="sm" variant="secondary" icon={<HiOutlineCheck aria-hidden="true" />} onClick={() => update.mutate('COMPLETED')}>
                    {t('appointments.markCompleted')}
                  </Button>
                  <Button size="sm" variant="secondary" icon={<HiOutlineNoSymbol aria-hidden="true" />} onClick={() => update.mutate('NO_SHOW')}>
                    {t('appointments.markNoShow')}
                  </Button>
                  <Button size="sm" variant="subtle" icon={<HiOutlineArrowPath aria-hidden="true" />} onClick={() => setRescheduleOpen(true)}>
                    {t('appointments.reschedule')}
                  </Button>
                </>
              )}
              {can('appointments.delete') && (
                <Button size="sm" variant="danger" icon={<HiOutlineXMark aria-hidden="true" />} onClick={() => setCancelOpen(true)}>
                  {t('appointments.cancel')}
                </Button>
              )}
            </div>
          )}
        </div>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader title={t('appointments.patient')} />
          <div className="flex items-center gap-3 px-5 pb-5">
            <Avatar name={fullName(a.patient)} size={44} />
            <div className="min-w-0">
              <Link to={`/patients/${a.patient.id}`} className="font-semibold hover:underline">
                {fullName(a.patient)}
              </Link>
              <p className="text-sm text-ink-3">{a.patient.phone}</p>
              <p className="truncate text-sm text-ink-3">{a.patient.email}</p>
            </div>
          </div>
        </Card>
        <Card>
          <CardHeader title={t('appointments.doctor')} />
          <div className="flex items-center gap-3 px-5 pb-5">
            <Avatar name={doctorName(a.doctor)} color={a.doctor.color} size={44} />
            <div>
              <Link to={`/doctors/${a.doctor.id}`} className="font-semibold hover:underline">
                {doctorName(a.doctor)}
              </Link>
              <p className="text-sm text-ink-3">{a.doctor.specialty?.name}</p>
            </div>
          </div>
        </Card>
      </div>

      <Card aria-labelledby="pre-visit">
        <CardHeader id="pre-visit" title={t('growth.appt.preVisit')} />
        <dl className="grid gap-4 px-5 pb-5 text-sm sm:grid-cols-2">
          <div className="min-w-0">
            <dt className="text-ink-3">{t('growth.appt.attendance')}</dt>
            <dd className="mt-1">
              {a.patientConfirmedAt ? (
                <Badge tone="success" dot>
                  {t('growth.appt.confirmedAt', { when: fmtDateTime(a.patientConfirmedAt, prefs.lang, tz) })}
                </Badge>
              ) : (
                <div className="space-y-2">
                  <p className="font-medium">{t('growth.appt.notConfirmed')}</p>
                  {canConfirmAttendance(a) && can('appointments.update') && (
                    <>
                      <Button size="sm" variant="secondary" icon={<HiOutlineCheckCircle aria-hidden="true" />} onClick={() => confirmAttendance.mutate()} loading={confirmAttendance.isPending} disabled={a.depositStatus === 'PENDING'}>
                        {t('growth.appt.markConfirmed')}
                      </Button>
                      {a.depositStatus === 'PENDING' && <p className="text-xs text-ink-3">{t('growth.appt.depositBlocksConfirm')}</p>}
                    </>
                  )}
                </div>
              )}
            </dd>
          </div>
          <div className="min-w-0">
            <dt className="text-ink-3">{t('growth.appt.deposit')}</dt>
            <dd className="mt-1 space-y-1.5">
              <span className="inline-flex flex-wrap items-center gap-2">
                <Badge tone={DEPOSIT_TONE[a.depositStatus ?? 'NONE']}>
                  <HiOutlineBanknotes aria-hidden="true" />
                  {t(`growth.appt.depositStatus.${a.depositStatus ?? 'NONE'}`)}
                </Badge>
                {deposit && depositAmount && <span className="font-semibold tabular-nums">{depositAmount}</span>}
              </span>
              {a.depositStatus === 'PENDING' && (
                <p role="note" className="rounded-xl bg-warning-soft px-3 py-2 text-xs text-ink-2">
                  {t('growth.appt.depositHold')}
                </p>
              )}
              {a.paymentRef && (
                <p className="truncate text-xs text-ink-3">
                  {t('growth.appt.paymentRef')}: <span className="font-mono">{a.paymentRef}</span>
                </p>
              )}
            </dd>
          </div>
          {videoUrl && !active && (
            <div className="min-w-0">
              <dt className="text-ink-3">{t('growth.appt.video')}</dt>
              <dd className="mt-1">
                <a href={videoUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 font-medium text-primary hover:underline">
                  <HiOutlineVideoCamera aria-hidden="true" />
                  {t('growth.appt.openVideo')}
                </a>
              </dd>
            </div>
          )}
          {a.seriesId && (
            <div className="min-w-0">
              <dt className="text-ink-3">{t('growth.appt.series')}</dt>
              <dd className="mt-1">
                {can('appointments.delete') ? (
                  <Button size="sm" variant="ghost" className="text-danger hover:bg-danger-soft hover:text-danger" icon={<HiOutlineXMark aria-hidden="true" />} onClick={() => setSeriesOpen(true)}>
                    {t('growth.appt.cancelSeries')}
                  </Button>
                ) : (
                  <span className="font-mono text-xs">{a.seriesId.slice(0, 8)}</span>
                )}
              </dd>
            </div>
          )}
        </dl>
      </Card>

      {showIntake && (
        <Card aria-labelledby="intake">
          <CardHeader id="intake" title={t('growth.appt.intake')} subtitle={intake.data?.submittedAt ? t('growth.appt.intakeSubmitted', { when: fmtDateTime(intake.data.submittedAt, prefs.lang, tz) }) : undefined} icon={<HiOutlineClipboardDocumentList />} />
          {intake.isLoading ? (
            <Skeleton className="mx-5 mb-5 h-20" />
          ) : !answers ? (
            <EmptyState title={t('growth.appt.intakeEmpty')} className="py-8" />
          ) : (
            <dl className="grid gap-4 px-5 pb-5 text-sm sm:grid-cols-2">
              {intakeRows(intakeFields, answers).map((r) => (
                <div key={r.key} className="min-w-0">
                  <dt className="text-ink-3">{r.label}</dt>
                  <dd className="whitespace-pre-wrap break-words font-medium">{typeof r.value === 'boolean' ? (r.value ? t('growth.appt.yes') : t('growth.appt.no')) : r.value || '—'}</dd>
                </div>
              ))}
            </dl>
          )}
        </Card>
      )}

      <Card>
        <dl className="grid gap-4 p-5 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-ink-3">{t('appointments.service')}</dt>
            <dd className="font-medium">{a.service?.name ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-ink-3">{t('appointments.location')}</dt>
            <dd className="font-medium">{a.location ? `${a.location.name} · ${a.location.address}` : '—'}</dd>
          </div>
          <div>
            <dt className="text-ink-3">{t('appointments.createdBy')}</dt>
            <dd className="font-medium">
              {t(`source.${a.source}` as never)} · {fmtDateTime(a.createdAt, prefs.lang, tz)}
            </dd>
          </div>
          <div>
            <dt className="text-ink-3">Calendar event</dt>
            <dd className="truncate font-mono text-xs">{a.calendarEventId ?? '—'}</dd>
          </div>
          {a.cancellationReason && (
            <div className="sm:col-span-2">
              <dt className="text-ink-3">{t('appointments.cancelReason')}</dt>
              <dd className="font-medium">{a.cancellationReason}</dd>
            </div>
          )}
          {a.notes && (
            <div className="sm:col-span-2">
              <dt className="text-ink-3">{t('appointments.administrativeNotes')}</dt>
              <dd>{a.notes}</dd>
            </div>
          )}
        </dl>
        {a.conversationId && (
          <div className="border-t border-border p-4">
            <ButtonLink to={`/conversations/${a.conversationId}`} variant="ghost" size="sm" icon={<HiOutlineChatBubbleLeftRight aria-hidden="true" />}>
              {t('appointments.conversation')}
            </ButtonLink>
          </div>
        )}
      </Card>

      <ConfirmDialog open={cancelOpen} onClose={() => setCancelOpen(false)} onConfirm={() => cancel.mutate()} danger loading={cancel.isPending} title={t('appointments.cancel')} body={t('chat.confirmCancelBody', { when: fmtDateTime(a.startTime, prefs.lang, tz), doctor: doctorName(a.doctor) })} confirmLabel={t('appointments.cancel')}>
        <Field label={t('appointments.cancelReason')} className="mt-4">
          <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
        </Field>
      </ConfirmDialog>

      {a.seriesId && (
        <ConfirmDialog open={seriesOpen} onClose={() => setSeriesOpen(false)} onConfirm={() => cancelSeries.mutate(a.seriesId!)} danger loading={cancelSeries.isPending} title={t('growth.appt.cancelSeriesTitle')} body={t('growth.appt.cancelSeriesBody')} confirmLabel={t('growth.appt.cancelSeries')}>
          <Field label={t('appointments.cancelReason')} className="mt-4">
            <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
          </Field>
        </ConfirmDialog>
      )}

      <Modal
        open={rescheduleOpen}
        onClose={() => setRescheduleOpen(false)}
        title={t('appointments.reschedule')}
        size="lg"
        footer={
          <>
            <Button variant="secondary" onClick={() => setRescheduleOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button disabled={!newStart} loading={reschedule.isPending} onClick={() => reschedule.mutate()}>
              {t('common.confirm')}
            </Button>
          </>
        }
      >
        <SlotPicker doctorId={a.doctorId} serviceId={a.serviceId ?? undefined} value={newStart} onChange={(s) => setNewStart(s.start)} />
      </Modal>
    </div>
  );
}
