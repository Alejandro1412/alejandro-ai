import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import {
  HiOutlineCalendarDays,
  HiOutlineChatBubbleLeftRight,
  HiOutlineCheckBadge,
  HiOutlineClock,
  HiOutlineSparkles,
  HiOutlineUserGroup,
  HiArrowRight,
} from 'react-icons/hi2';
import { Link, useNavigate } from 'react-router-dom';
import { AgentAvatar } from '@/components/brand/Logo';
import { Meter, RankBars, TrendChart } from '@/components/charts/Charts';
import { ButtonLink } from '@/components/ui/Button';
import { AnimatedNumber } from '@/components/ui/AnimatedNumber';
import { Avatar, Badge, Card, CardHeader, PageHeader, Segmented, StatCard, statusTone } from '@/components/ui/Display';
import { EmptyState, ErrorState, Skeleton, SkeletonRows } from '@/components/ui/Feedback';
import { useAuth } from '@/contexts/AuthContext';
import { usePreferences, useT } from '@/contexts/PreferencesContext';
import { api } from '@/lib/api';
import { doctorName, fmtNumber, fmtRelative, fmtTime, fmtWeekdayShort, fullName } from '@/lib/format';
import type { Appointment, Handoff } from '@/types';
import type { ValueReport } from '@/features/reports/valueReport';
import { AiBriefing } from './AiBriefing';

interface Overview {
  todayAppointments: { value: number; completed: number };
  upcomingAppointments: { value: number };
  aiConversations: { value: number; delta: number };
  appointmentsBookedByAi: { value: number; delta: number };
  humanHandoffs: { value: number; open: number; delta: number };
  aiResolutionRate: { value: number; delta: number };
  bookingConversion: { value: number };
  satisfaction?: { positive: number; negative: number; rate: number | null };
}
interface Point {
  date: string;
  conversations: number;
  resolvedByAi: number;
  resolutionRate: number;
  appointmentsAi: number;
  appointmentsOther: number;
  handoffs: number;
}
interface Insights {
  topQuestions: { intent: string; count: number }[];
  unansweredQuestions?: { question: string }[];
}

