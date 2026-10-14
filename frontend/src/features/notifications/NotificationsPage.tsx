import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { HiOutlineBell, HiOutlineCalendarDays, HiOutlineExclamationTriangle, HiOutlineUserGroup } from 'react-icons/hi2';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { Card, PageHeader, Pagination } from '@/components/ui/Display';
import { EmptyState, SkeletonRows } from '@/components/ui/Feedback';
import { Switch } from '@/components/ui/Field';
import { usePreferences, useT } from '@/contexts/PreferencesContext';
import { api } from '@/lib/api';
import { cn, fmtRelative } from '@/lib/format';
import type { Notification } from '@/types';

const icons: Record<string, typeof HiOutlineBell> = {
  HUMAN_HANDOFF: HiOutlineUserGroup,
  SYSTEM_ALERT: HiOutlineExclamationTriangle,
};

export default function NotificationsPage() {
  const t = useT();
  const { prefs } = usePreferences();
  const qc = useQueryClient();
  const nav = useNavigate();
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [page, setPage] = useState(1);
  const q = useQuery({ queryKey: ['notifications', { unreadOnly, page }], queryFn: () => api.page<Notification>('/notifications', { unreadOnly, page, pageSize: 20 }) });
  const unreadCountQuery = useQuery({ queryKey: ['notifications', 'unread'], queryFn: () => api.get<{ unread: number }>('/notifications/unread-count') });
  const unreadCount = unreadCountQuery.data?.unread ?? 0;
  const refresh = () => void qc.invalidateQueries({ queryKey: ['notifications'] });
  const readAll = useMutation({ mutationFn: () => api.post('/notifications/read-all'), onSuccess: refresh });
  const read = useMutation({ mutationFn: (id: string) => api.post(`/notifications/${id}/read`), onSuccess: refresh });

  const open = (n: Notification) => {
    if (!n.readAt) read.mutate(n.id);
    const d = n.data as { conversationId?: string; appointmentId?: string };
    if (d.conversationId) nav(`/conversations/${d.conversationId}`);
    else if (d.appointmentId) nav(`/appointments/${d.appointmentId}`);
  };

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <PageHeader
        title={
          <span className="inline-flex items-center gap-3">
            <span>{t('notifications.title')}</span>
            {unreadCount > 0 && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-rose-500/10 px-2.5 py-0.5 text-xs font-semibold text-rose-600 ring-1 ring-inset ring-rose-500/25 dark:bg-rose-500/20 dark:text-rose-300">
                <span className="h-1.5 w-1.5 rounded-full bg-rose-500 animate-pulse" />
                {unreadCount} {t('notifications.unreadOnly')}
              </span>
            )}
          </span>
        }
        subtitle={t('notifications.subtitle')}
        actions={
          <Button variant="secondary" onClick={() => readAll.mutate()} loading={readAll.isPending} disabled={unreadCount === 0}>
            {t('notifications.markAll')}
          </Button>
        }
      />
      <Card>
        <div className="border-b border-border px-4 py-2">
          <Switch label={t('notifications.unreadOnly')} checked={unreadOnly} onChange={setUnreadOnly} />
        </div>
        {q.isLoading ? (
          <SkeletonRows rows={6} className="p-4" />
        ) : !q.data?.items.length ? (
          <EmptyState icon={<HiOutlineBell />} title={t('notifications.empty')} body={t('notifications.emptyBody')} />
        ) : (
          <>
            <ul className="divide-y divide-border">
              {q.data.items.map((n) => {
                const Icon = icons[n.type] ?? HiOutlineCalendarDays;
                return (
                  <li key={n.id}>
                    <button type="button" onClick={() => open(n)} className={cn('flex w-full items-start gap-3.5 px-4 py-3.5 text-left transition hover:bg-surface-2', !n.readAt && 'bg-primary-soft/30')}>
                      <span className={cn('grid h-9 w-9 shrink-0 place-items-center rounded-xl text-lg shadow-xs', n.type === 'HUMAN_HANDOFF' ? 'bg-warning-soft text-warning' : n.type === 'SYSTEM_ALERT' ? 'bg-danger-soft text-danger' : 'bg-primary-soft text-primary')}>
                        <Icon aria-hidden="true" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2">
                          <span className="text-sm font-semibold text-ink">{n.title}</span>
                          {!n.readAt && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-rose-500/10 px-1.5 py-0.5 text-[0.65rem] font-bold text-rose-600 dark:bg-rose-500/20 dark:text-rose-400" aria-label="unread">
                              <span className="h-1.5 w-1.5 rounded-full bg-rose-500" />
                            </span>
                          )}
                        </span>
                        <span className="mt-0.5 block text-sm text-ink-2">{n.body}</span>
                        <span className="mt-1 block text-xs text-ink-3">{fmtRelative(n.createdAt, prefs.lang)}</span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
            <Pagination page={page} totalPages={q.data.meta.totalPages} onChange={setPage} />
          </>
        )}
      </Card>
    </div>
  );
}
