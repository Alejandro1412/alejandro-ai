import { useState } from 'react';
import { HiOutlineChartBar, HiOutlineTableCells } from 'react-icons/hi2';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { usePreferences, useT } from '@/contexts/PreferencesContext';
import { cn } from '@/lib/format';

/** Categorical palette validated for CVD separation in light and dark (fixed order, never cycled). */
export const SERIES = ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)'];

export interface Series {
  key: string;
  label: string;
}

type Row = Record<string, string | number>;

interface TipProps {
  active?: boolean;
  payload?: { dataKey?: string | number; value?: number | string; color?: string }[];
  label?: string | number;
  series: Series[];
  fmt: (v: number) => string;
  xFormat?: (v: string) => string;
}

function ChartTooltip({ active, payload, label, series, fmt, xFormat }: TipProps) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl border border-border bg-surface px-3 py-2 text-xs shadow-pop">
      <p className="mb-1 font-semibold text-ink">{xFormat ? xFormat(String(label)) : label}</p>
      {payload.map((p) => (
        <p key={String(p.dataKey)} className="flex items-center gap-2 text-ink-2">
          <span className="h-2 w-2 rounded-full" style={{ background: p.color }} aria-hidden="true" />
          {series.find((s) => s.key === p.dataKey)?.label}: <span className="font-semibold text-ink">{fmt(Number(p.value))}</span>
        </p>
      ))}
    </div>
  );
}

export function Legend({ series }: { series: Series[] }) {
  if (series.length < 2) return null;
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-2">
      {series.map((s, i) => (
        <li key={s.key} className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm" style={{ background: SERIES[i] }} aria-hidden="true" />
          {s.label}
        </li>
      ))}
    </ul>
  );
}

/**
 * Time-series chart with legend, crosshair tooltip, recessive grid and an accessible table view.
 */
