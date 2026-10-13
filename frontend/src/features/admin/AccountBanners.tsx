import { useQuery } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { HiOutlineExclamationTriangle, HiOutlineInformationCircle, HiOutlineLockClosed, HiOutlineShieldExclamation, HiXMark } from 'react-icons/hi2';
import { Link } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { usePreferences, useT } from '@/contexts/PreferencesContext';
import { api, impersonation } from '@/lib/api';
import { cn, fmtDate } from '@/lib/format';
import { READ_ONLY_STATUSES, isSubStatus } from './SubscriptionBadge';

type Tone = 'warning' | 'danger' | 'info';
const toneCls: Record<Tone, string> = {
  warning: 'border-warning/40 bg-warning-soft',
  danger: 'border-danger/40 bg-danger-soft',
  info: 'border-info/30 bg-info-soft',
};
const iconCls: Record<Tone, string> = { warning: 'text-warning', danger: 'text-danger', info: 'text-info' };

function Banner({ tone, icon, role, children, action, onDismiss, dismissLabel }: { tone: Tone; icon: ReactNode; role: 'status' | 'alert'; children: ReactNode; action?: ReactNode; onDismiss?: () => void; dismissLabel?: string }) {
  return (
    <div role={role} className={cn('flex flex-col gap-2 rounded-2xl border px-4 py-3 text-sm text-ink sm:flex-row sm:items-center', toneCls[tone])}>
      <div className="flex min-w-0 flex-1 items-start gap-2.5">
        <span className={cn('mt-0.5 shrink-0 text-lg', iconCls[tone])} aria-hidden="true">
          {icon}
        </span>
        <p className="min-w-0">{children}</p>
      </div>
      {(action || onDismiss) && (
        <div className="flex shrink-0 items-center gap-1 self-end sm:self-auto">
          {action}
          {onDismiss && (
            <button type="button" onClick={onDismiss} className="grid h-8 w-8 place-items-center rounded-lg text-ink-3 hover:bg-surface/60 hover:text-ink" aria-label={dismissLabel}>
              <HiXMark aria-hidden="true" />
            </button>
          )}
        </div>
      )}
    </div>
  );
}

const ctaCls = 'inline-flex h-8 items-center rounded-lg bg-surface px-3 text-sm font-medium text-ink shadow-sm ring-1 ring-border hover:bg-surface-2';

/** Per-tab dismissal (harmless UI pref) so a dismissed notice comes back in a new session. */
function useDismissed(key: string): [boolean, () => void] {
  const storageKey = `aai.banner.${key}`;
  const [dismissed, setDismissed] = useState(() => {
    try {
      return sessionStorage.getItem(storageKey) === '1';
    } catch {
      return false;
    }
  });
  return [
    dismissed,
    () => {
      setDismissed(true);
      try {
        sessionStorage.setItem(storageKey, '1');
      } catch {
        /* storage unavailable */
      }
    },
  ];
}

export function daysUntil(iso: string, now = Date.now()) {
  return Math.ceil((new Date(iso).getTime() - now) / 86_400_000);
}

export function exitImpersonation() {
  impersonation.stop();
  window.close();
  // Tabs not opened by script cannot close themselves: fall back to the operator's console (full reload).
  setTimeout(() => window.location.replace('/admin'), 150);
}

/** Account-level notices shown above every page: support impersonation and subscription state. */
export function AccountBanners() {
  const t = useT();
  const { prefs } = usePreferences();
  const { me, can } = useAuth();
  const status = me?.subscription?.status;
  const canBilling = can('billing.manage');
  const [pastDueHidden, hidePastDue] = useDismissed(`pastdue`);
  const [trialHidden, hideTrial] = useDismissed(`trial.${me?.subscription?.trialEndsAt ?? ''}`);
  const billing = useQuery({
    queryKey: ['billing'],
    queryFn: () => api.get<{ subscription: { graceEndsAt?: string | null } }>('/billing/overview'),
    enabled: status === 'PAST_DUE' && canBilling,
  });
  if (!me) return null;

  const items: ReactNode[] = [];
  if (me.impersonatedBy) {
    items.push(
      <Banner
        key="imp"
        tone="warning"
        role="alert"
        icon={<HiOutlineShieldExclamation />}
        action={
          <button type="button" onClick={exitImpersonation} className={ctaCls}>
            {t('admin.banner.exit')}
          </button>
        }
      >
        {t('admin.banner.impersonating', { clinic: me.clinic.name, user: me.user.name })}
      </Banner>,
    );
  }
  if (isSubStatus(status) && READ_ONLY_STATUSES.includes(status)) {
    items.push(
      <Banner
        key="ro"
        tone="danger"
        role="alert"
        icon={<HiOutlineLockClosed />}
        action={
          canBilling && (
            <Link to="/settings/billing" className={ctaCls} data-no-underline>
              {t('admin.banner.reactivate')}
            </Link>
          )
        }
      >
        {t('admin.banner.readOnly', { status: t(`admin.subStatus.${status}`) })}
      </Banner>,
    );
  } else if (status === 'PAST_DUE' && !pastDueHidden) {
    const grace = billing.data?.subscription.graceEndsAt;
    items.push(
      <Banner
        key="pd"
        tone="warning"
        role="status"
        icon={<HiOutlineExclamationTriangle />}
        onDismiss={hidePastDue}
        dismissLabel={t('admin.banner.dismiss')}
        action={
          canBilling && (
            <Link to="/settings/billing" className={ctaCls} data-no-underline>
              {t('admin.banner.updatePayment')}
            </Link>
          )
        }
      >
        {!canBilling ? t('admin.banner.pastDueGeneric') : grace ? t('admin.banner.pastDueGrace', { date: fmtDate(grace, prefs.lang) }) : t('admin.banner.pastDue')}
      </Banner>,
    );
  } else if (status === 'TRIALING' && me.subscription?.trialEndsAt && !trialHidden) {
    const days = daysUntil(me.subscription.trialEndsAt);
    if (days <= 3) {
      items.push(
        <Banner
          key="trial"
          tone="info"
          role="status"
          icon={<HiOutlineInformationCircle />}
          onDismiss={hideTrial}
          dismissLabel={t('admin.banner.dismiss')}
          action={
            canBilling && (
              <Link to="/settings/billing" className={ctaCls} data-no-underline>
                {t('admin.banner.choosePlan')}
              </Link>
            )
          }
        >
          {days <= 0 ? t('admin.banner.trialToday') : days === 1 ? t('admin.banner.trialTomorrow') : t('admin.banner.trialDays', { days })}
        </Banner>,
      );
    }
  }
  if (!items.length) return null;
  return <div className="mb-5 space-y-2">{items}</div>;
}
