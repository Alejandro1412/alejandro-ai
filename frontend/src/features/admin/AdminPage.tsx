import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { HiMagnifyingGlass, HiOutlineBuildingOffice2 } from 'react-icons/hi2';
import { Card, CardHeader, PageHeader, StatCard } from '@/components/ui/Display';
import { DataTable } from '@/components/ui/DataTable';
import { EmptyState, ErrorState, Skeleton, SkeletonRows } from '@/components/ui/Feedback';
import { Input } from '@/components/ui/Field';
import { usePreferences, useT } from '@/contexts/PreferencesContext';
import { api } from '@/lib/api';
import { fmtDate, fmtMoney, fmtNumber, fmtRelative } from '@/lib/format';
import { fmtUsd } from './format';
import { SubscriptionBadge } from './SubscriptionBadge';
import { TenantDrawer } from './TenantDrawer';
import { TenantMixChart } from './TenantMixChart';
import { SUB_STATUSES, type AdminOverview, type AdminTenant } from './types';

export default function AdminPage() {
  const t = useT();
  const { prefs } = usePreferences();
  const lang = prefs.lang;
  const [input, setInput] = useState('');
  const [search, setSearch] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  useEffect(() => {
    const id = setTimeout(() => setSearch(input.trim()), 300);
    return () => clearTimeout(id);
  }, [input]);

  const overview = useQuery({ queryKey: ['admin', 'overview'], queryFn: () => api.get<AdminOverview>('/admin/overview') });
  const tenants = useQuery({ queryKey: ['admin', 'tenants', search], queryFn: () => api.get<AdminTenant[]>('/admin/tenants', { search }), placeholderData: keepPreviousData });
  const o = overview.data;

  const periodCell = (r: AdminTenant) => {
    const s = r.subscription;
    if (!s) return <span className="text-ink-3">—</span>;
    if (s.status === 'PAST_DUE' && s.graceEndsAt) return <span className="text-warning">{t('admin.console.graceEnds', { date: fmtDate(s.graceEndsAt, lang) })}</span>;
    if (s.status === 'TRIALING' && s.trialEndsAt) return t('admin.console.trialEnds', { date: fmtDate(s.trialEndsAt, lang) });
    return s.currentPeriodEnd ? t('admin.console.periodEnds', { date: fmtDate(s.currentPeriodEnd, lang) }) : '—';
  };

  return (
    <div className="space-y-5">
      <PageHeader title={t('admin.title')} subtitle={t('admin.console.subtitle')} />

      <section className="stagger grid grid-cols-2 gap-3 lg:grid-cols-3 2xl:grid-cols-6" aria-label="KPIs">
        {!o ? (
          Array.from({ length: 6 }).map((_, k) => <Skeleton key={k} className="h-28 rounded-2xl" />)
        ) : (
          <>
            <StatCard label={t('admin.console.kpiMrr')} value={fmtMoney(o.mrrCents, 'USD', lang)} hint={t('admin.console.kpiMrrHint')} />
            <StatCard label={t('admin.console.kpiArr')} value={fmtMoney(o.arrCents, 'USD', lang)} hint={t('admin.console.kpiArrHint')} tone="accent" />
            <StatCard label={t('admin.console.kpiTenants')} value={fmtNumber(o.tenants, lang)} hint={t('admin.console.kpiTenantsHint', { active: o.byStatus.ACTIVE ?? 0, trialing: o.byStatus.TRIALING ?? 0 })} tone="info" />
            <StatCard label={t('admin.console.kpiSignups')} value={fmtNumber(o.signupsLast30Days, lang)} tone="success" />
            <StatCard label={t('admin.console.kpiAiCost')} value={fmtUsd(o.thisMonth.aiCostUsd, lang)} hint={`${fmtNumber(o.thisMonth.aiConversations, lang)} · ${t('admin.console.kpiAiConversations')}`} tone="primary" />
            <StatCard label={t('admin.console.kpiOpenInvoices')} value={fmtMoney(o.openInvoicesCents, 'USD', lang)} hint={t('admin.console.kpiOutbound', { count: fmtNumber(o.thisMonth.outboundMessages, lang) })} tone="warning" />
          </>
        )}
      </section>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
        <Card aria-labelledby="adm-mix">
          <CardHeader id="adm-mix" title={t('admin.console.chartTitle')} />
          <div className="px-4 pb-5 sm:px-5">{o ? <TenantMixChart overview={o} /> : <Skeleton className="h-56" />}</div>
        </Card>
        <Card aria-labelledby="adm-status">
          <CardHeader id="adm-status" title={t('admin.console.statusMix')} />
          <ul className="grid grid-cols-1 gap-2 px-5 pb-5 sm:grid-cols-2">
            {SUB_STATUSES.map((s) => (
              <li key={s} className="flex items-center justify-between gap-2 rounded-xl border border-border px-3 py-2.5">
                <SubscriptionBadge status={s} />
                <span className="font-display text-lg font-bold tabular-nums">{o ? fmtNumber(o.byStatus[s] ?? 0, lang) : '—'}</span>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <Card aria-labelledby="adm-tenants">
        <CardHeader id="adm-tenants" title={t('admin.console.tenants')} subtitle={tenants.data ? t('admin.console.resultsCount', { count: tenants.data.length }) : undefined} />
        <div className="border-b border-border px-3 pb-3">
          <div className="relative max-w-md">
            <HiMagnifyingGlass className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-3" aria-hidden="true" />
            <Input type="search" aria-label={t('common.search')} placeholder={t('admin.console.searchPlaceholder')} className="pl-9" value={input} onChange={(e) => setInput(e.target.value)} maxLength={100} />
          </div>
        </div>
        {tenants.isLoading ? (
          <SkeletonRows rows={6} className="p-4" />
        ) : tenants.isError ? (
          <ErrorState error={tenants.error} onRetry={() => void tenants.refetch()} />
        ) : !tenants.data?.length ? (
          <EmptyState icon={<HiOutlineBuildingOffice2 />} title={t('admin.console.empty')} />
        ) : (
          <DataTable
            caption={t('admin.console.tenantsTable')}
            rows={tenants.data}
            rowKey={(r) => r.id}
            onRowClick={(r) => setOpenId(r.id)}
            columns={[
              {
                key: 'clinic',
                header: t('admin.console.colClinic'),
                cell: (r) => (
                  <div className="min-w-0">
                    <p className="truncate font-medium">{r.clinic?.name ?? r.name}</p>
                    <p className="truncate text-xs text-ink-3">
                      {r.clinic?.slug}
                      {r.clinic?.city ? ` · ${r.clinic.city}` : ''}
                    </p>
                  </div>
                ),
              },
              { key: 'plan', header: t('admin.console.colPlan'), cell: (r) => r.plan?.name ?? <span className="text-ink-3">{t('admin.console.noPlan')}</span> },
              { key: 'status', header: t('admin.console.colStatus'), cell: (r) => <SubscriptionBadge status={r.subscription?.status} /> },
              { key: 'period', header: t('admin.console.colPeriod'), hideBelow: 'lg', cell: periodCell },
              { key: 'users', header: t('admin.console.colUsers'), hideBelow: 'xl', className: 'text-right tabular-nums', cell: (r) => r.users },
              { key: 'doctors', header: t('admin.console.colDoctors'), hideBelow: 'xl', className: 'text-right tabular-nums', cell: (r) => r.doctors },
              { key: 'conv', header: t('admin.console.colConversations'), hideBelow: 'lg', className: 'text-right tabular-nums', cell: (r) => fmtNumber(r.conversationsThisMonth, lang) },
              { key: 'cost', header: t('admin.console.colAiCost'), className: 'text-right tabular-nums', cell: (r) => fmtUsd(r.aiCostUsd, lang) },
              { key: 'last', header: t('admin.console.colLastActivity'), hideBelow: 'xl', cell: (r) => <span className="text-ink-3">{r.lastActivity ? fmtRelative(r.lastActivity, lang) : t('admin.console.never')}</span> },
            ]}
            mobileCard={(r) => (
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold">{r.clinic?.name ?? r.name}</p>
                  <p className="truncate text-xs text-ink-3">
                    {r.plan?.name ?? t('admin.console.noPlan')} · {r.clinic?.slug}
                  </p>
                  <p className="mt-1 text-xs text-ink-2">
                    {fmtNumber(r.conversationsThisMonth, lang)} {t('admin.console.colConversations').toLowerCase()} · {fmtUsd(r.aiCostUsd, lang)}
                  </p>
                </div>
                <SubscriptionBadge status={r.subscription?.status} />
              </div>
            )}
          />
        )}
      </Card>
      <TenantDrawer tenantId={openId} onClose={() => setOpenId(null)} />
    </div>
  );
}
