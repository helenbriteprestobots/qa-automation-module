import { type ChannelSession, DemoChannel, STARTER_TEST_CASES, SignInExpiredError } from '@ctp/runner';
import { AiError } from '@ctp/ai';
import type { AiStatus, Run, TestCase, TestCaseDraft, TestResult } from '@ctp/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { type AiFacade, type RunAi, createAiFacade, currentMonth } from '../src/ai.ts';
import { buildApp } from '../src/app.ts';
import { GenerationManager } from '../src/generation/generationManager.ts';
import { createJiraService } from '../src/jira/service.ts';
import { Store } from '../src/db.ts';
import { RunManager, TRIAL_TEST_CASE_ID } from '../src/runManager.ts';

const DRAFT: TestCaseDraft = {
  title: 'Patient asks for a pediatrics appointment',
  area: 'BOOK',
  story: 'Un paciente pide turno con pediatría.',
  steps: [
    { action: { type: 'say', text: 'Hola' }, expect: [{ type: 'bot_replied' }] },
    { action: { type: 'say', text: 'Quiero sacar un turno' }, expect: [{ type: 'ai_judge', criteria: 'Asks which specialty' }] },
  ],
  assumptions: [],
};

/** A fake AI: no network, predictable answers, counts calls. */
const fakeRunAi = (verdict: 'pass' | 'fail' = 'pass') => {
  const calls = { judge: 0, analyze: 0, summarize: 0 };
  const runAi: RunAi = {
    judge: {
      judge: async () => {
        calls.judge += 1;
        return { verdict, reason: `Fake judge says ${verdict}.` };
      },
    },
    analyze: async () => {
      calls.analyze += 1;
      return { category: 'bot_misunderstood', explanation: 'Fake explanation.', suggestion: 'Fake suggestion.' };
    },
    summarize: async () => {
      calls.summarize += 1;
      return 'Fake summary.';
    },
  };
  return { runAi, calls };
};

const fakeFacade = (runAi?: RunAi): AiFacade => ({
  status: (): AiStatus => ({
    enabled: Boolean(runAi),
    models: { author: 'a', judge: 'j' },
    budget: { month: currentMonth(), spentUsd: 0, limitUsd: 20, level: 'ok' },
  }),
  breakdown: () => ({ month: currentMonth(), byPurpose: [], byModel: [] }),
  setBudget: () => undefined,
  draft: async ({ current }) => (current ? { ...current, title: 'Changed title' } : DRAFT),
  forRuns: () => runAi,
  jiraText: async () => {
    throw new AiError('AI is off');
  },
  estimateProposal: () => ({ lowUsd: 0.01, highUsd: 0.05 }),
  propose: async () => ({ proposals: [], notes: [] }),
});

let store: Store;
let runs: RunManager;
let app: Awaited<ReturnType<typeof buildApp>>;

const setup = async (runAi?: RunAi, facade: AiFacade = fakeFacade(runAi)) => {
  runs = new RunManager(store, async () => new DemoChannel({ replyDelayMs: 1 }), 'demo', 'Demo bot', () => runAi);
  app = await buildApp({
    store,
    runs,
    ai: facade,
    generations: new GenerationManager(store, async () => new DemoChannel({ replyDelayMs: 1 }), 'demo', facade, runs),
    jira: createJiraService({
      store,
      ai: facade,
      client: undefined,
      status: { configured: false, labels: [], problems: ['Missing: JIRA_SITE'] },
    }),
    status: async () => ({ mode: 'demo', target: 'Demo bot', ready: true, problems: [], notes: [] }),
  });
};

beforeEach(async () => {
  store = new Store(':memory:');
  STARTER_TEST_CASES.forEach((testCase) => store.saveTestCase(testCase));
  await setup();
});

afterEach(async () => {
  await runs.whenIdle();
  await app.close();
  store.close();
});

const runDetail = async (id: string) =>
  (await app.inject({ method: 'GET', url: `/api/runs/${id}` })).json<{ run: Run; results: TestResult[] }>();

