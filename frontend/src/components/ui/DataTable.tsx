import type { ReactNode } from 'react';
import { cn } from '@/lib/format';

export interface Column<T> {
  key: string;
  header: string;
  cell: (row: T) => ReactNode;
  className?: string;
  /** Hide on small tables (tablet) — mobile always uses the card layout. */
  hideBelow?: 'lg' | 'xl';
}

/**
 * Responsive table: a semantic <table> from md up, stacked cards on phones (no horizontal scroll).
 */
export function DataTable<T>({
  rows,
  columns,
  rowKey,
  onRowClick,
  mobileCard,
  caption,
}: {
  rows: T[];
  columns: Column<T>[];
  rowKey: (r: T) => string;
  onRowClick?: (r: T) => void;
  mobileCard: (r: T) => ReactNode;
  caption: string;
}) {
  return (
    <>
      <div className="hidden md:block">
        <table className="w-full text-left text-sm">
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr className="border-b border-border text-xs uppercase tracking-wide text-ink-3">
              {columns.map((c) => (
                <th key={c.key} scope="col" className={cn('px-4 py-3 font-medium', c.hideBelow === 'lg' && 'hidden lg:table-cell', c.hideBelow === 'xl' && 'hidden xl:table-cell', c.className)}>
                  {c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={rowKey(r)}
                onClick={onRowClick ? () => onRowClick(r) : undefined}
                onKeyDown={onRowClick ? (e) => e.key === 'Enter' && onRowClick(r) : undefined}
                tabIndex={onRowClick ? 0 : undefined}
                className={cn('border-b border-border/70 last:border-0', onRowClick && 'cursor-pointer transition hover:bg-surface-2 focus-visible:bg-surface-2')}
              >
                {columns.map((c) => (
                  <td key={c.key} className={cn('px-4 py-3 align-middle', c.hideBelow === 'lg' && 'hidden lg:table-cell', c.hideBelow === 'xl' && 'hidden xl:table-cell', c.className)}>
                    {c.cell(r)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="divide-y divide-border md:hidden" aria-label={caption}>
        {rows.map((r) => (
          <li key={rowKey(r)}>
            {onRowClick ? (
              <button type="button" onClick={() => onRowClick(r)} className="block w-full px-4 py-3.5 text-left active:bg-surface-2">
                {mobileCard(r)}
              </button>
            ) : (
              <div className="px-4 py-3.5">{mobileCard(r)}</div>
            )}
          </li>
        ))}
      </ul>
    </>
  );
}
