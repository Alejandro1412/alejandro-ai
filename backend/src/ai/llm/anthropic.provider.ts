import { CircuitBreaker, fetchJson, isRetryableHttp, retry } from '../../common/utils/resilience';
import type { ChatMessage, LLMProvider, LLMRequest, LLMResponse } from './llm-provider';

type Block =
  | { type: 'text'; text: string }
  | { type: 'thinking'; thinking: string; signature?: string }
  | { type: 'redacted_thinking'; data: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id: string; content: string };

interface AnthropicResponse {
  model: string;
  stop_reason: string;
  content: Block[];
  usage: { input_tokens: number; output_tokens: number };
}

/**
 * Claude 5.x models (Sonnet/Opus/Fable/Mythos 5+) reject non-default sampling parameters and run
 * adaptive thinking by default. For a receptionist we want low latency, so thinking is kept to the
 * minimum ("between_tools") with low effort. Older models (Haiku 4.5, 3.x) still accept temperature.
 */
export function isClaude5Plus(model: string): boolean {
  const m = /^claude-(?:[a-z]+)-(\d+)/.exec(model);
  return Boolean(m && Number(m[1]) >= 5);
}

/** Anthropic Messages API with tool use. Tool results are grouped into a single user turn as required. */
export class AnthropicProvider implements LLMProvider {
  readonly name = 'anthropic' as const;
  private readonly breaker = new CircuitBreaker('Anthropic');

  constructor(
    private readonly apiKey: string,
    private readonly timeoutMs: number,
  ) {}

  static toMessages(messages: ChatMessage[]) {
    const out: { role: 'user' | 'assistant'; content: string | Block[] }[] = [];
    for (const m of messages) {
      if (m.role === 'tool') {
        const block: Block = { type: 'tool_result', tool_use_id: m.toolCallId, content: m.content };
        const last = out[out.length - 1];
        if (last?.role === 'user' && Array.isArray(last.content) && last.content.every((b) => b.type === 'tool_result')) last.content.push(block);
        else out.push({ role: 'user', content: [block] });
      } else if (m.role === 'assistant') {
        // Replay Claude's own blocks (including thinking + signatures) when we have them.
        if (m.raw?.provider === 'anthropic' && Array.isArray(m.raw.content)) {
          out.push({ role: 'assistant', content: m.raw.content as Block[] });
          continue;
        }
        const blocks: Block[] = [];
        if (m.content) blocks.push({ type: 'text', text: m.content });
        for (const c of m.toolCalls ?? []) blocks.push({ type: 'tool_use', id: c.id, name: c.name, input: c.arguments });
        if (!blocks.length) continue; // empty assistant turns are not allowed
        out.push({ role: 'assistant', content: blocks });
      } else {
        const last = out[out.length - 1];
        // Consecutive user turns are merged (the API requires alternation).
        if (last?.role === 'user' && typeof last.content === 'string') last.content = `${last.content}\n\n${m.content}`;
        else out.push({ role: 'user', content: m.content });
      }
    }
    return out;
  }

  static buildBody(req: LLMRequest) {
    const modern = isClaude5Plus(req.model);
    return {
      model: req.model,
      system: req.system,
      max_tokens: req.maxTokens,
      ...(modern ? { thinking: { type: 'between_tools' }, output_config: { effort: 'low' } } : { temperature: req.temperature }),
      messages: AnthropicProvider.toMessages(req.messages),
      ...(req.tools.length ? { tools: req.tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters })) } : {}),
    };
  }

  async complete(req: LLMRequest): Promise<LLMResponse> {
    const body = AnthropicProvider.buildBody(req);
    const res = await this.breaker.exec(() =>
      retry(
        () =>
          fetchJson<AnthropicResponse>('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            service: 'Anthropic',
            timeoutMs: this.timeoutMs,
            headers: { 'x-api-key': this.apiKey, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          }),
        { retries: 2, baseDelayMs: 400, shouldRetry: isRetryableHttp },
      ),
    );
    return AnthropicProvider.parse(res, req.model);
  }

  static parse(res: AnthropicResponse, requested: string): LLMResponse {
    const text = res.content
      .filter((b): b is Extract<Block, { type: 'text' }> => b.type === 'text')
      .map((b) => b.text)
      .join('\n');
    const toolCalls = res.content
      .filter((b): b is Extract<Block, { type: 'tool_use' }> => b.type === 'tool_use')
      .map((b) => ({ id: b.id, name: b.name, arguments: b.input ?? {} }));
    return {
      content: text,
      toolCalls,
      usage: { inputTokens: res.usage.input_tokens, outputTokens: res.usage.output_tokens },
      model: res.model ?? requested,
      finishReason: toolCalls.length ? 'tool_calls' : res.stop_reason === 'max_tokens' ? 'length' : res.stop_reason === 'refusal' ? 'refusal' : 'stop',
      raw: { provider: 'anthropic', content: res.content },
    };
  }
}
