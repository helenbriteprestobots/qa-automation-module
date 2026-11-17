import { transcriptToText } from '@ctp/ai';
import {
  FAILURE_CATEGORY_LABELS,
  type JiraIssueType,
  type Run,
  type TestCase,
  type TestResult,
  describeAction,
  describeCheck,
} from '@ctp/shared';

/** Jira descriptions are limited to about 32,000 characters. */
const MAX_CONVERSATION_CHARS = 18_000;

const statusWord = (result: TestResult, index: number): string => {
  const step = result.steps.find((s) => s.index === index);
  if (!step) return 'not reached';
  if (step.error) return `could not finish: ${step.error}`;
  const failed = step.checks.filter((c) => !c.passed && !c.skipped);
  if (failed.length === 0) return 'passed';
  return `FAILED. ${failed.map((c) => `Expected: ${describeCheck(c.check)}. Got: ${c.detail}`).join(' ')}`;
};

/** The first thing that went wrong, in plain words. Used when the AI doesn't write the problem. */
export const plainProblem = (result: TestResult): string => {
  if (result.analysis) return result.analysis.explanation;
  for (const step of result.steps) {
    const failed = step.checks.find((c) => !c.passed && !c.skipped);
    if (failed) {
      return `At step ${step.index + 1} (${describeAction(step.action)}), the test expected: ${describeCheck(failed.check)}. What happened: ${failed.detail}`;
    }
    if (step.error) return `At step ${step.index + 1} (${describeAction(step.action)}), the test could not continue: ${step.error}`;
  }
  return result.error ?? 'The test did not pass. See the conversation below.';
};

export const suggestedIssueType = (result: TestResult): JiraIssueType => {
  const category = result.analysis?.category;
  if (category === 'test_out_of_date' || category === 'platform_problem') return 'Task';
  if (!category && result.status === 'error' && result.steps.length === 0) return 'Task';
  return 'Bug';
};

export const cardTitle = (testCaseId: string, text: string, demo: boolean): string =>
  `${demo ? '[DEMO] ' : ''}[${testCaseId}] ${text.trim().replace(/\s+/g, ' ')}`.slice(0, 200);

export const cardDescription = (input: {
  run: Run;
  testCase: Pick<TestCase, 'id' | 'title' | 'story' | 'steps'>;
  result: TestResult;
  problem: string;
}): string => {
  const { run, testCase, result } = input;
  const conversation = transcriptToText([
    ...result.setup,
    ...result.steps.flatMap((step) => [...(step.sent ? [step.sent] : []), ...step.replies]),
  ]);
  const trimmed =
    conversation.length > MAX_CONVERSATION_CHARS
      ? `${conversation.slice(0, MAX_CONVERSATION_CHARS)}\n… (cut: the conversation is longer)`
      : conversation;

  const lines = [
    ...(run.mode === 'demo'
      ? ['This card comes from a run against the DEMO bot, a simulated bot inside the testing platform. It is not about the real chatbot.', '']
      : []),
    '## What went wrong',
    input.problem.trim(),
    '',
    '## Test case',
    `${testCase.id} · ${testCase.title}`,
    `Story: ${testCase.story}`,
    '',
    '## Steps',
    ...testCase.steps.map((step, i) => `- Step ${i + 1} · ${describeAction(step.action)}: ${statusWord(result, i)}`),
    ...(result.error && result.steps.length === 0 ? [`- The test could not start: ${result.error}`] : []),
    '',
    ...(result.analysis
      ? [
          '## Likely cause (written by AI)',
          `${FAILURE_CATEGORY_LABELS[result.analysis.category]}. ${result.analysis.explanation}`,
          `Suggested next step: ${result.analysis.suggestion}`,
          '',
        ]
      : []),
    '## Where it ran',
    `- Chatbot: ${run.target}`,
    `- Run #${run.id}, ${(result.finishedAt ?? run.finishedAt ?? run.createdAt).replace('T', ' ').slice(0, 16)} UTC`,
    ...(result.conversationId ? [`- Conversation id in the chatbot database: ${result.conversationId}`] : []),
    ...(run.mode === 'stage' ? ['- Messages sent by the testing platform have ids starting with "qa-".'] : []),
    '',
    '## Full conversation',
    '```',
    trimmed,
    '```',
    '',
    `Created by the Chatbot Testing Platform (result ${result.id}).`,
  ];
  return lines.join('\n');
};

/** Text added on top when the card is a comment on an earlier card. */
export const commentHeader = (run: Run, result: TestResult): string =>
  `Seen again in run #${run.id} (${(result.finishedAt ?? run.createdAt).replace('T', ' ').slice(0, 16)} UTC).`;
