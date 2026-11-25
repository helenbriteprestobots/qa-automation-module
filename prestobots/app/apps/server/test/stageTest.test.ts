import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { StepError } from '@ctp/runner';
import type { ChatMessage, GoogleSession } from '@ctp/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { DemoChannel, STARTER_TEST_CASES } from '@ctp/runner';

import { createAiFacade } from '../src/ai.ts';
import { buildApp } from '../src/app.ts';
import { Store } from '../src/db.ts';
import { GenerationManager } from '../src/generation/generationManager.ts';
import { createJiraService } from '../src/jira/service.ts';
import { RunManager } from '../src/runManager.ts';
import { SessionStore } from '../src/google/sessionStore.ts';
import {
  type StageConnect,
  StageService,
  StageTestFailedError,
  type StageServiceOptions,
  TEST_MESSAGE_BUSY,
} from '../src/stage/stageService.ts';

const SESSION: GoogleSession = {
  email: 'juan@prestobots.com',
  refreshToken: '1//0g-secret-refresh-token',
  scopes: ['openid', 'email', 'https://www.googleapis.com/auth/cloud-platform'],
  signedInAt: '2026-11-23T15:04:05.000Z',
};

const STAGE = {
  projectId: 'salud-stage',
  orgId: 'testing-macena-gupshup-v3-qa',
  webhookUrl: 'https://us-central1-salud-stage.cloudfunctions.net/webhookGupshupMessages',
  patientPhone: '5492611234567',
  resetMessage: 'hola',
  replyTimeoutMs: 45_000,
};

const ACK_AT = Date.parse('2026-11-23T16:00:00.000Z');

const message = (from: ChatMessage['from'], text: string, at: number): ChatMessage => ({
  id: `${from}-${at}`,
  from,
  kind: 'text',
  text,
  options: [],
  at: new Date(at).toISOString(),
});

/** A fake salud-stage: `prepare` answers with what the test says the bot did. */
const fakeStage = (behavior: { replies?: ChatMessage[]; error?: Error } = {}) => {
  const seen = { resetMessages: [] as Array<string | undefined>, closed: 0, disposed: 0 };
  const connect: StageConnect = async (options) => {
    seen.resetMessages.push(options?.resetMessage);
    return {
      target: 'salud-stage · TESTING MACENA',
      dispose: async () => void (seen.disposed += 1),
      openSession: async () => ({
        prepare: async () => {
          if (behavior.error) throw behavior.error;
          return [message('patient', options?.resetMessage ?? '', ACK_AT - 300), ...(behavior.replies ?? [])];
        },
        lastAcceptedAt: () => ACK_AT,
        close: async () => void (seen.closed += 1),
      }),
    };
  };
  return { seen, connect };
};

let dir: string;
let sessions: SessionStore;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ctp-hola-'));
  sessions = new SessionStore(join(dir, 'google-session.json'));
  sessions.save(SESSION);
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const service = (connect: StageConnect, change: Partial<StageServiceOptions> = {}) =>
  new StageService({ mode: 'stage', stage: STAGE, sessions, legacyKeyFileSet: false, connect, ...change });

