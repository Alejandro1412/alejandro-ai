import { useQuery } from '@tanstack/react-query';
import { useEffect, useId, useState, type ReactNode } from 'react';
import {
  HiArrowDownRight,
  HiArrowUpRight,
  HiChevronDown,
  HiChevronLeft,
  HiChevronRight,
  HiMinus,
  HiOutlineBanknotes,
  HiOutlineBellAlert,
  HiOutlineCalendarDays,
  HiOutlineChatBubbleLeftRight,
  HiOutlineCheckBadge,
  HiOutlineClipboardDocument,
  HiOutlineClock,
  HiOutlineMoon,
  HiOutlinePrinter,
  HiOutlineQueueList,
  HiOutlineStar,
  HiOutlineUserMinus,
} from 'react-icons/hi2';
import { useSearchParams } from 'react-router-dom';
import { RankBars } from '@/components/charts/Charts';
import { Button } from '@/components/ui/Button';
import { Card, CardHeader, PageHeader } from '@/components/ui/Display';
import { ErrorState, Skeleton } from '@/components/ui/Feedback';
import { useToast } from '@/components/ui/Toast';
import { usePreferences, useT, type Lang } from '@/contexts/PreferencesContext';
import { api } from '@/lib/api';
import { cn, fmtMoney, fmtNumber } from '@/lib/format';
import { ComparisonChart } from './ReportCharts';
import { absDelta, buildSummary, CHANNELS, deltaTone, hoursSaved, isValidMonth, monthDate, monthOf, pctDelta, ppDelta, shiftMonth, type Delta, type ValueReport } from './valueReport';

const monthLabel = (month: string, lang: Lang) => new Intl.DateTimeFormat(lang === 'en' ? 'en-US' : 'es-CO', { month: 'long', year: 'numeric' }).format(monthDate(month));
const monthShort = (month: string, lang: Lang) => new Intl.DateTimeFormat(lang === 'en' ? 'en-US' : 'es-CO', { month: 'long' }).format(monthDate(month));

/** Print: hide the app chrome, use the full page width and always print in light colors. */
const PRINT_CSS = `@media print {
  aside, header.sticky, nav.fixed, [data-print-hide] { display: none !important; }
  div[class~="md:pl-[76px]"] { padding-left: 0 !important; }
  main#main { padding: 0 !important; max-width: none !important; }
  body { background: #fff !important; }
  #value-report .card { box-shadow: none !important; break-inside: avoid; }
  @page { margin: 14mm; }
}`;

function usePrintInLight() {
  useEffect(() => {
    const root = document.documentElement;
    let wasDark = false;
    const before = () => {
      wasDark = root.classList.contains('dark');
      if (wasDark) root.classList.remove('dark');
    };
    const after = () => {
      if (wasDark) root.classList.add('dark');
      wasDark = false;
    };
    window.addEventListener('beforeprint', before);
    window.addEventListener('afterprint', after);
    return () => {
      window.removeEventListener('beforeprint', before);
      window.removeEventListener('afterprint', after);
    };
  }, []);
}

function DeltaChip({ delta, lowerIsBetter, prev }: { delta: Delta; lowerIsBetter?: boolean; prev: string }) {
  const t = useT();
  const { prefs } = usePreferences();
  if (!delta) return null;
  const tone = deltaTone(delta, lowerIsBetter);
  const cls = tone === 'good' ? 'bg-success-soft text-success' : tone === 'bad' ? 'bg-danger-soft text-danger' : 'bg-surface-3 text-ink-2';
  let text: string;
  let Icon = HiMinus;
  if (delta.kind === 'new') {
    text = t('growth.report.newMetric');
    Icon = HiArrowUpRight;
  } else {
    if (delta.value > 0) Icon = HiArrowUpRight;
    else if (delta.value < 0) Icon = HiArrowDownRight;
    const n = new Intl.NumberFormat(prefs.lang === 'en' ? 'en-US' : 'es-CO', { maximumFractionDigits: 1 }).format(Math.abs(delta.value));
    text = delta.value === 0 ? t('growth.report.noChange') : delta.kind === 'pct' ? `${n}%` : delta.kind === 'pp' ? `${n} ${t('growth.report.pp')}` : n;
  }
  const verdict = tone === 'good' ? t('growth.report.better') : tone === 'bad' ? t('growth.report.worse') : '';
  return (
    <span className={cn('inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-xs font-semibold', cls)}>
      <Icon aria-hidden="true" />
      {delta.kind !== 'new' && delta.value < 0 && <span className="sr-only">−</span>}
      {text}
      <span className="sr-only">
        {' '}
        {t('growth.report.vsPrev', { month: prev })}
        {verdict ? ` (${verdict})` : ''}
      </span>
    </span>
  );
}

