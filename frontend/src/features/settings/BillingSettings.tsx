import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { HiOutlineExclamationTriangle, HiOutlineLockClosed } from 'react-icons/hi2';
import { useSearchParams } from 'react-router-dom';
import { Meter } from '@/components/charts/Charts';
import { Button } from '@/components/ui/Button';
import { Badge, Card, CardHeader, statusTone } from '@/components/ui/Display';
import { Skeleton } from '@/components/ui/Feedback';
import { useToast } from '@/components/ui/Toast';
import { useAuth } from '@/contexts/AuthContext';
import { usePreferences, useT } from '@/contexts/PreferencesContext';
import { api, errorMessage } from '@/lib/api';
import { fmtDate, fmtMoney } from '@/lib/format';
import type { Plan } from '@/types';
import { fmtUsd } from '../admin/format';
import { SubscriptionBadge } from '../admin/SubscriptionBadge';
import type { AiBudget } from '../admin/types';
import { PricingGrid } from '../landing/PricingGrid';

interface Overview {
  subscription: {
    status: string;
    interval: 'MONTHLY' | 'YEARLY';
    currentPeriodEnd: string;
    trialEndsAt: string | null;
    cancelAtPeriodEnd: boolean;
    hasPaymentMethod: boolean;
    graceEndsAt?: string | null;
    suspendedReason?: string | null;
  };
  plan: Plan;
  usage: { doctors: number; users: number; knowledgeSources: number; aiConversationsThisMonth: number };
  invoices: { id: string; number: string; amountCents: number; currency: string; status: string; issuedAt: string; hostedUrl: string | null; description?: string | null }[];
  aiBudget?: AiBudget;
  provider: 'mock' | 'stripe';
}

