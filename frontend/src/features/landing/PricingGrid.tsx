import { useQuery } from '@tanstack/react-query';
import { HiCheck } from 'react-icons/hi2';
import { Button } from '@/components/ui/Button';
import { Segmented } from '@/components/ui/Display';
import { Skeleton } from '@/components/ui/Feedback';
import { usePreferences, useT } from '@/contexts/PreferencesContext';
import { api } from '@/lib/api';
import { cn, fmtMoney } from '@/lib/format';
import type { Plan } from '@/types';

export function PricingGrid({
  interval,
  onInterval,
  currentKey,
  onChoose,
  loadingKey,
  compact,
}: {
  interval: 'MONTHLY' | 'YEARLY';
  onInterval: (v: 'MONTHLY' | 'YEARLY') => void;
  currentKey?: string;
  onChoose: (key: string) => void;
  loadingKey?: string;
  compact?: boolean;
}) {
  const t = useT();
  const { prefs } = usePreferences();
  const plans = useQuery({ queryKey: ['plans'], queryFn: () => api.get<Plan[]>('/billing/plans') });
  const limit = (v: number | null, label: string) => `${v === null ? t('billing.unlimited') : v.toLocaleString()} ${label}`;

  // Catalog descriptions come from the API in English; show the localized copy when we have it.
  const planDescription = (key: string, fallback: string | null) => {
    const k = `billing.planDescriptions.${key}`;
    const v = t(k as never);
    return v === k ? fallback : v;
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-center">
        <Segmented
          label={t('billing.changePlan')}
          value={interval}
          onChange={onInterval}
          options={[
            { value: 'MONTHLY', label: t('billing.monthly') },
            { value: 'YEARLY', label: `${t('billing.yearly')} · ${t('billing.yearlySave')}` },
          ]}
        />
      </div>
      <div className={cn('grid gap-4', compact ? 'lg:grid-cols-3' : 'md:grid-cols-3')}>
        {plans.isLoading
          ? Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-[440px] rounded-2xl" />)
          : plans.data?.map((p) => {
              const price = interval === 'YEARLY' ? p.priceYearlyCents / 12 : p.priceMonthlyCents;
              const current = p.key === currentKey;
              return (
                <article key={p.key} className={cn('spotlight relative flex flex-col rounded-2xl border bg-surface p-6 transition-transform duration-300 hover:-translate-y-1', p.isPopular ? 'border-primary shadow-pop ring-1 ring-primary/30' : 'border-border shadow-card')} aria-labelledby={`plan-${p.key}`}>
                  {p.isPopular && <span className="absolute -top-3 left-6 rounded-full bg-primary px-3 py-1 text-xs font-semibold text-primary-fg">{t('billing.mostPopular')}</span>}
                  <h3 id={`plan-${p.key}`} className="text-lg font-bold">
                    {p.name}
                  </h3>
                  <p className="mt-1 min-h-[40px] text-sm text-ink-2">{planDescription(p.key, p.description)}</p>
                  <p className="mt-5 flex items-baseline gap-1">
                    <span className="font-display text-4xl font-bold tracking-tight">{fmtMoney(Math.round(price), p.currency, prefs.lang)}</span>
                    <span className="text-sm text-ink-3">{t('common.perMonth')}</span>
                  </p>
                  {interval === 'YEARLY' && (
                    <p className="text-xs text-ink-3">
                      {fmtMoney(p.priceYearlyCents, p.currency, prefs.lang)} {t('common.perYear')}
                    </p>
                  )}
                  <ul className="mt-5 space-y-2.5 text-sm">
                    <li className="flex gap-2">
                      <HiCheck className="mt-0.5 shrink-0 text-accent" aria-hidden="true" /> {limit(p.limits.doctors, t('billing.doctors').toLowerCase())}
                    </li>
                    <li className="flex gap-2">
                      <HiCheck className="mt-0.5 shrink-0 text-accent" aria-hidden="true" /> {limit(p.limits.aiConversationsPerMonth, t('billing.aiConversations').toLowerCase())}
                    </li>
                    {p.features.map((f) => (
                      <li key={f} className="flex gap-2">
                        <HiCheck className="mt-0.5 shrink-0 text-accent" aria-hidden="true" /> {t(`billing.features.${f}` as never)}
                      </li>
                    ))}
                  </ul>
                  <div className="mt-auto pt-6">
                    <Button className="w-full" variant={p.isPopular ? 'primary' : 'secondary'} disabled={current} loading={loadingKey === p.key} onClick={() => onChoose(p.key)}>
                      {current ? t('billing.current') : t('billing.choose')}
                    </Button>
                  </div>
                </article>
              );
            })}
      </div>
      <p className="text-center text-xs text-ink-3">{t('billing.overage')}</p>
    </div>
  );
}
