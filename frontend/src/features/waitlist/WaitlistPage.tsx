import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { HiOutlineArrowTopRightOnSquare, HiOutlineClock, HiOutlineInformationCircle, HiOutlineQueueList, HiOutlineTrash, HiPlus } from 'react-icons/hi2';
import { Link } from 'react-router-dom';
import { Button, IconButton } from '@/components/ui/Button';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { Badge, Card, PageHeader, Tabs, type Tone } from '@/components/ui/Display';
import { EmptyState, ErrorState, SkeletonRows } from '@/components/ui/Feedback';
import { ConfirmDialog } from '@/components/ui/Overlay';
import { useToast } from '@/components/ui/Toast';
import { useAuth } from '@/contexts/AuthContext';
import { usePreferences, useT } from '@/contexts/PreferencesContext';
import { api, errorMessage } from '@/lib/api';
import { doctorName, fmtDate, fmtDateTime, fmtRelative, fullName } from '@/lib/format';
import { AddToWaitlistDialog } from './AddToWaitlistDialog';
import { countByStatus, formatCountdown, WAITLIST_STATUSES, type WaitlistEntry, type WaitlistStatus } from './waitlist';

const STATUS_TONE: Record<WaitlistStatus, Tone> = { WAITING: 'info', OFFERED: 'warning', BOOKED: 'success', EXPIRED: 'neutral', CANCELLED: 'danger' };
const SOURCE_TONE: Record<string, Tone> = { AI: 'primary', WHATSAPP: 'accent', HUMAN: 'neutral' };

/** Re-renders every `ms` while enabled (offer countdowns). */
function useNow(ms: number, enabled: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!enabled) return;
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms, enabled]);
  return now;
}

