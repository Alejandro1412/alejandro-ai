import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect } from 'react';
import { AgentAvatar } from '@/components/brand/Logo';
import { ChatThread } from '@/components/chat/ChatThread';
import { streamOrPost, useChat, type ChatSender } from '@/components/chat/useChat';
import { Card } from '@/components/ui/Display';
import { useToast } from '@/components/ui/Toast';
import { usePreferences, useT } from '@/contexts/PreferencesContext';
import { api } from '@/lib/api';
import type { AgentStep, Journey, Message, TurnResult } from '@/types';

export default function PortalChat() {
  const t = useT();
  const { prefs } = usePreferences();
  const toast = useToast();
  const history = useQuery({ queryKey: ['portal-chat'], queryFn: () => api.get<{ conversationId: string; status: string; journey: Journey | null; messages: Message[] } | null>('/portal/chat'), staleTime: Infinity });
  const send = useCallback<ChatSender>(
    (text, action, conversationId, live) => {
      const body = { message: text, action, conversationId: conversationId ?? undefined, language: prefs.lang };
      return streamOrPost(
        (h) => api.stream<TurnResult>('/portal/chat/stream', body, (event, data) => (event === 'step' ? h.onStep(data as AgentStep) : event === 'delta' && h.onDelta((data as { text: string }).text))),
        () => api.post<TurnResult>('/portal/chat', body),
        live,
      );
    },
    [prefs.lang],
  );
  const chat = useChat(send);
  const { hydrate, setFeedback, conversationId } = chat;
  useEffect(() => {
    if (history.data && history.data.status !== 'CLOSED' && history.data.status !== 'RESOLVED') hydrate(history.data.conversationId, history.data.messages, history.data.status, history.data.journey);
  }, [history.data, hydrate]);
  const onFeedback = useCallback(
    (m: Message, value: 1 | -1 | null) => {
      if (!conversationId) return;
      setFeedback(m.id, value);
      if (value) toast.success(t('chat.thanksFeedback'));
      void api.post(`/portal/chat/${conversationId}/messages/${m.id}/feedback`, { value }).catch(() => setFeedback(m.id, m.feedback ?? null));
    },
    [conversationId, setFeedback, toast, t],
  );
  useEffect(() => {
    if (chat.error) toast.error(t('chat.errorSend'), chat.error);
  }, [chat.error, toast, t]);

  const intro: Message = { id: 'intro', role: 'ASSISTANT', content: t('chat.aiDisclaimer'), attachments: [], createdAt: new Date().toISOString() };

  return (
    <Card className="-mx-4 flex h-[calc(100dvh-160px)] flex-col overflow-hidden rounded-none border-x-0 sm:mx-0 sm:rounded-2xl sm:border-x lg:h-[calc(100dvh-120px)]">
      <div className="flex items-center gap-3 border-b border-border px-4 py-3">
        <AgentAvatar size={38} online />
        <div>
          <p className="text-sm font-semibold">Alejandro AI</p>
          <p className="text-xs text-accent-strong dark:text-accent">{chat.status === 'HANDOFF' ? t('chat.humanActive') : t('brand.tagline')}</p>
        </div>
      </div>
      <ChatThread
        messages={chat.messages.length ? chat.messages : [intro]}
        typing={chat.typing}
        live={chat.live}
        journey={chat.journey}
        onFeedback={onFeedback}
        onSend={(text, action) => void chat.submit(text, action)}
        showDisclaimer={false}
      />
    </Card>
  );
}
