import { useCallback, useRef, useState } from 'react';
import { ApiError, errorMessage } from '@/lib/api';
import type { AgentStep, ChatAction, Journey, Message, TurnResult, TurnTrace } from '@/types';

/** What the user sees while the agent works: live tool steps, then the answer being written. */
export interface LiveTurn {
  steps: { key: string; label: string; done: boolean; ok: boolean }[];
  text: string;
}

export interface LiveHandlers {
  onStep: (s: AgentStep) => void;
  onDelta: (text: string) => void;
}

export type ChatSender = (text: string, action: ChatAction | undefined, conversationId: string | null, live: LiveHandlers) => Promise<TurnResult>;

/**
 * Chat state machine shared by playground, portal, webchat and the landing widget: optimistic user
 * message, live agent progress (streaming), reply merge, guided-journey state and trace history.
 */
export function useChat(send: ChatSender, initial: Message[] = []) {
  const [messages, setMessages] = useState<Message[]>(initial);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [typing, setTyping] = useState(false);
  const [live, setLive] = useState<LiveTurn | null>(null);
  const [traces, setTraces] = useState<TurnTrace[]>([]);
  const [status, setStatus] = useState<string>('ACTIVE');
  const [journey, setJourney] = useState<Journey | null>(null);
  const [error, setError] = useState<string | null>(null);
  const convRef = useRef<string | null>(null);

  const submit = useCallback(
    async (text: string, action?: ChatAction) => {
      const temp: Message = { id: `tmp-${Date.now()}`, role: 'USER', content: text, attachments: [], createdAt: new Date().toISOString() };
      setMessages((m) => [...m, temp]);
      setTyping(true);
      setLive({ steps: [], text: '' });
      setError(null);
      const handlers: LiveHandlers = {
        onStep: (s) =>
          setLive((l) => {
            if (!l) return l;
            if (s.type === 'tool') {
              if (s.phase === 'start') return { ...l, steps: [...l.steps, { key: s.name, label: s.name, done: false, ok: true }] };
              const steps = [...l.steps];
              const i = steps.map((x) => x.key).lastIndexOf(s.name);
              if (i >= 0) steps[i] = { ...steps[i], done: true, ok: s.status === 'SUCCESS' };
              return { ...l, steps };
            }
            return l;
          }),
        onDelta: (d) => setLive((l) => (l ? { ...l, text: l.text + d } : l)),
      };
      try {
        const res = await send(text, action, convRef.current, handlers);
        convRef.current = res.conversationId;
        setConversationId(res.conversationId);
        setStatus(res.conversationStatus);
        if (res.journey !== undefined) setJourney(res.journey ?? null);
        setMessages((m) => [
          ...(res.welcome ? [res.welcome] : []),
          ...m.filter((x) => x.id !== temp.id),
          { ...res.userMessage, attachments: [] },
          ...(res.assistantMessage ? [res.assistantMessage] : []),
        ]);
        if (res.trace) setTraces((t) => [...t, res.trace!]);
      } catch (err) {
        setMessages((m) => m.filter((x) => x.id !== temp.id));
        setError(errorMessage(err));
      } finally {
        setTyping(false);
        setLive(null);
      }
    },
    [send],
  );

  const setFeedback = useCallback((messageId: string, value: 1 | -1 | null) => {
    setMessages((m) => m.map((x) => (x.id === messageId ? { ...x, feedback: value } : x)));
  }, []);

  const reset = useCallback((seed: Message[] = []) => {
    convRef.current = null;
    setConversationId(null);
    setMessages(seed);
    setTraces([]);
    setStatus('ACTIVE');
    setJourney(null);
    setError(null);
  }, []);

  const hydrate = useCallback((id: string, msgs: Message[], st: string, j: Journey | null = null) => {
    convRef.current = id;
    setConversationId(id);
    setMessages(msgs);
    setStatus(st);
    setJourney(j);
  }, []);

  return { messages, setMessages, conversationId, typing, live, traces, status, journey, error, submit, reset, hydrate, setFeedback };
}

/**
 * Wraps a streaming endpoint with a transparent fallback to the classic JSON endpoint (old proxies,
 * networks that buffer SSE). Both return the same TurnResult.
 */
export async function streamOrPost(stream: (live: LiveHandlers) => Promise<TurnResult>, post: () => Promise<TurnResult>, live: LiveHandlers): Promise<TurnResult> {
  try {
    return await stream(live);
  } catch (err) {
    // Only when the stream never started (proxy without SSE, older backend). An interrupted stream is NOT
    // retried: the turn already ran on the server and re-posting would duplicate it.
    if (err instanceof ApiError && (err.code === 'STREAM_UNAVAILABLE' || [404, 405, 502, 504].includes(err.status))) return post();
    throw err;
  }
}
