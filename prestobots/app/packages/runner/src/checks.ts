import type { ChatMessage, Check, CheckResult } from '@ctp/shared';

import { includesNormalized } from './text.ts';

const quote = (value: string): string => `«${value}»`;

const listOptions = (replies: ChatMessage[]): string[] =>
  replies.flatMap((reply) => reply.options.map((option) => option.title));

/** Everything the bot "said": texts plus the labels of its buttons and list rows. */
const spokenText = (replies: ChatMessage[]): string =>
  replies.map((reply) => [reply.text, ...reply.options.map((o) => o.title)].join(' ')).join(' ');

const KIND_WORDS: Record<string, string> = {
  text: 'a text',
  buttons: 'buttons',
  list: 'a list',
  flow: 'a WhatsApp form',
  link: 'a link',
  media: 'a file or image',
  alert: 'a system notice',
  other: 'another kind of message',
};

/**
 * Evaluates the checks of one step against the bot's replies to that step.
 * Only messages written by the bot count; system notices are shown in the report but not checked.
 */
export const evaluateChecks = (checks: Check[], replies: ChatMessage[]): CheckResult[] => {
  const botReplies = replies.filter((reply) => reply.from === 'bot');
  const options = listOptions(botReplies);
  const offered = options.length > 0 ? options.map(quote).join(', ') : 'no options';

  return checks.map((check): CheckResult => {
    switch (check.type) {
      case 'bot_replied': {
        const passed = botReplies.length > 0;
        return {
          check,
          passed,
          detail: passed
            ? `The bot sent ${botReplies.length} message${botReplies.length === 1 ? '' : 's'}.`
            : 'The bot did not answer in time.',
        };
      }
      case 'offers_choices': {
        const passed = options.length > 0;
        return {
          check,
          passed,
          detail: passed ? `The bot offered ${offered}.` : 'The bot did not offer any buttons or list.',
        };
      }
      case 'reply_kind': {
        const kinds = [...new Set(botReplies.map((reply) => reply.kind))];
        const passed = kinds.includes(check.kind);
        return {
          check,
          passed,
          detail: passed
            ? `The bot replied with ${KIND_WORDS[check.kind]}.`
            : `Expected ${KIND_WORDS[check.kind]}; the bot sent ${
                kinds.length > 0 ? kinds.map((k) => KIND_WORDS[k]).join(' and ') : 'nothing'
              }.`,
        };
      }
      case 'offers_option': {
        const passed = options.some((title) => includesNormalized(title, check.option));
        return {
          check,
          passed,
          detail: passed
            ? `The bot offered ${quote(check.option)}.`
            : `Expected the option ${quote(check.option)}; the bot offered ${offered}.`,
        };
      }
      case 'mentions_any': {
        const text = spokenText(botReplies);
        const found = check.words.filter((word) => includesNormalized(text, word));
        const passed = found.length > 0;
        return {
          check,
          passed,
          detail: passed
            ? `The reply mentions ${found.map(quote).join(', ')}.`
            : `None of ${check.words.map(quote).join(', ')} appear in the reply.`,
        };
      }
      case 'mentions_none': {
        const text = spokenText(botReplies);
        const found = check.words.filter((word) => includesNormalized(text, word));
        const passed = found.length === 0;
        return {
          check,
          passed,
          detail: passed
            ? `The reply avoids ${check.words.map(quote).join(', ')}.`
            : `The reply mentions ${found.map(quote).join(', ')}, which it should not.`,
        };
      }
      case 'ai_judge':
        // Needs the AI; see evaluateStepChecks. Without a judge it is skipped, never failed.
        return { check, passed: true, skipped: true, detail: 'The AI judge is not available.' };
    }
  });
};

export interface JudgeInput {
  criteria: string;
  /** Everything said before this step (for context). */
  earlier: ChatMessage[];
  patientMessage: ChatMessage | null;
  replies: ChatMessage[];
  signal: AbortSignal;
}

export type JudgeOutcome = { verdict: 'pass' | 'fail'; reason: string } | { skipped: string };

/** Reads the bot's replies and decides whether they meet a criterion described in words. */
export interface Judge {
  judge(input: JudgeInput): Promise<JudgeOutcome>;
}

/**
 * Evaluates all checks of a step: rule checks right away, AI-judge checks through the judge.
 * If the bot sent nothing, AI-judge checks fail without calling the AI (nothing to judge).
 */
export const evaluateStepChecks = async (
  checks: Check[],
  context: Omit<JudgeInput, 'criteria'>,
  judge: Judge | undefined
): Promise<CheckResult[]> => {
  const base = evaluateChecks(checks, context.replies);
  const botReplied = context.replies.some((reply) => reply.from === 'bot');

  return Promise.all(
    base.map(async (result): Promise<CheckResult> => {
      if (result.check.type !== 'ai_judge') return result;
      if (!botReplied) {
        return { check: result.check, passed: false, detail: 'The bot did not answer, so there was nothing to judge.' };
      }
      if (!judge) return result;
      const outcome = await judge.judge({ ...context, criteria: result.check.criteria });
      if ('skipped' in outcome) {
        return { check: result.check, passed: true, skipped: true, detail: outcome.skipped };
      }
      return { check: result.check, passed: outcome.verdict === 'pass', detail: outcome.reason };
    })
  );
};
