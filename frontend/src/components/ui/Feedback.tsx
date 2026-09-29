import type { ReactNode } from 'react';
import { HiOutlineExclamationTriangle } from 'react-icons/hi2';
import { cn } from '@/lib/format';
import { useT } from '@/contexts/PreferencesContext';

export function Spinner({ className }: { className?: string }) {
  return (
    <svg className={cn('h-5 w-5 animate-spin', className)} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity=".2" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('skeleton', className)} aria-hidden="true" />;
}

export function SkeletonRows({ rows = 5, className }: { rows?: number; className?: string }) {
  const t = useT();
  return (
    <div className={cn('space-y-3', className)} role="status" aria-label={t('common.loading')}>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-3">
          <Skeleton className="h-10 w-10 rounded-full" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-3.5 w-1/3" />
            <Skeleton className="h-3 w-2/3" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  body,
  action,
  className,
}: {
  icon?: ReactNode;
  title: string;
  body?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col items-center justify-center px-6 py-14 text-center', className)}>
      {icon && <div className="mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-primary-soft text-2xl text-primary">{icon}</div>}
      <h3 className="text-base font-semibold text-ink">{title}</h3>
      {body && <p className="mt-1.5 max-w-md text-sm text-ink-2">{body}</p>}
      {action && <div className="mt-5 flex flex-wrap justify-center gap-2">{action}</div>}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error?: unknown; onRetry?: () => void }) {
  const t = useT();
  return (
    <div role="alert" className="flex flex-col items-center px-6 py-12 text-center">
      <div className="mb-3 grid h-12 w-12 place-items-center rounded-2xl bg-danger-soft text-xl text-danger">
        <HiOutlineExclamationTriangle aria-hidden="true" />
      </div>
      <p className="font-semibold">{t('common.errorTitle')}</p>
      <p className="mt-1 text-sm text-ink-2">{error instanceof Error ? error.message : t('common.errorGeneric')}</p>
      {onRetry && (
        <button type="button" onClick={onRetry} className="mt-4 rounded-lg px-3 py-1.5 text-sm font-medium text-primary hover:bg-primary-soft">
          {t('common.retry')}
        </button>
      )}
    </div>
  );
}