describe('runs', () => {
  it('lists the starter test cases', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/test-cases' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toHaveLength(STARTER_TEST_CASES.length);
  });

  it('runs every active test case and keeps the results', async () => {
    const created = await app.inject({ method: 'POST', url: '/api/runs', payload: { allActive: true } });
    expect(created.statusCode).toBe(201);
    const run = created.json<Run>();

    const again = await app.inject({ method: 'POST', url: '/api/runs', payload: { allActive: true } });
    expect(again.statusCode).toBe(409);

    await runs.whenIdle();

    const detail = await runDetail(run.id);
    expect(detail.run.status).toBe('finished');
    expect(detail.run.counts).toMatchObject({ total: 8, passed: 7, failed: 1, error: 0 });
    expect(detail.results.find((r) => r.testCaseId === 'SAL-CANCEL-002')?.status).toBe('failed');
    // AI off: no explanations, no summary.
    expect(detail.run.summary).toBeUndefined();

    const list = (await app.inject({ method: 'GET', url: '/api/test-cases' })).json<Array<{ id: string; lastResult: { status: string } | null }>>();
    expect(list.find((t) => t.id === 'SAL-GREET-001')?.lastResult?.status).toBe('passed');
  });

  it('archives a test case and leaves it out of "run all active"', async () => {
    await app.inject({ method: 'PATCH', url: '/api/test-cases/SAL-CANCEL-002', payload: { status: 'archived' } });
    const run = (await app.inject({ method: 'POST', url: '/api/runs', payload: { allActive: true } })).json<Run>();
    expect(run.testCaseIds).not.toContain('SAL-CANCEL-002');
  });

  it('cancels a run in progress', async () => {
    runs = new RunManager(store, async () => new DemoChannel({ replyDelayMs: 50 }), 'demo', 'Demo bot');
    const run = runs.start(STARTER_TEST_CASES.map((t) => t.id));
    expect(runs.cancel(run.id)).toBe(true);
    await runs.whenIdle();
    const saved = store.getRun(run.id);
    expect(saved?.status).toBe('cancelled');
    expect(saved?.counts.skipped).toBeGreaterThan(0);
  });

  it('marks runs left running by a previous stop as interrupted', () => {
    store.saveRun({ id: '99', status: 'running', mode: 'demo', target: 'x', testCaseIds: ['SAL-GREET-001'], counts: { total: 1, passed: 0, failed: 0, error: 0, skipped: 0 }, createdAt: new Date().toISOString() });
    store.saveResult({ id: '99-1', runId: '99', testCaseId: 'SAL-GREET-001', testCaseTitle: 't', status: 'running', steps: [], setup: [] }, 0);
    runs.recoverInterrupted();
    expect(store.getRun('99')?.status).toBe('interrupted');
    expect(store.listResults('99')[0]?.status).toBe('error');
  });
});

describe('AI during runs', () => {
  it('explains each failure and summarises the run', async () => {
    const { runAi, calls } = fakeRunAi();
    await app.close();
    await setup(runAi);

    const run = (await app.inject({ method: 'POST', url: '/api/runs', payload: { allActive: true } })).json<Run>();
    await runs.whenIdle();
    const detail = await runDetail(run.id);

    expect(calls.analyze).toBe(1);
    expect(detail.results.find((r) => r.testCaseId === 'SAL-CANCEL-002')?.analysis?.explanation).toBe('Fake explanation.');
    expect(detail.results.find((r) => r.testCaseId === 'SAL-GREET-001')?.analysis).toBeUndefined();
    expect(detail.run.summary).toBe('Fake summary.');
  });

  it('uses the judge for AI checks, and skips them when the AI is off', async () => {
    const { runAi, calls } = fakeRunAi('fail');
    await app.close();
    await setup(runAi);
    let run = (await app.inject({ method: 'POST', url: '/api/test-cases/trial', payload: { draft: DRAFT } })).json<Run>();
    await runs.whenIdle();
    let result = (await runDetail(run.id)).results[0]!;
    expect(calls.judge).toBe(1);
    expect(result.status).toBe('failed');
    expect(result.steps[1]?.checks[0]).toMatchObject({ passed: false, detail: 'Fake judge says fail.' });

    await app.close();
    await setup(undefined);
    run = (await app.inject({ method: 'POST', url: '/api/test-cases/trial', payload: { draft: DRAFT } })).json<Run>();
    await runs.whenIdle();
    result = (await runDetail(run.id)).results[0]!;
    expect(result.status).toBe('passed');
    expect(result.steps[1]?.checks[0]).toMatchObject({ passed: true, skipped: true });
  });
});

