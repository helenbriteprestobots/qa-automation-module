import { AiError, type Proposal, type ProposalRequest } from '@ctp/ai';
import { DemoChannel, STARTER_TEST_CASES } from '@ctp/runner';
import type { AiStatus, Generation, ProposalTrial, TestCase } from '@ctp/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { type AiFacade, currentMonth } from '../src/ai.ts';
import { buildApp } from '../src/app.ts';
import { Store } from '../src/db.ts';
import { GenerationManager } from '../src/generation/generationManager.ts';
import { createJiraService } from '../src/jira/service.ts';
import { RunManager } from '../src/runManager.ts';

/** On the demo bot, the first passes and the second fails (the demo bot doesn't understand a written cancel). */
const PROPOSALS: Proposal[] = [
  {
    title: 'Patient picks pediatrics from the menu',
    area: 'BOOK',
    story: 'Un paciente elige Sacar turno y luego Pediatría.',
    steps: [
      { action: { type: 'say', text: 'Hola' }, expect: [{ type: 'offers_option', option: 'Sacar turno' }] },
      { action: { type: 'choose', option: 'Sacar turno' }, expect: [{ type: 'offers_option', option: 'Pediatría' }] },
    ],
    assumptions: ['The runner never picks an appointment time.'],
    why: 'No test covered the pediatrics path.',
  },
  {
    title: 'Patient writes that they want to cancel',
    area: 'CANCEL',
    story: 'Un paciente escribe que quiere cancelar.',
    steps: [{ action: { type: 'say', text: 'Necesito cancelar el turno' }, expect: [{ type: 'mentions_any', words: ['cancel'] }] }],
    assumptions: [],
    why: 'Patients often type instead of tapping.',
  },
];

const fakeAi = (options: { enabled?: boolean } = {}) => {
  const requests: ProposalRequest[] = [];
  const facade: AiFacade = {
    status: (): AiStatus => ({
      enabled: options.enabled ?? true,
      models: { author: 'a', judge: 'j' },
      budget: { month: currentMonth(), spentUsd: 0, limitUsd: 20, level: 'ok' },
    }),
    breakdown: () => ({ month: currentMonth(), byPurpose: [], byModel: [] }),
    setBudget: () => undefined,
    draft: async () => {
      throw new AiError('not used');
    },
    forRuns: () => undefined,
    jiraText: async () => {
      throw new AiError('not used');
    },
    estimateProposal: () => ({ lowUsd: 0.04, highUsd: 0.3 }),
    propose: async (request) => {
      requests.push(request);
      return { proposals: requests.length === 1 ? PROPOSALS : [], notes: ['A fake note.'] };
    },
  };
  return { facade, requests };
};

let store: Store;
let runs: RunManager;
let generations: GenerationManager;
let app: Awaited<ReturnType<typeof buildApp>>;
let requests: ProposalRequest[];

const setup = async (options: { enabled?: boolean } = {}) => {
  const ai = fakeAi(options);
  requests = ai.requests;
  const channel = async () => new DemoChannel({ replyDelayMs: 5 });
  runs = new RunManager(store, channel, 'demo', 'Demo bot');
  generations = new GenerationManager(store, channel, 'demo', ai.facade, runs);
  runs.setBlocker(() => (generations.activeId() ? 'Generate test cases is using the chatbot.' : null));
  app = await buildApp({
    store,
    runs,
    ai: ai.facade,
    generations,
    jira: createJiraService({ store, ai: ai.facade, client: undefined, status: { configured: false, labels: [], problems: [] } }),
    status: async () => ({ mode: 'demo', target: 'Demo bot', ready: true, problems: [], notes: [] }),
  });
};

const getGeneration = async (id: string) => (await app.inject({ method: 'GET', url: `/api/generations/${id}` })).json<Generation>();

beforeEach(async () => {
  store = new Store(':memory:');
  STARTER_TEST_CASES.forEach((testCase) => store.saveTestCase(testCase));
});

afterEach(async () => {
  await generations.whenIdle();
  await runs.whenIdle();
  await app.close();
  store.close();
});