describe('Send test hola (FR-17, FR-18)', () => {
  it('sends the reset message and shows the replies with the bot reply time', async () => {
    const { seen, connect } = fakeStage({
      replies: [message('system', 'aviso', ACK_AT + 1000), message('bot', '¡Hola! ¿En qué te ayudo?', ACK_AT + 4230)],
    });
    const result = await service(connect).sendTestMessage();
    expect(result.sent.text).toBe('hola');
    expect(result.replies.map((r) => r.text)).toEqual(['aviso', '¡Hola! ¿En qué te ayudo?']);
    expect(result.replySeconds).toBe(4.2);
    expect(seen.resetMessages.at(-1)).toBe('hola');
    expect(seen.closed).toBe(1);
    expect(seen.disposed).toBeGreaterThanOrEqual(1);
  });

  it('never reports a negative reply time (clock differences)', async () => {
    const { connect } = fakeStage({ replies: [message('bot', 'Hola', ACK_AT - 2000)] });
    expect((await service(connect).sendTestMessage()).replySeconds).toBe(0);
  });

  it('sends "hola" when no reset message is set', async () => {
    const { seen, connect } = fakeStage({ replies: [message('bot', 'Hola', ACK_AT + 1000)] });
    await service(connect, { stage: { ...STAGE, resetMessage: undefined } }).sendTestMessage();
    expect(seen.resetMessages.at(-1)).toBe('hola');
  });

  it('explains a message the bot did not accept', async () => {
    const { seen, connect } = fakeStage({ error: new StepError('The bot did not accept the message (HTTP 200: «error»).') });
    const error = (await service(connect).sendTestMessage().catch((e: unknown) => e)) as Error;
    expect(error).toBeInstanceOf(StageTestFailedError);
    expect(error.message).toBe('The bot did not accept the message (HTTP 200: «error»). Check STAGE_WEBHOOK_URL with the developers.');
    expect(seen.closed).toBe(1);
  });

  it('explains a bot that accepted the message but saved no reply', async () => {
    const { connect } = fakeStage({ replies: [] });
    const error = (await service(connect).sendTestMessage().catch((e: unknown) => e)) as Error;
    expect(error).toBeInstanceOf(StageTestFailedError);
    expect(error.message).toBe(
      "The bot accepted the message but no reply was saved in salud-stage within 45 s. Check that the QA clinic's bot is on, then try again."
    );
  });
});

/** A salud-stage whose bot answers only when the test says so. */
const controllableStage = () => {
  const sends = { count: 0 };
  let answer: (() => void) | undefined;
  const connect: StageConnect = async (options) => ({
    target: 'salud-stage · TESTING MACENA',
    openSession: async () => ({
      prepare: async () => {
        if (options?.resetMessage) sends.count += 1;
        await new Promise<void>((resolve) => {
          answer = resolve;
        });
        return [message('patient', 'hola', ACK_AT), message('bot', 'Hola', ACK_AT + 1000)];
      },
      lastAcceptedAt: () => ACK_AT,
      close: async () => undefined,
    }),
  });
  return { sends, connect, answer: () => answer?.() };
};

const platform = async (connect: StageConnect, change: Partial<StageServiceOptions> = {}) => {
  const store = new Store(':memory:');
  const ai = createAiFacade({ store, apiKey: undefined, models: { author: 'a', judge: 'j' }, defaultBudgetUsd: 20, mode: 'stage' });
  const channel = async () => new DemoChannel({ replyDelayMs: 50 });
  const runs = new RunManager(store, channel, 'stage', 'salud-stage');
  const generations = new GenerationManager(store, channel, 'stage', ai, runs);
  const stage = service(connect, {
    busyElsewhere: () => (runs.activeRunId() ? `Run #${runs.activeRunId()} is using the chatbot.` : null),
    ...change,
  });
  // Same wiring as src/index.ts: a waiting test message blocks runs and generations.
  const blocker = () => (stage.busy() ? TEST_MESSAGE_BUSY : null);
  runs.setBlocker(blocker);
  generations.setBlocker(blocker);
  const app = await buildApp({
    store,
    runs,
    ai,
    generations,
    jira: createJiraService({ store, ai, client: undefined, status: { configured: false, labels: [], problems: [] } }),
    status: () => stage.status(),
    stage,
  });
  return {
    app,
    runs,
    store,
    stage,
    close: async () => {
      await runs.whenIdle();
      await app.close();
      store.close();
    },
  };
};

