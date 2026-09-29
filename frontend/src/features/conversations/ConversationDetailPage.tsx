import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { HiArrowLeft, HiOutlineCheckCircle, HiOutlineDocumentText, HiOutlineHandRaised, HiOutlineSparkles } from 'react-icons/hi2';
import { Link, useParams } from 'react-router-dom';
import { AgentAvatar } from '@/components/brand/Logo';
import { ChatThread, Composer } from '@/components/chat/ChatThread';
import { Button } from '@/components/ui/Button';
import { Avatar, Badge, Card, CardHeader, Tabs, statusTone } from '@/components/ui/Display';
import { ErrorState, Skeleton } from '@/components/ui/Feedback';
import { useToast } from '@/components/ui/Toast';
import { useAuth } from '@/contexts/AuthContext';
import { usePreferences, useT } from '@/contexts/PreferencesContext';
import { api, errorMessage } from '@/lib/api';
import { fmtDateTime, fullName } from '@/lib/format';
import type { Conversation, HandoffSummary } from '@/types';
import { TracePanel } from '../ai/TracePanel';

export default function ConversationDetailPage() {
  const { id = '' } = useParams();
  const t = useT();
  const { prefs } = usePreferences();
  const { can } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const [tab, setTab] = useState<'chat' | 'info'>('chat');
  const conv = useQuery({ queryKey: ['conversations', id], queryFn: () => api.get<Conversation>(`/conversations/${id}`), refetchInterval: 15_000 });
  const [summary, setSummary] = useState<HandoffSummary | null>(null);
  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ['conversations'] });
    void qc.invalidateQueries({ queryKey: ['handoffs'] });
  };

  const reply = useMutation({ mutationFn: (content: string) => api.post(`/conversations/${id}/messages`, { content }), onSuccess: invalidate, onError: (e) => toast.error(errorMessage(e)) });
  const summarize = useMutation({ mutationFn: () => api.post<HandoffSummary>(`/conversations/${id}/summary`), onSuccess: setSummary });
  const openHandoff = conv.data?.handoffs?.find((h) => h.status !== 'RESOLVED');
  const assign = useMutation({ mutationFn: () => api.post(`/handoffs/${openHandoff!.id}/assign`), onSuccess: invalidate });
  const resolve = useMutation({
    mutationFn: (returnToAi: boolean) => (openHandoff ? api.post(`/handoffs/${openHandoff.id}/resolve`, { returnToAi }) : api.post(`/conversations/${id}/status`, { status: returnToAi ? 'ACTIVE' : 'RESOLVED', returnToAi })),
    onSuccess: () => {
      toast.success(t('common.saved'));
      invalidate();
    },
  });

  if (conv.isLoading) return <Skeleton className="h-[70vh] rounded-2xl" />;
  if (conv.isError || !conv.data) return <ErrorState error={conv.error} onRetry={() => void conv.refetch()} />;
  const c = conv.data;
  const s = summary ?? openHandoff?.summary ?? c.summary;
  const lastTrace = [...(c.messages ?? [])].reverse().find((m) => m.trace && !(m.trace as unknown as { seeded?: boolean }).seeded)?.trace ?? undefined;
  const name = c.patient ? fullName(c.patient) : (c.externalContact ?? t('conversations.unidentified'));

  const info = (
    <div className="space-y-4">
      <Card>
        <div className="flex items-center gap-3 p-4">
          {c.patient ? <Avatar name={name} size={44} /> : <AgentAvatar size={44} />}
          <div className="min-w-0">
            {c.patient ? (
              <Link to={`/patients/${c.patient.id}`} className="font-semibold hover:underline">
                {name}
              </Link>
            ) : (
              <p className="font-semibold">{name}</p>
            )}
            <p className="text-xs text-ink-3">{c.patient?.phone ?? c.externalContact}</p>
          </div>
        </div>
        <dl className="grid grid-cols-2 gap-3 border-t border-border p-4 text-sm">
          <div>
            <dt className="text-xs text-ink-3">{t('common.channel')}</dt>
            <dd className="font-medium">{t(`channel.${c.channel}` as never)}</dd>
          </div>
          <div>
            <dt className="text-xs text-ink-3">{t('common.language')}</dt>
            <dd className="font-medium uppercase">{c.language}</dd>
          </div>
          <div>
            <dt className="text-xs text-ink-3">{t('common.status')}</dt>
            <dd>
              <Badge tone={statusTone(c.status)} dot>
                {t(`status.${c.status}` as never)}
              </Badge>
            </dd>
          </div>
          <div>
            <dt className="text-xs text-ink-3">IA</dt>
            <dd>
              <Badge tone={c.aiEnabled ? 'success' : 'warning'}>{c.aiEnabled ? t('conversations.aiActive') : t('conversations.aiPaused')}</Badge>
            </dd>
          </div>
        </dl>
        {can('conversations.handoff') && (
          <div className="flex flex-wrap gap-2 border-t border-border p-4">
            {openHandoff && openHandoff.status === 'OPEN' && (
              <Button size="sm" variant="secondary" icon={<HiOutlineHandRaised aria-hidden="true" />} loading={assign.isPending} onClick={() => assign.mutate()}>
                {t('conversations.assign')}
              </Button>
            )}
            <Button size="sm" variant="secondary" icon={<HiOutlineCheckCircle aria-hidden="true" />} loading={resolve.isPending} onClick={() => resolve.mutate(false)}>
              {t('conversations.resolve')}
            </Button>
            {!c.aiEnabled && (
              <Button size="sm" variant="subtle" icon={<HiOutlineSparkles aria-hidden="true" />} onClick={() => resolve.mutate(true)}>
                {t('conversations.resolveReturnAi')}
              </Button>
            )}
          </div>
        )}
      </Card>

      <Card aria-labelledby="sum-h">
        <CardHeader
          id="sum-h"
          title={t('conversations.summary')}
          icon={<HiOutlineDocumentText />}
          action={
            <Button size="sm" variant="ghost" loading={summarize.isPending} onClick={() => summarize.mutate()}>
              {t('conversations.generateSummary')}
            </Button>
          }
        />
        {s ? (
          <div className="space-y-3 px-5 pb-5 text-sm">
            <p className="text-ink">{s.summary}</p>
            {openHandoff && (
              <p>
                <Badge tone={statusTone(openHandoff.urgency)}>{t(`urgency.${openHandoff.urgency}` as never)}</Badge> <span className="text-ink-2">{openHandoff.reason}</span>
              </p>
            )}
            {s.intent && (
              <p>
                <span className="font-semibold">{t('conversations.intent')}:</span> {t(`intents.${s.intent}` as never)}
              </p>
            )}
            {s.actionsTaken.length > 0 && (
              <div>
                <p className="font-semibold">{t('conversations.actionsTaken')}</p>
                <ul className="mt-1 list-disc space-y-0.5 pl-5 text-ink-2">
                  {s.actionsTaken.map((a) => (
                    <li key={a}>{a}</li>
                  ))}
                </ul>
              </div>
            )}
            {s.pendingActions.length > 0 && (
              <div>
                <p className="font-semibold">{t('conversations.pendingActions')}</p>
                <ul className="mt-1 list-disc space-y-0.5 pl-5 text-ink-2">
                  {s.pendingActions.map((a) => (
                    <li key={a}>{a}</li>
                  ))}
                </ul>
              </div>
            )}
            <div className="rounded-xl bg-primary-soft p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-primary">{t('conversations.recommendation')}</p>
              <p className="mt-1 text-ink">{s.recommendation}</p>
            </div>
          </div>
        ) : (
          <p className="px-5 pb-5 text-sm text-ink-3">—</p>
        )}
      </Card>

      {c.toolExecutions && c.toolExecutions.length > 0 && (
        <Card aria-labelledby="tl-h">
          <CardHeader id="tl-h" title={t('conversations.toolTimeline')} />
          <ol className="space-y-2 px-5 pb-5">
            {c.toolExecutions.map((te) => (
              <li key={te.id} className="flex items-center gap-2 text-xs">
                <span className="font-mono font-semibold text-ink">{te.toolName}()</span>
                <Badge tone={statusTone(te.status)}>{te.status}</Badge>
                <span className="ml-auto text-ink-3">{fmtDateTime(te.createdAt, prefs.lang)}</span>
              </li>
            ))}
          </ol>
        </Card>
      )}

      {lastTrace && can('ai.playground') && (
        <Card aria-labelledby="trace-h">
          <CardHeader id="trace-h" title={t('playground.debug')} />
          <TracePanel trace={lastTrace} />
        </Card>
      )}
    </div>
  );

  const thread = (
    <Card className="flex h-[calc(100dvh-230px)] min-h-[480px] flex-col overflow-hidden">
      <div className="flex items-center gap-3 border-b border-border px-4 py-3">
        <p className="min-w-0 flex-1 truncate text-sm font-semibold">{c.subject ?? name}</p>
        <Badge tone={statusTone(c.status)} dot>
          {t(`status.${c.status}` as never)}
        </Badge>
      </div>
      <ChatThread messages={c.messages ?? []} readOnly showDisclaimer={false} />
      {can('conversations.reply') && c.status !== 'CLOSED' && <Composer onSend={(text) => reply.mutate(text)} disabled={reply.isPending} />}
    </Card>
  );

  return (
    <div className="space-y-4">
      <Link to="/conversations" className="inline-flex items-center gap-1.5 text-sm font-medium text-ink-2 hover:text-ink">
        <HiArrowLeft aria-hidden="true" /> {t('conversations.title')}
      </Link>
      <h1 className="text-xl font-bold sm:text-2xl">{name}</h1>
      <div className="lg:hidden">
        <Tabs
          value={tab}
          onChange={setTab}
          tabs={[
            { value: 'chat', label: 'Chat' },
            { value: 'info', label: t('common.details') },
          ]}
        />
        <div className="mt-3">{tab === 'chat' ? thread : info}</div>
      </div>
      <div className="hidden gap-4 lg:grid lg:grid-cols-[minmax(0,1fr)_380px]">
        {thread}
        <div className="scrollbar-thin max-h-[calc(100dvh-230px)] overflow-y-auto">{info}</div>
      </div>
    </div>
  );
}
