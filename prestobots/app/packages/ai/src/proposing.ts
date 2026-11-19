import { type BotMap, type FormSummary, type TestCase, type TestCaseDraft, describeAction, testCaseDraftSchema } from '@ctp/shared';
import { z } from 'zod/v4';

import type { AiClient } from './client.ts';
import { DRAFT_OUTPUT_SCHEMA, DRAFT_SYSTEM } from './drafting.ts';
import { costUsd } from './pricing.ts';

/** Everything the AI needs to propose new test cases. */
export interface ProposalRequest {
  mode: 'demo' | 'stage';
  map: BotMap;
  form?: FormSummary;
  existing: Array<Pick<TestCase, 'id' | 'title' | 'status' | 'story' | 'steps'>>;
  /** Proposals an admin rejected earlier: never propose them again. */
  rejected: Array<{ title: string; story: string; reason?: string }>;
  maxProposals: number;
}

export type Proposal = TestCaseDraft & { why: string };

const PROPOSE_TASK = `
## Your task now: propose new test cases

You get a map of the bot's menus, made by an explorer that started every conversation with "Hola" and tapped options. The map is the bot vocabulary: use only option texts that appear in it. The explorer did not tap risky options (confirming, cancelling, hand-over, appointment times); they are listed as skipped with the reason.

Propose test cases for what the bot can do that the existing test cases don't cover yet:
- Read the existing test cases first. Don't propose anything they already cover, even with other words.
- Never propose something similar to a rejected proposal.
- Mix menu journeys (choose actions following the map) and things a patient would type instead of tapping (say actions, e.g. "quiero turno con pediatría"), because real patients do both.
- A test may end at a risky option by checking that the bot offers it (offers_option), but must never choose it: on the real chatbot that could book, cancel or hand over for real.
- If the map shows the bot failing (errors, "no te entendí" to a menu option), a test for that is valuable.
- Prefer fewer, meaningful tests over many shallow ones. At most the number requested.
- why: one sentence in plain English for a non-technical admin: what this covers that wasn't tested.
- notes: plain-English notes for the admin, such as important things you could not test and why. Empty when there is nothing to say.`;

const PROPOSALS_OUTPUT_SCHEMA = z.object({
  proposals: z.array(DRAFT_OUTPUT_SCHEMA.extend({ why: z.string() })),
  notes: z.array(z.string()),
});
export { PROPOSALS_OUTPUT_SCHEMA };

const truncate = (text: string, max: number): string => (text.length > max ? `${text.slice(0, max)}…` : text);

/** The menu map as plain text. */
export const mapToText = (map: BotMap): string =>
  map.nodes
    .map((node) => {
      const route = ['Hola', ...node.path].map((step) => `«${step}»`).join(' → ');
      const lines = [`PATH ${route}`];
      if (node.error) lines.push(`  ERROR: ${node.error}`);
      for (const reply of node.replies.filter((r) => r.from !== 'patient')) {
        const kind = reply.kind === 'text' ? '' : ` · ${reply.kind === 'flow' ? 'WhatsApp form' : reply.kind}`;
        lines.push(`  [${reply.from === 'bot' ? 'Bot' : reply.from}${kind}] ${truncate(reply.text.replace(/\s+/g, ' '), 300)}`);
        if (reply.options.length > 0) lines.push(`    options: ${reply.options.map((o) => `«${o.title}»`).join(' | ')}`);
      }
      for (const skipped of node.skipped) lines.push(`  skipped «${skipped.option}»: ${skipped.reason}`);
      return lines.join('\n');
    })
    .join('\n') + (map.truncated ? '\n(The explorer stopped at its limit: deeper paths were not explored.)' : '');

const formToText = (form: FormSummary): string =>
  [
    `WhatsApp form "${form.name}" (the runner cannot fill it; tests can only check that the bot offers it):`,
    ...form.screens.map((s) => `- ${s.title}${s.fields.length > 0 ? `: ${s.fields.join(', ')}` : ''}`),
  ].join('\n');

export const buildProposalPrompt = (input: ProposalRequest): { system: string; user: string } => {
  const user = [
    `<mode>${input.mode}${input.mode === 'demo' ? ' (a simulated demo bot, not the real chatbot)' : ''}</mode>`,
    '<bot_map>',
    mapToText(input.map),
    '</bot_map>',
    ...(input.form ? ['<whatsapp_form>', formToText(input.form), '</whatsapp_form>'] : []),
    '<existing_test_cases>',
    input.existing.length === 0
      ? '(none)'
      : input.existing
          .map((t) => `${t.id} [${t.status}] ${t.title}: ${t.story} Steps: ${t.steps.map((s) => describeAction(s.action)).join('; ')}`)
          .join('\n'),
    '</existing_test_cases>',
    '<rejected_proposals>',
    input.rejected.length === 0 ? '(none)' : input.rejected.map((r) => `- ${r.title}: ${r.story}${r.reason ? ` (rejected because: ${r.reason})` : ''}`).join('\n'),
    '</rejected_proposals>',
    `Propose at most ${input.maxProposals} new test cases.`,
  ].join('\n');
  return { system: `${DRAFT_SYSTEM}\n${PROPOSE_TASK}`, user };
};

/** Rough cost range of the writing step, shown to the admin before it starts. */
export const estimateProposalCost = (model: string, prompt: { system: string; user: string }): { lowUsd: number; highUsd: number } => {
  // About 3 characters per token for Spanish/English mixed text with JSON: errs on the high side.
  const inputTokens = Math.ceil((prompt.system.length + prompt.user.length) / 3);
  const cost = (outputTokens: number) => costUsd(model, { inputTokens, outputTokens, cacheReadTokens: 0, cacheWriteTokens: 0 });
  return { lowUsd: cost(3_000), highUsd: cost(16_000) };
};

export const proposeTestCases = async (
  ai: AiClient,
  input: ProposalRequest,
  signal?: AbortSignal
): Promise<{ proposals: Proposal[]; notes: string[] }> => {
  const prompt = buildProposalPrompt(input);
  const output = await ai.structured({
    purpose: 'generate_tests',
    model: ai.models.author,
    system: prompt.system,
    user: prompt.user,
    schema: PROPOSALS_OUTPUT_SCHEMA,
    maxTokens: 32_000,
    effort: 'medium',
    signal,
  });

  const notes = [...output.notes];
  const proposals: Proposal[] = [];
  for (const raw of output.proposals.slice(0, input.maxProposals)) {
    const parsed = testCaseDraftSchema.safeParse(raw);
    if (parsed.success) proposals.push({ ...parsed.data, why: raw.why });
    else notes.push(`One proposal ("${raw.title}") was incomplete and was left out.`);
  }
  return { proposals, notes };
};
