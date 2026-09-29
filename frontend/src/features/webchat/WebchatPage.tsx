import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { AgentAvatar, Isotype } from '@/components/brand/Logo';
import { ChatThread } from '@/components/chat/ChatThread';
import { useChat } from '@/components/chat/useChat';
import { EmptyState, Skeleton } from '@/components/ui/Feedback';
import { usePreferences, useT } from '@/contexts/PreferencesContext';
import { A11yButton, LangSwitch } from '@/layouts/Controls';
import { api } from '@/lib/api';
import type { ChatAction, Message, TurnResult } from '@/types';

const KEY = (slug: string) => `aai.webchat.${slug}`;
interface Session {
  sessionToken: string;
  conversationId: string;
}

function loadSession(slug: string): Session | null {
  try {
    return JSON.parse(sessionStorage.getItem(KEY(slug)) ?? 'null') as Session | null;
  } catch {
    return null;
  }
}

/** Public, embeddable webchat (iframe-friendly). Session token is per browser tab and never grants staff data. */
export default function WebchatPage() {
  const { slug = '' } = useParams();
  const t = useT();
  const { prefs } = usePreferences();
  const profile = useQuery({ queryKey: ['public', slug], queryFn: () => api.get<{ clinic: { name: string }; agent: { name: string } | null }>(`/public/clinics/${slug}`) });
  const session = useRef<Session | null>(loadSession(slug));
  const [ready, setReady] = useState(false);

  const send = useCallback(
    async (text: string, action: ChatAction | undefined): Promise<TurnResult> => {
      if (!session.current) throw new Error('No session');
      return api.post<TurnResult>(`/public/chat/${slug}/messages`, { message: text, action }, { headers: { 'X-Chat-Session': session.current.sessionToken }, anonymous: true });
    },
    [slug],
  );
  const chat = useChat(send);
  const { hydrate } = chat;

  useEffect(() => {
    let alive = true;
    (async () => {
      if (session.current) {
        try {
          const h = await api.request<{ conversationId: string; status: string; messages: Message[] }>(`/public/chat/${slug}/messages`, { headers: { 'X-Chat-Session': session.current.sessionToken }, anonymous: true });
          if (alive) hydrate(h.data.conversationId, h.data.messages, h.data.status);
          if (alive) setReady(true);
          return;
        } catch {
          session.current = null;
        }
      }
      const s = await api.post<Session & { welcome: Message }>(`/public/chat/${slug}/session`, { language: prefs.lang }, { anonymous: true });
      session.current = { sessionToken: s.sessionToken, conversationId: s.conversationId };
      try {
        sessionStorage.setItem(KEY(slug), JSON.stringify(session.current));
      } catch {
        /* storage unavailable — session lives in memory for this tab */
      }
      if (alive) {
        hydrate(s.conversationId, [s.welcome], 'ACTIVE');
        setReady(true);
      }
    })().catch(() => setReady(true));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug]);

  if (profile.isError) return <EmptyState title={t('errors.notFound')} body={t('errors.notFoundBody')} className="min-h-dvh" />;

  return (
    <div className="flex h-dvh flex-col bg-bg">
      <header className="flex items-center gap-3 border-b border-border bg-surface px-4 py-3">
        <AgentAvatar size={40} online />
        <div className="min-w-0 flex-1">
          {profile.isLoading ? <Skeleton className="h-4 w-40" /> : <p className="truncate font-semibold">{profile.data?.agent?.name ?? 'Alejandro AI'}</p>}
          <p className="truncate text-xs text-ink-3">{profile.data?.clinic.name}</p>
        </div>
        <LangSwitch compact />
        <A11yButton />
      </header>
      <main id="main" className="flex min-h-0 flex-1 flex-col">
        {ready ? <ChatThread messages={chat.messages} typing={chat.typing} onSend={(text, action) => void chat.submit(text, action)} composerDisabledReason={chat.status === 'HANDOFF' ? t('chat.humanActive') : undefined} /> : <Skeleton className="m-4 h-32" />}
      </main>
      <footer className="flex items-center justify-center gap-1.5 border-t border-border bg-surface py-1.5 text-[0.65rem] text-ink-3">
        <Isotype size={12} /> Powered by Alejandro AI
      </footer>
    </div>
  );
}