export default function WaitlistPage() {
  const t = useT();
  const { prefs } = usePreferences();
  const { me, can } = useAuth();
  const tz = me?.clinic.timezone;
  const qc = useQueryClient();
  const toast = useToast();
  const [status, setStatus] = useState<WaitlistStatus>('WAITING');
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<WaitlistEntry | null>(null);

  // The realtime hook only maps a fixed set of events, so the list also polls every 30 s.
  const q = useQuery({ queryKey: ['waitlist'], queryFn: () => api.get<WaitlistEntry[]>('/waitlist'), refetchInterval: 30_000 });
  const all = q.data ?? [];
  const counts = countByStatus(all);
  const rows = all.filter((e) => e.status === status);
  const now = useNow(15_000, status === 'OFFERED' && rows.length > 0);

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/waitlist/${id}`),
    onSuccess: () => {
      toast.success(t('growth.waitlist.removed'));
      setRemoving(null);
      void qc.invalidateQueries({ queryKey: ['waitlist'] });
    },
    onError: (e) => toast.error(t('common.errorGeneric'), errorMessage(e)),
  });

  const lang = prefs.lang;
  const patientName = (e: WaitlistEntry) => (e.patient ? fullName(e.patient) : '—');
  const targetLabel = (e: WaitlistEntry) => {
    const parts = [e.doctor ? doctorName(e.doctor) : null, e.specialty ? (lang === 'en' ? (e.specialty.nameEn ?? e.specialty.name) : e.specialty.name) : null, e.service ? (lang === 'en' ? (e.service.nameEn ?? e.service.name) : e.service.name) : null].filter(Boolean);
    return parts.length ? parts.join(' · ') : '—';
  };
  const range = (e: WaitlistEntry) => `${fmtDate(e.fromDate, lang, tz)} – ${fmtDate(e.toDate, lang, tz)}`;
  const tod = (e: WaitlistEntry) => (e.timeOfDay ? t(`growth.timeOfDay.${e.timeOfDay}`) : t('growth.timeOfDay.any'));
  const sourceBadge = (e: WaitlistEntry) => {
    const key = e.source === 'AI' || e.source === 'WHATSAPP' || e.source === 'HUMAN' ? e.source : 'AI';
    return <Badge tone={SOURCE_TONE[key]}>{t(`growth.waitlist.source.${key}`)}</Badge>;
  };
  const canRemove = (e: WaitlistEntry) => can('appointments.update') && (e.status === 'WAITING' || e.status === 'OFFERED');

  const detail = (e: WaitlistEntry) => {
    if (e.status === 'OFFERED' && e.offeredStart) {
      const left = e.offerExpiresAt ? formatCountdown(new Date(e.offerExpiresAt).getTime() - now) : null;
      return (
        <div className="space-y-0.5 text-sm">
          <p className="font-medium text-ink">{t('growth.waitlist.offered', { when: fmtDateTime(e.offeredStart, lang, tz) })}</p>
          {e.offerExpiresAt && (
            <p className="inline-flex items-center gap-1 text-xs text-warning">
              <HiOutlineClock aria-hidden="true" />
              {left ? t('growth.waitlist.expiresIn', { time: left }) : t('growth.waitlist.expired')}
            </p>
          )}
        </div>
      );
    }
    if (e.status === 'BOOKED' && e.appointmentId)
      return (
        <Link to={`/appointments/${e.appointmentId}`} className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline">
          {t('growth.waitlist.viewAppointment')} <HiOutlineArrowTopRightOnSquare aria-hidden="true" />
        </Link>
      );
    return e.notes ? <p className="line-clamp-2 max-w-[16rem] text-xs text-ink-3">{e.notes}</p> : <span className="text-ink-3">—</span>;
  };

  const removeBtn = (e: WaitlistEntry) =>
    canRemove(e) ? (
      <IconButton
        label={t('growth.waitlist.remove')}
        className="text-danger hover:bg-danger-soft hover:text-danger"
        onClick={(ev) => {
          ev.stopPropagation();
          setRemoving(e);
        }}
      >
        <HiOutlineTrash aria-hidden="true" />
      </IconButton>
    ) : null;

  const columns: Column<WaitlistEntry>[] = [
    {
      key: 'patient',
      header: t('growth.waitlist.col.patient'),
      cell: (e) =>
        e.patient ? (
          <Link to={`/patients/${e.patient.id}`} className="font-medium text-ink hover:underline">
            {patientName(e)}
          </Link>
        ) : (
          '—'
        ),
    },
    { key: 'target', header: t('growth.waitlist.col.target'), cell: (e) => <span className="text-ink-2">{targetLabel(e)}</span> },
    { key: 'dates', header: t('growth.waitlist.col.dates'), cell: (e) => <span className="whitespace-nowrap text-ink-2">{range(e)}</span>, hideBelow: 'lg' },
    { key: 'time', header: t('growth.waitlist.col.time'), cell: (e) => <span className="text-ink-2">{tod(e)}</span>, hideBelow: 'xl' },
    { key: 'source', header: t('growth.waitlist.col.source'), cell: sourceBadge },
    { key: 'created', header: t('growth.waitlist.col.created'), cell: (e) => <span className="whitespace-nowrap text-ink-3">{fmtRelative(e.createdAt, lang)}</span>, hideBelow: 'xl' },
    { key: 'detail', header: t('growth.waitlist.col.detail'), cell: detail },
    { key: 'actions', header: t('growth.waitlist.col.actions'), cell: (e) => removeBtn(e), className: 'w-14 text-right' },
  ];

  const card = (e: WaitlistEntry) => (
    <div className="min-w-0 space-y-1.5">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          {e.patient ? (
            <Link to={`/patients/${e.patient.id}`} className="block truncate font-semibold text-ink hover:underline">
              {patientName(e)}
            </Link>
          ) : (
            <span className="font-semibold">—</span>
          )}
          <p className="truncate text-sm text-ink-2">{targetLabel(e)}</p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {sourceBadge(e)}
          {removeBtn(e)}
        </div>
      </div>
      <p className="text-xs text-ink-3">
        {range(e)} · {tod(e)} · {fmtRelative(e.createdAt, lang)}
      </p>
      {detail(e)}
    </div>
  );

  return (
    <div className="page-enter space-y-5">
      <PageHeader
        title={t('growth.waitlist.title')}
        subtitle={t('growth.waitlist.subtitle')}
        actions={
          can('appointments.create') && (
            <Button icon={<HiPlus aria-hidden="true" />} onClick={() => setAdding(true)}>
              {t('growth.waitlist.add')}
            </Button>
          )
        }
      />

      <section aria-label={t('growth.waitlist.countsLabel')} className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {WAITLIST_STATUSES.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setStatus(s)}
            aria-pressed={status === s}
            className={`card flex flex-col items-start gap-1 p-4 text-left transition hover:border-border-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${status === s ? 'ring-2 ring-primary/40' : ''}`}
          >
            <Badge tone={STATUS_TONE[s]} dot>
              {t(`growth.waitlist.status.${s}`)}
            </Badge>
            <span className="font-display text-2xl font-bold tabular-nums text-ink">{q.isLoading ? '…' : counts[s]}</span>
          </button>
        ))}
      </section>

      <div className="flex items-start gap-3 rounded-2xl border border-info/25 bg-info-soft px-4 py-3 text-sm" role="note">
        <HiOutlineInformationCircle className="mt-0.5 shrink-0 text-lg text-info" aria-hidden="true" />
        <div>
          <p className="font-semibold text-ink">{t('growth.waitlist.howTitle')}</p>
          <p className="mt-0.5 text-ink-2">{t('growth.waitlist.howBody')}</p>
        </div>
      </div>

      <Card className="overflow-hidden">
        <div className="px-3 sm:px-4">
          <Tabs value={status} onChange={setStatus} tabs={WAITLIST_STATUSES.map((s) => ({ value: s, label: t(`growth.waitlist.status.${s}`), count: q.data ? counts[s] : undefined }))} />
        </div>
        {q.isLoading ? (
          <SkeletonRows rows={5} className="p-5" />
        ) : q.isError ? (
          <ErrorState error={q.error} onRetry={() => void q.refetch()} />
        ) : !rows.length ? (
          <EmptyState
            icon={<HiOutlineQueueList />}
            title={t('growth.waitlist.emptyTitle')}
            body={t('growth.waitlist.emptyBody')}
            action={
              status === 'WAITING' &&
              can('appointments.create') && (
                <Button variant="secondary" icon={<HiPlus aria-hidden="true" />} onClick={() => setAdding(true)}>
                  {t('growth.waitlist.add')}
                </Button>
              )
            }
          />
        ) : (
          <DataTable rows={rows} columns={columns} rowKey={(e) => e.id} mobileCard={card} caption={`${t('growth.waitlist.caption')} · ${t(`growth.waitlist.status.${status}`)}`} />
        )}
      </Card>

      {can('appointments.create') && <AddToWaitlistDialog open={adding} onClose={() => setAdding(false)} />}
      <ConfirmDialog
        open={Boolean(removing)}
        onClose={() => setRemoving(null)}
        onConfirm={() => removing && remove.mutate(removing.id)}
        loading={remove.isPending}
        danger
        title={t('growth.waitlist.removeTitle')}
        body={t('growth.waitlist.removeBody', { name: removing ? patientName(removing) : '' })}
        confirmLabel={t('growth.waitlist.remove')}
      />
    </div>
  );
}
