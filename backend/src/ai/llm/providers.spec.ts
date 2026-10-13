import { resetEnvCache } from '../../config/env';
import { AnthropicProvider, isClaude5Plus } from './anthropic.provider';
import { GeminiProvider } from './gemini.provider';
import type { LLMRequest } from './llm-provider';
import { LLMFactory } from './llm.factory';
import { OpenAIProvider } from './openai.provider';

const baseReq = (model: string): LLMRequest => ({
  system: 'sys',
  model,
  temperature: 0.3,
  maxTokens: 500,
  tools: [{ name: 'getDoctors', description: 'List doctors', parameters: { type: 'object', properties: { specialty: { type: 'string' } } } }],
  messages: [{ role: 'user', content: 'Hola' }],
  hints: {} as LLMRequest['hints'],
});

const mockFetch = (body: unknown) => {
  const fn = jest.fn().mockResolvedValue(new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } }));
  global.fetch = fn as unknown as typeof fetch;
  return fn;
};
const sentBody = (fn: jest.Mock) => JSON.parse((fn.mock.calls[0][1] as RequestInit).body as string) as Record<string, unknown>;

describe('Anthropic provider', () => {
  it('detects Claude 5+ model ids', () => {
    expect(isClaude5Plus('claude-sonnet-5-5')).toBe(true);
    expect(isClaude5Plus('claude-opus-5-5')).toBe(true);
    expect(isClaude5Plus('claude-fable-5-1')).toBe(true);
    expect(isClaude5Plus('claude-haiku-4-5-20251001')).toBe(false);
    expect(isClaude5Plus('claude-3-5-haiku-latest')).toBe(false);
  });

  it('omits sampling params and keeps thinking minimal on Claude 5.x; sends temperature on older models', () => {
    const modern = AnthropicProvider.buildBody(baseReq('claude-sonnet-5-5')) as Record<string, unknown>;
    expect(modern).not.toHaveProperty('temperature');
    expect(modern.thinking).toEqual({ type: 'between_tools' });
    const legacy = AnthropicProvider.buildBody(baseReq('claude-haiku-4-5-20251001')) as Record<string, unknown>;
    expect(legacy.temperature).toBe(0.3);
    expect(legacy).not.toHaveProperty('thinking');
  });

  it('replays native blocks (thinking + signature) and merges consecutive user turns', () => {
    const raw = [
      { type: 'thinking', thinking: 'plan', signature: 'sig' },
      { type: 'tool_use', id: 't1', name: 'getDoctors', input: {} },
    ];
    const msgs = AnthropicProvider.toMessages([
      { role: 'user', content: 'a' },
      { role: 'user', content: 'b' },
      { role: 'assistant', content: '', toolCalls: [{ id: 't1', name: 'getDoctors', arguments: {} }], raw: { provider: 'anthropic', content: raw } },
      { role: 'tool', toolCallId: 't1', name: 'getDoctors', content: '{"ok":true}' },
    ]);
    expect(msgs[0]).toEqual({ role: 'user', content: 'a\n\nb' });
    expect(msgs[1]).toEqual({ role: 'assistant', content: raw });
    expect(msgs[2].role).toBe('user');
  });

  it('parses tool calls and keeps the raw content for the next iteration', async () => {
    const fn = mockFetch({
      model: 'claude-sonnet-5-5',
      stop_reason: 'tool_use',
      content: [
        { type: 'thinking', thinking: 'x', signature: 's' },
        { type: 'tool_use', id: 'tu_1', name: 'getDoctors', input: { specialty: 'Dermatología' } },
      ],
      usage: { input_tokens: 100, output_tokens: 20 },
    });
    const r = await new AnthropicProvider('key', 5000).complete(baseReq('claude-sonnet-5-5'));
    expect(fn).toHaveBeenCalledWith('https://api.anthropic.com/v1/messages', expect.anything());
    expect((fn.mock.calls[0][1] as RequestInit).headers).toMatchObject({ 'x-api-key': 'key', 'anthropic-version': '2023-06-01' });
    expect(r.toolCalls).toEqual([{ id: 'tu_1', name: 'getDoctors', arguments: { specialty: 'Dermatología' } }]);
    expect(r.finishReason).toBe('tool_calls');
    expect(r.content).toBe('');
    expect(r.raw?.provider).toBe('anthropic');
    expect(sentBody(fn).tools).toEqual([expect.objectContaining({ name: 'getDoctors', input_schema: expect.any(Object) })]);
  });

  it('maps refusals', async () => {
    mockFetch({ model: 'claude-sonnet-5-5', stop_reason: 'refusal', content: [{ type: 'text', text: 'No.' }], usage: { input_tokens: 1, output_tokens: 1 } });
    const r = await new AnthropicProvider('key', 5000).complete(baseReq('claude-sonnet-5-5'));
    expect(r.finishReason).toBe('refusal');
  });
});