function KpiTile({ label, value, delta, lowerIsBetter, hint, icon, prev }: { label: string; value: string; delta: Delta; lowerIsBetter?: boolean; hint?: string; icon: ReactNode; prev: string }) {
  return (
    <div className="card flex min-w-0 flex-col gap-2.5 p-4 sm:p-5">
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-medium text-ink-2">{label}</p>
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-primary-soft text-base text-primary print:hidden" aria-hidden="true">
          {icon}
        </span>
      </div>
      <p className={`font-display font-bold leading-none tracking-tight text-ink [overflow-wrap:anywhere] ${String(value).length > 10 ? "text-xl sm:text-2xl" : "text-[1.65rem] sm:text-3xl"}`}>{value}</p>
      <div className="flex min-h-[1.25rem] flex-wrap items-center gap-x-2 gap-y-1 text-xs">
        <DeltaChip delta={delta} lowerIsBetter={lowerIsBetter} prev={prev} />
        {hint && <span className="text-ink-3">{hint}</span>}
      </div>
    </div>
  );
}

export default function ValueReportPage() {
  const t = useT();
  const { prefs } = usePreferences();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const thisMonth = monthOf();
  const raw = params.get('month');
  const month = isValidMonth(raw) && raw <= thisMonth ? raw : thisMonth;
  const [methodOpen, setMethodOpen] = useState(false);
  const methodId = useId();
  usePrintInLight();

  const q = useQuery({ queryKey: ['reports', 'value', month], queryFn: () => api.get<ValueReport>('/reports/value', { month }) });
  const go = (m: string) => setParams((p) => {
    const next = new URLSearchParams(p);
    next.set('month', m);
    return next;
  });

  const lang = prefs.lang;
  const num = (n: number) => fmtNumber(n, lang);
  const label = monthLabel(month, lang);
  const prevName = monthShort(shiftMonth(month, -1), lang);
  const r = q.data;

  const kpis = (() => {
    if (!r) return [];
    const c = r.current;
    const p = r.previous;
    const money = (cents: number) => fmtMoney(cents, r.clinic.currency, lang) ?? '—';
    const afterPct = c.conversations ? Math.round((c.afterHours / c.conversations) * 100) : 0;
    const rate = (v: number | null) => (v === null ? '—' : `${new Intl.NumberFormat(lang === 'en' ? 'en-US' : 'es-CO', { maximumFractionDigits: 1 }).format(v)}%`);
    return [
      { key: 'conversations', icon: <HiOutlineChatBubbleLeftRight />, label: t('growth.report.kpi.conversations'), value: num(c.conversations), delta: pctDelta(c.conversations, p.conversations) },
      { key: 'resolution', icon: <HiOutlineCheckBadge />, label: t('growth.report.kpi.resolution'), value: rate(c.resolutionRate), delta: ppDelta(c.resolutionRate, p.resolutionRate), hint: t('growth.report.kpi.resolutionHint', { n: num(c.resolvedByAi) }) },
      { key: 'afterHours', icon: <HiOutlineMoon />, label: t('growth.report.kpi.afterHours'), value: num(c.afterHours), delta: pctDelta(c.afterHours, p.afterHours), hint: t('growth.report.kpi.afterHoursHint', { pct: afterPct }) },
      { key: 'appointments', icon: <HiOutlineCalendarDays />, label: t('growth.report.kpi.appointments'), value: num(c.appointmentsByAi), delta: pctDelta(c.appointmentsByAi, p.appointmentsByAi) },
      { key: 'revenue', icon: <HiOutlineBanknotes />, label: t('growth.report.kpi.revenue'), value: money(c.revenueBookedByAiCents), delta: pctDelta(c.revenueBookedByAiCents, p.revenueBookedByAiCents), hint: t('growth.report.kpi.revenueHint') },
      { key: 'hours', icon: <HiOutlineClock />, label: t('growth.report.kpi.hours'), value: num(hoursSaved(c.minutesSaved)), delta: pctDelta(c.minutesSaved, p.minutesSaved), hint: t('growth.report.kpi.hoursHint', { min: r.clinic.minutesSavedPerConversation }) },
      { key: 'noShow', icon: <HiOutlineUserMinus />, label: t('growth.report.kpi.noShow'), value: rate(c.noShowRate), delta: ppDelta(c.noShowRate, p.noShowRate), lowerIsBetter: true, hint: t('growth.report.kpi.noShowHint') },
      { key: 'reminders', icon: <HiOutlineBellAlert />, label: t('growth.report.kpi.reminders'), value: num(c.remindersSent), delta: pctDelta(c.remindersSent, p.remindersSent), hint: t('growth.report.kpi.remindersHint', { n: num(c.attendanceConfirmed) }) },
      { key: 'refilled', icon: <HiOutlineQueueList />, label: t('growth.report.kpi.refilled'), value: num(c.slotsRefilledFromWaitlist), delta: pctDelta(c.slotsRefilledFromWaitlist, p.slotsRefilledFromWaitlist), hint: t('growth.report.kpi.refilledHint') },
      {
        key: 'rating',
        icon: <HiOutlineStar />,
        label: t('growth.report.kpi.rating'),
        value: c.averageRating === null ? '—' : `${new Intl.NumberFormat(lang === 'en' ? 'en-US' : 'es-CO', { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(c.averageRating)} / 5`,
        delta: absDelta(c.averageRating, p.averageRating),
        hint: t('growth.report.kpi.ratingHint', { n: num(c.reviews) }),
      },
    ];
  })();

  const headline = r ? t('growth.report.headline', { month: label, n: num(r.current.conversations), m: num(r.current.appointmentsByAi) }) : '';

  const copy = async () => {
    if (!r) return;
    const text = buildSummary({
      title: t('growth.report.summaryTitle', { clinic: r.clinic.name, month: label }),
      headline: `${headline}.`,
      lines: kpis.map((k) => [k.label, k.hint ? `${k.value} (${k.hint})` : k.value]),
    });
    try {
      await navigator.clipboard.writeText(text);
      toast.success(t('growth.report.copied'));
    } catch {
      toast.error(t('growth.report.copyFailed'));
    }
  };

  const channelItems = r ? CHANNELS.map((ch) => ({ label: t(`growth.report.channel.${ch}`), value: r.current.byChannel?.[ch] ?? 0 })) : [];
  const comparison = r
    ? [
        { label: t('growth.report.kpi.conversations'), current: r.current.conversations, previous: r.previous.conversations },
        { label: t('growth.report.kpi.resolution'), current: r.current.resolvedByAi, previous: r.previous.resolvedByAi },
        { label: t('growth.report.kpi.afterHours'), current: r.current.afterHours, previous: r.previous.afterHours },
        { label: t('growth.report.kpi.appointments'), current: r.current.appointmentsByAi, previous: r.previous.appointmentsByAi },
        { label: t('growth.report.kpi.reminders'), current: r.current.remindersSent, previous: r.previous.remindersSent },
        { label: t('growth.report.kpi.refilled'), current: r.current.slotsRefilledFromWaitlist, previous: r.previous.slotsRefilledFromWaitlist },
      ]
    : [];
  const methodKeys = ['conversations', 'resolution', 'afterHours', 'appointments', 'revenue', 'hours', 'noShow', 'reminders', 'refilled', 'rating'] as const;

  return (
    <div id="value-report" className="page-enter space-y-5">
      <style>{PRINT_CSS}</style>
      <PageHeader
        title={t('growth.report.title')}
        subtitle={t('growth.report.subtitle')}
        actions={
          <div className="flex flex-wrap items-center gap-2 print:hidden">
            <Button variant="secondary" size="sm" icon={<HiOutlineClipboardDocument aria-hidden="true" />} onClick={() => void copy()} disabled={!r}>
              {t('growth.report.copy')}
            </Button>
            <Button variant="secondary" size="sm" icon={<HiOutlinePrinter aria-hidden="true" />} onClick={() => window.print()} disabled={!r}>
              {t('growth.report.print')}
            </Button>
          </div>
        }
      />

      <nav aria-label={t('growth.report.monthPicker')} className="flex items-center gap-2 print:hidden">
        <Button variant="secondary" size="icon" aria-label={t('growth.report.prevMonth')} title={t('growth.report.prevMonth')} onClick={() => go(shiftMonth(month, -1))}>
          <HiChevronLeft aria-hidden="true" />
        </Button>
        <p className="min-w-[10rem] text-center text-base font-semibold cap-first" aria-live="polite">
          {label}
        </p>
        <Button variant="secondary" size="icon" aria-label={t('growth.report.nextMonth')} title={t('growth.report.nextMonth')} onClick={() => go(shiftMonth(month, 1))} disabled={month >= thisMonth}>
          <HiChevronRight aria-hidden="true" />
        </Button>
      </nav>

      {q.isError ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : !r ? (
        <div className="space-y-4" role="status" aria-label={t('common.loading')}>
          <Skeleton className="h-32 rounded-2xl" />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
            {Array.from({ length: 10 }).map((_, i) => (
              <Skeleton key={i} className="h-32 rounded-2xl" />
            ))}
          </div>
        </div>
      ) : (
        <>
          <section className="card overflow-hidden bg-primary-soft/60 p-5 sm:p-7" aria-labelledby="vr-headline">
            <p className="text-sm font-medium text-primary">
              {r.clinic.name} · <span className="cap-first inline-block">{label}</span>
            </p>
            <h2 id="vr-headline" className="mt-2 max-w-3xl font-display text-xl font-bold leading-snug text-ink sm:text-2xl lg:text-[1.75rem]">
              {headline}
            </h2>
            <p className="mt-3 text-sm text-ink-2">
              {t('growth.report.kpi.hours')}: <strong className="text-ink">{num(hoursSaved(r.current.minutesSaved))}</strong> · {t('growth.report.kpi.revenue')}: <strong className="text-ink">{fmtMoney(r.current.revenueBookedByAiCents, r.clinic.currency, lang)}</strong>
            </p>
          </section>

          <section aria-label="KPIs" className="stagger grid grid-cols-1 gap-3 min-[420px]:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 print:grid-cols-3">
            {kpis.map((k) => (
              <KpiTile key={k.key} label={k.label} value={k.value} delta={k.delta} lowerIsBetter={k.lowerIsBetter} hint={k.hint} icon={k.icon} prev={prevName} />
            ))}
          </section>

          <div className="grid gap-4 lg:grid-cols-5">
            <Card className="lg:col-span-2" aria-labelledby="vr-channel">
              <CardHeader id="vr-channel" title={t('growth.report.byChannel')} subtitle={label} />
              <div className="px-5 pb-5">
                {r.current.conversations === 0 ? <p className="py-6 text-center text-sm text-ink-3">{t('growth.report.noData')}</p> : <RankBars items={channelItems} format={num} />}
              </div>
            </Card>
            <Card className="lg:col-span-3" aria-labelledby="vr-compare">
              <CardHeader id="vr-compare" title={t('growth.report.comparison')} />
              <div className="px-3 pb-4 sm:px-5">
                <ComparisonChart rows={comparison} title={t('growth.report.comparison')} currentLabel={label} previousLabel={monthLabel(shiftMonth(month, -1), lang)} format={num} />
              </div>
            </Card>
          </div>

          <Card>
            <h2 className="m-0">
              <button
                type="button"
                className="flex w-full items-center justify-between gap-3 rounded-2xl px-5 py-4 text-left text-[0.95rem] font-semibold text-ink hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                aria-expanded={methodOpen}
                aria-controls={methodId}
                onClick={() => setMethodOpen((v) => !v)}
              >
                {t('growth.report.method')}
                <HiChevronDown className={cn('shrink-0 text-ink-3 transition-transform print:hidden', methodOpen && 'rotate-180')} aria-hidden="true" />
              </button>
            </h2>
            <div id={methodId} className={cn('border-t border-border px-5 py-4', !methodOpen && 'hidden print:block')}>
              <ul className="list-disc space-y-2 pl-5 text-sm text-ink-2">
                {methodKeys.map((k) => (
                  <li key={k}>{t(`growth.report.methodItems.${k}`, { min: r.clinic.minutesSavedPerConversation })}</li>
                ))}
              </ul>
              <p className="mt-3 text-xs text-ink-3">{t('growth.report.methodNote')}</p>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
