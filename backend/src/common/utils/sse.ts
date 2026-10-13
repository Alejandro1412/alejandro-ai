import type { Response } from 'express';
import { AppError } from '../errors/app-error';

type Send = (event: string, data: unknown) => void;

/**
 * Server-Sent Events over a POST response (EventSource cannot POST, the client reads the stream with
 * fetch). Emits `step` events while the agent works, `delta` chunks of the final answer, then `done`
 * with the same payload as the non-streaming endpoint. A client disconnect never aborts the turn:
 * the conversation is persisted regardless.
 */
export async function streamTurn<T extends { assistantMessage?: { content: string } | null }>(
  res: Response,
  run: (onStep: (e: unknown) => void) => Promise<T>,
  opts: { revealMs?: number } = {},
): Promise<void> {
  let closed = false;
  res.on('close', () => {
    closed = true;
  });
  res.status(200);
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // nginx / proxies: do not buffer
  res.flushHeaders();
  const send: Send = (event, data) => {
    if (!closed) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };
  const heartbeat = setInterval(() => !closed && res.write(': ping\n\n'), 15_000);
  try {
    const result = await run((e) => send('step', e));
    const text = result.assistantMessage?.content ?? '';
    if (text) {
      // Word-group chunks paced to read naturally (~1.2 s max for long answers).
      const words = text.split(/(\s+)/);
      const groups = Math.max(1, Math.ceil(words.length / 70));
      const delay = opts.revealMs ?? 14;
      for (let i = 0; i < words.length && !closed; i += groups) {
        send('delta', { text: words.slice(i, i + groups).join('') });
        if (delay) await new Promise((r) => setTimeout(r, delay));
      }
    }
    send('done', result);
  } catch (err) {
    const e = err instanceof AppError ? { code: err.code, message: err.message } : { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' };
    send('error', e);
  } finally {
    clearInterval(heartbeat);
    res.end();
  }
}