describe('OpenAI provider', () => {
  it('uses max_completion_tokens and only sends temperature to GPT-4.x', async () => {
    const reply = { model: 'm', choices: [{ finish_reason: 'stop', message: { content: 'Hola' } }], usage: { prompt_tokens: 5, completion_tokens: 2 } };
    let fn = mockFetch(reply);
    await new OpenAIProvider('k', 5000).complete(baseReq('gpt-6.1-sol'));
    expect(sentBody(fn)).toMatchObject({ max_completion_tokens: 500 });
    expect(sentBody(fn)).not.toHaveProperty('temperature');
    expect(sentBody(fn)).not.toHaveProperty('max_tokens');
    fn = mockFetch(reply);
    await new OpenAIProvider('k', 5000).complete(baseReq('gpt-4.1-mini'));
    expect(sentBody(fn).temperature).toBe(0.3);
  });

  it('parses function calls', async () => {
    mockFetch({ model: 'm', choices: [{ finish_reason: 'tool_calls', message: { content: null, tool_calls: [{ id: 'c1', function: { name: 'getDoctors', arguments: '{"specialty":"Cardiología"}' } }] } }] });
    const r = await new OpenAIProvider('k', 5000).complete(baseReq('gpt-6.1-sol'));
    expect(r.toolCalls).toEqual([{ id: 'c1', name: 'getDoctors', arguments: { specialty: 'Cardiología' } }]);
  });
});

describe('Gemini provider', () => {
  it('echoes model parts with thought signatures and hides thought text', async () => {
    const parts = [
      { text: 'internal', thought: true },
      { functionCall: { name: 'getDoctors', args: {} }, thoughtSignature: 'sig' },
    ];
    mockFetch({ candidates: [{ content: { parts }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 1 } });
    const r = await new GeminiProvider('k', 5000).complete(baseReq('gemini-3.8-flash'));
    expect(r.content).toBe('');
    expect(r.toolCalls[0].name).toBe('getDoctors');
    const contents = GeminiProvider.toContents([
      { role: 'user', content: 'hola' },
      { role: 'assistant', content: '', toolCalls: r.toolCalls, raw: r.raw },
    ]);
    expect(contents[1]).toEqual({ role: 'model', parts });
  });
});

describe('LLMFactory', () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
    resetEnvCache();
  });

  it('keeps the mock when no key is configured and reports fallback for unconfigured vendors', () => {
    delete process.env.ANTHROPIC_API_KEY;
    process.env.AI_DEFAULT_PROVIDER = 'mock';
    resetEnvCache();
    const f = new LLMFactory();
    expect(f.resolve('mock', 'alejandro-mock-1').provider.name).toBe('mock');
    expect(f.resolve('anthropic', 'claude-sonnet-5-5')).toMatchObject({ fallback: true });
  });

  it('upgrades clinics on the mock to the platform default provider once its key exists', () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test';
    process.env.AI_DEFAULT_PROVIDER = 'anthropic';
    resetEnvCache();
    const r = new LLMFactory().resolve('mock', 'alejandro-mock-1');
    expect(r.provider.name).toBe('anthropic');
    expect(r.model).toBe('claude-sonnet-5-5');
    expect(r.fallback).toBe(false);
  });
});
