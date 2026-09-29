import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { HiOutlineQuestionMarkCircle } from 'react-icons/hi2';
import { Link } from 'react-router-dom';
import { RankBars, TrendChart } from '@/components/charts/Charts';
import { Badge, Card, CardHeader, PageHeader, Segmented, StatCard } from '@/components/ui/Display';
import { EmptyState, Skeleton, SkeletonRows } from '@/components/ui/Feedback';
import { usePreferences, useT } from '@/contexts/PreferencesContext';
import { api } from '@/lib/api';
import { fmtNumber, fmtRelative, fmtWeekdayShort } from '@/lib/format';

interface Overview {
  aiConversations: { value: number; delta: number };
  appointmentsBookedByAi: { value: number; delta: number };
  humanHandoffs: { value: number; delta: number };
  aiResolutionRate: { value: number; delta: number };
  bookingConversion: { value: number };
}
interface Insights {
  topQuestions: { intent: string; count: number }[];
  unansweredQuestions: { id: string; conversationId: string; question: string; createdAt: string }[];
  toolUsage: { tool: string; calls: number; errors: number; avgLatencyMs: number }[];
  aiErrors: { toolErrors: number; toolCalls: number; errorRate: number };
  appointments: { booked: number; cancelled: number; rescheduled: number; completed: number; noShow: number };
  channels: { channel: string; count: number }[];
  specialtyDemand: { specialty: string; count: number }[];
}
interface Usage {
  rows: { kind: string; provider: string | null; model: string | null; calls: number; tokensIn: number; tokensOut: number; costUsd: number; avgLatencyMs: number }[];
}