export function TrendChart({
  data,
  xKey,
  series,
  type = 'area',
  stacked,
  height = 240,
  format = (v) => String(v),
  xFormat,
  title,
  domainMax,
}: {
  data: Row[];
  xKey: string;
  series: Series[];
  type?: 'area' | 'bar' | 'line';
  stacked?: boolean;
  height?: number;
  format?: (v: number) => string;
  xFormat?: (v: string) => string;
  title: string;
  domainMax?: number;
}) {
  const t = useT();
  const { prefs } = usePreferences();
  const [table, setTable] = useState(false);
  const axis = { stroke: 'var(--chart-axis)', fontSize: 11, tickLine: false, axisLine: false } as const;
  const common = { data, margin: { top: 8, right: 8, left: -4, bottom: 0 } };
  const anim = !prefs.reduceMotion;
  const x = <XAxis dataKey={xKey} {...axis} tickFormatter={xFormat} minTickGap={24} />;
  const y = <YAxis {...axis} allowDecimals={false} tickFormatter={(v: number) => format(v)} domain={[0, domainMax ?? 'auto']} width={48} />;
  const grid = <CartesianGrid stroke="var(--chart-grid)" strokeDasharray="0" vertical={false} />;
  const tip = <Tooltip cursor={{ stroke: 'var(--chart-axis)', strokeWidth: 1, fill: 'rgb(var(--surface-3) / 0.5)' }} content={<ChartTooltip series={series} fmt={format} xFormat={xFormat} />} />;

  return (
    <figure className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <Legend series={series} />
        <button type="button" onClick={() => setTable((v) => !v)} className="ml-auto inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-ink-3 hover:bg-surface-2 hover:text-ink" aria-pressed={table}>
          {table ? <HiOutlineChartBar aria-hidden="true" /> : <HiOutlineTableCells aria-hidden="true" />}
          {table ? t('analytics.chartView') : t('analytics.tableView')}
        </button>
      </div>
      {table ? (
        <div className="scrollbar-thin max-h-[280px] overflow-auto rounded-xl border border-border">
          <table className="w-full text-left text-xs">
            <caption className="sr-only">{title}</caption>
            <thead className="sticky top-0 bg-surface-2">
              <tr>
                <th scope="col" className="px-3 py-2 font-medium text-ink-3">
                  {t('common.date')}
                </th>
                {series.map((s) => (
                  <th key={s.key} scope="col" className="px-3 py-2 text-right font-medium text-ink-3">
                    {s.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.map((r) => (
                <tr key={String(r[xKey])} className="border-t border-border">
                  <td className="px-3 py-1.5">{xFormat ? xFormat(String(r[xKey])) : r[xKey]}</td>
                  {series.map((s) => (
                    <td key={s.key} className="px-3 py-1.5 text-right tabular-nums">
                      {format(Number(r[s.key] ?? 0))}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div style={{ height }} role="img" aria-label={title}>
          <ResponsiveContainer width="100%" height="100%">
            {type === 'bar' ? (
              <BarChart {...common} barCategoryGap="28%">
                {grid}
                {x}
                {y}
                {tip}
                {series.map((s, i) => (
                  <Bar key={s.key} dataKey={s.key} stackId={stacked ? 'a' : undefined} fill={SERIES[i]} radius={stacked && i < series.length - 1 ? 0 : [4, 4, 0, 0]} stroke="rgb(var(--surface))" strokeWidth={stacked ? 1 : 0} isAnimationActive={anim} maxBarSize={28} />
                ))}
              </BarChart>
            ) : type === 'line' ? (
              <LineChart {...common}>
                {grid}
                {x}
                {y}
                {tip}
                {series.map((s, i) => (
                  <Line key={s.key} dataKey={s.key} type="monotoneX" stroke={SERIES[i]} strokeWidth={2} dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: 'rgb(var(--surface))' }} isAnimationActive={anim} />
                ))}
              </LineChart>
            ) : (
              <AreaChart {...common}>
                <defs>
                  {series.map((s, i) => (
                    <linearGradient key={s.key} id={`fill-${s.key}`} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={SERIES[i]} stopOpacity={0.22} />
                      <stop offset="100%" stopColor={SERIES[i]} stopOpacity={0.02} />
                    </linearGradient>
                  ))}
                </defs>
                {grid}
                {x}
                {y}
                {tip}
                {series.map((s, i) => (
                  <Area key={s.key} dataKey={s.key} type="monotoneX" stroke={SERIES[i]} strokeWidth={2} fill={`url(#fill-${s.key})`} stackId={stacked ? 'a' : undefined} activeDot={{ r: 4, strokeWidth: 2, stroke: 'rgb(var(--surface))' }} isAnimationActive={anim} />
                ))}
              </AreaChart>
            )}
          </ResponsiveContainer>
        </div>
      )}
    </figure>
  );
}

/** Horizontal ranked bars in plain HTML (labels stay readable at any width). */
export function RankBars({ items, format = (v) => String(v), className }: { items: { label: string; value: number }[]; format?: (v: number) => string; className?: string }) {
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <ul className={cn('space-y-2.5', className)}>
      {items.map((i) => (
        <li key={i.label} className="group">
          <div className="mb-1 flex items-baseline justify-between gap-3 text-sm">
            <span className="truncate text-ink">{i.label}</span>
            <span className="shrink-0 tabular-nums text-ink-2">{format(i.value)}</span>
          </div>
          <div className="h-2 rounded-full bg-surface-3" aria-hidden="true">
            <div className="h-2 rounded-full transition-[width] duration-500" style={{ width: `${(i.value / max) * 100}%`, background: SERIES[0] }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

export function Meter({ value, label }: { value: number; label: string }) {
  return (
    <div>
      <div className="h-2.5 rounded-full bg-surface-3" role="meter" aria-valuenow={value} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
        <div className="h-2.5 rounded-full bg-accent transition-[width] duration-500" style={{ width: `${Math.min(100, value)}%` }} />
      </div>
    </div>
  );
}