describe('POST /api/stage/test-message (FR-18, FR-19)', () => {
  it('answers 200 with the bot reply', async () => {
    const { connect } = fakeStage({ replies: [message('bot', 'Hola', ACK_AT + 1500)] });
    const { app, close } = await platform(connect);
    const response = await app.inject({ method: 'POST', url: '/api/stage/test-message' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ replySeconds: 1.5 });
    await close();
  });

  it('answers 502 when the bot did not reply', async () => {
    const { connect } = fakeStage({ replies: [] });
    const { app, close } = await platform(connect);
    const response = await app.inject({ method: 'POST', url: '/api/stage/test-message' });
    expect(response.statusCode).toBe(502);
    expect(response.json<{ error: string }>().error).toContain('no reply was saved');
    await close();
  });

  const sentHola = (seen: { resetMessages: Array<string | undefined> }) => seen.resetMessages.filter(Boolean).length;

  it('refuses while a run is using the chatbot, without sending', async () => {
    const { seen, connect } = fakeStage({ replies: [message('bot', 'Hola', ACK_AT + 1000)] });
    const { app, runs, close, store } = await platform(connect);
    store.saveTestCase(STARTER_TEST_CASES[0]!);
    runs.start([STARTER_TEST_CASES[0]!.id]);
    const response = await app.inject({ method: 'POST', url: '/api/stage/test-message' });
    expect(response.statusCode).toBe(409);
    expect(response.json<{ error: string }>().error).toMatch(/^Run #\d+ is using the chatbot\.$/);
    expect(sentHola(seen)).toBe(0);
    await close();
  });

  it('refuses while "Generate test cases" is using the chatbot', async () => {
    const { seen, connect } = fakeStage({ replies: [message('bot', 'Hola', ACK_AT + 1000)] });
    const { app, close } = await platform(connect, { busyElsewhere: () => '"Generate test cases" (#3) is using the chatbot.' });
    const response = await app.inject({ method: 'POST', url: '/api/stage/test-message' });
    expect(response.statusCode).toBe(409);
    expect(response.json<{ error: string }>().error).toBe('"Generate test cases" (#3) is using the chatbot.');
    expect(sentHola(seen)).toBe(0);
    await close();
  });

  it('refuses when the checks do not all pass', async () => {
    sessions.remove();
    const { seen, connect } = fakeStage({ replies: [message('bot', 'Hola', ACK_AT + 1000)] });
    const { app, close } = await platform(connect);
    const response = await app.inject({ method: 'POST', url: '/api/stage/test-message' });
    expect(response.statusCode).toBe(409);
    expect(response.json<{ error: string }>().error).toBe(
      'The real bot is not ready: fix the failed checks in Settings first (Signed in with Google).'
    );
    expect(sentHola(seen)).toBe(0);
    await close();
  });

  it('refuses a second test message while the first waits for the bot', async () => {
    const bot = controllableStage();
    const { app, close } = await platform(bot.connect);
    const first = app.inject({ method: 'POST', url: '/api/stage/test-message' });
    await new Promise((resolve) => setTimeout(resolve, 20));
    const second = await app.inject({ method: 'POST', url: '/api/stage/test-message' });
    expect(second.statusCode).toBe(409);
    expect(second.json<{ error: string }>().error).toBe("A test message is waiting for the bot's reply. Try again in a few seconds.");
    bot.answer();
    expect((await first).statusCode).toBe(200);
    expect(bot.sends.count).toBe(1);
    await close();
  });
});

describe('runs and generations wait for the test message (FR-20)', () => {
  it('refuses to start a run, a trial or "Generate test cases" while the bot has not answered', async () => {
    const bot = controllableStage();
    const { app, store, close } = await platform(bot.connect);
    store.saveTestCase(STARTER_TEST_CASES[0]!);
    const pending = app.inject({ method: 'POST', url: '/api/stage/test-message' });
    await new Promise((resolve) => setTimeout(resolve, 20));

    const starter = STARTER_TEST_CASES[0]!;
    const draft = { title: starter.title, area: starter.area, story: starter.story, steps: starter.steps };
    const attempts = [
      await app.inject({ method: 'POST', url: '/api/runs', payload: { testCaseIds: [STARTER_TEST_CASES[0]!.id] } }),
      await app.inject({ method: 'POST', url: '/api/test-cases/trial', payload: { draft: { ...draft, assumptions: [] } } }),
      await app.inject({ method: 'POST', url: '/api/generations' }),
    ];
    for (const response of attempts) {
      expect(response.statusCode).toBe(409);
      expect(response.json<{ error: string }>().error).toBe("A test message is waiting for the bot's reply. Try again in a few seconds.");
    }

    bot.answer();
    expect((await pending).statusCode).toBe(200);
    await close();
  });
});
