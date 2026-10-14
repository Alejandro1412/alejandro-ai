import { useQuery } from '@tanstack/react-query';
import { HiBell, HiOutlineBell } from 'react-icons/hi2';
import { NavLink } from 'react-router-dom';
import { useT } from '@/contexts/PreferencesContext';
import { api } from '@/lib/api';
import { cn } from '@/lib/format';

export interface NotificationButtonProps {
  className?: string;
  onClick?: () => void;
}

/**
 * Premium notification bell button with dynamic active state,
 * animated bell hover motion, and a pixel-perfect status badge with ring cutout.
 */
export function NotificationButton({ className, onClick }: NotificationButtonProps) {
  const t = useT();
  const unread = useQuery({
    queryKey: ['notifications', 'unread'],
    queryFn: () => api.get<{ unread: number }>('/notifications/unread-count'),
    refetchInterval: 60_000,
  });

  const count = unread.data?.unread ?? 0;
  const hasUnread = count > 0;
  const formattedCount = count > 99 ? '99+' : count;

  return (
    <NavLink
      to="/notifications"
      onClick={onClick}
      className={({ isActive }) =>
        cn(
          'group relative grid h-10 w-10 place-items-center rounded-xl transition-all duration-200 outline-none',
          'focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-surface',
          isActive
            ? 'bg-primary-soft text-primary font-semibold shadow-xs'
            : 'text-ink-2 hover:bg-surface-2 hover:text-ink active:scale-95',
          className,
        )
      }
      aria-label={`${t('nav.notifications')}${hasUnread ? ` (${count})` : ''}`}
      title={`${t('nav.notifications')}${hasUnread ? ` (${count})` : ''}`}
      data-no-underline
    >
      {({ isActive }) => (
        <span className="relative inline-flex items-center justify-center">
          {isActive ? (
            <HiBell
              className="h-5 w-5 transition-transform duration-200 ease-out group-hover:scale-110"
              aria-hidden="true"
            />
          ) : (
            <HiOutlineBell
              className="h-5 w-5 transition-transform duration-200 ease-out group-hover:-rotate-12 group-hover:scale-105 origin-top"
              aria-hidden="true"
            />
          )}

          {hasUnread && (
            <span
              className={cn(
                'absolute -top-1.5 -right-2.5 z-10 flex h-[1.125rem] min-w-[1.125rem] items-center justify-center rounded-full',
                'bg-gradient-to-tr from-rose-600 via-rose-500 to-red-500 text-white',
                'shadow-xs shadow-rose-500/30',
                isActive
                  ? 'ring-2 ring-primary-soft'
                  : 'ring-2 ring-surface group-hover:ring-surface-2',
                'text-[0.625rem] font-bold leading-none tracking-tight tabular-nums select-none',
                'transition-all duration-200 group-hover:scale-110',
                count > 9 ? 'px-1.5 min-w-[1.25rem]' : 'px-1',
              )}
              role="status"
              aria-label={`${count} ${t('notifications.unreadOnly')}`}
            >
              {/* Subtle ambient pulse aura */}
              <span
                className="absolute -inset-0.5 rounded-full bg-rose-500/35 animate-ping opacity-60 pointer-events-none"
                style={{ animationDuration: '3s' }}
              />
              <span className="relative z-10">{formattedCount}</span>
            </span>
          )}
        </span>
      )}
    </NavLink>
  );
}
