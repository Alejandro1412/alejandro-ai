import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import { streamOrPost, useChat, type ChatSender } from '@/components/chat/useChat';
import { usePreferences } from '@/contexts/PreferencesContext';
import { api } from '@/lib/api';
import type { AgentStep, Journey, Message, TurnResult } from '@/types';

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

export interface ClinicProfile {
  clinic: { name: string; phone: string | null; address: string | null; city: string | null };
  agent: { name: string } | null;
}

/**
 * Public webchat session for one clinic: an opaque per-tab token (stored hashed on the server),
 * streaming replies, history restore and thumbs feedback. Used by /chat/:slug, the embeddable
 * widget and the landing page demo. `enabled` lets the landing widget start the session lazily.
 */
export function useWebchat(slug: string, enabled = true) {
  const { prefs } = usePreferences();
  const profile = useQuery({ queryKey: ['public', slug], queryFn: () => api.get<ClinicProfile>(`/public/clinics/${slug}`), enabled: enabled && Boolean(slug) });
  const session = useRef<Session | null>(loadSession(slug));
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);

  const send = useCallback<ChatSender>(
    (text, action, _conversationId, live) => {
      if (!session.current) return Promise.reject(new Error('No session'));
      const opts = { headers: { 'X-Chat-Session': session.current.sessionToken }, anonymous: true };
      const body = { message: text, action };
      return streamOrPost(
        (h) => api.stream<TurnResult>(`/public/chat/${slug}/messages/stream`, body, (event, data) => (event === 'step' ? h.onStep(data as AgentStep) : event === 'delta' && h.onDelta((data as { text: string }).text)), opts),
        () => api.post<TurnResult>(`/public/chat/${slug}/messages`, body, opts),
        live,
      );
    },
    [slug],
  );
  const chat = useChat(send);
  const { hydrate, setFeedback } = chat;

  useEffect(() => {
    if (!enabled || !slug) return;
    let alive = true;
    (async () => {
      if (session.current) {
        try {
          const h = await api.request<{ conversationId: string; status: string; journey: Journey | null; messages: Message[] }>(`/public/chat/${slug}/messages`, { headers: { 'X-Chat-Session': session.current.sessionToken }, anonymous: true });
          if (alive) {
            hydrate(h.data.conversationId, h.data.messages, h.data.status, h.data.journey);
            setReady(true);
          }
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
    })().catch(() => {
      if (alive) {
        setFailed(true);
        setReady(true);
      }
    });
    return () => {
      alive = false;
    };
    // The session is created once per clinic; language changes apply to the next message.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug, enabled]);

  const onFeedback = useCallback(
    (m: Message, value: 1 | -1 | null) => {
      if (!session.current) return;
      setFeedback(m.id, value);
      void api.post(`/public/chat/${slug}/messages/${m.id}/feedback`, { value }, { headers: { 'X-Chat-Session': session.current.sessionToken }, anonymous: true }).catch(() => setFeedback(m.id, m.feedback ?? null));
    },
    [slug, setFeedback],
  );

  return { chat, profile, ready, failed, onFeedback };
}
