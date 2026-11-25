import { existsSync } from 'node:fs';

import { AiError, BudgetExceededError } from '@ctp/ai';
import fastifyStatic from '@fastify/static';
import {
  type PlatformStatus,
  type RunEvent,
  TEST_CASE_STATUSES,
  jiraCardInputSchema,
  type TestCase,
  nextTestCaseId,
  testCaseDraftSchema,
} from '@ctp/shared';
import Fastify, { type FastifyInstance } from 'fastify';
import { z } from 'zod';

import type { AiFacade } from './ai.ts';
import type { Store } from './db.ts';
import type { GoogleSignIn } from './google/signIn.ts';
import type { SessionStore } from './google/sessionStore.ts';
import { type StageService, StageTestConflictError, StageTestFailedError } from './stage/stageService.ts';
import { GenerationConflictError, GenerationInputError, type GenerationManager } from './generation/generationManager.ts';
import { JiraError, JiraInputError, type JiraService } from './jira/service.ts';
import { RunConflictError, RunInputError, type RunManager } from './runManager.ts';

export interface AppDeps {
  store: Store;
  runs: RunManager;
  /** Computes the platform status shown in the page header. */
  status: () => Promise<Omit<PlatformStatus, 'activeRunId' | 'activeGenerationId' | 'ai' | 'jira'>>;
  ai: AiFacade;
  jira: JiraService;
  generations: GenerationManager;
  /** "Sign in with Google" for reading the real bot (stage mode). */
  google?: { signIn: GoogleSignIn; sessions: SessionStore; onSignedOut?: () => void };
  /** Connection checks and the test message for the real bot. */
  stage?: StageService;
  /** Folder with the built web page, served in production. */
  webDist?: string;
  logger?: boolean;
}

