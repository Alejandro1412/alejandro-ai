import { Injectable } from '@nestjs/common';
import { env } from '../../config/env';
import { AnthropicProvider } from './anthropic.provider';
import { GeminiProvider } from './gemini.provider';
import type { LLMProvider } from './llm-provider';
import { MockLLMProvider } from './mock.provider';
import { OpenAIProvider } from './openai.provider';
import { SUPPORTED_MODELS } from './pricing';

export type ProviderName = 'mock' | 'openai' | 'anthropic' | 'gemini';

/**
 * Resolves the provider configured for a clinic. API keys live only in the backend environment;
 * if a clinic selects a provider whose key is not configured, the platform degrades to the mock
 * provider and says so in the trace (never silently calls an unconfigured vendor).
 */
@Injectable()
export class LLMFactory {
  private readonly cache = new Map<ProviderName, LLMProvider>();

  availability(): Record<ProviderName, boolean> {
    const e = env();
    return { mock: true, openai: Boolean(e.OPENAI_API_KEY), anthropic: Boolean(e.ANTHROPIC_API_KEY), gemini: Boolean(e.GEMINI_API_KEY) };
  }

  resolve(requested: string, model: string): { provider: LLMProvider; model: string; fallback: boolean } {
    const name = (['mock', 'openai', 'anthropic', 'gemini'].includes(requested) ? requested : 'mock') as ProviderName;
    if (!this.availability()[name]) return { provider: this.get('mock'), model: SUPPORTED_MODELS.mock[0], fallback: name !== 'mock' };
    return { provider: this.get(name), model: model || SUPPORTED_MODELS[name][0], fallback: false };
  }

  private get(name: ProviderName): LLMProvider {
    let p = this.cache.get(name);
    if (!p) {
      const e = env();
      const timeout = e.AI_REQUEST_TIMEOUT_MS;
      p =
        name === 'openai'
          ? new OpenAIProvider(e.OPENAI_API_KEY!, timeout)
          : name === 'anthropic'
            ? new AnthropicProvider(e.ANTHROPIC_API_KEY!, timeout)
            : name === 'gemini'
              ? new GeminiProvider(e.GEMINI_API_KEY!, timeout)
              : new MockLLMProvider();
      this.cache.set(name, p);
    }
    return p;
  }
}
