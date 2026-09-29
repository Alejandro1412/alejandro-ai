import { randomUUID } from 'node:crypto';
import { CircuitBreaker, fetchJson, isRetryableHttp, retry } from '../../common/utils/resilience';
import type { ChatMessage, JsonSchema, LLMProvider, LLMRequest, LLMResponse } from './llm-provider';

type Part =
  | { text: string }
  | { functionCall: { name: string; args: Record<string, unknown> } }
  | { functionResponse: { name: string; response: Record<string, unknown> } };

interface GeminiResponse {
  candidates?: { content?: { parts?: Part[] }; finishReason?: string }[];
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
  modelVersion?: string;
}

const UNSUPPORTED_KEYS = new Set(['$schema', 'additionalProperties', 'default', 'examples', '$defs', 'definitions', 'const']);

/** Gemini accepts an OpenAPI subset of JSON Schema: strip unsupported keywords recursively. */
export function toGeminiSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(toGeminiSchema);
  if (!schema || typeof schema !== 'object') return schema;
  return Object.fromEntries(
    Object.entries(schema as Record<string, unknown>)
      .filter(([k]) => !UNSUPPORTED_KEYS.has(k))
      .map(([k, v]) => [k, toGeminiSchema(v)]),
  );
}

/** Google Gemini generateContent with function declarations. */
export class GeminiProvider implements LLMProvider {
  readonly name = 'gemini' as const;
  private readonly breaker = new CircuitBreaker('Gemini');

  constructor(
    private readonly apiKey: string,
    private readonly timeoutMs: number,
  ) {}

  static toContents(messages: ChatMessage[]) {
    const out: { role: 'user' | 'model'; parts: Part[] }[] = [];
    for (const m of messages) {
      if (m.role === 'tool') {
        let response: Record<string, unknown>;
        try {
          const parsed = JSON.parse(m.content) as unknown;
          response = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : { result: parsed };
        } catch {
          response = { result: m.content };
        }
        const part: Part = { functionResponse: { name: m.name, response } };
        const last = out[out.length - 1];
        if (last?.role === 'user' && last.parts.every((p) => 'functionResponse' in p)) last.parts.push(part);
        else out.push({ role: 'user', parts: [part] });
      } else if (m.role === 'assistant') {
        const parts: Part[] = [];
        if (m.content) parts.push({ text: m.content });
        for (const c of m.toolCalls ?? []) parts.push({ functionCall: { name: c.name, args: c.arguments } });
        out.push({ role: 'model', parts: parts.length ? parts : [{ text: '…' }] });
      } else out.push({ role: 'user', parts: [{ text: m.content }] });
    }
    return out;
  }

  async complete(req: LLMRequest): Promise<LLMResponse> {
    const body = {
      systemInstruction: { parts: [{ text: req.system }] },
      contents: GeminiProvider.toContents(req.messages),
      generationConfig: { temperature: req.temperature, maxOutputTokens: req.maxTokens },
      ...(req.tools.length
        ? {
            tools: [
              {
                functionDeclarations: req.tools.map((t) => ({ name: t.name, description: t.description, parameters: toGeminiSchema(t.parameters) as JsonSchema })),
              },
            ],
          }
        : {}),
    };
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(req.model)}:generateContent`;
    const res = await this.breaker.exec(() =>
      retry(
        () =>
          fetchJson<GeminiResponse>(url, {
            method: 'POST',
            service: 'Gemini',
            timeoutMs: this.timeoutMs,
            headers: { 'x-goog-api-key': this.apiKey, 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          }),
        { retries: 2, baseDelayMs: 400, shouldRetry: isRetryableHttp },
      ),
    );
    const parts = res.candidates?.[0]?.content?.parts ?? [];
    const text = parts
      .filter((p): p is { text: string } => 'text' in p)
      .map((p) => p.text)
      .join('\n');
    const toolCalls = parts
      .filter((p): p is { functionCall: { name: string; args: Record<string, unknown> } } => 'functionCall' in p)
      .map((p) => ({ id: `gem_${randomUUID()}`, name: p.functionCall.name, arguments: p.functionCall.args ?? {} }));
    return {
      content: text,
      toolCalls,
      usage: { inputTokens: res.usageMetadata?.promptTokenCount ?? 0, outputTokens: res.usageMetadata?.candidatesTokenCount ?? 0 },
      model: res.modelVersion ?? req.model,
      finishReason: toolCalls.length ? 'tool_calls' : res.candidates?.[0]?.finishReason === 'MAX_TOKENS' ? 'length' : 'stop',
    };
  }
}
