/**
 * Estimated list prices in USD per 1M tokens (input / output). Used for cost tracking only —
 * update from provider pricing pages; unknown models fall back to a conservative default.
 */
const PRICES: Record<string, [number, number]> = {
  'alejandro-mock-1': [0, 0],
  'gpt-4o-mini': [0.15, 0.6],
  'gpt-4o': [2.5, 10],
  'gpt-4.1-mini': [0.4, 1.6],
  'gpt-4.1': [2, 8],
  'claude-3-5-haiku-latest': [0.8, 4],
  'claude-haiku-4-5': [1, 5],
  'claude-sonnet-4-5': [3, 15],
  'gemini-2.0-flash': [0.1, 0.4],
  'gemini-2.5-flash': [0.3, 2.5],
  'gemini-2.5-pro': [1.25, 10],
  'text-embedding-3-small': [0.02, 0],
};

const DEFAULT_PRICE: [number, number] = [1, 3];

/** Returns micro-USD (1e-6 USD). */
export function estimateCostMicroUsd(model: string, inputTokens: number, outputTokens: number): number {
  const [pin, pout] = PRICES[model] ?? (model.startsWith('local') ? [0, 0] : DEFAULT_PRICE);
  return Math.round(inputTokens * pin + outputTokens * pout);
}

export const SUPPORTED_MODELS: Record<'mock' | 'openai' | 'anthropic' | 'gemini', string[]> = {
  mock: ['alejandro-mock-1'],
  openai: ['gpt-4o-mini', 'gpt-4.1-mini', 'gpt-4o', 'gpt-4.1'],
  anthropic: ['claude-haiku-4-5', 'claude-sonnet-4-5', 'claude-3-5-haiku-latest'],
  gemini: ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-2.5-pro'],
};