export const buildApp = async (deps: AppDeps): Promise<FastifyInstance> => {
  const { store, runs, ai, jira, generations } = deps;
  const app = Fastify({ logger: deps.logger ?? false });

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof RunConflictError || error instanceof GenerationConflictError) {
      return reply.code(409).send({ error: error.message });
    }
    if (error instanceof StageTestConflictError) return reply.code(409).send({ error: error.message });
    if (error instanceof StageTestFailedError) return reply.code(502).send({ error: error.message });
    if (error instanceof GenerationInputError) return reply.code(400).send({ error: error.message });
    if (error instanceof AiError || error instanceof BudgetExceededError) {
      return reply.code(400).send({ error: error.message });
    }
    if (error instanceof JiraInputError) return reply.code(error.statusCode).send({ error: error.message });
    if (error instanceof JiraError) return reply.code(502).send({ error: error.message });
    if (error instanceof RunInputError || error instanceof z.ZodError) {
      return reply.code(400).send({ error: error instanceof z.ZodError ? 'Invalid request.' : error.message });
    }
    app.log.error(error);
    return reply.code(500).send({ error: 'Unexpected server problem. See the platform logs.' });
  });

  app.get('/api/status', async (): Promise<PlatformStatus> => ({
    ...(await deps.status()),
    activeRunId: runs.activeRunId(),
    activeGenerationId: generations.activeId(),
    ai: ai.status(),
    jira: jira.status(),
  }));

  // ── Google sign-in (reads the real bot's replies) ──────────────────────────

  const google = deps.google;
  if (google) {
    app.get('/api/google/sign-in', async (request, reply) => {
      const { from } = z.object({ from: z.string().optional() }).parse(request.query);
      return reply.redirect(google.signIn.start(from));
    });

    app.get('/api/google/callback', async (request, reply) => {
      const query = z
        .object({ code: z.string().optional(), state: z.string().optional(), error: z.string().optional() })
        .parse(request.query);
      const outcome = await google.signIn.finish(query);
      const params = new URLSearchParams(
        'reason' in outcome
          ? { google: 'error', reason: outcome.reason, ...(outcome.email ? { email: outcome.email } : {}) }
          : { google: 'signed-in' }
      );
      return reply.redirect(`${outcome.origin}/settings?${params.toString()}`);
    });

    app.post('/api/google/sign-out', async () => {
      google.sessions.remove();
      google.onSignedOut?.();
      return { signedIn: false };
    });
  }

  // ── Real bot (salud-stage) ─────────────────────────────────────────────────

  const stage = deps.stage;
  if (stage) {
    app.get('/api/stage/checks', async (request) => {
      const { fresh } = z.object({ fresh: z.string().optional() }).parse(request.query);
      return stage.checks({ fresh: fresh === '1' });
    });

    app.post('/api/stage/test-message', async () => stage.sendTestMessage());
  }

  // ── AI usage and budget ────────────────────────────────────────────────────

  app.get('/api/ai/usage', async () => ({ status: ai.status(), breakdown: ai.breakdown() }));

  app.put('/api/ai/budget', async (request) => {
    const { limitUsd } = z.object({ limitUsd: z.number().min(0).max(10_000) }).parse(request.body);
    ai.setBudget(limitUsd);
    return ai.status();
  });

  // ── Test cases ─────────────────────────────────────────────────────────────

  app.get('/api/test-cases', async () => {
    const last = store.lastResults();
    return store.listTestCases().map((testCase) => ({ ...testCase, lastResult: last.get(testCase.id) ?? null }));
  });

  app.get('/api/test-cases/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const testCase = store.getTestCase(id);
    if (!testCase) return reply.code(404).send({ error: `Test case ${id} does not exist.` });
    const proposalTrial = testCase.proposal
      ? store.getGeneration(testCase.proposal.generationId)?.trials.find((trial) => trial.testCaseId === id)
      : undefined;
    return { testCase, history: store.historyOf(id), jiraCards: store.jiraCardsForTestCase(id), proposalTrial: proposalTrial ?? null };
  });

  /** The AI writes a new test case, or changes an existing one / a draft, from the admin's words. */
  app.post('/api/test-cases/draft', async (request, reply) => {
    const body = z
      .object({
        request: z.string().trim().min(1).max(4000),
        currentId: z.string().optional(),
        draft: testCaseDraftSchema.optional(),
      })
      .parse(request.body);
    let current = body.draft;
    if (body.currentId) {
      const saved = store.getTestCase(body.currentId);
      if (!saved) return reply.code(404).send({ error: `Test case ${body.currentId} does not exist.` });
      current = { title: saved.title, area: saved.area, story: saved.story, steps: saved.steps, assumptions: [] };
    }
    return ai.draft({ request: body.request, current });
  });

  /** "Try it": runs a draft once without saving it. */
  app.post('/api/test-cases/trial', async (request, reply) => {
    const { draft } = z.object({ draft: testCaseDraftSchema }).parse(request.body);
    return reply.code(201).send(runs.startTrial(draft));
  });

  app.post('/api/test-cases', async (request, reply) => {
    const { draft, status } = z
      .object({ draft: testCaseDraftSchema, status: z.enum(['active', 'proposed']).default('active') })
      .parse(request.body);
    const now = new Date().toISOString();
    const testCase: TestCase = {
      id: nextTestCaseId(draft.area, store.listTestCases().map((t) => t.id)),
      title: draft.title,
      area: draft.area,
      story: draft.story,
      steps: draft.steps,
      status,
      origin: 'manual',
      createdAt: now,
      updatedAt: now,
    };
    store.saveTestCase(testCase);
    return reply.code(201).send(testCase);
  });

  /** Replaces the content of a test case. Its id never changes. */
  app.put('/api/test-cases/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const { draft } = z.object({ draft: testCaseDraftSchema }).parse(request.body);
    const testCase = store.getTestCase(id);
    if (!testCase) return reply.code(404).send({ error: `Test case ${id} does not exist.` });
    const updated: TestCase = {
      ...testCase,
      title: draft.title,
      area: draft.area,
      story: draft.story,
      steps: draft.steps,
      updatedAt: new Date().toISOString(),
    };
    store.saveTestCase(updated);
    return updated;
  });

  app.patch('/api/test-cases/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const { status, reason } = z
      .object({ status: z.enum(TEST_CASE_STATUSES), reason: z.string().trim().max(500).optional() })
      .parse(request.body);
    const testCase = store.getTestCase(id);
    if (!testCase) return reply.code(404).send({ error: `Test case ${id} does not exist.` });
    const updated: TestCase = { ...testCase, status, updatedAt: new Date().toISOString() };
    // The reason helps the AI not propose the same thing again.
    if (status === 'rejected' && testCase.proposal) {
      updated.proposal = { ...testCase.proposal, rejectedReason: reason || undefined };
    }
    store.saveTestCase(updated);
    return updated;
  });

  // ── Runs ───────────────────────────────────────────────────────────────────

  app.get('/api/runs', async () => store.listRuns());

  app.post('/api/runs', async (request, reply) => {
    const body = z
      .object({ testCaseIds: z.array(z.string()).optional(), allActive: z.boolean().optional() })
      .parse(request.body ?? {});
    const ids = body.allActive
      ? store.listTestCases().filter((testCase) => testCase.status === 'active').map((testCase) => testCase.id)
      : (body.testCaseIds ?? []);
    if (body.allActive && ids.length === 0) throw new RunInputError('There are no active test cases.');
    const run = runs.start(ids);
    return reply.code(201).send(run);
  });

  app.get('/api/runs/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const run = store.getRun(id);
    if (!run) return reply.code(404).send({ error: `Run #${id} does not exist.` });
    return { run, results: store.listResults(id), jiraCards: store.jiraCardsForRun(id) };
  });

  app.post('/api/runs/:id/cancel', async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!runs.cancel(id)) return reply.code(409).send({ error: `Run #${id} is not in progress.` });
    return { ok: true };
  });

  /** Live progress (Server-Sent Events). */
  app.get('/api/runs/:id/events', async (request, reply) => {
    const { id } = request.params as { id: string };
    const run = store.getRun(id);
    if (!run) return reply.code(404).send({ error: `Run #${id} does not exist.` });

    reply.hijack();
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    const send = (event: RunEvent): void => {
      reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
    };
    send({ type: 'run', run });

    const unsubscribe = runs.subscribe(id, send);
    const heartbeat = setInterval(() => reply.raw.write(': keep-alive\n\n'), 15_000);
    request.raw.on('close', () => {
      clearInterval(heartbeat);
      unsubscribe();
    });
  });

  // ── Generate test cases ────────────────────────────────────────────────────

  /** List without the bulky parts (menu map, conversations). */
  app.get('/api/generations', async () =>
    store.listGenerations().map(({ map, trials, ...rest }) => ({
      ...rest,
      paths: map?.nodes.length ?? 0,
      trials: trials.map(({ result: _result, ...trial }) => trial),
    }))
  );

  app.post('/api/generations', async (_request, reply) => reply.code(201).send(generations.start()));

  app.get('/api/generations/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const generation = store.getGeneration(id);
    if (!generation) return reply.code(404).send({ error: `Generation #${id} does not exist.` });
    return generation;
  });

  app.post('/api/generations/:id/confirm', async (request) => {
    const { id } = request.params as { id: string };
    return generations.confirm(id);
  });

  app.post('/api/generations/:id/cancel', async (request) => {
    const { id } = request.params as { id: string };
    return generations.cancel(id);
  });

  // ── Jira cards ─────────────────────────────────────────────────────────────

  /** Tries the Jira settings: the account, the project and its card types. */
  app.post('/api/jira/check', async () => jira.check());

  /** Pre-filled card for a failed result, plus the cards created earlier for the same test case. */
  app.post('/api/results/:id/jira/draft', async (request) => {
    const { id } = request.params as { id: string };
    return jira.draft(id);
  });

  /** Creates the card, or comments on an earlier one. */
  app.post('/api/results/:id/jira', async (request, reply) => {
    const { id } = request.params as { id: string };
    const input = jiraCardInputSchema.parse(request.body);
    return reply.code(201).send(await jira.send(id, input));
  });

  // ── Web page (production build) ────────────────────────────────────────────

  if (deps.webDist && existsSync(deps.webDist)) {
    await app.register(fastifyStatic, { root: deps.webDist });
    app.setNotFoundHandler((request, reply) => {
      if (request.method === 'GET' && !request.url.startsWith('/api/')) {
        return reply.sendFile('index.html');
      }
      return reply.code(404).send({ error: 'Not found' });
    });
  }

  return app;
};
