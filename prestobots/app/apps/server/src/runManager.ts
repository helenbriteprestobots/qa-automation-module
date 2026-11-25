import { EventEmitter } from 'node:events';

import { BudgetExceededError } from '@ctp/ai';
import { type ChatChannel, executeTestCase } from '@ctp/runner';
import {
  type ChatbotMode,
  type Run,
  type RunCounts,
  type RunEvent,
  type TestCase,
  type TestCaseDraft,
  type TestResult,
  emptyCounts,
} from '@ctp/shared';

import type { RunAi } from './ai.ts';
import type { Store } from './db.ts';

export type ChannelFactory = () => Promise<ChatChannel & { dispose?: () => Promise<void> }>;

export class RunConflictError extends Error {}
export class RunInputError extends Error {}

/** Id used for "Try it" runs of a test case that is not saved yet. Never assigned to a real test case. */
export const TRIAL_TEST_CASE_ID = 'SAL-TRIAL-000';

const CANCELLED_ERROR = 'The run was cancelled while this test was in progress.';

const countResults = (results: TestResult[]): RunCounts => {
  const counts = emptyCounts(results.length);
  for (const result of results) {
    if (result.status === 'passed') counts.passed += 1;
    else if (result.status === 'failed') counts.failed += 1;
    else if (result.status === 'error') counts.error += 1;
    else if (result.status === 'skipped') counts.skipped += 1;
  }
  return counts;
};

/**
 * Runs test cases in the background, one run at a time (all tests share the same test patient),
 * saves every result as it happens and streams progress to the web page. When the AI is on, it also
 * judges replies during the run and explains failures at the end.
 */
export class RunManager {
  private active: { runId: string; controller: AbortController; done: Promise<void> } | null = null;
  private readonly events = new EventEmitter();
  /** Returns a reason when something else is using the chatbot (e.g. "Generate test cases"). */
  private blocker: () => string | null = () => null;

  constructor(
    private readonly store: Store,
    private readonly channelFactory: ChannelFactory,
    private readonly mode: ChatbotMode,
    private readonly defaultTarget: string,
    private readonly ai: () => RunAi | undefined = () => undefined
  ) {
    this.events.setMaxListeners(100);
  }

  setBlocker(blocker: () => string | null): void {
    this.blocker = blocker;
  }

  activeRunId(): string | null {
    return this.active?.runId ?? null;
  }

  /** Resolves when the current run (if any) has finished. */
  async whenIdle(): Promise<void> {
    await this.active?.done;
  }

  /** Marks runs left unfinished by a previous stop of the platform as interrupted. */
  recoverInterrupted(): void {
    for (const run of this.store.listUnfinishedRuns()) {
      const results = this.store.listResults(run.id).map((result, position) => {
        if (result.status !== 'pending' && result.status !== 'running') return result;
        const fixed: TestResult = {
          ...result,
          status: result.status === 'running' ? 'error' : 'skipped',
          error: result.status === 'running' ? 'The platform was stopped while this test was running.' : undefined,
        };
        this.store.saveResult(fixed, position);
        return fixed;
      });
      this.store.saveRun({ ...run, status: 'interrupted', counts: countResults(results) });
    }
  }

  /** Runs saved test cases. */
  start(testCaseIds: string[]): Run {
    const unique = [...new Set(testCaseIds)];
    if (unique.length === 0) throw new RunInputError('Choose at least one test case.');
    const testCases = unique.map((id) => {
      const testCase = this.store.getTestCase(id);
      if (!testCase) throw new RunInputError(`Test case ${id} does not exist.`);
      return testCase;
    });
    return this.launch(testCases, false);
  }

  /** "Try it": runs a test case that is not saved yet. Its result stays out of every test case's history. */
  startTrial(draft: TestCaseDraft): Run {
    const now = new Date().toISOString();
    const { assumptions: _assumptions, ...rest } = draft;
    return this.launch(
      [{ ...rest, id: TRIAL_TEST_CASE_ID, status: 'proposed', origin: 'manual', createdAt: now, updatedAt: now }],
      true
    );
  }

  cancel(runId: string): boolean {
    if (this.active?.runId !== runId) return false;
    this.active.controller.abort();
    return true;
  }

  subscribe(runId: string, listener: (event: RunEvent) => void): () => void {
    const key = `run:${runId}`;
    this.events.on(key, listener);
    return () => this.events.off(key, listener);
  }

