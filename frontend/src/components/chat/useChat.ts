import { useCallback, useRef, useState } from 'react';
import { errorMessage } from '@/lib/api';
import type { ChatAction, Message, TurnResult, TurnTrace } from '@/types';

/**
 * Chat state machine shared by playground, portal and webchat: optimistic user message,
 * typing indicator, reply merge, and trace history for observability panels.
 */
export function useChat(send: (text: string, action: ChatAction | undefined, conversationId: string | null) => Promise<TurnResult>, initial: Message[] = []) {
  const [messages, setMessages] = useState<Message[]>(initial);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [typing, setTyping] = useState(false);
  const [traces, setTraces] = useState<TurnTrace[]>([]);
  const [status, setStatus] = useState<string>('ACTIVE');
  const [error, setError] = useState<string | null>(null);
  const convRef = useRef<string | null>(null);

  const submit = useCallback(
    async (text: string, action?: ChatAction) => {
      const temp: Message = { id: `tmp-${Date.now()}`, role: 'USER', content: text, attachments: [], createdAt: new Date().toISOString() };
      setMessages((m) => [...m, temp]);
      setTyping(true);
      setError(null);
      try {
        const res = await send(text, action, convRef.current);
        convRef.current = res.conversationId;
        setConversationId(res.conversationId);
        setStatus(res.conversationStatus);
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
      }
    },
    [send],
  );

  const reset = useCallback((seed: Message[] = []) => {
    convRef.current = null;
    setConversationId(null);
    setMessages(seed);
    setTraces([]);
    setStatus('ACTIVE');
    setError(null);
  }, []);

  const hydrate = useCallback((id: string, msgs: Message[], st: string) => {
    convRef.current = id;
    setConversationId(id);
    setMessages(msgs);
    setStatus(st);
  }, []);

  return { messages, setMessages, conversationId, typing, traces, status, error, submit, reset, hydrate };
}
