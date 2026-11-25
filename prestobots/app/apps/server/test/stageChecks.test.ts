import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { FirestoreUnavailableError, ReadAccessError, SignInExpiredError, StepError } from '@ctp/runner';
import type { ChatbotMode, GoogleSession, StageChecks } from '@ctp/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { FIREBASE_TOOLS_CLIENT, parseGoogleConfig, stageSettingsProblems } from '../src/config.ts';
import { DemoChannel } from '@ctp/runner';

import { createAiFacade } from '../src/ai.ts';
import { buildApp } from '../src/app.ts';
import { Store } from '../src/db.ts';
import { GenerationManager } from '../src/generation/generationManager.ts';
import { createJiraService } from '../src/jira/service.ts';
import { RunManager } from '../src/runManager.ts';
import { SessionStore } from '../src/google/sessionStore.ts';
import { type StageConnect, StageService, type StageServiceOptions } from '../src/stage/stageService.ts';

const STAGE = {
  projectId: 'salud-stage',
  orgId: 'testing-macena-gupshup-v3-qa',
  webhookUrl: 'https://us-central1-salud-stage.cloudfunctions.net/webhookGupshupMessages',
  patientPhone: '5492611234567',
};

describe('stageSettingsProblems (FR-13 check 1)', () => {
  it('accepts complete settings', () => {
    expect(stageSettingsProblems(STAGE)).toEqual([]);
  });

  it.each([
    ['the QA clinic', { orgId: undefined }, 'STAGE_QA_ORG_ID'],
    ['the webhook', { webhookUrl: undefined }, 'STAGE_WEBHOOK_URL'],
    ['the test phone', { patientPhone: undefined }, 'TEST_PATIENT_PHONE'],
  ])('reports missing %s', (_label, change, name) => {
    const problems = stageSettingsProblems({ ...STAGE, ...change });
    expect(problems).toHaveLength(1);
    expect(problems[0]?.message).toContain(name);
    expect(problems[0]?.fix).toBeTruthy();
  });

  it.each(['+5492611234567', '549 261 123 4567', '549261123'])('rejects the phone «%s» with an example', (phone) => {
    const problems = stageSettingsProblems({ ...STAGE, patientPhone: phone });
    expect(problems).toHaveLength(1);
    expect(problems[0]?.message).toContain('10–15 digits');
    expect(problems[0]?.fix).toContain('Write it like 5492611234567');
  });
});

describe('parseGoogleConfig (FR-7, FR-8)', () => {
  it('uses the public firebase-tools client by default', () => {
    expect(parseGoogleConfig({})).toEqual({ ...FIREBASE_TOOLS_CLIENT, legacyKeyFileSet: false });
    expect(FIREBASE_TOOLS_CLIENT.clientId).toMatch(/\.apps\.googleusercontent\.com$/);
  });

  it('uses the client from .env when both values are set', () => {
    expect(parseGoogleConfig({ GOOGLE_OAUTH_CLIENT_ID: 'own.apps.googleusercontent.com', GOOGLE_OAUTH_CLIENT_SECRET: 'own-secret' })).toMatchObject({
      clientId: 'own.apps.googleusercontent.com',
      clientSecret: 'own-secret',
    });
    expect(parseGoogleConfig({ GOOGLE_OAUTH_CLIENT_ID: 'only-id' }).clientId).toBe(FIREBASE_TOOLS_CLIENT.clientId);
  });

  it('notices the old key-file setting', () => {
    expect(parseGoogleConfig({ STAGE_SERVICE_ACCOUNT_FILE: './secrets/key.json' }).legacyKeyFileSet).toBe(true);
    expect(parseGoogleConfig({ STAGE_SERVICE_ACCOUNT_FILE: ' ' }).legacyKeyFileSet).toBe(false);
  });
});

