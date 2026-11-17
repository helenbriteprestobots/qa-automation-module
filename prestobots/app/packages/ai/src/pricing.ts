/**
 * Claude API list prices in USD per million tokens (from Anthropic's model docs, Nov 2026).
 * The platform uses them to estimate its own spend for the budget legend. Anthropic's invoice is
 * always the source of truth. Update this table when prices change.
 */
interface Price {
  input: number;
  output: number;
  cacheRead: number;
  /** 5-minute cache writes. */
  cacheWrite: number;
}

const PRICES: Record<string, Price> = {
  'claude-opus-5-5': { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
  'claude-sonnet-5-5': { input: 2, output: 10, cacheRead: 0.1, cacheWrite: 2.5 },
  'claude-haiku-5-5': { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 },
};

/** Claude Haiku 5.5 costs more when the prompt is over 100K tokens. */
const HAIKU_LONG_PROMPT: Price = { input: 0.5, output: 2.5, cacheRead: 0.05, cacheWrite: 0.625 };

/** Unknown models are priced like Opus, the most expensive model we use, so the legend never under-counts. */
const FALLBACK = PRICES['claude-opus-5-5']!;

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export const isKnownModel = (model: string): boolean => model in PRICES;

export const costUsd = (model: string, usage: TokenUsage): number => {
  const promptTokens = usage.inputTokens + usage.cacheReadTokens + usage.cacheWriteTokens;
  const price =
    model === 'claude-haiku-5-5' && promptTokens > 100_000 ? HAIKU_LONG_PROMPT : (PRICES[model] ?? FALLBACK);
  const perToken = (perMillion: number) => perMillion / 1_000_000;
  return (
    usage.inputTokens * perToken(price.input) +
    usage.outputTokens * perToken(price.output) +
    usage.cacheReadTokens * perToken(price.cacheRead) +
    usage.cacheWriteTokens * perToken(price.cacheWrite)
  );
};
