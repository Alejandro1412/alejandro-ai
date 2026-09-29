import { CircuitBreaker, fetchJson, isRetryableHttp, retry } from '../../common/utils/resilience';
import type { ChatMessage, LLMProvider, LLMRequest, LLMResponse } from './llm-provider';

type Block =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id: string; content: string };

interface AnthropicResponse {
  model: string;
  stop_reason: string;
  content: Block[];
  usage: { input_tokens: number; output_tokens: number };
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
        const blocks: Block[] = [];
        if (m.content) blocks.push({ type: 'text', text: m.content });
        for (const c of m.toolCalls ?? []) blocks.push({ type: 'tool_use', id: c.id, name: c.name, input: c.arguments });
        out.push({ role: 'assistant', content: blocks.length ? blocks : [{ type: 'text', text: '…' }] });
      } else {
        out.push({ role: 'user', content: m.content });
      }
    }
    return out;
  }

  async complete(req: LLMRequest): Promise<LLMResponse> {
    const body = {
      model: req.model,
      system: req.system,
      max_tokens: req.maxTokens,
      temperature: req.temperature,
      messages: AnthropicProvider.toMessages(req.messages),
      ...(req.tools.length ? { tools: req.tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters })) } : {}),
    };
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
      model: res.model,
      finishReason: toolCalls.length ? 'tool_calls' : res.stop_reason === 'max_tokens' ? 'length' : 'stop',
    };
  }
}