describe('writing test cases', () => {
  it('drafts, tries, saves with the next free id, and edits without changing the id', async () => {
    const draft = (await app.inject({ method: 'POST', url: '/api/test-cases/draft', payload: { request: 'pediatría' } })).json<TestCaseDraft>();
    expect(draft.title).toBe(DRAFT.title);

    const trial = (await app.inject({ method: 'POST', url: '/api/test-cases/trial', payload: { draft } })).json<Run>();
    expect(trial.trial).toBe(true);
    expect(trial.testCaseIds).toEqual([TRIAL_TEST_CASE_ID]);
    await runs.whenIdle();

    const saved = await app.inject({ method: 'POST', url: '/api/test-cases', payload: { draft, status: 'active' } });
    expect(saved.statusCode).toBe(201);
    const testCase = saved.json<TestCase>();
    expect(testCase).toMatchObject({ id: 'SAL-BOOK-003', origin: 'manual', status: 'active' });

    const history = (await app.inject({ method: 'GET', url: `/api/test-cases/${testCase.id}` })).json<{ history: unknown[] }>();
    expect(history.history).toHaveLength(0);

    const changed = (await app.inject({ method: 'POST', url: '/api/test-cases/draft', payload: { request: 'rename', currentId: testCase.id } })).json<TestCaseDraft>();
    expect(changed.title).toBe('Changed title');
    const updated = (await app.inject({ method: 'PUT', url: `/api/test-cases/${testCase.id}`, payload: { draft: { ...changed, area: 'INFO' } } })).json<TestCase>();
    expect(updated).toMatchObject({ id: 'SAL-BOOK-003', title: 'Changed title', area: 'INFO' });
  });

  it('explains in plain words when the AI is off', async () => {
    await app.close();
    await setup(undefined, createAiFacade({ store, apiKey: undefined, models: { author: 'a', judge: 'j' }, defaultBudgetUsd: 20, mode: 'demo' }));
    const response = await app.inject({ method: 'POST', url: '/api/test-cases/draft', payload: { request: 'x' } });
    expect(response.statusCode).toBe(400);
    expect(response.json<{ error: string }>().error).toMatch(/ANTHROPIC_API_KEY/);
  });
});

describe('AI budget', () => {
  it('adds up this month, warns at 80% and stops at 100%', () => {
    const facade = createAiFacade({ store, apiKey: 'test-key', models: { author: 'a', judge: 'j' }, defaultBudgetUsd: 10, mode: 'demo' });
    const entry = { at: new Date().toISOString(), purpose: 'judge' as const, model: 'claude-haiku-5-5', inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 };

    store.recordAiUsage({ ...entry, costUsd: 7 });
    expect(facade.status().budget).toMatchObject({ spentUsd: 7, limitUsd: 10, level: 'ok' });

    store.recordAiUsage({ ...entry, costUsd: 1.5 });
    expect(facade.status().budget.level).toBe('warning');

    store.recordAiUsage({ ...entry, at: '2020-01-01T00:00:00.000Z', costUsd: 100 });
    expect(facade.status().budget.spentUsd).toBeCloseTo(8.5);

    facade.setBudget(8);
    expect(facade.status().budget.level).toBe('exhausted');
    expect(facade.breakdown().byPurpose[0]).toMatchObject({ purpose: 'judge', calls: 2 });
  });
});

describe('Google sign-in expiry during runs (FR-11)', () => {
  const EXPIRED = 'Your Google sign-in expired. Sign in again in Settings.';

  /** A demo channel that reports an expired sign-in once the first test has finished. */
  class ExpiringChannel extends DemoChannel {
    sessions = 0;
    override async openSession(): Promise<ChannelSession> {
      this.sessions += 1;
      return super.openSession();
    }
    fatal(): string | undefined {
      return this.sessions >= 1 ? EXPIRED : undefined;
    }
  }

  it('stops the run after the current test and skips the rest with the reason', async () => {
    const channel = new ExpiringChannel({ replyDelayMs: 1 });
    const expiringRuns = new RunManager(store, async () => channel, 'stage', 'salud-stage');
    const run = expiringRuns.start(['SAL-GREET-001', 'SAL-CANCEL-002']);
    await expiringRuns.whenIdle();

    const results = store.listResults(run.id);
    expect(results[0]?.status).toBe('passed');
    expect(results[1]).toMatchObject({ status: 'skipped', error: EXPIRED });
    expect(store.getRun(run.id)?.status).toBe('finished');
    expect(channel.sessions).toBe(1);
  });

  it('fails every test before sending anything when the sign-in already expired', async () => {
    let opened = 0;
    const expiredRuns = new RunManager(
      store,
      async () => {
        opened += 1;
        throw new SignInExpiredError();
      },
      'stage',
      'salud-stage'
    );
    const run = expiredRuns.start(['SAL-GREET-001', 'SAL-CANCEL-002']);
    await expiredRuns.whenIdle();
    const results = store.listResults(run.id);
    expect(results.map((r) => r.status)).toEqual(['error', 'error']);
    expect(results[0]?.error).toBe(`Could not connect to the chatbot: ${EXPIRED}`);
    expect(opened).toBe(1);
  });
});
