import { useState } from 'react';
import { HiOutlineChartBar, HiOutlineTableCells } from 'react-icons/hi2';
import { Bar, BarChart, CartesianGrid, Cell, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Legend, SERIES } from '@/components/charts/Charts';
import { Segmented } from '@/components/ui/Display';
import { usePreferences, useT } from '@/contexts/PreferencesContext';
import { fmtNumber } from '@/lib/format';
import { PLAN_KEYS, SUB_STATUSES, type AdminOverview } from './types';

type Mode = 'status' | 'plan';
interface Row {
  key: string;
  label: string;
  value: number;
  color: string;
}

function MixTooltip({ active, payload }: { active?: boolean; payload?: { payload?: Row }[] }) {
  const row = payload?.[0]?.payload;
  if (!active || !row) return null;
  return (
    <div className="rounded-xl border border-border bg-surface px-3 py-2 text-xs shadow-pop">
      <p className="flex items-center gap-2 text-ink-2">
        <span className="h-2 w-2 rounded-full" style={{ background: row.color }} aria-hidden="true" />
        {row.label}: <span className="font-semibold text-ink">{row.value}</span>
      </p>
    </div>
  );
}

/**
 * Tenants by status (one measure → one hue) or by plan (plans are identities → fixed categorical order + legend).
 * Status colors stay reserved for the badges; the chart never repaints a category when switching modes.
 */
export function TenantMixChart({ overview }: { overview: AdminOverview }) {
  const t = useT();
  const { prefs } = usePreferences();
  const [mode, setMode] = useState<Mode>('status');
  const [table, setTable] = useState(false);

  const rows: Row[] =
    mode === 'status'
      ? SUB_STATUSES.map((s) => ({ key: s, label: t(`admin.subStatus.${s}`), value: overview.byStatus[s] ?? 0, color: SERIES[0] }))
      : PLAN_KEYS.map((p, i) => ({ key: p, label: t(`admin.plans.${p}`), value: overview.byPlan[p] ?? 0, color: SERIES[i] }));
  const title = `${t('admin.console.chartTitle')} · ${mode === 'status' ? t('admin.console.byStatus') : t('admin.console.byPlan')}`;
  const axis = { stroke: 'var(--chart-axis)', fontSize: 11, tickLine: false, axisLine: false } as const;

  return (
    <figure className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Segmented
          label={t('admin.console.chartTitle')}
          value={mode}
          onChange={setMode}
          options={[
            { value: 'status', label: t('admin.console.byStatus') },
            { value: 'plan', label: t('admin.console.byPlan') },
          ]}
        />
        <button type="button" onClick={() => setTable((v) => !v)} className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-ink-3 hover:bg-surface-2 hover:text-ink" aria-pressed={table}>
          {table ? <HiOutlineChartBar aria-hidden="true" /> : <HiOutlineTableCells aria-hidden="true" />}
          {table ? t('analytics.chartView') : t('analytics.tableView')}
        </button>
      </div>
      {mode === 'plan' && <Legend series={PLAN_KEYS.map((p) => ({ key: p, label: t(`admin.plans.${p}`) }))} />}
      {table ? (
        <div className="overflow-hidden rounded-xl border border-border">
          <table className="w-full text-left text-xs">
            <caption className="sr-only">{title}</caption>
            <thead className="bg-surface-2">
              <tr>
                <th scope="col" className="px-3 py-2 font-medium text-ink-3">
                  {t('admin.console.category')}
                </th>
                <th scope="col" className="px-3 py-2 text-right font-medium text-ink-3">
                  {t('admin.console.tenants')}
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key} className="border-t border-border">
                  <th scope="row" className="px-3 py-1.5 font-normal">
                    {r.label}
                  </th>
                  <td className="px-3 py-1.5 text-right tabular-nums">{fmtNumber(r.value, prefs.lang)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div style={{ height: rows.length * 34 + 16 }} role="img" aria-label={`${title}: ${rows.map((r) => `${r.label} ${r.value}`).join(', ')}`}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 32, left: 0, bottom: 4 }} barCategoryGap={6}>
              <CartesianGrid stroke="var(--chart-grid)" horizontal={false} />
              <XAxis type="number" allowDecimals={false} hide />
              <YAxis type="category" dataKey="label" {...axis} width={112} />
              <Tooltip cursor={{ fill: 'rgb(var(--surface-3) / 0.5)' }} content={<MixTooltip />} />
              <Bar dataKey="value" radius={[0, 4, 4, 0]} maxBarSize={22} isAnimationActive={!prefs.reduceMotion}>
                {rows.map((r) => (
                  <Cell key={r.key} fill={r.color} />
                ))}
                <LabelList dataKey="value" position="right" fill="rgb(var(--ink-2))" fontSize={11} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </figure>
  );
}