const SESSION: GoogleSession = {
  email: 'juan@prestobots.com',
  refreshToken: '1//0g-secret-refresh-token',
  scopes: ['openid', 'email', 'https://www.googleapis.com/auth/cloud-platform'],
  signedInAt: '2026-11-23T15:04:05.000Z',
};

let dir: string;
let sessions: SessionStore;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ctp-checks-'));
  sessions = new SessionStore(join(dir, 'google-session.json'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** A connection to salud-stage that records how often it was tried. */
const countingConnect = (result: () => Promise<{ target: string }> = async () => ({ target: 'salud-stage · TESTING MACENA' })) => {
  const calls = { count: 0 };
  const connect: StageConnect = async () => {
    calls.count += 1;
    return result();
  };
  return { calls, connect };
};

const service = (change: Partial<StageServiceOptions> = {}, connect = countingConnect().connect) =>
  new StageService({
    mode: 'stage' as ChatbotMode,
    stage: { ...STAGE, replyTimeoutMs: 1000 },
    sessions,
    legacyKeyFileSet: false,
    connect,
    ...change,
  });

const states = (checks: StageChecks) => Object.fromEntries(checks.checks.map((c) => [c.id, c.state]));

describe('StageService checks 1–4 (FR-9, FR-13, FR-16, FR-22)', () => {
  it('lists the six checks in order with plain labels', async () => {
    sessions.save(SESSION);
    const checks = await service().checks();
    expect(checks.checks.map((c) => [c.id, c.label])).toEqual([
      ['settings', 'Stage settings filled in'],
      ['guard', 'Target is safe'],
      ['signedIn', 'Signed in with Google'],
      ['domain', 'prestobots.com account'],
      ['readAccess', 'Can read salud-stage'],
      ['clinic', 'QA clinic found'],
    ]);
    expect(checks.account).toEqual({ email: 'juan@prestobots.com' });
    expect(checks.checks.slice(0, 4).every((c) => c.state === 'passed')).toBe(true);
  });

  it('fails check 1 for a badly written phone and skips the target check', async () => {
    const checks = await service({ stage: { ...STAGE, patientPhone: '+54 9 261', replyTimeoutMs: 1000 } }).checks();
    expect(states(checks)).toMatchObject({ settings: 'failed', guard: 'skipped' });
    expect(checks.checks[0]?.fix).toContain('Write it like 5492611234567');
    expect(checks.ready).toBe(false);
  });

  it('refuses production without trying to read anything', async () => {
    sessions.save(SESSION);
    const { calls, connect } = countingConnect();
    const checks = await service({ stage: { ...STAGE, projectId: 'salud-prod', replyTimeoutMs: 1000 } }, connect).checks();
    expect(states(checks)).toMatchObject({ guard: 'failed', readAccess: 'skipped', clinic: 'skipped' });
    expect(calls.count).toBe(0);
  });

  it('says "Not signed in" without a session and skips the account check', async () => {
    const checks = await service().checks();
    expect(checks.checks[2]).toMatchObject({ state: 'failed', message: 'Not signed in', fix: 'Click Sign in with Google.' });
    expect(states(checks)).toMatchObject({ domain: 'skipped', readAccess: 'skipped' });
    expect(checks.account).toBeNull();
  });

  it('explains a damaged sign-in file', async () => {
    writeFileSync(join(dir, 'google-session.json'), '{"email": "jua');
    const checks = await service().checks();
    expect(checks.checks[2]).toMatchObject({ state: 'failed', message: 'Not signed in (the saved sign-in was damaged)' });
  });

  it('fails the account check for another domain', async () => {
    sessions.save({ ...SESSION, email: 'juan@gmail.com' });
    const checks = await service().checks();
    expect(checks.checks[3]).toMatchObject({ state: 'failed' });
    expect(checks.checks[3]?.message).toContain('prestobots.com');
  });

  it('in demo mode runs checks 1–4 and skips 5–6 with the demo note', async () => {
    sessions.save(SESSION);
    const { calls, connect } = countingConnect();
    const checks = await service({ mode: 'demo' }, connect).checks();
    expect(states(checks)).toEqual({
      settings: 'passed',
      guard: 'passed',
      signedIn: 'passed',
      domain: 'passed',
      readAccess: 'skipped',
      clinic: 'skipped',
    });
    expect(checks.checks[4]?.message).toBe('Only needed for the real bot (CHATBOT_MODE=stage)');
    expect(calls.count).toBe(0);
  });

  it('notes that the old key-file setting is no longer used (FR-8)', () => {
    expect(service({ legacyKeyFileSet: true }).notes()).toContain(
      'STAGE_SERVICE_ACCOUNT_FILE is no longer used; sign in with Google in Settings instead.'
    );
    expect(service().notes()).not.toContain('STAGE_SERVICE_ACCOUNT_FILE is no longer used; sign in with Google in Settings instead.');
  });
});

describe('StageService checks 5–6 (FR-11, FR-12, FR-13, FR-14)', () => {
  const failing = (error: Error) => countingConnect(async () => {
    throw error;
  }).connect;

  beforeEach(() => sessions.save(SESSION));

  it('passes both when the QA clinic can be read', async () => {
    let disposed = 0;
    const connect: StageConnect = async () => ({ target: 'salud-stage · TESTING MACENA', dispose: async () => void (disposed += 1) });
    const checks = await service({}, connect).checks();
    expect(states(checks)).toMatchObject({ readAccess: 'passed', clinic: 'passed' });
    expect(checks.checks[5]?.message).toBe('salud-stage · TESTING MACENA');
    expect(checks.ready).toBe(true);
    expect(disposed).toBe(1);
  });

  it('explains a missing read permission, naming the account', async () => {
    const checks = await service({}, failing(new ReadAccessError('juan@prestobots.com', 'salud-stage'))).checks();
    expect(checks.checks[4]).toMatchObject({
      state: 'failed',
      message: "Your account juan@prestobots.com can't read salud-stage. Ask Pachi for read access (Cloud Datastore Viewer) on salud-stage.",
    });
    expect(states(checks)).toMatchObject({ clinic: 'skipped' });
    expect(checks.ready).toBe(false);
  });

  it('asks to sign in again when the sign-in expired', async () => {
    const checks = await service({}, failing(new SignInExpiredError())).checks();
    expect(checks.checks[4]).toMatchObject({
      state: 'failed',
      message: 'Your Google sign-in expired. Sign in again in Settings.',
      fix: 'Click Sign in with Google.',
    });
  });

  it('passes read access but fails the clinic when the clinic is wrong', async () => {
    const checks = await service({}, failing(new StepError('The QA clinic «qa» does not exist in salud-stage.'))).checks();
    expect(states(checks)).toMatchObject({ readAccess: 'passed', clinic: 'failed' });
    expect(checks.checks[5]?.message).toBe('The QA clinic «qa» does not exist in salud-stage.');
  });

  it.each([
    ['Google is unreachable', new FirestoreUnavailableError('getaddrinfo ENOTFOUND firestore.googleapis.com')],
    ['something unexpected happens', new Error('socket hang up')],
  ])('reports "could not reach salud-stage" when %s', async (_label, error) => {
    const checks = await service({}, failing(error)).checks();
    expect(checks.checks[4]?.state).toBe('failed');
    expect(checks.checks[4]?.message).toMatch(/^Could not reach salud-stage: /);
    expect(checks.checks[4]?.fix).toBe('Check your internet connection and click Check again');
    expect(states(checks)).toMatchObject({ clinic: 'skipped' });
  });
});

describe('StageService cache (FR-6, FR-15)', () => {
  beforeEach(() => sessions.save(SESSION));

  it('reuses the result for 60 seconds, then checks again', async () => {
    const clock = { now: 0 };
    const { calls, connect } = countingConnect();
    const stage = service({ now: () => clock.now }, connect);
    await stage.checks();
    clock.now += 59_000;
    await stage.checks();
    expect(calls.count).toBe(1);
    clock.now += 2000;
    await stage.checks();
    expect(calls.count).toBe(2);
  });

  it('checks again when asked for a fresh result or after invalidate()', async () => {
    const { calls, connect } = countingConnect();
    const stage = service({ now: () => 0 }, connect);
    await stage.checks();
    await stage.checks({ fresh: true });
    expect(calls.count).toBe(2);
    stage.invalidate();
    await stage.checks();
    expect(calls.count).toBe(3);
  });

  it('clears the cache when the sign-in expires during a check', async () => {
    let expired = true;
    const { calls, connect } = countingConnect(async () => {
      if (expired) throw new SignInExpiredError();
      return { target: 'salud-stage · TESTING MACENA' };
    });
    const stage = service({ now: () => 0 }, connect);
    expect((await stage.checks()).ready).toBe(false);
    expired = false;
    expect((await stage.checks()).ready).toBe(true);
    expect(calls.count).toBe(2);
  });

  it('does not keep a "could not reach salud-stage" result', async () => {
    let down = true;
    const { calls, connect } = countingConnect(async () => {
      if (down) throw new FirestoreUnavailableError('timeout');
      return { target: 'salud-stage · TESTING MACENA' };
    });
    const stage = service({ now: () => 0 }, connect);
    expect((await stage.checks()).ready).toBe(false);
    down = false;
    expect((await stage.checks()).ready).toBe(true);
    expect(calls.count).toBe(2);
  });
});

describe('stage checks API and status (FR-15)', () => {
  const appWith = async (stage: StageService) => {
    const store = new Store(':memory:');
    const ai = createAiFacade({ store, apiKey: undefined, models: { author: 'a', judge: 'j' }, defaultBudgetUsd: 20, mode: 'stage' });
    const channel = async () => new DemoChannel({ replyDelayMs: 1 });
    const runs = new RunManager(store, channel, 'stage', 'salud-stage');
    const app = await buildApp({
      store,
      runs,
      ai,
      generations: new GenerationManager(store, channel, 'stage', ai, runs),
      jira: createJiraService({ store, ai, client: undefined, status: { configured: false, labels: [], problems: [] } }),
      status: () => stage.status(),
      stage,
    });
    return { app, close: async () => { await app.close(); store.close(); } };
  };

  it('serves the checks, fresh on request, without any token', async () => {
    sessions.save(SESSION);
    const { calls, connect } = countingConnect();
    const { app, close } = await appWith(service({ now: () => 0 }, connect));
    const first = await app.inject({ method: 'GET', url: '/api/stage/checks' });
    expect(first.statusCode).toBe(200);
    expect(first.json<StageChecks>().ready).toBe(true);
    expect(first.body).not.toContain(SESSION.refreshToken);
    await app.inject({ method: 'GET', url: '/api/stage/checks' });
    expect(calls.count).toBe(1);
    await app.inject({ method: 'GET', url: '/api/stage/checks?fresh=1' });
    expect(calls.count).toBe(2);
    await close();
  });

  it('reports the real bot ready only when all six checks pass', async () => {
    sessions.save(SESSION);
    const { app, close } = await appWith(service({ now: () => 0 }));
    const ready = (await app.inject({ method: 'GET', url: '/api/status' })).json<{ ready: boolean; target: string; problems: string[] }>();
    expect(ready).toMatchObject({ ready: true, target: 'salud-stage · TESTING MACENA', problems: [] });
    await close();

    sessions.remove();
    const signedOut = await appWith(service({ now: () => 0 }));
    const notReady = (await signedOut.app.inject({ method: 'GET', url: '/api/status' })).json<{ ready: boolean; problems: string[] }>();
    expect(notReady.ready).toBe(false);
    expect(notReady.problems).toEqual(['Not signed in. Click Sign in with Google.']);
    await signedOut.close();
  });
});