export default function AnalyticsPage() {
  const t = useT();
  const { prefs } = usePreferences();
  const [days, setDays] = useState('30');
  const overview = useQuery({ queryKey: ['analytics', 'overview', days], queryFn: () => api.get<Overview>('/analytics/overview', { days }) });
  const series = useQuery({ queryKey: ['analytics', 'timeseries', days], queryFn: () => api.get<Record<string, number | string>[]>('/analytics/timeseries', { days }) });
  const insights = useQuery({ queryKey: ['analytics', 'insights', days], queryFn: () => api.get<Insights>('/analytics/insights', { days }) });
  const usage = useQuery({ queryKey: ['ai', 'usage', days], queryFn: () => api.get<Usage>('/ai/usage', { days }) });
  const o = overview.data;
  const i = insights.data;
  const xFmt = (d: string) => fmtWeekdayShort(`${d}T12:00:00`, prefs.lang);

  return (
    <div className="space-y-5">
      <PageHeader
        title={t('analytics.title')}
        subtitle={t('analytics.subtitle')}
        actions={
          <Segmented
            label={t('common.filters')}
            value={days}
            onChange={setDays}
            options={[
              { value: '7', label: '7d' },
              { value: '30', label: '30d' },
              { value: '90', label: '90d' },
            ]}
          />
        }
      />
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-5" aria-label="KPIs">
        {!o || !i ? (
          Array.from({ length: 5 }).map((_, k) => <Skeleton key={k} className="h-28 rounded-2xl" />)
        ) : (
          <>
            <StatCard label={t('analytics.totalConversations')} value={fmtNumber(o.aiConversations.value, prefs.lang)} delta={o.aiConversations.delta} />
            <StatCard label={t('analytics.resolved')} value={`${o.aiResolutionRate.value}%`} delta={o.aiResolutionRate.delta} tone="success" />
            <StatCard label={t('analytics.handoffs')} value={fmtNumber(o.humanHandoffs.value, prefs.lang)} delta={o.humanHandoffs.delta} invertDelta tone="warning" />
            <StatCard label={t('analytics.conversion')} value={`${o.bookingConversion.value}%`} tone="accent" />
            <StatCard label={t('analytics.errorRate')} value={`${i.aiErrors.errorRate}%`} hint={`${i.aiErrors.toolErrors}/${i.aiErrors.toolCalls}`} tone="danger" />
          </>
        )}
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title={t('dashboard.resolutionTrend')} />
          <div className="px-3 pb-4 sm:px-5">
            {series.isLoading ? <Skeleton className="h-56" /> : <TrendChart title={t('dashboard.resolutionTrend')} type="line" data={series.data ?? []} xKey="date" xFormat={xFmt} format={(v) => `${v}%`} domainMax={100} series={[{ key: 'resolutionRate', label: t('analytics.resolved') }]} height={220} />}
          </div>
        </Card>
        <Card>
          <CardHeader title={t('analytics.handoffs')} />
          <div className="px-3 pb-4 sm:px-5">
            {series.isLoading ? (
              <Skeleton className="h-56" />
            ) : (
              <TrendChart
                title={t('analytics.handoffs')}
                type="bar"
                data={series.data ?? []}
                xKey="date"
                xFormat={xFmt}
                height={220}
                series={[
                  { key: 'handoffs', label: t('analytics.handoffs') },
                  { key: 'cancellations', label: t('analytics.cancelled') },
                ]}
              />
            )}
          </div>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader title={t('analytics.topQuestions')} />
          <div className="px-5 pb-5">{!i ? <SkeletonRows rows={4} /> : <RankBars items={i.topQuestions.map((q) => ({ label: t(`intents.${q.intent}` as never), value: q.count }))} />}</div>
        </Card>
        <Card>
          <CardHeader title={t('analytics.specialtyDemand')} />
          <div className="px-5 pb-5">{!i ? <SkeletonRows rows={3} /> : <RankBars items={i.specialtyDemand.map((s) => ({ label: s.specialty, value: s.count }))} />}</div>
        </Card>
        <Card>
          <CardHeader title={t('analytics.booked')} />
          {i && (
            <dl className="grid grid-cols-2 gap-4 px-5 pb-5">
              {(
                [
                  ['analytics.booked', i.appointments.booked],
                  ['status.COMPLETED', i.appointments.completed],
                  ['analytics.cancelled', i.appointments.cancelled],
                  ['analytics.rescheduled', i.appointments.rescheduled],
                  ['status.NO_SHOW', i.appointments.noShow],
                ] as const
              ).map(([k, v]) => (
                <div key={k}>
                  <dt className="text-xs text-ink-3">{t(k)}</dt>
                  <dd className="font-display text-2xl font-bold">{fmtNumber(v, prefs.lang)}</dd>
                </div>
              ))}
              <div>
                <dt className="text-xs text-ink-3">{t('analytics.channels')}</dt>
                <dd className="mt-1 flex flex-wrap gap-1">
                  {i.channels.map((c) => (
                    <Badge key={c.channel}>
                      {t(`channel.${c.channel}` as never)} {c.count}
                    </Badge>
                  ))}
                </dd>
              </div>
            </dl>
          )}
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title={t('analytics.unanswered')} subtitle={t('analytics.unansweredHint')} icon={<HiOutlineQuestionMarkCircle />} />
          {!i ? (
            <SkeletonRows rows={3} className="p-5" />
          ) : !i.unansweredQuestions.length ? (
            <EmptyState title={t('analytics.noData')} className="py-8" />
          ) : (
            <ul className="divide-y divide-border px-2 pb-2">
              {i.unansweredQuestions.map((u) => (
                <li key={u.id}>
                  <Link to={`/conversations/${u.conversationId}`} className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm hover:bg-surface-2" data-no-underline>
                    <span className="min-w-0 flex-1">“{u.question}”</span>
                    <span className="shrink-0 text-xs text-ink-3">{fmtRelative(u.createdAt, prefs.lang)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card>
          <CardHeader title={t('analytics.toolUsage')} />
          <div className="scrollbar-thin overflow-x-auto px-5 pb-5">
            <table className="w-full text-left text-sm">
              <caption className="sr-only">{t('analytics.toolUsage')}</caption>
              <thead className="text-xs text-ink-3">
                <tr>
                  <th scope="col" className="py-2 font-medium">
                    Tool
                  </th>
                  <th scope="col" className="py-2 text-right font-medium">
                    {t('analytics.calls')}
                  </th>
                  <th scope="col" className="py-2 text-right font-medium">
                    Err
                  </th>
                  <th scope="col" className="py-2 text-right font-medium">
                    {t('analytics.avgLatency')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {i?.toolUsage.map((r) => (
                  <tr key={r.tool} className="border-t border-border">
                    <td className="py-2 font-mono text-xs">{r.tool}</td>
                    <td className="py-2 text-right tabular-nums">{r.calls}</td>
                    <td className="py-2 text-right tabular-nums">{r.errors}</td>
                    <td className="py-2 text-right tabular-nums">{r.avgLatencyMs} ms</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>

      <Card>
        <CardHeader title={t('analytics.usage')} />
        <div className="scrollbar-thin overflow-x-auto px-5 pb-5">
          <table className="w-full min-w-[560px] text-left text-sm">
            <caption className="sr-only">{t('analytics.usage')}</caption>
            <thead className="text-xs text-ink-3">
              <tr>
                <th scope="col" className="py-2 font-medium">
                  {t('settings.provider')}
                </th>
                <th scope="col" className="py-2 font-medium">
                  {t('settings.model')}
                </th>
                <th scope="col" className="py-2 text-right font-medium">
                  {t('analytics.calls')}
                </th>
                <th scope="col" className="py-2 text-right font-medium">
                  {t('analytics.tokensIn')}
                </th>
                <th scope="col" className="py-2 text-right font-medium">
                  {t('analytics.tokensOut')}
                </th>
                <th scope="col" className="py-2 text-right font-medium">
                  {t('analytics.estCost')}
                </th>
              </tr>
            </thead>
            <tbody>
              {usage.data?.rows
                .filter((r) => r.kind === 'AI_COMPLETION')
                .map((r) => (
                  <tr key={`${r.provider}-${r.model}`} className="border-t border-border">
                    <td className="py-2">{r.provider}</td>
                    <td className="py-2 font-mono text-xs">{r.model}</td>
                    <td className="py-2 text-right tabular-nums">{fmtNumber(r.calls, prefs.lang)}</td>
                    <td className="py-2 text-right tabular-nums">{fmtNumber(r.tokensIn, prefs.lang)}</td>
                    <td className="py-2 text-right tabular-nums">{fmtNumber(r.tokensOut, prefs.lang)}</td>
                    <td className="py-2 text-right tabular-nums">${r.costUsd.toFixed(4)}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
