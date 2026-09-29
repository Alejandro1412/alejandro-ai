import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { io, type Socket } from 'socket.io-client';
import { tokenStore } from './api';

let socket: Socket | null = null;
let currentToken: string | null = null;

function connect(token: string): Socket {
  if (socket && currentToken === token) return socket;
  socket?.disconnect();
  currentToken = token;
  socket = io({ path: '/socket.io', auth: { token }, transports: ['websocket', 'polling'], reconnectionDelayMax: 10_000 });
  return socket;
}

const EVENT_QUERIES: Record<string, string[][]> = {
  'appointment.changed': [['appointments'], ['analytics'], ['calendar'], ['doctors'], ['portal']],
  'conversation.updated': [['conversations'], ['analytics']],
  'message.created': [['conversations'], ['portal-chat']],
  'handoff.created': [['handoffs'], ['conversations'], ['analytics']],
  'handoff.updated': [['handoffs'], ['conversations']],
  'notification.created': [['notifications']],
  'knowledge.updated': [['knowledge']],
};

/** Live data: server events invalidate the affected queries so every open screen refreshes itself. */
export function useRealtime(enabled: boolean, onEvent?: (event: string, payload: Record<string, unknown>) => void) {
  const qc = useQueryClient();
  useEffect(() => {
    if (!enabled) return;
    let s: Socket | null = null;
    const handlers: [string, (p: Record<string, unknown>) => void][] = [];
    const bind = (token: string | null) => {
      if (!token) return;
      s = connect(token);
      for (const [event, keys] of Object.entries(EVENT_QUERIES)) {
        const h = (payload: Record<string, unknown>) => {
          keys.forEach((k) => void qc.invalidateQueries({ queryKey: k }));
          onEvent?.(event, payload);
        };
        s.on(event, h);
        handlers.push([event, h]);
      }
      const step = (p: Record<string, unknown>) => onEvent?.('agent.step', p);
      s.on('agent.step', step);
      handlers.push(['agent.step', step]);
    };
    bind(tokenStore.get());
    const unsub = tokenStore.subscribe((tok) => {
      handlers.forEach(([e, h]) => s?.off(e, h));
      handlers.length = 0;
      if (tok) bind(tok);
      else {
        socket?.disconnect();
        socket = null;
      }
    });
    return () => {
      handlers.forEach(([e, h]) => s?.off(e, h));
      unsub();
    };
  }, [enabled, qc, onEvent]);
}