export default function DashboardPage() {
  const t = useT();
  const { prefs } = usePreferences();
  const { me, can } = useAuth();
  const nav = useNavigate();
  const [days, setDays] = useState('30');
  const analytics = can('analytics.read');
  const tz = me?.clinic.timezone;

  const overview = useQuery({ queryKey: ['analytics', 'overview', days], queryFn: () => api.get<Overview>('/analytics/overview', { days }), enabled: analytics });
  const series = useQuery({ queryKey: ['analytics', 'timeseries', days], queryFn: () => api.get<Point[]>('/analytics/timeseries', { days }), enabled: analytics });
  const insights = useQuery({ queryKey: ['analytics', 'insights', days], queryFn: () => api.get<Insights>('/analytics/insights', { days }), enabled: analytics });
  const today = useMemo(() => {
    const s = new Date();
    s.setHours(0, 0, 0, 0);
    return { from: s.toISOString(), to: new Date(s.getTime() + 86_400_000).toISOString() };
  }, []);
  const schedule = useQuery({
    queryKey: ['appointments', 'today', today.from],
    queryFn: () => api.page<Appointment>('/appointments', { ...today, pageSize: 50, order: 'asc' }),
    enabled: can('appointments.read'),
  });
  const value = useQuery({ queryKey: ['reports', 'value', 'teaser'], queryFn: () => api.get<ValueReport>('/reports/value'), enabled: analytics, staleTime: 5 * 60_000 });
  const queue = useQuery({ queryKey: ['handoffs', 'open'], queryFn: () => api.get<Handoff[]>('/handoffs', { status: 'open' }), enabled: can('conversations.handoff') });

  const hour = new Date().getHours();
  const first = me?.user.name.split(' ')[0] ?? '';
  const greeting = t(hour < 12 ? 'dashboard.greetingMorning' : hour < 19 ? 'dashboard.greetingAfternoon' : 'dashboard.greetingEvening', { name: first });
  const o = overview.data;
  const pts = series.data ?? [];
  const xFmt = (d: string) => fmtWeekdayShort(`${d}T12:00:00`, prefs.lang);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={<p className="mb-1 text-sm font-medium cap-first text-ink-3">{new Intl.DateTimeFormat(prefs.lang === 'en' ? 'en-US' : 'es-CO', { weekday: 'long', day: 'numeric', month: 'long', timeZone: tz }).format(new Date())}</p>}
        title={greeting}
        subtitle={t('dashboard.subtitle', { clinic: me?.clinic.name ?? '' })}
        actions={
          <>
            {analytics && (
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
            )}
            {can('ai.playground') && (
              <ButtonLink to="/ai/playground" icon={<HiOutlineSparkles aria-hidden="true" />}>
                {t('dashboard.tryPlayground')}
              </ButtonLink>
            )}
          </>
        }
      />

      {analytics && (
        <section aria-label="KPIs" className="stagger grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3 2xl:grid-cols-6">
          {overview.isLoading || !o ? (
            Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-[132px] rounded-2xl" />)
          ) : (
            <>
              <StatCard label={t('dashboard.todayAppointments')} value={<AnimatedNumber to={o.todayAppointments.value} format={(n) => fmtNumber(n, prefs.lang)} />} icon={<HiOutlineCalendarDays />} hint={o.todayAppointments.completed ? `${o.todayAppointments.completed} ${t('status.COMPLETED').toLowerCase()}` : undefined} />
              <StatCard label={t('dashboard.aiConversations')} value={<AnimatedNumber to={o.aiConversations.value} format={(n) => fmtNumber(n, prefs.lang)} />} delta={o.aiConversations.delta} icon={<HiOutlineChatBubbleLeftRight />} tone="accent" />
              <StatCard label={t('dashboard.bookedByAi')} value={<AnimatedNumber to={o.appointmentsBookedByAi.value} format={(n) => fmtNumber(n, prefs.lang)} />} delta={o.appointmentsBookedByAi.delta} icon={<HiOutlineSparkles />} />
              <StatCard label={t('dashboard.handoffs')} value={<AnimatedNumber to={o.humanHandoffs.value} format={(n) => fmtNumber(n, prefs.lang)} />} delta={o.humanHandoffs.delta} invertDelta hint={t('dashboard.openNow', { count: o.humanHandoffs.open })} icon={<HiOutlineUserGroup />} tone="warning" />
              <StatCard label={t('dashboard.upcoming')} value={<AnimatedNumber to={o.upcomingAppointments.value} format={(n) => fmtNumber(n, prefs.lang)} />} icon={<HiOutlineClock />} tone="info" />
              <StatCard label={t('dashboard.resolution')} value={<AnimatedNumber to={o.aiResolutionRate.value} format={(n) => `${n}%`} />} delta={o.aiResolutionRate.delta} icon={<HiOutlineCheckBadge />} tone="success" />
            </>
          )}
        </section>
      )}
      {analytics && o && <AiBriefing o={o} unanswered={insights.data?.unansweredQuestions?.[0]?.question ?? null} days={Number(days)} />}
      {analytics && value.data && (
        <Card aria-labelledby="value-teaser">
          <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <h2 id="value-teaser" className="text-[0.95rem] font-semibold text-ink">
                {t('growth.report.teaserTitle')}
              </h2>
              <dl className="mt-3 grid grid-cols-3 gap-4 sm:gap-8">
                {(
                  [
                    ['growth.report.teaserConversations', fmtNumber(value.data.current.conversations, prefs.lang)],
                    ['growth.report.teaserAppointments', fmtNumber(value.data.current.appointmentsByAi, prefs.lang)],
                    ['growth.report.teaserHours', fmtNumber(Math.round((value.data.current.minutesSaved / 60) * 10) / 10, prefs.lang)],
                  ] as const
                ).map(([k, v]) => (
                  <div key={k} className="min-w-0">
                    <dt className="truncate text-xs text-ink-3">{t(k)}</dt>
                    <dd className="font-display text-2xl font-bold tabular-nums text-ink">{v}</dd>
                  </div>
                ))}
              </dl>
            </div>
            <ButtonLink to="/reports/value" variant="secondary" size="sm" className="self-start sm:self-center">
              {t('growth.report.teaserCta')} <HiArrowRight aria-hidden="true" />
            </ButtonLink>
          </div>
        </Card>
      )}
      {overview.isError && <ErrorState error={overview.error} onRetry={() => void overview.refetch()} />}

      {analytics && (
        <div className="grid gap-4 lg:grid-cols-3">
          <Card className="lg:col-span-2" aria-labelledby="conv-chart">
            <CardHeader id="conv-chart" title={t('dashboard.conversationsOverTime')} subtitle={t(days === '7' ? 'dashboard.last7' : days === '90' ? 'dashboard.last90' : 'dashboard.last30')} />
            <div className="px-3 pb-4 sm:px-5">
              {series.isLoading ? (
                <Skeleton className="h-60" />
              ) : (
                <TrendChart
                  title={t('dashboard.conversationsOverTime')}
                  data={pts as unknown as Record<string, number | string>[]}
                  xKey="date"
                  xFormat={xFmt}
                  series={[
                    { key: 'conversations', label: t('dashboard.conversationsLabel') },
                    { key: 'resolvedByAi', label: t('dashboard.resolvedLabel') },
                  ]}
                />
              )}
            </div>
          </Card>
          <Card aria-labelledby="res-card">
            <CardHeader id="res-card" title={t('dashboard.resolution')} />
            <div className="space-y-5 px-5 pb-5">
              <div>
                <div className="mb-2 flex items-baseline justify-between">
                  <span className="font-display text-3xl font-bold">{o ? `${o.aiResolutionRate.value}%` : '—'}</span>
                  <AgentAvatar size={34} online />
                </div>
                <Meter value={o?.aiResolutionRate.value ?? 0} label={t('dashboard.resolution')} />
              </div>
              <div>
                <div className="mb-2 flex items-baseline justify-between text-sm">
                  <span className="text-ink-2">{t('dashboard.bookingConversion')}</span>
                  <span className="font-semibold">{o ? `${o.bookingConversion.value}%` : '—'}</span>
                </div>
                <Meter value={o?.bookingConversion.value ?? 0} label={t('dashboard.bookingConversion')} />
              </div>
              <div>
                <p className="mb-3 text-sm font-semibold">{t('dashboard.topQuestions')}</p>
                {insights.isLoading ? <SkeletonRows rows={3} /> : <RankBars items={(insights.data?.topQuestions ?? []).slice(0, 5).map((q) => ({ label: t(`intents.${q.intent}` as never), value: q.count }))} />}
              </div>
            </div>
          </Card>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card aria-labelledby="today">
          <CardHeader
            id="today"
            title={t('dashboard.todaySchedule')}
            subtitle={schedule.data ? t('common.showing', { count: schedule.data.meta.total }) : undefined}
            action={
              <Link to="/calendar" className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline">
                {t('common.viewAll')} <HiArrowRight aria-hidden="true" />
              </Link>
            }
          />
          <div className="px-2 pb-3">
            {schedule.isLoading ? (
              <SkeletonRows rows={4} className="px-3" />
            ) : !schedule.data?.items.length ? (
              <EmptyState icon={<HiOutlineCalendarDays />} title={t('dashboard.noAppointmentsToday')} />
            ) : (
              <ul className="scrollbar-thin max-h-[380px] divide-y divide-border overflow-y-auto">
                {schedule.data.items
                  .filter((a) => a.status !== 'RESCHEDULED')
                  .map((a) => (
                    <li key={a.id}>
                      <button type="button" onClick={() => nav(`/appointments/${a.id}`)} className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left hover:bg-surface-2">
                        <span className="w-16 shrink-0 text-sm font-semibold tabular-nums">{fmtTime(a.startTime, prefs.lang, tz)}</span>
                        <span className="h-9 w-1 shrink-0 rounded-full" style={{ background: a.doctor.color }} aria-hidden="true" />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium">{fullName(a.patient)}</span>
                          <span className="block truncate text-xs text-ink-3">
                            {doctorName(a.doctor)} · {a.service?.name ?? a.doctor.specialty?.name}
                          </span>
                        </span>
                        <span className="hidden sm:inline">
                          <Badge tone={a.source === 'AI' || a.source === 'WHATSAPP' ? 'primary' : 'neutral'}>{t(`source.${a.source}` as never)}</Badge>
                        </span>
                        <Badge tone={statusTone(a.status)} dot>
                          {t(`status.${a.status}` as never)}
                        </Badge>
                      </button>
                    </li>
                  ))}
              </ul>
            )}
          </div>
        </Card>

        {can('conversations.handoff') && (
          <Card aria-labelledby="queue">
            <CardHeader
              id="queue"
              title={t('dashboard.handoffQueue')}
              action={
                <Link to="/conversations?tab=queue" className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline">
                  {t('common.viewAll')} <HiArrowRight aria-hidden="true" />
                </Link>
              }
            />
            <div className="px-2 pb-3">
              {queue.isLoading ? (
                <SkeletonRows rows={3} className="px-3" />
              ) : !queue.data?.length ? (
                <EmptyState icon={<AgentAvatar size={40} />} title={t('conversations.queueEmpty')} body={t('dashboard.queueEmpty')} />
              ) : (
                <ul className="divide-y divide-border">
                  {queue.data.slice(0, 6).map((h) => (
                    <li key={h.id}>
                      <Link to={`/conversations/${h.conversationId}`} className="flex items-start gap-3 rounded-xl px-3 py-3 hover:bg-surface-2" data-no-underline>
                        <Avatar name={h.patient ? fullName(h.patient) : '?'} size={36} />
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-2">
                            <span className="truncate text-sm font-semibold">{h.patient ? fullName(h.patient) : t('conversations.unidentified')}</span>
                            <Badge tone={statusTone(h.urgency)}>{t(`urgency.${h.urgency}` as never)}</Badge>
                          </span>
                          <span className="mt-0.5 line-clamp-1 block text-xs text-ink-2">{h.summary.summary}</span>
                          <span className="mt-0.5 block text-xs text-ink-3">
                            {t(`channel.${h.conversation?.channel ?? 'WEB'}` as never)} · {fmtRelative(h.createdAt, prefs.lang)}
                          </span>
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </Card>
        )}
      </div>

      {analytics && (
        <Card aria-labelledby="by-source">
          <CardHeader id="by-source" title={t('dashboard.appointmentsBySource')} />
          <div className="px-3 pb-4 sm:px-5">
            {series.isLoading ? (
              <Skeleton className="h-56" />
            ) : (
              <TrendChart
                title={t('dashboard.appointmentsBySource')}
                type="bar"
                stacked
                height={220}
                data={pts as unknown as Record<string, number | string>[]}
                xKey="date"
                xFormat={xFmt}
                series={[
                  { key: 'appointmentsAi', label: t('dashboard.aiBooked') },
                  { key: 'appointmentsOther', label: t('dashboard.otherBooked') },
                ]}
              />
            )}
          </div>
        </Card>
      )}
    </div>
  );
}
