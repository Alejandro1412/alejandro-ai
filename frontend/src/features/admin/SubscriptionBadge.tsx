import type { IconType } from 'react-icons';
import { HiOutlineCheckCircle, HiOutlineClock, HiOutlineExclamationTriangle, HiOutlineMinusCircle, HiOutlineNoSymbol, HiOutlineXCircle } from 'react-icons/hi2';
import { useT } from '@/contexts/PreferencesContext';
import { cn } from '@/lib/format';
import { SUB_STATUSES, type SubStatus } from './types';

/** Each subscription state gets its own semantic color AND icon + text, so it never relies on color alone. */
const STYLE: Record<SubStatus | 'NONE', { cls: string; Icon: IconType }> = {
  TRIALING: { cls: 'bg-info-soft text-info', Icon: HiOutlineClock },
  ACTIVE: { cls: 'bg-success-soft text-success', Icon: HiOutlineCheckCircle },
  PAST_DUE: { cls: 'bg-warning-soft text-warning', Icon: HiOutlineExclamationTriangle },
  EXPIRED: { cls: 'bg-danger-soft text-danger', Icon: HiOutlineXCircle },
  SUSPENDED: { cls: 'bg-danger text-white dark:text-[#2a0710]', Icon: HiOutlineNoSymbol },
  CANCELED: { cls: 'bg-surface-3 text-ink-2', Icon: HiOutlineMinusCircle },
  NONE: { cls: 'bg-surface-3 text-ink-3', Icon: HiOutlineMinusCircle },
};

export const isSubStatus = (s: string | null | undefined): s is SubStatus => SUB_STATUSES.includes(s as SubStatus);
export const READ_ONLY_STATUSES: SubStatus[] = ['EXPIRED', 'SUSPENDED', 'CANCELED'];

export function SubscriptionBadge({ status, className }: { status: string | null | undefined; className?: string }) {
  const t = useT();
  const key = isSubStatus(status) ? status : 'NONE';
  const { cls, Icon } = STYLE[key];
  return (
    <span className={cn('inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium', cls, className)}>
      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
      {t(`admin.subStatus.${key}`)}
    </span>
  );
}
