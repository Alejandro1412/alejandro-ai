import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import { HiOutlineArrowPath, HiOutlinePlay } from 'react-icons/hi2';
import { AgentAvatar } from '@/components/brand/Logo';
import { ChatThread } from '@/components/chat/ChatThread';
import { streamOrPost, useChat, type ChatSender } from '@/components/chat/useChat';
import { Button } from '@/components/ui/Button';
import { Badge, Card, Segmented, Tabs } from '@/components/ui/Display';
import { Field, Select } from '@/components/ui/Field';
import { useToast } from '@/components/ui/Toast';
import { useAuth } from '@/contexts/AuthContext';
import { usePreferences, useT } from '@/contexts/PreferencesContext';
import { api } from '@/lib/api';
import { cn, fullName } from '@/lib/format';
import { useRealtime } from '@/lib/realtime';
import type { AgentStep, Message, Patient, TurnResult } from '@/types';
import { TracePanel } from './TracePanel';

interface Scenario {
  id: string;
  title: string;
  description: string;
  patientId: string | null;
  messages: string[];
}

export default function PlaygroundPage() {
  const t = useT();
  const { prefs } = usePreferences();
  const { me } = useAuth();
  const toast = useToast();
  const [patientId, setPatientId] = useState<string>('');
  const [lang, setLang] = useState<'es' | 'en'>(prefs.lang);
  const [selectedTurn, setSelectedTurn] = useState<number | null>(null);
  const [mobileTab, setMobileTab] = useState<'chat' | 'trace' | 'setup'>('chat');
  const [live, setLive] = useState<{ name: string; type: string }[]>([]);
  const patientRef = useRef(patientId);
  patientRef.current = patientId;

  const scenarios = useQuery({ queryKey: ['ai', 'scenarios'], queryFn: () => api.get<Scenario[]>('/ai/playground/scenarios') });
  const patients = useQuery({ queryKey: ['patients', 'playground'], queryFn: () => api.page<Patient>('/patients', { pageSize: 50 }) });

  const send = useCallback<ChatSender>(
    (text, action, conversationId, live) => {
      const body = { message: text, action, conversationId: conversationId ?? undefined, patientId: conversationId ? undefined : patientRef.current || null, language: lang };
      return streamOrPost(
        (h) => api.stream<TurnResult>('/ai/chat/stream', body, (event, data) => (event === 'step' ? h.onStep(data as AgentStep) : event === 'delta' && h.onDelta((data as { text: string }).text))),
        () => api.post<TurnResult>('/ai/chat', body),
        live,
      );
    },
    [lang],
  );
  const chat = useChat(send);
  const onFeedback = useCallback(
    (m: Message, value: 1 | -1 | null) => {
      if (!chat.conversationId) return;
      chat.setFeedback(m.id, value);
      void api.post(`/conversations/${chat.conversationId}/messages/${m.id}/feedback`, { value }).catch(() => chat.setFeedback(m.id, m.feedback ?? null));
    },
    [chat],
  );

  // Live system events (tool calls) streamed over the socket while the agent works.
  const onEvent = useCallback(
    (event: string, p: Record<string, unknown>) => {
      if (event === 'agent.step' && (!chat.conversationId || p.conversationId === chat.conversationId)) setLive((l) => [...l.slice(-12), { name: String(p.name), type: String(p.type) }]);
    },
    [chat.conversationId],
  );
  useRealtime(Boolean(me), onEvent);
  useEffect(() => {
    if (chat.typing) setLive([]);
    else setSelectedTurn(null);
  }, [chat.typing]);
  useEffect(() => {
    if (chat.error) toast.error(t('chat.errorSend'), chat.error);
  }, [chat.error, toast, t]);

  const runScenario = async (s: Scenario) => {
    setPatientId(s.patientId ?? '');
    patientRef.current = s.patientId ?? '';
    chat.reset();
    setMobileTab('chat');
    for (const m of s.messages) await chat.submit(m);
  };

  const trace = chat.traces[selectedTurn ?? chat.traces.length - 1];
  const handedOff = chat.status === 'HANDOFF';

  const setup = (
    <div className="space-y-5 p-4 sm:p-5">
      <Field label={t('playground.patient')}>
        <Select
          value={patientId}
          onChange={(e) => {
            setPatientId(e.target.value);
            chat.reset();
          }}
        >
          <option value="">{t('playground.anonymous')}</option>
          {patients.data?.items.map((p) => (
            <option key={p.id} value={p.id}>
              {fullName(p)}
            </option>
          ))}
        </Select>
      </Field>
      <div>
        <p className="label">{t('playground.language')}</p>
        <Segmented
          label={t('playground.language')}
          value={lang}
          onChange={setLang}
          options={[
            { value: 'es', label: 'Español' },
            { value: 'en', label: 'English' },
          ]}
        />
      </div>
      <Button variant="secondary" className="w-full" icon={<HiOutlineArrowPath aria-hidden="true" />} onClick={() => chat.reset()}>
        {t('playground.newConversation')}
      </Button>
      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-3">{t('playground.scenarios')}</p>
        <ul className="space-y-2">
          {scenarios.data?.map((s) => (
            <li key={s.id}>
              <button type="button" disabled={chat.typing} onClick={() => void runScenario(s)} className="group w-full rounded-xl border border-border bg-surface p-3 text-left transition hover:border-primary hover:bg-primary-soft disabled:opacity-60">
                <span className="flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold text-ink">{s.title}</span>
                  <HiOutlinePlay className="text-ink-3 group-hover:text-primary" aria-hidden="true" />
                </span>
                <span className="mt-1 block text-xs text-ink-3">{s.description}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );

  const tracePanel = (
    <div>
      {chat.traces.length > 1 && (
        <div className="scrollbar-thin flex gap-1 overflow-x-auto border-b border-border px-4 py-2" role="group" aria-label={t('playground.turns')}>
          {chat.traces.map((tr, i) => (
            <button
              key={tr.requestId}
              type="button"
              onClick={() => setSelectedTurn(i)}
              className={cn('whitespace-nowrap rounded-lg px-2.5 py-1 text-xs font-medium', (selectedTurn ?? chat.traces.length - 1) === i ? 'bg-primary text-primary-fg' : 'bg-surface-2 text-ink-2')}
            >
              #{i + 1} {tr.intent}
            </button>
          ))}
        </div>
      )}
      <TracePanel trace={chat.typing ? undefined : trace} live={live} />
    </div>
  );

  const chatPanel = (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-3 border-b border-border px-4 py-3">
        <AgentAvatar size={36} online />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">Alejandro AI</p>
          <p className="truncate text-xs text-ink-3">{patientId ? fullName(patients.data?.items.find((p) => p.id === patientId)) : t('playground.anonymous')}</p>
        </div>
        <Badge tone={handedOff ? 'warning' : 'success'} dot>
          {handedOff ? t('conversations.aiPaused') : t('conversations.aiActive')}
        </Badge>
      </div>
      {handedOff && <p className="bg-warning-soft px-4 py-2 text-xs text-warning">{t('playground.handoffBanner')}</p>}
      <ChatThread
        messages={chat.messages as Message[]}
        typing={chat.typing}
        live={chat.live}
        journey={chat.journey}
        onFeedback={onFeedback}
        onSend={(text, action) => void chat.submit(text, action)}
        emptyHint={t('playground.placeholder')}
        showDisclaimer={false}
      />
    </div>
  );

  return (
    <div className="space-y-4">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold sm:text-[1.7rem]">{t('playground.title')}</h1>
        <p className="text-[0.95rem] text-ink-2">{t('playground.subtitle')}</p>
      </header>

      {/* Mobile / tablet: tabbed */}
      <div className="xl:hidden">
        <Tabs
          value={mobileTab}
          onChange={setMobileTab}
          tabs={[
            { value: 'chat', label: 'Chat' },
            { value: 'trace', label: t('playground.debug'), count: chat.traces.length || undefined },
            { value: 'setup', label: t('playground.scenario') },
          ]}
        />
        <Card className="mt-3 overflow-hidden">
          {mobileTab === 'chat' && <div className="flex h-[calc(100dvh-270px)] min-h-[420px] flex-col">{chatPanel}</div>}
          {mobileTab === 'trace' && tracePanel}
          {mobileTab === 'setup' && setup}
        </Card>
      </div>

      {/* Desktop: three panes */}
      <div className="hidden h-[calc(100dvh-190px)] min-h-[560px] grid-cols-[280px_minmax(0,1fr)_380px] gap-4 xl:grid">
        <Card className="scrollbar-thin overflow-y-auto">{setup}</Card>
        <Card className="flex min-h-0 flex-col overflow-hidden">{chatPanel}</Card>
        <Card className="scrollbar-thin overflow-y-auto">
          <div className="border-b border-border px-5 py-3.5">
            <h2 className="text-sm font-semibold">{t('playground.debug')}</h2>
          </div>
          {tracePanel}
        </Card>
      </div>
    </div>
  );
}
