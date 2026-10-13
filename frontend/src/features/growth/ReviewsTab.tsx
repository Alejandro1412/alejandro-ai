import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { HiOutlineChartBar, HiOutlineInformationCircle, HiOutlinePaperAirplane, HiOutlineStar, HiOutlineTableCells, HiStar } from 'react-icons/hi2';
import { Bar, BarChart, CartesianGrid, Cell, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { ButtonLink } from '@/components/ui/Button';
import { Card, CardHeader, StatCard } from '@/components/ui/Display';
import { EmptyState, ErrorState, Skeleton, SkeletonRows } from '@/components/ui/Feedback';
import { useAuth } from '@/contexts/AuthContext';
import { usePreferences, useT } from '@/contexts/PreferencesContext';
import { api } from '@/lib/api';
import { cn, fmtDate, fmtNumber } from '@/lib/format';
import { responseRate, type ReviewStats } from './growth';

/** Single-hue sequential ramp (1 → 5 stars, light → full) mixed with the surface so it adapts to dark mode. */
const RAMP = [38, 54, 70, 85, 100].map((p) => `color-mix(in srgb, var(--chart-1) ${p}%, rgb(var(--surface)))`);

export function Stars({ value, size = 'md' }: { value: number; size?: 'sm' | 'md' }) {
  const t = useT();
  const full = Math.round(value);
  return (
    <span className="inline-flex items-center gap-0.5" role="img" aria-label={t('growth.reviews.ratingAria', { n: value })}>
      {[1, 2, 3, 4, 5].map((i) => (
        <HiStar key={i} aria-hidden="true" className={cn(size === 'sm' ? 'h-3.5 w-3.5' : 'h-5 w-5', i <= full ? 'text-warning' : 'text-border-strong')} />
      ))}
    </span>
  );
}

interface TipProps {
  active?: boolean;
  payload?: { value?: number | string; payload?: { label: string } }[];
  countLabel: string;
}
function Tip({ active, payload, countLabel }: TipProps) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl border border-border bg-surface px-3 py-2 text-xs shadow-pop">
      <p className="font-semibold text-ink">{payload[0].payload?.label}</p>
      <p className="text-ink-2">
        {countLabel}: <span className="font-semibold text-ink">{payload[0].value}</span>
      </p>
    </div>
  );
}

