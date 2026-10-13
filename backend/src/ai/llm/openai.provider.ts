import { CircuitBreaker, fetchJson, isRetryableHttp, retry } from '../../common/utils/resilience';
import type { ChatMessage, LLMProvider, LLMRequest, LLMResponse } from './llm-provider';

interface OpenAIResponse {
  model: string;
  choices: { finish_reason: string; message: { content: string | null; tool_calls?: { id: string; function: { name: string; arguments: string } }[] } }[];
  usage?: { prompt_tokens: number; completion_tokens: number };
}

/** OpenAI Chat Completions with native function calling. */
export class OpenAIProvider implements LLMProvider {
  readonly name = 'openai' as const;
  private readonly breaker = new CircuitBreaker('OpenAI');

  constructor(
    private readonly apiKey: string,
    private readonly timeoutMs: number,
  ) {}

  static toMessages(system: string, messages: ChatMessage[]) {
    return [
      { role: 'system', content: system },
      ...messages.map((m) => {
        if (m.role === 'tool') return { role: 'tool', tool_call_id: m.toolCallId, content: m.content };
        if (m.role === 'assistant')
          return {
            role: 'assistant',
            content: m.content || null,
            ...(m.toolCalls?.length
              ? { tool_calls: m.toolCalls.map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: JSON.stringify(c.arguments) } })) }
              : {}),
          };
        return { role: 'user', content: m.content };
      }),
    ];
  }

  /**
   * GPT-4.x accepts `temperature`; reasoning-era models (GPT-5+, o-series) only accept the default, and
   * every current model takes `max_completion_tokens` instead of the legacy `max_tokens`.
   */
  static acceptsTemperature(model: string): boolean {
    return /^gpt-4/.test(model);
  }

  async complete(req: LLMRequest): Promise<LLMResponse> {
    const body = {
      model: req.model,
      ...(OpenAIProvider.acceptsTemperature(req.model) ? { temperature: req.temperature } : {}),
      max_completion_tokens: req.maxTokens,
      messages: OpenAIProvider.toMessages(req.system, req.messages),
      ...(req.tools.length
        ? { tools: req.tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } })), tool_choice: 'auto' }
        : {}),
    };
    const res = await this.breaker.exec(() =>
      retry(
        () =>
          fetchJson<OpenAIResponse>('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            service: 'OpenAI',
            timeoutMs: this.timeoutMs,
            headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          }),
        { retries: 2, baseDelayMs: 400, shouldRetry: isRetryableHttp },
      ),
    );
    const choice = res.choices[0];
    const toolCalls = (choice.message.tool_calls ?? []).map((c) => ({ id: c.id, name: c.function.name, arguments: safeJson(c.function.arguments) }));
    return {
      content: choice.message.content ?? '',
      toolCalls,
      usage: { inputTokens: res.usage?.prompt_tokens ?? 0, outputTokens: res.usage?.completion_tokens ?? 0 },
      model: res.model,
      finishReason: toolCalls.length ? 'tool_calls' : choice.finish_reason === 'length' ? 'length' : 'stop',
    };
  }
}

export function safeJson(s: string): Record<string, unknown> {
  try {
    const v = JSON.parse(s) as unknown;
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
