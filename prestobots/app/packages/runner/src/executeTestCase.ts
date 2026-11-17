import type { ChatMessage, StepResult, TestCase, TestResult } from '@ctp/shared';

import type { ChannelSession, ChatChannel } from './channels/types.ts';
import { StepError } from './channels/types.ts';
import { type Judge, evaluateStepChecks } from './checks.ts';
import { isAbortError } from './text.ts';

export interface ExecuteOptions {
  testCase: TestCase;
  channel: ChatChannel;
  runId: string;
  resultId: string;
  signal: AbortSignal;
  /** Evaluates AI-judge checks. Without it those checks are marked as skipped. */
  judge?: Judge;
  /** Called after every step, so the web page can show progress live. */
  onUpdate?: (result: TestResult) => void;
}

/**
 * Plays one test case: for each step the patient acts, the bot replies, and the step's checks are
 * evaluated. Stops at the first step that fails, because the rest of the conversation would be off
 * track.
 */
export const executeTestCase = async (options: ExecuteOptions): Promise<TestResult> => {
  const { testCase, channel, runId, resultId, signal, onUpdate, judge } = options;

  const result: TestResult = {
    id: resultId,
    runId,
    testCaseId: testCase.id,
    testCaseTitle: testCase.title,
    status: 'running',
    steps: [],
    setup: [],
    startedAt: new Date().toISOString(),
  };
  onUpdate?.(structuredClone(result));

  let session: ChannelSession | undefined;
  try {
    session = await channel.openSession();
    result.setup = await session.prepare(signal);
    result.conversationId = session.conversationId();

    let lastReplies: ChatMessage[] = result.setup.filter((message) => message.from === 'bot');

    for (const [index, step] of testCase.steps.entries()) {
      const startedAt = Date.now();
      const stepResult: StepResult = {
        index,
        action: step.action,
        sent: null,
        replies: [],
        checks: [],
        durationMs: 0,
      };
      result.steps.push(stepResult);

      try {
        stepResult.sent = await session.send(step.action, lastReplies, signal);
        stepResult.replies = await session.collectReplies(signal);
      } catch (error) {
        stepResult.durationMs = Date.now() - startedAt;
        if (error instanceof StepError) {
          stepResult.error = error.message;
          result.status = 'error';
          result.error = `Step ${index + 1}: ${error.message}`;
          break;
        }
        throw error;
      }

      const earlier = result.steps
        .slice(0, -1)
        .flatMap((previous) => [...(previous.sent ? [previous.sent] : []), ...previous.replies]);
      stepResult.checks = await evaluateStepChecks(
        step.expect,
        { earlier, patientMessage: stepResult.sent, replies: stepResult.replies, signal },
        judge
      );
      stepResult.durationMs = Date.now() - startedAt;
      result.conversationId = session.conversationId() ?? result.conversationId;
      lastReplies = stepResult.replies.filter((message) => message.from === 'bot');
      onUpdate?.(structuredClone(result));

      if (stepResult.checks.some((check) => !check.passed)) {
        result.status = 'failed';
        if (index < testCase.steps.length - 1) {
          result.error = `Stopped at step ${index + 1} of ${testCase.steps.length} because a check failed.`;
        }
        break;
      }
    }

    if (result.status === 'running') result.status = 'passed';
  } catch (error) {
    result.status = 'error';
    result.error = isAbortError(error)
      ? 'The run was cancelled while this test was in progress.'
      : error instanceof StepError
        ? error.message
        : `Unexpected problem: ${(error as Error).message}`;
  } finally {
    await session?.close().catch(() => undefined);
  }

  result.finishedAt = new Date().toISOString();
  onUpdate?.(structuredClone(result));
  return result;
};
