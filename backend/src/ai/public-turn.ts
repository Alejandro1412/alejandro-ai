import type { TurnEvent, TurnResult } from './orchestrator/orchestrator.service';

/** Patient-facing shape of a turn: no observability trace (prompts, tool payloads) ever leaves for patients. */
export function publicTurn(r: TurnResult, welcome: unknown = null) {
  return {
    conversationId: r.conversationId,
    userMessage: { id: r.userMessage.id, role: 'USER' as const, content: r.userMessage.content, createdAt: r.userMessage.createdAt, attachments: [] },
    assistantMessage: r.assistantMessage,
    conversationStatus: r.conversationStatus,
    journey: r.journey,
    ...(welcome ? { welcome } : {}),
  };
}

/** Progress events patients may see: tool/status progress only (no policy decisions or internal reasons). */
export const publicStep = (onStep: (e: unknown) => void) => (e: TurnEvent) => {
  if (e.type !== 'policy') onStep(e);
};
