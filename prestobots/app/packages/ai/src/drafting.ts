import { AREAS, AREA_LABELS, REPLY_KINDS, type TestCaseDraft, testCaseDraftSchema } from '@ctp/shared';
import { z } from 'zod/v4';

import { AiError, type AiClient } from './client.ts';

/** What the bot has been seen saying recently, so the AI uses real option names. */
export interface BotVocabulary {
  mode: 'demo' | 'stage';
  options: string[];
  sampleReplies: string[];
}

export interface DraftRequest {
  /** The admin's words: a new story, or a change to apply. */
  request: string;
  /** The test case or draft being changed. Absent when writing a new one. */
  current?: TestCaseDraft;
  vocabulary: BotVocabulary;
  existing: Array<{ id: string; title: string }>;
}

const AREA_LINES = AREAS.map((area) => `- ${area}: ${AREA_LABELS[area]}`).join('\n');

export const DRAFT_SYSTEM = `You write automated test cases for the Cauce chatbot: a Spanish-language (Argentina) WhatsApp assistant that medical clinics use so patients can book, confirm or cancel appointments, ask questions, or reach a person.

A test case is a short patient story that a test runner plays against the bot, step by step. In each step the simulated patient does ONE action. The runner then waits for the bot's replies and evaluates that step's checks against those replies.

Actions:
- say {text}: the patient writes a message. Write it the way a real Argentine patient would, in Spanish.
- choose {option}: the patient taps a button or list option the bot offered in its replies to the PREVIOUS step. Matching ignores case and accents and accepts a partial match.

Checks (yes/no questions about the bot's replies to that step):
- bot_replied: the bot answered.
- offers_choices: the bot offered buttons or a list.
- reply_kind {kind}: the bot replied with text, buttons, list, flow (a WhatsApp form) or link.
- offers_option {option}: one of the offered buttons or list rows contains this text.
- mentions_any {words}: the reply (texts and option labels) contains at least one of these words or fragments. Matching ignores case and accents and works on fragments ("cancel" matches "cancelado").
- mentions_none {words}: the reply contains none of these.
- ai_judge {criteria}: an AI reads the reply and decides whether it meets the criteria, written in plain English. Use it for meaning ("asks which specialty the patient needs", "confirms the date and time of the appointment") that keywords can't capture reliably.

Areas:
${AREA_LINES}

How to write good test cases:
- Test what the bot achieves, not its exact wording. Prefer offers_choices, ai_judge and short word fragments over full sentences.
- Every step has at least one check.
- Keep it short: 1 to 6 steps. Begin a new conversation with "Hola", which starts the bot.
- Only use option texts that appear in the bot vocabulary below or that the request states explicitly. When you don't know the exact text of an option, use a "say" action instead and mention it in assumptions.
- WhatsApp forms (flows) can't be filled by the runner yet. Stop at checking that the bot offers the form (reply_kind flow) and mention it in assumptions.
- The runner can't make the bot send a reminder. Don't write tests that need a reminder first; explain this in assumptions if asked.
- title: short, in English, starting with "Patient". story: one or two sentences in Spanish that a non-technical reader understands. area: the best fitting area code.
- assumptions: plain English for a non-technical admin. List what you guessed and any part of the request you could not test, and why. Empty when there is nothing to say.
- When changing an existing test case, apply the requested change and keep everything else as it was unless the change requires otherwise.`;

const checkSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('bot_replied') }),
  z.object({ type: z.literal('offers_choices') }),
  z.object({ type: z.literal('reply_kind'), kind: z.enum(REPLY_KINDS) }),
  z.object({ type: z.literal('offers_option'), option: z.string() }),
  z.object({ type: z.literal('mentions_any'), words: z.array(z.string()) }),
  z.object({ type: z.literal('mentions_none'), words: z.array(z.string()) }),
  z.object({ type: z.literal('ai_judge'), criteria: z.string() }),
]);

export const DRAFT_OUTPUT_SCHEMA = z.object({
  title: z.string(),
  area: z.enum(AREAS),
  story: z.string(),
  steps: z.array(
    z.object({
      action: z.discriminatedUnion('type', [
        z.object({ type: z.literal('say'), text: z.string() }),
        z.object({ type: z.literal('choose'), option: z.string() }),
      ]),
      expect: z.array(checkSchema),
    })
  ),
  assumptions: z.array(z.string()),
});

const vocabularyBlock = (vocabulary: BotVocabulary): string => {
  if (vocabulary.options.length === 0 && vocabulary.sampleReplies.length === 0) {
    return `<bot_vocabulary mode="${vocabulary.mode}">\nNo conversations recorded yet: option names are unknown.\n</bot_vocabulary>`;
  }
  return [
    `<bot_vocabulary mode="${vocabulary.mode}">`,
    `Options the bot has offered: ${vocabulary.options.map((o) => `«${o}»`).join(', ') || '(none seen)'}`,
    'Sample bot messages:',
    ...vocabulary.sampleReplies.map((reply) => `- ${reply}`),
    '</bot_vocabulary>',
  ].join('\n');
};

export const draftTestCase = async (ai: AiClient, input: DraftRequest): Promise<TestCaseDraft> => {
  const user = [
    vocabularyBlock(input.vocabulary),
    '<existing_test_cases>',
    input.existing.map((t) => `${t.id} — ${t.title}`).join('\n') || '(none)',
    '</existing_test_cases>',
    ...(input.current
      ? ['<test_case_to_change>', JSON.stringify(input.current, null, 2), '</test_case_to_change>', '<change_requested>', input.request, '</change_requested>']
      : ['<new_test_case_request>', input.request, '</new_test_case_request>']),
  ].join('\n');

  const output = await ai.structured({
    purpose: 'write_test',
    model: ai.models.author,
    system: DRAFT_SYSTEM,
    user,
    schema: DRAFT_OUTPUT_SCHEMA,
    maxTokens: 16000,
    effort: 'medium',
  });

  const parsed = testCaseDraftSchema.safeParse(output);
  if (!parsed.success) {
    throw new AiError('The AI wrote a test case with missing parts. Try describing it differently.');
  }
  return parsed.data;
};
