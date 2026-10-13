/**
 * Estimated list prices in USD per 1M tokens (input / output). Used for cost tracking only —
 * update from provider pricing pages; unknown models fall back to a conservative default.
 */
const PRICES: Record<string, [number, number]> = {
  'alejandro-mock-1': [0, 0],
  'gpt-6.1-sol': [1, 5],
  'gpt-6-luna': [0.05, 0.25],
  'gpt-6-astra': [5, 25],
  'gpt-5-mini': [0.25, 2],
  'gpt-4o-mini': [0.15, 0.6],
  'gpt-4o': [2.5, 10],
  'gpt-4.1-mini': [0.4, 1.6],
  'gpt-4.1': [2, 8],
  'claude-3-5-haiku-latest': [0.8, 4],
  'claude-haiku-4-5': [1, 5],
  'claude-haiku-4-5-20251001': [1, 5],
  'claude-sonnet-5-5': [2, 10],
  'claude-opus-5-5': [4, 20],
  'claude-sonnet-4-5': [3, 15],
  'gemini-3.8-flash': [0.3, 2.5],
  'gemini-3.6-flash': [0.3, 2.5],
  'gemini-3.5-flash-lite': [0.1, 0.4],
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

/**
 * Suggested models per provider (first = default). Clinics can also type any other model id their
 * account has access to; the list only drives the settings UI and cost estimates.
 */
export const SUPPORTED_MODELS: Record<'mock' | 'openai' | 'anthropic' | 'gemini', string[]> = {
  mock: ['alejandro-mock-1'],
  openai: ['gpt-6.1-sol', 'gpt-6-luna', 'gpt-6-astra', 'gpt-4.1-mini'],
  anthropic: ['claude-sonnet-5-5', 'claude-haiku-4-5-20251001', 'claude-opus-5-5'],
  gemini: ['gemini-3.8-flash', 'gemini-3.5-flash-lite', 'gemini-3.6-flash'],
};

/** Model ids are free-form per provider but must look like a model id (no spaces, URLs or control chars). */
export const MODEL_ID = /^[a-z0-9][a-z0-9._:/-]{1,79}$/i;
