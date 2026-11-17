import { z } from 'zod';

import { chatMessageSchema } from './chat.ts';
import { checkSchema, stepActionSchema } from './testCase.ts';

export const CHATBOT_MODES = ['demo', 'stage'] as const;
export type ChatbotMode = (typeof CHATBOT_MODES)[number];

export const RUN_STATUSES = ['queued', 'running', 'finished', 'interrupted', 'cancelled'] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

/**
 * passed  → every check was true
 * failed  → the bot answered, but at least one check was false
 * error   → the test could not be completed (bot did not answer in time, option not offered,
 *           connection problem…)
 * skipped → not run (the run was cancelled before reaching it)
 */
export const RESULT_STATUSES = ['pending', 'running', 'passed', 'failed', 'error', 'skipped'] as const;
export type ResultStatus = (typeof RESULT_STATUSES)[number];

export const checkResultSchema = z.object({
  check: checkSchema,
  passed: z.boolean(),
  /** Plain-words explanation of what was expected and what happened. */
  detail: z.string(),
  /** True when the check could not be evaluated (e.g. AI judge off or budget reached). Not a failure. */
  skipped: z.boolean().optional(),
});
export type CheckResult = z.infer<typeof checkResultSchema>;

export const stepResultSchema = z.object({
  index: z.number().int(),
  action: stepActionSchema,
  sent: chatMessageSchema.nullable(),
  replies: z.array(chatMessageSchema),
  checks: z.array(checkResultSchema),
  /** Set when the step could not be completed. */
  error: z.string().optional(),
  durationMs: z.number(),
});
export type StepResult = z.infer<typeof stepResultSchema>;

export const FAILURE_CATEGORIES = [
  'bot_misunderstood',
  'bot_wrong_answer',
  'bot_silent_or_slow',
  'test_out_of_date',
  'platform_problem',
  'unclear',
] as const;
export type FailureCategory = (typeof FAILURE_CATEGORIES)[number];

export const FAILURE_CATEGORY_LABELS: Record<FailureCategory, string> = {
  bot_misunderstood: 'The bot misunderstood the patient',
  bot_wrong_answer: 'The bot gave a wrong or incomplete answer',
  bot_silent_or_slow: 'The bot did not answer, or answered too late',
  test_out_of_date: 'The test seems out of date (the bot changed on purpose)',
  platform_problem: 'Problem in the testing platform or its connection',
  unclear: 'Unclear',
};

/** AI explanation of why a test failed. Reused later for Jira cards. */
export const failureAnalysisSchema = z.object({
  category: z.enum(FAILURE_CATEGORIES),
  explanation: z.string(),
  suggestion: z.string(),
});
export type FailureAnalysis = z.infer<typeof failureAnalysisSchema>;

export const testResultSchema = z.object({
  id: z.string(),
  runId: z.string(),
  testCaseId: z.string(),
  testCaseTitle: z.string(),
  status: z.enum(RESULT_STATUSES),
  steps: z.array(stepResultSchema),
  /** Messages exchanged before the test itself (e.g. the reset message). */
  setup: z.array(chatMessageSchema).default([]),
  error: z.string().optional(),
  /** Conversation id in the chatbot's database, for developers. */
  conversationId: z.string().optional(),
  /** AI explanation, only for failed or errored results. */
  analysis: failureAnalysisSchema.optional(),
  startedAt: z.string().optional(),
  finishedAt: z.string().optional(),
});
export type TestResult = z.infer<typeof testResultSchema>;

export const runCountsSchema = z.object({
  total: z.number(),
  passed: z.number(),
  failed: z.number(),
  error: z.number(),
  skipped: z.number(),
});
export type RunCounts = z.infer<typeof runCountsSchema>;

export const runSchema = z.object({
  id: z.string(),
  status: z.enum(RUN_STATUSES),
  mode: z.enum(CHATBOT_MODES),
  /** Human description of where it ran, e.g. "salud-stage · QA clinic". */
  target: z.string(),
  testCaseIds: z.array(z.string()),
  counts: runCountsSchema,
  /** A "Try it" run of a test case that is not saved yet. */
  trial: z.boolean().optional(),
  /** Plain-words summary, written by the AI when something failed. */
  summary: z.string().optional(),
  createdAt: z.string(),
  startedAt: z.string().optional(),
  finishedAt: z.string().optional(),
});
export type Run = z.infer<typeof runSchema>;

/** Events streamed to the web page while a run is in progress. */
export type RunEvent = { type: 'run'; run: Run } | { type: 'result'; result: TestResult };

export const emptyCounts = (total = 0): RunCounts => ({
  total,
  passed: 0,
  failed: 0,
  error: 0,
  skipped: 0,
});
