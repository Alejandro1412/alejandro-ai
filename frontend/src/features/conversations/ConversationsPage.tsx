import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { HiOutlineChatBubbleLeftRight, HiMagnifyingGlass } from 'react-icons/hi2';
import { Link, useSearchParams } from 'react-router-dom';
import { AgentAvatar } from '@/components/brand/Logo';
import { Avatar, Badge, Card, PageHeader, Pagination, Tabs, statusTone } from '@/components/ui/Display';
import { EmptyState, ErrorState, SkeletonRows } from '@/components/ui/Feedback';
import { Input, Select } from '@/components/ui/Field';
import { useAuth } from '@/contexts/AuthContext';
import { usePreferences, useT } from '@/contexts/PreferencesContext';
import { api } from '@/lib/api';
import { fmtRelative, fullName } from '@/lib/format';
import type { Conversation, Handoff } from '@/types';

export default function ConversationsPage() {
  const t = useT();
  const { prefs } = usePreferences();
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as 'all' | 'queue') ?? 'all';
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [channel, setChannel] = useState('');

  const list = useQuery({
    queryKey: ['conversations', { page, search, status, channel }],
    queryFn: () => api.page<Conversation>('/conversations', { page, pageSize: 20, search, status, channel }),
    placeholderData: keepPreviousData,
    enabled: tab === 'all',
  });
  const queue = useQuery({ queryKey: ['handoffs', 'open'], queryFn: () => api.get<Handoff[]>('/handoffs', { status: 'open' }), enabled: can('conversations.handoff') });

  return (
    <div className="space-y-5">
      <PageHeader title={t('conversations.title')} subtitle={tab === 'queue' ? t('conversations.queueSubtitle') : t('conversations.subtitle')} />
      <Tabs
        value={tab}
        onChange={(v) => setParams(v === 'all' ? {} : { tab: v })}
        tabs={[
          { value: 'all', label: t('conversations.tabAll') },
          ...(can('conversations.handoff') ? [{ value: 'queue' as const, label: t('conversations.tabQueue'), count: queue.data?.length }] : []),
        ]}
      />

      {tab === 'all' ? (
        <Card>
          <div className="flex flex-col gap-2 border-b border-border p-3 sm:flex-row">
            <div className="relative flex-1">
              <HiMagnifyingGlass className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-3" aria-hidden="true" />
              <Input
                aria-label={t('common.search')}
                placeholder={t('common.searchPlaceholder')}
                className="pl-9"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                }}
              />
            </div>
            <Select aria-label={t('common.status')} value={status} onChange={(e) => setStatus(e.target.value)} className="sm:w-44">
              <option value="">{t('common.all')}</option>
              {['ACTIVE', 'HANDOFF', 'RESOLVED', 'CLOSED'].map((s) => (
                <option key={s} value={s}>
                  {t(`status.${s}` as never)}
                </option>
              ))}
            </Select>
            <Select aria-label={t('common.channel')} value={channel} onChange={(e) => setChannel(e.target.value)} className="sm:w-44">
              <option value="">{t('common.all')}</option>
              {['WEB', 'WHATSAPP', 'PORTAL', 'PLAYGROUND'].map((c) => (
                <option key={c} value={c}>
                  {t(`channel.${c}` as never)}
                </option>
              ))}
            </Select>
          </div>
          {list.isLoading ? (
            <SkeletonRows rows={8} className="p-4" />
          ) : list.isError ? (
            <ErrorState error={list.error} onRetry={() => void list.refetch()} />
          ) : !list.data?.items.length ? (
            <EmptyState icon={<HiOutlineChatBubbleLeftRight />} title={t('conversations.empty')} body={t('conversations.emptyBody')} />
          ) : (
            <>
              <ul className="divide-y divide-border">
                {list.data.items.map((c) => (
                  <li key={c.id}>
                    <Link to={`/conversations/${c.id}`} className="flex items-start gap-3 px-4 py-3.5 transition hover:bg-surface-2" data-no-underline>
                      {c.patient ? <Avatar name={fullName(c.patient)} size={40} /> : <AgentAvatar size={40} />}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <p className="truncate text-sm font-semibold">{c.patient ? fullName(c.patient) : (c.externalContact ?? t('conversations.unidentified'))}</p>
                          <span className="ml-auto shrink-0 text-xs text-ink-3">{fmtRelative(c.lastMessageAt, prefs.lang)}</span>
                        </div>
                        <p className="mt-0.5 line-clamp-1 text-sm text-ink-2">{c.lastMessage ?? c.subject}</p>
                        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                          <Badge tone={statusTone(c.status)} dot>
                            {t(`status.${c.status}` as never)}
                          </Badge>
                          <Badge>{t(`channel.${c.channel}` as never)}</Badge>
                          {c.hasBooking && <Badge tone="primary">{t('chat.booked')}</Badge>}
                          <span className="text-xs text-ink-3">{t('conversations.messages', { count: c.messageCount ?? 0 })}</span>
                        </div>
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
              <Pagination page={page} totalPages={list.data.meta.totalPages} onChange={setPage} />
            </>
          )}
        </Card>
      ) : (
        <HandoffQueue items={queue.data} loading={queue.isLoading} />
      )}
    </div>
  );
}

function HandoffQueue({ items, loading }: { items?: Handoff[]; loading: boolean }) {
  const t = useT();
  const { prefs } = usePreferences();
  if (loading) return <SkeletonRows rows={4} />;
  if (!items?.length)
    return (
      <Card>
        <EmptyState icon={<AgentAvatar size={44} />} title={t('conversations.queueEmpty')} body={t('conversations.queueEmptyBody')} />
      </Card>
    );
  return (
    <ul className="grid gap-3 lg:grid-cols-2">
      {items.map((h) => (
        <li key={h.id}>
          <Link to={`/conversations/${h.conversationId}`} className="card block p-4 transition hover:border-border-strong hover:shadow-pop" data-no-underline>
            <div className="flex items-start gap-3">
              <Avatar name={h.patient ? fullName(h.patient) : '?'} size={40} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-semibold">{h.patient ? fullName(h.patient) : (h.conversation?.externalContact ?? t('conversations.unidentified'))}</p>
                  <Badge tone={statusTone(h.urgency)}>{t(`urgency.${h.urgency}` as never)}</Badge>
                  <Badge tone={statusTone(h.status)}>{t(`status.${h.status}` as never)}</Badge>
                </div>
                <p className="mt-1 text-sm text-ink">{h.reason}</p>
                <p className="mt-1 line-clamp-2 text-sm text-ink-2">{h.summary.summary}</p>
                <p className="mt-2 text-xs text-ink-3">
                  {t(`channel.${h.conversation?.channel ?? 'WEB'}` as never)} · {t('conversations.waiting', { time: fmtRelative(h.createdAt, prefs.lang).replace(/^hace |^in |ago$/g, '') })}
                  {h.assignee ? ` · ${t('conversations.assignedTo', { name: h.assignee.name })}` : ''}
                </p>
              </div>
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}
