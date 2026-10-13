import { useState } from 'react';
import { HiOutlineChartBar, HiOutlineTableCells } from 'react-icons/hi2';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Legend, SERIES } from '@/components/charts/Charts';
import { usePreferences, useT } from '@/contexts/PreferencesContext';

export interface ComparisonRow {
  label: string;
  current: number;
  previous: number;
}

interface TipProps {
  active?: boolean;
  payload?: { dataKey?: string | number; value?: number | string; color?: string }[];
  label?: string | number;
  names: Record<string, string>;
  fmt: (v: number) => string;
}

function Tip({ active, payload, label, names, fmt }: TipProps) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl border border-border bg-surface px-3 py-2 text-xs shadow-pop">
      <p className="mb-1 font-semibold text-ink">{label}</p>
      {payload.map((p) => (
        <p key={String(p.dataKey)} className="flex items-center gap-2 text-ink-2">
          <span className="h-2 w-2 rounded-full" style={{ background: p.color }} aria-hidden="true" />
          {names[String(p.dataKey)]}: <span className="font-semibold text-ink">{fmt(Number(p.value))}</span>
        </p>
      ))}
    </div>
  );
}

/**
 * Grouped horizontal bars (this month vs previous) — one shared axis, legend for the two series,
 * per-bar tooltip and an accessible table view (also used when printing).
 */
export function ComparisonChart({ rows, title, currentLabel, previousLabel, format }: { rows: ComparisonRow[]; title: string; currentLabel: string; previousLabel: string; format: (v: number) => string }) {
  const t = useT();
  const { prefs } = usePreferences();
  const [table, setTable] = useState(false);
  const names = { current: currentLabel, previous: previousLabel };
  const axis = { stroke: 'var(--chart-axis)', fontSize: 11, tickLine: false, axisLine: false } as const;
  const tableView = (
    <div className="overflow-hidden rounded-xl border border-border">
      <table className="w-full text-left text-xs">
        <caption className="sr-only">{title}</caption>
        <thead className="bg-surface-2">
          <tr>
            <th scope="col" className="px-3 py-2 font-medium text-ink-3">
              {t('growth.report.metric')}
            </th>
            <th scope="col" className="px-3 py-2 text-right font-medium text-ink-3">
              {currentLabel}
            </th>
            <th scope="col" className="px-3 py-2 text-right font-medium text-ink-3">
              {previousLabel}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label} className="border-t border-border">
              <th scope="row" className="px-3 py-1.5 font-normal text-ink">
                {r.label}
              </th>
              <td className="px-3 py-1.5 text-right tabular-nums">{format(r.current)}</td>
              <td className="px-3 py-1.5 text-right tabular-nums text-ink-2">{format(r.previous)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
  return (
    <figure className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <Legend
          series={[
            { key: 'current', label: currentLabel },
            { key: 'previous', label: previousLabel },
          ]}
        />
        <button type="button" onClick={() => setTable((v) => !v)} className="ml-auto inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-ink-3 hover:bg-surface-2 hover:text-ink print:hidden" aria-pressed={table}>
          {table ? <HiOutlineChartBar aria-hidden="true" /> : <HiOutlineTableCells aria-hidden="true" />}
          {table ? t('analytics.chartView') : t('analytics.tableView')}
        </button>
      </div>
      {table ? (
        tableView
      ) : (
        <>
          <div style={{ height: Math.max(220, rows.length * 52) }} role="img" aria-label={title} className="print:hidden">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 12, left: 4, bottom: 0 }} barCategoryGap="24%" barGap={2}>
                <CartesianGrid stroke="var(--chart-grid)" horizontal={false} />
                <XAxis type="number" {...axis} allowDecimals={false} tickFormatter={(v: number) => format(v)} />
                <YAxis type="category" dataKey="label" {...axis} width={128} tick={{ fill: 'var(--chart-axis)', fontSize: 11 }} />
                <Tooltip cursor={{ fill: 'rgb(var(--surface-3) / 0.5)' }} content={<Tip names={names} fmt={format} />} />
                <Bar dataKey="current" fill={SERIES[0]} radius={[0, 4, 4, 0]} maxBarSize={16} isAnimationActive={!prefs.reduceMotion} />
                <Bar dataKey="previous" fill={SERIES[1]} radius={[0, 4, 4, 0]} maxBarSize={16} isAnimationActive={!prefs.reduceMotion} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          {/* Charts do not reflow reliably on paper: print the exact numbers instead. */}
          <div className="hidden print:block">{tableView}</div>
        </>
      )}
    </figure>
  );
}