describe('generate test cases', () => {
  it('explores, waits for OK, writes proposals, tries each twice, and remembers rejections', async () => {
    await setup();

    const started = await app.inject({ method: 'POST', url: '/api/generations' });
    expect(started.statusCode).toBe(201);
    const { id } = started.json<Generation>();

    // While exploring, runs must wait: both use the same test patient.
    const run = await app.inject({ method: 'POST', url: '/api/runs', payload: { allActive: true } });
    expect(run.statusCode).toBe(409);
    expect((await app.inject({ method: 'GET', url: '/api/status' })).json<{ activeGenerationId: string }>().activeGenerationId).toBe(id);

    await generations.whenIdle();
    let generation = await getGeneration(id);
    expect(generation.status).toBe('awaiting_confirmation');
    expect(generation.estimate).toEqual({ lowUsd: 0.04, highUsd: 0.3 });
    expect(generation.map!.nodes.map((n) => n.path.join(' > '))).toContain('Sacar turno > Pediatría');
    expect(requests).toHaveLength(0); // Nothing paid before the OK.

    const confirmed = await app.inject({ method: 'POST', url: `/api/generations/${id}/confirm` });
    expect(confirmed.statusCode).toBe(200);
    await generations.whenIdle();

    generation = await getGeneration(id);
    expect(generation.status).toBe('finished');
    expect(generation.proposals).toEqual(['SAL-BOOK-003', 'SAL-CANCEL-003']);
    expect(generation.notes).toContain('SAL-BOOK-003: The runner never picks an appointment time.');
    const outcomes = Object.fromEntries(generation.trials.map((t: ProposalTrial) => [t.testCaseId, t.outcome]));
    expect(outcomes).toEqual({ 'SAL-BOOK-003': 'passed', 'SAL-CANCEL-003': 'failed' });
    expect(generation.trials[0]!.attempts).toEqual(['passed', 'passed']);
    expect(generation.progress).toMatch(/2 proposals to review, 1 of them did not pass/);

    // The AI got the map and every existing test case.
    expect(requests[0]!.existing.map((t) => t.id)).toContain('SAL-GREET-001');
    expect(requests[0]!.map.nodes.length).toBeGreaterThan(3);

    // Proposals are test cases "to review", with their trial; trials don't appear in run history.
    const detail = (await app.inject({ method: 'GET', url: '/api/test-cases/SAL-BOOK-003' })).json<{
      testCase: TestCase;
      history: unknown[];
      proposalTrial: ProposalTrial | null;
    }>();
    expect(detail.testCase).toMatchObject({ status: 'proposed', origin: 'generated', proposal: { generationId: id, why: 'No test covered the pediatrics path.' } });
    expect(detail.proposalTrial?.result.steps).toHaveLength(2);
    expect(detail.history).toEqual([]);

    // Reject one with a reason; the next generation tells the AI.
    const rejected = await app.inject({
      method: 'PATCH',
      url: '/api/test-cases/SAL-CANCEL-003',
      payload: { status: 'rejected', reason: 'We test this already by hand.' },
    });
    expect(rejected.json<TestCase>().proposal?.rejectedReason).toBe('We test this already by hand.');

    const second = (await app.inject({ method: 'POST', url: '/api/generations' })).json<Generation>();
    await generations.whenIdle();
    await app.inject({ method: 'POST', url: `/api/generations/${second.id}/confirm` });
    await generations.whenIdle();
    expect(requests[1]!.rejected).toEqual([
      { title: 'Patient writes that they want to cancel', story: 'Un paciente escribe que quiere cancelar.', reason: 'We test this already by hand.' },
    ]);
    expect(requests[1]!.existing.map((t) => t.id)).not.toContain('SAL-CANCEL-003');
    expect((await getGeneration(second.id)).progress).toMatch(/nothing new/);

    // Runs work again once it's done.
    expect((await app.inject({ method: 'POST', url: '/api/runs', payload: { testCaseIds: ['SAL-BOOK-003'] } })).statusCode).toBe(201);
  });

  it('can be cancelled while waiting for the OK', async () => {
    await setup();
    const { id } = (await app.inject({ method: 'POST', url: '/api/generations' })).json<Generation>();
    await generations.whenIdle();
    const cancelled = await app.inject({ method: 'POST', url: `/api/generations/${id}/cancel` });
    expect(cancelled.json<Generation>().status).toBe('cancelled');
    expect((await app.inject({ method: 'POST', url: `/api/generations/${id}/confirm` })).statusCode).toBe(400);
    expect(requests).toHaveLength(0);
  });

  it('explains that the AI is needed', async () => {
    await setup({ enabled: false });
    const response = await app.inject({ method: 'POST', url: '/api/generations' });
    expect(response.statusCode).toBe(400);
    expect(response.json<{ error: string }>().error).toMatch(/needs the AI/);
  });
});
