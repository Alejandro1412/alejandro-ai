/**
 * Provider-agnostic LLM contract. The orchestrator only speaks this language, so OpenAI,
 * Anthropic, Gemini (or the local mock) can be swapped per clinic without touching agent logic.
 */
export type JsonSchema = Record<string, unknown>;

export interface ToolSpec {
  name: string;
  description: string;
  parameters: JsonSchema;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export type ChatMessage =
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string; toolCalls?: ToolCall[] }
  | { role: 'tool'; toolCallId: string; name: string; content: string };

/** Structured signals computed by the orchestrator (intent, entities…). Real LLMs get them in the prompt too. */
export interface TurnHints {
  language: 'es' | 'en';
  intent: string;
  category: string;
  entities: Record<string, unknown>;
  patient: { id: string; name: string } | null;
  now: string;
  timezone: string;
  action: Record<string, unknown> | null;
  forcedTool: { name: string; args: Record<string, unknown> } | null;
  pending: Record<string, unknown> | null;
  catalog: { specialties: { id: string; name: string; nameEn: string | null }[] };
  clinicName: string;
  lastAssistantMessage: string | null;
}

export interface LLMRequest {
  system: string;
  messages: ChatMessage[];
  tools: ToolSpec[];
  model: string;
  temperature: number;
  maxTokens: number;
  hints: TurnHints;
}

export interface LLMUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface LLMResponse {
  content: string;
  toolCalls: ToolCall[];
  usage: LLMUsage;
  model: string;
  finishReason: 'stop' | 'tool_calls' | 'length' | 'error';
}

export interface LLMProvider {
  readonly name: 'mock' | 'openai' | 'anthropic' | 'gemini';
  complete(req: LLMRequest): Promise<LLMResponse>;
}

/** Rough token estimate (≈4 chars/token) used when a provider does not report usage. */
export const estimateTokens = (text: string) => Math.ceil(text.length / 4);
