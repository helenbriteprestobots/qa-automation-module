import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import type { z } from 'zod/v4';

import { type TokenUsage, costUsd } from './pricing.ts';

/** What the platform uses Claude for. Shown in the spending breakdown. */
export type AiPurpose = 'write_test' | 'judge' | 'analyze_failure' | 'summarize_run' | 'jira_card' | 'generate_tests';

export interface UsageEntry extends TokenUsage {
  at: string;
  purpose: AiPurpose;
  model: string;
  costUsd: number;
}

export interface UsageHooks {
  /** Throws BudgetExceededError when the monthly budget is used up. */
  assertBudget(): void;
  record(entry: UsageEntry): void;
}

export class BudgetExceededError extends Error {
  constructor() {
    super('The monthly AI budget has been reached. Raise it in Settings to use AI features again.');
    this.name = 'BudgetExceededError';
  }
}

/** An AI problem explained in plain words for admins. */
export class AiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AiError';
  }
}

export interface AiModels {
  /** Writes test cases, explains failures, summarises runs. */
  author: string;
  /** Judges replies (runs on many steps, so a cheaper model). */
  judge: string;
}

type Effort = 'low' | 'medium' | 'high';

interface CallOptions<T> {
  purpose: AiPurpose;
  model: string;
  system: string;
  user: string;
  schema: z.ZodType<T>;
  maxTokens: number;
  effort: Effort;
  signal?: AbortSignal;
}

const toPlainError = (error: unknown): Error => {
  if (error instanceof BudgetExceededError || error instanceof AiError) return error;
  if (error instanceof Anthropic.APIUserAbortError) {
    const abort = new Error('The run was cancelled');
    abort.name = 'AbortError';
    return abort;
  }
  if (error instanceof Anthropic.AuthenticationError) return new AiError('The Claude API key is not valid. Check ANTHROPIC_API_KEY in .env.');
  if (error instanceof Anthropic.PermissionDeniedError) return new AiError('The Claude API key is not allowed to use this model.');
  if (error instanceof Anthropic.RateLimitError) return new AiError('Claude is receiving too many requests right now. Try again in a minute.');
  if (error instanceof Anthropic.APIConnectionError) return new AiError('Could not reach Claude. Check the internet connection.');
  if (error instanceof Anthropic.InternalServerError) return new AiError('Claude is temporarily unavailable. Try again shortly.');
  if (error instanceof Anthropic.APIError) return new AiError(`Claude rejected the request: ${error.message}`);
  if (error instanceof Error && error.name === 'AbortError') return error;
  return new AiError(`Unexpected AI problem: ${(error as Error).message}`);
};

/** The one place that talks to Claude: budget check before, cost recording after. */
export class AiClient {
  private readonly anthropic: Anthropic;

  constructor(
    apiKey: string,
    readonly models: AiModels,
    private readonly usage: UsageHooks
  ) {
    this.anthropic = new Anthropic({ apiKey });
  }

  async structured<T>(options: CallOptions<T>): Promise<T> {
    this.usage.assertBudget();

    let response;
    try {
      response = await this.anthropic.messages.parse(
        {
          model: options.model,
          max_tokens: options.maxTokens,
          system: options.system,
          messages: [{ role: 'user', content: options.user }],
          output_config: { effort: options.effort, format: zodOutputFormat(options.schema) },
        },
        { signal: options.signal }
      );
    } catch (error) {
      throw toPlainError(error);
    }

    const usage: TokenUsage = {
      inputTokens: response.usage.input_tokens ?? 0,
      outputTokens: response.usage.output_tokens ?? 0,
      cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
      cacheWriteTokens: response.usage.cache_creation_input_tokens ?? 0,
    };
    this.usage.record({
      ...usage,
      at: new Date().toISOString(),
      purpose: options.purpose,
      model: options.model,
      costUsd: costUsd(options.model, usage),
    });

    if (response.stop_reason === 'refusal') {
      throw new AiError('Claude declined to answer this request.');
    }
    if (response.stop_reason === 'max_tokens') {
      throw new AiError('The AI answer was cut off because it was too long. Try a simpler request.');
    }
    if (response.parsed_output == null) {
      throw new AiError('The AI answer could not be read. Try again.');
    }
    return response.parsed_output as T;
  }
}