export default function BillingSettings() {
  const t = useT();
  const { prefs } = usePreferences();
  const { reload } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const [interval, setInterval] = useState<'MONTHLY' | 'YEARLY'>('MONTHLY');
  const q = useQuery({ queryKey: ['billing'], queryFn: () => api.get<Overview>('/billing/overview') });
  useEffect(() => {
    if (params.get('checkout') === 'success') {
      toast.success(t('billing.planChanged'));
      setParams({}, { replace: true });
    }
  }, [params, setParams, toast, t]);
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['billing'] });
    void reload();
  };
  const checkout = useMutation({
    mutationFn: (planKey: string) => api.post<{ url: string; completed: boolean }>('/billing/checkout', { planKey, interval }),
    onSuccess: (r) => {
      if (r.completed) {
        toast.success(t('billing.planChanged'));
        refresh();
      } else window.location.href = r.url;
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const portal = useMutation({ mutationFn: () => api.post<{ url: string }>('/billing/portal'), onSuccess: (r) => (window.location.href = r.url) });
  const cancel = useMutation({ mutationFn: (v: boolean) => api.post('/billing/cancel', { cancel: v }), onSuccess: refresh });

  if (q.isLoading || !q.data) return <Skeleton className="h-96 rounded-2xl" />;
  const { subscription: s, plan, usage } = q.data;
  const limit = (v: number | null) => (v === null ? t('billing.unlimited') : String(v));
  const meters: [string, number, number | null][] = [
    [t('billing.doctors'), usage.doctors, plan.limits.doctors],
    [t('billing.users'), usage.users, plan.limits.users],
    [t('billing.aiConversations'), usage.aiConversationsThisMonth, plan.limits.aiConversationsPerMonth],
    [t('billing.knowledgeSources'), usage.knowledgeSources, plan.limits.knowledgeSources],
  ];

  const stateNotice =
    s.status === 'PAST_DUE'
      ? { tone: 'warning' as const, text: s.graceEndsAt ? t('admin.billing.pastDueGrace', { date: fmtDate(s.graceEndsAt, prefs.lang) }) : t('admin.billing.pastDue') }
      : s.status === 'SUSPENDED'
        ? { tone: 'danger' as const, text: t('admin.billing.suspended') }
        : s.status === 'EXPIRED'
          ? { tone: 'danger' as const, text: t('admin.billing.expired') }
          : s.status === 'CANCELED'
            ? { tone: 'danger' as const, text: t('admin.billing.canceled') }
            : null;
  const budget = q.data.aiBudget;

  return (
    <>
      {stateNotice && (
        <div role={stateNotice.tone === 'danger' ? 'alert' : 'status'} className={stateNotice.tone === 'danger' ? 'flex items-start gap-2.5 rounded-2xl border border-danger/40 bg-danger-soft px-4 py-3 text-sm text-ink' : 'flex items-start gap-2.5 rounded-2xl border border-warning/40 bg-warning-soft px-4 py-3 text-sm text-ink'}>
          {stateNotice.tone === 'danger' ? <HiOutlineLockClosed className="mt-0.5 shrink-0 text-lg text-danger" aria-hidden="true" /> : <HiOutlineExclamationTriangle className="mt-0.5 shrink-0 text-lg text-warning" aria-hidden="true" />}
          <p>
            {stateNotice.text}
            {s.status === 'SUSPENDED' && s.suspendedReason && <span className="mt-1 block text-ink-2">{t('admin.billing.suspendedReason', { reason: s.suspendedReason })}</span>}
          </p>
        </div>
      )}
      <Card>
        <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center">
          <div className="flex-1">
            <p className="text-sm text-ink-3">{t('billing.currentPlan')}</p>
            <div className="mt-1 flex items-center gap-2">
              <h2 className="text-2xl font-bold">{plan.name}</h2>
              <SubscriptionBadge status={s.status} />
            </div>
            <p className="mt-1 text-sm text-ink-2">
              {fmtMoney(s.interval === 'YEARLY' ? plan.priceYearlyCents : plan.priceMonthlyCents, plan.currency, prefs.lang)}
              {s.interval === 'YEARLY' ? t('common.perYear') : t('common.perMonth')} ·{' '}
              {s.trialEndsAt ? t('billing.trialEnds', { date: fmtDate(s.trialEndsAt, prefs.lang) }) : s.cancelAtPeriodEnd ? t('billing.cancelsOn', { date: fmtDate(s.currentPeriodEnd, prefs.lang) }) : t('billing.renews', { date: fmtDate(s.currentPeriodEnd, prefs.lang) })}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {q.data.provider === 'stripe' && (
              <Button variant="secondary" loading={portal.isPending} onClick={() => portal.mutate()}>
                {t('billing.manage')}
              </Button>
            )}
            <Button variant="ghost" onClick={() => cancel.mutate(!s.cancelAtPeriodEnd)}>
              {s.cancelAtPeriodEnd ? t('billing.resumePlan') : t('billing.cancelPlan')}
            </Button>
          </div>
        </div>
        {q.data.provider === 'mock' && <p className="border-t border-border bg-info-soft px-5 py-2 text-xs text-info">{t('billing.mockNotice')}</p>}
      </Card>

      <Card>
        <CardHeader title={t('billing.usage')} subtitle={t('billing.overage')} />
        <div className="grid gap-5 px-5 pb-5 sm:grid-cols-2">
          {meters.map(([label, used, max]) => (
            <div key={label}>
              <div className="mb-2 flex justify-between text-sm">
                <span>{label}</span>
                <span className="tabular-nums text-ink-2">
                  {used} / {limit(max)}
                </span>
              </div>
              <Meter value={max ? (used / max) * 100 : 8} label={label} />
            </div>
          ))}
        </div>
      </Card>

      {budget && (
        <Card aria-labelledby="ai-budget">
          <CardHeader id="ai-budget" title={t('admin.billing.aiBudget')} subtitle={t('admin.billing.aiBudgetBody')} />
          <div className="space-y-2 px-5 pb-5">
            <div className="flex justify-between gap-3 text-sm">
              <span className="tabular-nums">{budget.capUsd === null ? t('admin.billing.spentNoCap', { spent: fmtUsd(budget.spentUsd, prefs.lang) }) : t('admin.billing.spent', { spent: fmtUsd(budget.spentUsd, prefs.lang), cap: fmtUsd(budget.capUsd, prefs.lang) })}</span>
              {budget.capUsd === null ? <Badge>{t('admin.billing.noLimit')}</Badge> : <span className="tabular-nums text-ink-2">{budget.capUsd > 0 ? Math.round((budget.spentUsd / budget.capUsd) * 100) : 100}%</span>}
            </div>
            {budget.capUsd !== null && <Meter value={budget.capUsd > 0 ? (budget.spentUsd / budget.capUsd) * 100 : 100} label={t('admin.billing.aiBudget')} />}
            {budget.exceeded && (
              <p role="status" className="flex items-start gap-2 rounded-xl bg-warning-soft px-3 py-2 text-sm text-ink">
                <HiOutlineExclamationTriangle className="mt-0.5 shrink-0 text-warning" aria-hidden="true" />
                {t('admin.billing.exceeded')}
              </p>
            )}
          </div>
        </Card>
      )}

      <Card>
        <CardHeader title={t('billing.changePlan')} />
        <div className="px-5 pb-6">
          <PricingGrid interval={interval} onInterval={setInterval} currentKey={plan.key} onChoose={(k) => checkout.mutate(k)} loadingKey={checkout.isPending ? checkout.variables : undefined} compact />
        </div>
      </Card>

      <Card>
        <CardHeader title={t('billing.invoices')} />
        <div className="scrollbar-thin overflow-x-auto px-5 pb-5">
          <table className="w-full min-w-[560px] text-left text-sm">
            <caption className="sr-only">{t('billing.invoices')}</caption>
            <thead className="text-xs text-ink-3">
              <tr>
                <th scope="col" className="py-2 font-medium">
                  {t('billing.invoice')}
                </th>
                <th scope="col" className="py-2 font-medium">
                  {t('common.date')}
                </th>
                <th scope="col" className="py-2 font-medium">
                  {t('admin.billing.description')}
                </th>
                <th scope="col" className="py-2 text-right font-medium">
                  {t('billing.amount')}
                </th>
                <th scope="col" className="py-2 text-right font-medium">
                  {t('common.status')}
                </th>
              </tr>
            </thead>
            <tbody>
              {q.data.invoices.map((i) => (
                <tr key={i.id} className="border-t border-border">
                  <td className="py-2 font-mono text-xs">{i.hostedUrl ? <a href={i.hostedUrl}>{i.number}</a> : i.number}</td>
                  <td className="py-2">{fmtDate(i.issuedAt, prefs.lang)}</td>
                  <td className="py-2 pr-3 text-ink-2">{i.description ?? '—'}</td>
                  <td className="py-2 text-right tabular-nums">{fmtMoney(i.amountCents, i.currency, prefs.lang)}</td>
                  <td className="py-2 text-right">
                    <Badge tone={statusTone(i.status)}>{t(`status.${i.status}` as never)}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}
