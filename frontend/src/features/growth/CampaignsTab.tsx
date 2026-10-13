import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { HiOutlineExclamationTriangle, HiOutlineMegaphone, HiOutlinePaperAirplane, HiPlus } from 'react-icons/hi2';
import { Button } from '@/components/ui/Button';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { Badge, Card, type Tone } from '@/components/ui/Display';
import { EmptyState, ErrorState, SkeletonRows, Spinner } from '@/components/ui/Feedback';
import { ConfirmDialog } from '@/components/ui/Overlay';
import { useToast } from '@/components/ui/Toast';
import { useAuth } from '@/contexts/AuthContext';
import { usePreferences, useT } from '@/contexts/PreferencesContext';
import { api, errorMessage } from '@/lib/api';
import { fmtDate, fmtNumber } from '@/lib/format';
import { conversionPct, type AudiencePreview, type Campaign } from './growth';
import { NewCampaignDialog } from './NewCampaignDialog';

const STATUS_TONE: Record<Campaign['status'], Tone> = { DRAFT: 'neutral', SENDING: 'info', SENT: 'success' };

export function CampaignsTab() {
  const t = useT();
  const { prefs } = usePreferences();
  const { me, can } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [sending, setSending] = useState<Campaign | null>(null);
  const lang = prefs.lang;
  const tz = me?.clinic.timezone;
  const manage = can('settings.manage');

  const q = useQuery({
    queryKey: ['campaigns'],
    queryFn: () => api.get<Campaign[]>('/campaigns'),
    enabled: manage,
    // While a campaign is being delivered, poll until it settles.
    refetchInterval: (query) => (query.state.data?.some((c) => c.status === 'SENDING') ? 5_000 : false),
  });
  const audience = useQuery({
    queryKey: ['campaigns', 'preview', 'send', sending?.id],
    queryFn: () => api.post<AudiencePreview>('/campaigns/preview', { kind: sending!.kind, criteria: { monthsSinceLastVisit: sending!.criteria.monthsSinceLastVisit, specialtyId: sending!.criteria.specialtyId ?? null, daysSinceVisit: sending!.criteria.daysSinceVisit } }),
    enabled: Boolean(sending),
  });
  const send = useMutation({
    mutationFn: (id: string) => api.post<Campaign>(`/campaigns/${id}/send`),
    onSuccess: () => {
      toast.success(t('growth.campaigns.sending'));
      setSending(null);
      void qc.invalidateQueries({ queryKey: ['campaigns'] });
    },
    onError: (e) => toast.error(t('common.errorGeneric'), errorMessage(e)),
  });

  if (!manage)
    return (
      <Card>
        <EmptyState icon={<HiOutlineMegaphone />} title={t('growth.campaigns.tab')} body={t('growth.campaigns.noPermission')} />
      </Card>
    );

  const dateCell = (c: Campaign) => (c.sentAt ? t('growth.campaigns.sentOn', { date: fmtDate(c.sentAt, lang, tz) }) : t('growth.campaigns.createdOn', { date: fmtDate(c.createdAt, lang, tz) }));
  const n = (v: number) => fmtNumber(v, lang);
  const bookedCell = (c: Campaign) => {
    const pct = conversionPct(c.stats);
    return (
      <span className="whitespace-nowrap">
        <span className="font-semibold tabular-nums text-ink">{n(c.stats.booked)}</span>
        {pct !== null && <span className="ml-1.5 text-xs text-ink-3">{t('growth.campaigns.conversion', { pct })}</span>}
      </span>
    );
  };
  const sendBtn = (c: Campaign) =>
    c.status === 'DRAFT' ? (
      <Button size="sm" variant="subtle" icon={<HiOutlinePaperAirplane aria-hidden="true" />} onClick={() => setSending(c)}>
        {t('growth.campaigns.send')}
      </Button>
    ) : null;
  const statusBadge = (c: Campaign) => (
    <Badge tone={STATUS_TONE[c.status]} dot>
      {c.status === 'SENDING' && <Spinner className="h-3 w-3" />}
      {t(`growth.campaigns.status.${c.status}`)}
    </Badge>
  );

  const columns: Column<Campaign>[] = [
    {
      key: 'name',
      header: t('growth.campaigns.col.name'),
      cell: (c) => (
        <div className="min-w-0">
          <p className="font-medium text-ink">{c.name}</p>
          <p className="text-xs text-ink-3">{t(`growth.campaigns.kind.${c.kind}`)}</p>
        </div>
      ),
    },
    { key: 'status', header: t('growth.campaigns.col.status'), cell: statusBadge },
    { key: 'date', header: t('growth.campaigns.col.date'), cell: (c) => <span className="whitespace-nowrap text-ink-2">{dateCell(c)}</span>, hideBelow: 'lg' },
    { key: 'recipients', header: t('growth.campaigns.col.recipients'), cell: (c) => <span className="tabular-nums">{c.status === 'DRAFT' ? '—' : n(c.stats.recipients)}</span>, className: 'text-right' },
    { key: 'sent', header: t('growth.campaigns.col.sent'), cell: (c) => <span className="tabular-nums">{c.status === 'DRAFT' ? '—' : n(c.stats.sent)}</span>, className: 'text-right', hideBelow: 'lg' },
    { key: 'failed', header: t('growth.campaigns.col.failed'), cell: (c) => <span className={c.stats.failed ? 'tabular-nums text-danger' : 'tabular-nums'}>{c.status === 'DRAFT' ? '—' : n(c.stats.failed)}</span>, className: 'text-right', hideBelow: 'xl' },
    { key: 'booked', header: t('growth.campaigns.col.booked'), cell: (c) => (c.status === 'SENT' ? bookedCell(c) : <span className="text-ink-3">—</span>) },
    { key: 'actions', header: t('growth.campaigns.col.actions'), cell: sendBtn, className: 'text-right' },
  ];

  const card = (c: Campaign) => (
    <div className="space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate font-semibold text-ink">{c.name}</p>
          <p className="text-xs text-ink-3">
            {t(`growth.campaigns.kind.${c.kind}`)} · {dateCell(c)}
          </p>
        </div>
        {statusBadge(c)}
      </div>
      {c.status !== 'DRAFT' && (
        <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
          <dt className="text-ink-3">{t('growth.campaigns.col.recipients')}</dt>
          <dd className="text-right tabular-nums">{n(c.stats.recipients)}</dd>
          <dt className="text-ink-3">{t('growth.campaigns.col.sent')}</dt>
          <dd className="text-right tabular-nums">{n(c.stats.sent)}</dd>
          <dt className="text-ink-3">{t('growth.campaigns.col.failed')}</dt>
          <dd className="text-right tabular-nums">{n(c.stats.failed)}</dd>
          <dt className="text-ink-3">{t('growth.campaigns.col.booked')}</dt>
          <dd className="text-right">{c.status === 'SENT' ? bookedCell(c) : '—'}</dd>
        </dl>
      )}
      {sendBtn(c)}
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button icon={<HiPlus aria-hidden="true" />} onClick={() => setCreating(true)}>
          {t('growth.campaigns.new')}
        </Button>
      </div>
      <Card className="overflow-hidden">
        {q.isLoading ? (
          <SkeletonRows rows={4} className="p-5" />
        ) : q.isError ? (
          <ErrorState error={q.error} onRetry={() => void q.refetch()} />
        ) : !q.data?.length ? (
          <EmptyState
            icon={<HiOutlineMegaphone />}
            title={t('growth.campaigns.emptyTitle')}
            body={t('growth.campaigns.emptyBody')}
            action={
              <Button variant="secondary" icon={<HiPlus aria-hidden="true" />} onClick={() => setCreating(true)}>
                {t('growth.campaigns.new')}
              </Button>
            }
          />
        ) : (
          <DataTable rows={q.data} columns={columns} rowKey={(c) => c.id} mobileCard={card} caption={t('growth.campaigns.caption')} />
        )}
      </Card>

      <NewCampaignDialog open={creating} onClose={() => setCreating(false)} />
      <ConfirmDialog
        open={Boolean(sending)}
        onClose={() => setSending(null)}
        onConfirm={() => sending && send.mutate(sending.id)}
        loading={send.isPending}
        title={`${t('growth.campaigns.sendTitle')}: ${sending?.name ?? ''}`}
        body={audience.data ? t('growth.campaigns.sendBody', { n: fmtNumber(audience.data.recipients, lang) }) : t('growth.campaigns.sendCounting')}
        confirmLabel={t('growth.campaigns.sendConfirm')}
      >
        <div className="mt-4 flex items-start gap-2 rounded-xl border border-warning/30 bg-warning-soft px-3 py-2.5 text-sm text-ink">
          <HiOutlineExclamationTriangle className="mt-0.5 shrink-0 text-warning" aria-hidden="true" />
          <p>{t('growth.campaigns.sendWhatsappNote')}</p>
        </div>
      </ConfirmDialog>
    </div>
  );
}
