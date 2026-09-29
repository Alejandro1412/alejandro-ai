import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
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
import { PricingGrid } from '../landing/PricingGrid';

interface Overview {
  subscription: { status: string; interval: 'MONTHLY' | 'YEARLY'; currentPeriodEnd: string; trialEndsAt: string | null; cancelAtPeriodEnd: boolean; hasPaymentMethod: boolean };
  plan: Plan;
  usage: { doctors: number; users: number; knowledgeSources: number; aiConversationsThisMonth: number };
  invoices: { id: string; number: string; amountCents: number; currency: string; status: string; issuedAt: string; hostedUrl: string | null }[];
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

  return (
    <>
      <Card>
        <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center">
          <div className="flex-1">
            <p className="text-sm text-ink-3">{t('billing.currentPlan')}</p>
            <div className="mt-1 flex items-center gap-2">
              <h2 className="text-2xl font-bold">{plan.name}</h2>
              <Badge tone={statusTone(s.status)}>{t(`status.${s.status}` as never)}</Badge>
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

      <Card>
        <CardHeader title={t('billing.changePlan')} />
        <div className="px-5 pb-6">
          <PricingGrid interval={interval} onInterval={setInterval} currentKey={plan.key} onChoose={(k) => checkout.mutate(k)} loadingKey={checkout.isPending ? checkout.variables : undefined} compact />
        </div>
      </Card>

      <Card>
        <CardHeader title={t('billing.invoices')} />
        <div className="scrollbar-thin overflow-x-auto px-5 pb-5">
          <table className="w-full min-w-[480px] text-left text-sm">
            <caption className="sr-only">{t('billing.invoices')}</caption>
            <thead className="text-xs text-ink-3">
              <tr>
                <th scope="col" className="py-2 font-medium">
                  {t('billing.invoice')}
                </th>
                <th scope="col" className="py-2 font-medium">
                  {t('common.date')}
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
