import type { ReactNode } from 'react';
import { HiArrowDownRight, HiArrowUpRight, HiChevronLeft, HiChevronRight } from 'react-icons/hi2';
import { useT } from '@/contexts/PreferencesContext';
import { cn, initials } from '@/lib/format';

export type Tone = 'neutral' | 'primary' | 'accent' | 'success' | 'warning' | 'danger' | 'info';
const toneCls: Record<Tone, string> = {
  neutral: 'bg-surface-3 text-ink-2',
  primary: 'bg-primary-soft text-primary',
  accent: 'bg-accent-soft text-accent-strong dark:text-accent',
  success: 'bg-success-soft text-success',
  warning: 'bg-warning-soft text-warning',
  danger: 'bg-danger-soft text-danger',
  info: 'bg-info-soft text-info',
};

export function Badge({ tone = 'neutral', children, dot, className }: { tone?: Tone; children: ReactNode; dot?: boolean; className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium', toneCls[tone], className)}>
      {dot && <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true" />}
      {children}
    </span>
  );
}

export const statusTone = (s: string): Tone =>
  (
    ({
      CONFIRMED: 'success',
      COMPLETED: 'info',
      PENDING: 'warning',
      CANCELLED: 'danger',
      NO_SHOW: 'danger',
      RESCHEDULED: 'neutral',
      ACTIVE: 'success',
      HANDOFF: 'warning',
      RESOLVED: 'info',
      CLOSED: 'neutral',
      OPEN: 'warning',
      ASSIGNED: 'primary',
      INDEXED: 'success',
      PROCESSING: 'info',
      UPLOADING: 'info',
      FAILED: 'danger',
      DISABLED: 'neutral',
      INACTIVE: 'neutral',
      ON_LEAVE: 'warning',
      TRIALING: 'accent',
      PAID: 'success',
      PAST_DUE: 'danger',
      LOW: 'neutral',
      MEDIUM: 'info',
      HIGH: 'warning',
      CRITICAL: 'danger',
      SUCCESS: 'success',
      ERROR: 'danger',
      DENIED: 'danger',
      FAILURE: 'danger',
    }) as Record<string, Tone>
  )[s] ?? 'neutral';

export function Card({ children, className, as: As = 'section', ...rest }: { children: ReactNode; className?: string; as?: 'section' | 'div' | 'article'; 'aria-labelledby'?: string }) {
  return (
    <As className={cn('card', className)} {...rest}>
      {children}
    </As>
  );
}

export function CardHeader({ title, subtitle, action, id, icon }: { title: string; subtitle?: string; action?: ReactNode; id?: string; icon?: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 px-5 pt-5 pb-3">
      <div className="flex min-w-0 items-start gap-2.5">
        {icon && <span className="mt-0.5 text-lg text-ink-3">{icon}</span>}
        <div className="min-w-0">
          <h2 id={id} className="text-[0.95rem] font-semibold text-ink">
            {title}
          </h2>
          {subtitle && <p className="mt-0.5 text-sm text-ink-3">{subtitle}</p>}
        </div>
      </div>
      {action}
    </div>
  );
}

export function PageHeader({ title, subtitle, actions, eyebrow }: { title: string; subtitle?: string; actions?: ReactNode; eyebrow?: ReactNode }) {
  return (
    <header className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {eyebrow}
        <h1 className="text-2xl font-bold text-ink sm:text-[1.7rem]">{title}</h1>
        {subtitle && <p className="mt-1 max-w-2xl text-[0.95rem] text-ink-2">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

export function StatCard({
  label,
  value,
  delta,
  hint,
  icon,
  tone = 'primary',
  invertDelta,
}: {
  label: string;
  value: ReactNode;
  delta?: number;
  hint?: string;
  icon?: ReactNode;
  tone?: Tone;
  invertDelta?: boolean;
}) {
  const t = useT();
  const good = delta !== undefined && (invertDelta ? delta <= 0 : delta >= 0);
  return (
    <div className="card spotlight flex flex-col gap-3 p-4 transition-transform duration-300 hover:-translate-y-0.5 sm:p-5">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium text-ink-2">{label}</p>
        {icon && <span className={cn('grid h-8 w-8 place-items-center rounded-lg text-base', toneCls[tone])}>{icon}</span>}
      </div>
      <p className="font-display text-[1.75rem] font-bold leading-none tracking-tight text-ink sm:text-3xl">{value}</p>
      <div className="flex min-h-[1.25rem] flex-wrap items-center gap-2 text-xs">
        {delta !== undefined && (
          <span className={cn('inline-flex items-center gap-0.5 font-semibold', good ? 'text-success' : 'text-danger')}>
            {delta >= 0 ? <HiArrowUpRight aria-hidden="true" /> : <HiArrowDownRight aria-hidden="true" />}
            {Math.abs(delta)}%<span className="sr-only"> {t('dashboard.vsPrevious')}</span>
          </span>
        )}
        {hint && <span className="text-ink-3">{hint}</span>}
      </div>
    </div>
  );
}

export function Avatar({ name, color, size = 36, className }: { name: string; color?: string; size?: number; className?: string }) {
  return (
    <span
      className={cn('inline-grid shrink-0 place-items-center rounded-full font-semibold text-white', className)}
      style={{ width: size, height: size, background: color ?? 'rgb(var(--primary))', fontSize: size * 0.38 }}
      aria-hidden="true"
    >
      {initials(name)}
    </span>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="rounded-md border border-border bg-surface-2 px-1.5 py-0.5 font-mono text-[0.7rem] text-ink-2">{children}</kbd>;
}

export function Segmented<T extends string>({ value, onChange, options, label }: { value: T; onChange: (v: T) => void; options: { value: T; label: string }[]; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-xl border border-border bg-surface-2 p-1">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn('rounded-lg px-3 py-1.5 text-sm font-medium transition', value === o.value ? 'bg-surface text-ink shadow-sm' : 'text-ink-3 hover:text-ink')}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Tabs<T extends string>({ value, onChange, tabs }: { value: T; onChange: (v: T) => void; tabs: { value: T; label: string; count?: number }[] }) {
  return (
    <div role="tablist" className="scrollbar-thin -mb-px flex gap-1 overflow-x-auto border-b border-border">
      {tabs.map((tab) => (
        <button
          key={tab.value}
          role="tab"
          type="button"
          aria-selected={value === tab.value}
          onClick={() => onChange(tab.value)}
          className={cn(
            'inline-flex items-center gap-2 whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-medium transition',
            value === tab.value ? 'border-primary text-ink' : 'border-transparent text-ink-3 hover:text-ink',
          )}
        >
          {tab.label}
          {tab.count !== undefined && <span className="rounded-full bg-surface-3 px-1.5 text-xs text-ink-2">{tab.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function Pagination({ page, totalPages, onChange }: { page: number; totalPages: number; onChange: (p: number) => void }) {
  const t = useT();
  if (totalPages <= 1) return null;
  return (
    <nav className="flex items-center justify-between gap-3 border-t border-border px-4 py-3 text-sm" aria-label="Pagination">
      <span className="text-ink-3">{t('common.page', { page, total: totalPages })}</span>
      <div className="flex gap-1">
        <button type="button" disabled={page <= 1} onClick={() => onChange(page - 1)} className="rounded-lg border border-border p-2 hover:bg-surface-2 disabled:opacity-40" aria-label={t('common.previous')}>
          <HiChevronLeft aria-hidden="true" />
        </button>
        <button type="button" disabled={page >= totalPages} onClick={() => onChange(page + 1)} className="rounded-lg border border-border p-2 hover:bg-surface-2 disabled:opacity-40" aria-label={t('common.next')}>
          <HiChevronRight aria-hidden="true" />
        </button>
      </div>
    </nav>
  );
}

/** CSS-only tooltip that also works with keyboard focus. */
export function Tooltip({ label, children }: { label: string; children: ReactNode }) {
  return (
    <span className="group relative inline-flex">
      {children}
      <span role="tooltip" className="pointer-events-none absolute bottom-full left-1/2 z-30 mb-2 -translate-x-1/2 whitespace-nowrap rounded-lg bg-navy px-2 py-1 text-xs text-white opacity-0 shadow-pop transition group-hover:opacity-100 group-focus-within:opacity-100 dark:bg-surface-3 dark:text-ink">
        {label}
      </span>
    </span>
  );
}