export function RatingDistribution({ data }: { data: ReviewStats['distribution'] }) {
  const t = useT();
  const { prefs } = usePreferences();
  const [table, setTable] = useState(false);
  const title = t('growth.reviews.distribution');
  const rows = [1, 2, 3, 4, 5].map((n) => ({ rating: n, label: t(n === 1 ? 'growth.reviews.star' : 'growth.reviews.stars', { n }), count: data.find((d) => d.rating === n)?.count ?? 0 }));
  const axis = { stroke: 'var(--chart-axis)', fontSize: 11, tickLine: false, axisLine: false } as const;
  return (
    <figure className="space-y-3">
      <div className="flex justify-end">
        <button type="button" onClick={() => setTable((v) => !v)} className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-ink-3 hover:bg-surface-2 hover:text-ink" aria-pressed={table}>
          {table ? <HiOutlineChartBar aria-hidden="true" /> : <HiOutlineTableCells aria-hidden="true" />}
          {table ? t('analytics.chartView') : t('analytics.tableView')}
        </button>
      </div>
      {table ? (
        <div className="overflow-hidden rounded-xl border border-border">
          <table className="w-full text-left text-xs">
            <caption className="sr-only">{title}</caption>
            <thead className="bg-surface-2">
              <tr>
                <th scope="col" className="px-3 py-2 font-medium text-ink-3">
                  {t('growth.reviews.rating')}
                </th>
                <th scope="col" className="px-3 py-2 text-right font-medium text-ink-3">
                  {t('growth.reviews.count')}
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.rating} className="border-t border-border">
                  <th scope="row" className="px-3 py-1.5 font-normal">
                    {r.label}
                  </th>
                  <td className="px-3 py-1.5 text-right tabular-nums">{fmtNumber(r.count, prefs.lang)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="h-56" role="img" aria-label={`${title}: ${rows.map((r) => `${r.label} ${r.count}`).join(', ')}`}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={rows} margin={{ top: 20, right: 8, left: -12, bottom: 0 }} barCategoryGap="30%">
              <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
              <XAxis dataKey="rating" {...axis} tickFormatter={(v: number) => `${v}★`} />
              <YAxis {...axis} allowDecimals={false} width={40} />
              <Tooltip cursor={{ fill: 'rgb(var(--surface-3) / 0.5)' }} content={<Tip countLabel={t('growth.reviews.count')} />} />
              <Bar dataKey="count" radius={[4, 4, 0, 0]} maxBarSize={44} isAnimationActive={!prefs.reduceMotion}>
                {rows.map((r, i) => (
                  <Cell key={r.rating} fill={RAMP[i]} />
                ))}
                <LabelList dataKey="count" position="top" style={{ fill: 'rgb(var(--ink-2))', fontSize: 11, fontWeight: 600 }} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </figure>
  );
}

export function ReviewsTab() {
  const t = useT();
  const { prefs } = usePreferences();
  const { me, can } = useAuth();
  const q = useQuery({ queryKey: ['reviews'], queryFn: () => api.get<ReviewStats>('/reviews') });
  const r = q.data;
  const lang = prefs.lang;
  const rate = r ? responseRate(r) : null;

  if (q.isError) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;

  return (
    <div className="space-y-5">
      <section aria-label="KPIs" className="stagger grid grid-cols-1 gap-3 min-[420px]:grid-cols-2 lg:grid-cols-4">
        {!r ? (
          Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-[132px] rounded-2xl" />)
        ) : (
          <>
            <StatCard
              label={t('growth.reviews.average')}
              icon={<HiOutlineStar />}
              tone="warning"
              value={r.average === null ? '—' : new Intl.NumberFormat(lang === 'en' ? 'en-US' : 'es-CO', { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(r.average)}
              hint={r.average === null ? t('growth.reviews.noRating') : undefined}
            />
            <StatCard label={t('growth.reviews.sent')} icon={<HiOutlinePaperAirplane />} value={fmtNumber(r.sent, lang)} hint={t('growth.reviews.period')} />
            <StatCard label={t('growth.reviews.responseRate')} icon={<HiOutlineChartBar />} tone="accent" value={rate === null ? '—' : `${rate}%`} hint={t('growth.reviews.responded', { n: fmtNumber(r.responded, lang) })} />
            <StatCard label={t('growth.reviews.toGoogle')} icon={<HiStar />} tone="success" value={fmtNumber(r.redirectedToGoogle, lang)} hint={t('growth.reviews.toGoogleHint')} />
          </>
        )}
      </section>
      {r?.average != null && (
        <p className="-mt-2 flex items-center gap-2 text-sm text-ink-2">
          <Stars value={r.average} /> {r.average} {t('growth.reviews.ofFive')}
        </p>
      )}

      <div className="flex items-start gap-3 rounded-2xl border border-info/25 bg-info-soft px-4 py-3 text-sm" role="note">
        <HiOutlineInformationCircle className="mt-0.5 shrink-0 text-lg text-info" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="text-ink-2">{t('growth.reviews.note')}</p>
        </div>
        {can('settings.manage') && (
          <ButtonLink to="/settings/clinic" variant="ghost" size="sm" className="shrink-0">
            {t('growth.reviews.goSettings')}
          </ButtonLink>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-5">
        <Card className="lg:col-span-2" aria-labelledby="rv-dist">
          <CardHeader id="rv-dist" title={t('growth.reviews.distribution')} subtitle={t('growth.reviews.period')} />
          <div className="px-3 pb-4 sm:px-5">{!r ? <Skeleton className="h-56" /> : <RatingDistribution data={r.distribution} />}</div>
        </Card>
        <Card className="lg:col-span-3" aria-labelledby="rv-recent">
          <CardHeader id="rv-recent" title={t('growth.reviews.recent')} />
          {!r ? (
            <SkeletonRows rows={4} className="px-5 pb-5" />
          ) : !r.recent.length ? (
            <EmptyState icon={<HiOutlineStar />} title={t('growth.reviews.emptyTitle')} body={t('growth.reviews.emptyBody')} />
          ) : (
            <ul className="scrollbar-thin max-h-[420px] divide-y divide-border overflow-y-auto px-5 pb-3">
              {r.recent.map((rv) => (
                <li key={rv.id} className="py-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <Stars value={rv.rating} size="sm" />
                    {rv.at && <span className="text-xs text-ink-3">{fmtDate(rv.at, lang, me?.clinic.timezone)}</span>}
                  </div>
                  <p className={cn('mt-1.5 text-sm', rv.comment ? 'text-ink' : 'italic text-ink-3')}>{rv.comment ? `“${rv.comment}”` : t('growth.reviews.noComment')}</p>
                  <p className="mt-1 text-xs text-ink-3">
                    {rv.patient ?? t('growth.reviews.anonymous')}
                    {rv.doctor ? ` · ${rv.doctor}` : ''}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