  private launch(testCases: TestCase[], trial: boolean): Run {
    if (this.active) {
      throw new RunConflictError(`Run #${this.active.runId} is still in progress. Wait for it to finish or cancel it.`);
    }
    const blocked = this.blocker();
    if (blocked) throw new RunConflictError(blocked);

    const run: Run = {
      id: this.store.nextRunId(),
      status: 'queued',
      mode: this.mode,
      target: this.defaultTarget,
      testCaseIds: testCases.map((t) => t.id),
      counts: emptyCounts(testCases.length),
      ...(trial ? { trial: true } : {}),
      createdAt: new Date().toISOString(),
    };
    this.store.saveRun(run);
    testCases.forEach((testCase, position) => {
      this.store.saveResult(this.blankResult(run.id, testCase, position, 'pending'), position);
    });

    const controller = new AbortController();
    const done = this.execute(run, testCases, controller.signal).finally(() => {
      this.active = null;
    });
    this.active = { runId: run.id, controller, done };
    return run;
  }

  private blankResult(runId: string, testCase: TestCase, position: number, status: TestResult['status']): TestResult {
    return {
      id: `${runId}-${position + 1}`,
      runId,
      testCaseId: testCase.id,
      testCaseTitle: testCase.title,
      status,
      steps: [],
      setup: [],
    };
  }

  private emit(event: RunEvent): void {
    const runId = event.type === 'run' ? event.run.id : event.result.runId;
    this.events.emit(`run:${runId}`, event);
  }

  private updateRun(run: Run, changes: Partial<Run>): Run {
    const updated = { ...run, ...changes, counts: countResults(this.store.listResults(run.id)) };
    this.store.saveRun(updated);
    this.emit({ type: 'run', run: updated });
    return updated;
  }

  private saveResult(result: TestResult, position: number): void {
    this.store.saveResult(result, position);
    this.emit({ type: 'result', result });
  }

  private async execute(initial: Run, testCases: TestCase[], signal: AbortSignal): Promise<void> {
    let run = this.updateRun(initial, { status: 'running', startedAt: new Date().toISOString() });
    const ai = this.ai();

    let channel: Awaited<ReturnType<ChannelFactory>> | undefined;
    try {
      channel = await this.channelFactory();
      run = this.updateRun(run, { target: channel.target });
    } catch (error) {
      const message = `Could not connect to the chatbot: ${(error as Error).message}`;
      testCases.forEach((testCase, position) => {
        this.saveResult(
          { ...this.blankResult(run.id, testCase, position, 'error'), error: message, finishedAt: new Date().toISOString() },
          position
        );
      });
      this.updateRun(run, { status: 'finished', summary: `No test could run. ${message}`, finishedAt: new Date().toISOString() });
      return;
    }

    try {
      let stopReason: string | undefined;
      for (const [position, testCase] of testCases.entries()) {
        if (signal.aborted) {
          this.saveResult(this.blankResult(run.id, testCase, position, 'skipped'), position);
          continue;
        }
        if (stopReason) {
          // The chatbot can't be used any more (e.g. the Google sign-in expired): skip the rest.
          this.saveResult({ ...this.blankResult(run.id, testCase, position, 'skipped'), error: stopReason }, position);
          continue;
        }
        const result = await executeTestCase({
          testCase,
          channel,
          runId: run.id,
          resultId: `${run.id}-${position + 1}`,
          signal,
          judge: ai?.judge,
          onUpdate: (update) => this.saveResult(update, position),
        });
        this.saveResult(result, position);
        run = this.updateRun(run, {});
        stopReason = channel.fatal?.();
      }
    } finally {
      await channel.dispose?.().catch(() => undefined);
    }

    if (ai && !signal.aborted) {
      run = await this.explainFailures(run, testCases, ai);
    }

    this.updateRun(run, { status: signal.aborted ? 'cancelled' : 'finished', finishedAt: new Date().toISOString() });
  }

  /** Asks the AI why each failed test failed, then for a summary. Never breaks the run. */
  private async explainFailures(run: Run, testCases: TestCase[], ai: RunAi): Promise<Run> {
    const results = this.store.listResults(run.id);
    const problems = results.filter(
      (result) => (result.status === 'failed' || result.status === 'error') && result.error !== CANCELLED_ERROR
    );
    if (problems.length === 0) return run;

    try {
      for (const result of problems) {
        const position = results.indexOf(result);
        const testCase = testCases[position];
        if (!testCase) continue;
        const analysis = await ai.analyze({ mode: run.mode, testCase, result });
        this.saveResult({ ...result, analysis }, position);
      }
      const summary = await ai.summarize(run, this.store.listResults(run.id));
      return this.updateRun(run, { summary });
    } catch (error) {
      const note =
        error instanceof BudgetExceededError
          ? 'Failure explanations were skipped: the monthly AI budget has been reached.'
          : `Failure explanations could not be written: ${(error as Error).message}`;
      return this.updateRun(run, { summary: note });
    }
  }
}
