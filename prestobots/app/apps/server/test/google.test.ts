import { mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { GoogleSession } from '@ctp/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';


import { DemoChannel } from '@ctp/runner';

import { createAiFacade } from '../src/ai.ts';
import { buildApp } from '../src/app.ts';
import { Store } from '../src/db.ts';
import { GenerationManager } from '../src/generation/generationManager.ts';
import { createJiraService } from '../src/jira/service.ts';
import { RunManager } from '../src/runManager.ts';
import { SessionStore } from '../src/google/sessionStore.ts';
import { GoogleSignIn, type GoogleSignInOptions } from '../src/google/signIn.ts';

const SESSION: GoogleSession = {
  email: 'juan@prestobots.com',
  refreshToken: '1//0g-secret-refresh-token',
  scopes: ['openid', 'email', 'https://www.googleapis.com/auth/cloud-platform'],
  signedInAt: '2026-11-23T15:04:05.000Z',
};

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ctp-google-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('SessionStore (FR-6, FR-21, FR-22)', () => {
  it('saves the session for the owner only, without leftovers', () => {
    const file = join(dir, 'secrets', 'google-session.json');
    const store = new SessionStore(file);
    store.save(SESSION);
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(statSync(join(dir, 'secrets')).mode & 0o777).toBe(0o700);
    expect(readdirSync(join(dir, 'secrets'))).toEqual(['google-session.json']);
    expect(store.read()).toEqual({ session: SESSION });
  });

  it('reports a missing file', () => {
    expect(new SessionStore(join(dir, 'none.json')).read()).toEqual({ missing: true });
  });

  it.each([
    ['truncated JSON', '{"email": "juan@prest'],
    ['a file that is not a session', JSON.stringify({ email: 'juan@prestobots.com' })],
  ])('treats %s as damaged', (_label, content) => {
    const file = join(dir, 'google-session.json');
    writeFileSync(file, content);
    expect(new SessionStore(file).read()).toEqual({ damaged: true });
  });

  it('removes the session, and does not fail when there is none', () => {
    const file = join(dir, 'google-session.json');
    const store = new SessionStore(file);
    store.save(SESSION);
    store.remove();
    expect(store.read()).toEqual({ missing: true });
    expect(() => store.remove()).not.toThrow();
  });
});

const PORT = 4000;

const signIn = (change: Partial<GoogleSignInOptions> = {}) =>
  new GoogleSignIn({
    clientId: 'default-client.apps.googleusercontent.com',
    clientSecret: 'default-secret',
    port: PORT,
    projectId: 'salud-stage',
    sessions: new SessionStore(join(dir, 'secrets', 'google-session.json')),
    ...change,
  });

describe('GoogleSignIn.start (FR-1, FR-7, FR-10)', () => {
  it('sends the admin to Google with the right client, scopes and a fresh state', () => {
    const url = new URL(signIn().start('http://localhost:5173'));
    expect(`${url.origin}${url.pathname}`).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    const params = url.searchParams;
    expect(params.get('client_id')).toBe('default-client.apps.googleusercontent.com');
    expect(params.get('redirect_uri')).toBe('http://127.0.0.1:4000/api/google/callback');
    expect(params.get('response_type')).toBe('code');
    expect(params.get('scope')).toBe('openid email https://www.googleapis.com/auth/cloud-platform');
    expect(params.get('state')).toMatch(/^[0-9a-f]{32}$/);
    expect(params.get('code_challenge')).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(params.get('code_challenge_method')).toBe('S256');
    expect(params.get('access_type')).toBe('offline');
    expect(params.get('prompt')).toBe('consent');
  });

  it('uses the client set in .env', () => {
    const url = new URL(signIn({ clientId: 'own.apps.googleusercontent.com' }).start(undefined));
    expect(url.searchParams.get('client_id')).toBe('own.apps.googleusercontent.com');
  });

  it('gives each sign-in its own state', () => {
    const flow = signIn();
    const a = new URL(flow.start(undefined)).searchParams.get('state');
    const b = new URL(flow.start(undefined)).searchParams.get('state');
    expect(a).not.toBe(b);
  });

  it.each([
    ['the Vite page', 'http://localhost:5173', 'http://localhost:5173'],
    ['the platform page', 'http://127.0.0.1:4000', 'http://127.0.0.1:4000'],
    ['another site', 'http://evil.test', 'http://localhost:4000'],
    ['another port', 'http://localhost:9999', 'http://localhost:4000'],
    ['https on localhost', 'https://localhost:5173', 'http://localhost:4000'],
    ['nothing', undefined, 'http://localhost:4000'],
  ])('remembers the starting page only when it is %s', (_label, from, origin) => {
    const flow = signIn();
    const state = new URL(flow.start(from)).searchParams.get('state') ?? '';
    expect(flow.pendingOrigin(state)).toBe(origin);
  });
});

/** An id_token as Google returns it (only the payload matters here). */
const idToken = (claims: Record<string, unknown>) =>
  ['header', Buffer.from(JSON.stringify(claims)).toString('base64url'), 'signature'].join('.');

/** Fake Google token endpoint. */
const tokenEndpoint = (reply: { status: number; body: Record<string, unknown> }) => {
  const calls: Array<{ url: string; body: URLSearchParams }> = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), body: new URLSearchParams(String(init?.body ?? '')) });
    return new Response(JSON.stringify(reply.body), { status: reply.status });
  }) as typeof fetch;
  return { calls, fetchImpl };
};

const GOOD_TOKENS = {
  access_token: 'access-1',
  refresh_token: '1//0g-secret-refresh-token',
  scope: 'openid https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/cloud-platform',
  id_token: idToken({ email: 'juan@prestobots.com', email_verified: true }),
};

describe('GoogleSignIn.finish (FR-2, FR-3, FR-4, FR-5)', () => {
  const begin = (flow: GoogleSignIn, from = 'http://localhost:5173') => new URL(flow.start(from)).searchParams.get('state') ?? '';

  it('saves the sign-in and sends the admin back to the starting page', async () => {
    const clock = { now: Date.parse('2026-11-23T15:00:00.000Z') };
    const { calls, fetchImpl } = tokenEndpoint({ status: 200, body: GOOD_TOKENS });
    let signedIn = 0;
    const sessions = new SessionStore(join(dir, 'secrets', 'google-session.json'));
    const flow = signIn({ fetch: fetchImpl, now: () => clock.now, sessions, onSignedIn: () => (signedIn += 1) });
    const consent = new URL(flow.start('http://localhost:5173'));
    const state = consent.searchParams.get('state') ?? '';

    expect(await flow.finish({ code: 'code-1', state })).toEqual({ origin: 'http://localhost:5173', email: 'juan@prestobots.com' });
    expect(calls[0]?.url).toBe('https://oauth2.googleapis.com/token');
    const body = calls[0]?.body;
    expect(body?.get('grant_type')).toBe('authorization_code');
    expect(body?.get('code')).toBe('code-1');
    expect(body?.get('redirect_uri')).toBe('http://127.0.0.1:4000/api/google/callback');
    const verifier = body?.get('code_verifier') ?? '';
    const { createHash } = await import('node:crypto');
    expect(createHash('sha256').update(verifier).digest('base64url')).toBe(consent.searchParams.get('code_challenge'));

    expect(sessions.read()).toEqual({
      session: {
        email: 'juan@prestobots.com',
        refreshToken: '1//0g-secret-refresh-token',
        scopes: GOOD_TOKENS.scope.split(' '),
        signedInAt: '2026-11-23T15:00:00.000Z',
      },
    });
    expect(signedIn).toBe(1);
  });

  it('accepts a prestobots.com address written in capitals', async () => {
    const { fetchImpl } = tokenEndpoint({
      status: 200,
      body: { ...GOOD_TOKENS, id_token: idToken({ email: 'Juan@PrestoBots.com', email_verified: true }) },
    });
    const flow = signIn({ fetch: fetchImpl });
    expect(await flow.finish({ code: 'c', state: begin(flow) })).toMatchObject({ email: 'Juan@PrestoBots.com' });
  });

  it.each([
    ['used twice', 'twice'],
    ['unknown', 'unknown'],
    ['older than 10 minutes', 'old'],
  ])('refuses a state that is %s and saves nothing', async (_label, kind) => {
    const clock = { now: 0 };
    const { fetchImpl, calls } = tokenEndpoint({ status: 200, body: GOOD_TOKENS });
    const sessions = new SessionStore(join(dir, 'secrets', 'google-session.json'));
    const flow = signIn({ fetch: fetchImpl, now: () => clock.now, sessions });
    let state = begin(flow);
    if (kind === 'twice') {
      await flow.finish({ code: 'c', state });
      sessions.remove();
      calls.length = 0;
    }
    if (kind === 'unknown') state = 'f'.repeat(32);
    if (kind === 'old') clock.now += 11 * 60 * 1000;

    expect(await flow.finish({ code: 'c', state })).toEqual({ origin: 'http://localhost:4000', reason: 'expired-state' });
    expect(calls).toHaveLength(0);
    expect(sessions.read()).toEqual({ missing: true });
  });

  it('reports a sign-in cancelled on Google', async () => {
    const flow = signIn();
    expect(await flow.finish({ error: 'access_denied', state: begin(flow) })).toEqual({
      origin: 'http://localhost:5173',
      reason: 'cancelled',
    });
  });

  it.each([
    ['Google refuses the code', { status: 400, body: { error: 'invalid_grant' } }],
    ['no refresh token comes back', { status: 200, body: { ...GOOD_TOKENS, refresh_token: undefined } }],
    ['no id token comes back', { status: 200, body: { ...GOOD_TOKENS, id_token: undefined } }],
  ])('reports a failed exchange when %s', async (_label, reply) => {
    const { fetchImpl } = tokenEndpoint(reply);
    const sessions = new SessionStore(join(dir, 'secrets', 'google-session.json'));
    const flow = signIn({ fetch: fetchImpl, sessions });
    expect(await flow.finish({ code: 'c', state: begin(flow) })).toMatchObject({ reason: 'exchange-failed' });
    expect(sessions.read()).toEqual({ missing: true });
  });

  it.each([
    ['another domain', { email: 'juan@gmail.com', email_verified: true }, 'wrong-domain'],
    ['an unverified email', { email: 'juan@prestobots.com', email_verified: false }, 'unverified-email'],
  ])('refuses %s and saves nothing', async (_label, claims, reason) => {
    const { fetchImpl } = tokenEndpoint({ status: 200, body: { ...GOOD_TOKENS, id_token: idToken(claims) } });
    const sessions = new SessionStore(join(dir, 'secrets', 'google-session.json'));
    const flow = signIn({ fetch: fetchImpl, sessions });
    expect(await flow.finish({ code: 'c', state: begin(flow) })).toEqual({
      origin: 'http://localhost:5173',
      reason,
      email: claims.email,
    });
    expect(sessions.read()).toEqual({ missing: true });
  });
});

/** The platform with only what the Google routes need. */
const appWithGoogle = async (flow: GoogleSignIn, sessions: SessionStore, onSignedOut?: () => void) => {
  const store = new Store(':memory:');
  const ai = createAiFacade({ store, apiKey: undefined, models: { author: 'a', judge: 'j' }, defaultBudgetUsd: 20, mode: 'demo' });
  const channel = async () => new DemoChannel({ replyDelayMs: 1 });
  const runs = new RunManager(store, channel, 'demo', 'Demo bot');
  const app = await buildApp({
    store,
    runs,
    ai,
    generations: new GenerationManager(store, channel, 'demo', ai, runs),
    jira: createJiraService({ store, ai, client: undefined, status: { configured: false, labels: [], problems: [] } }),
    status: async () => ({ mode: 'demo', target: 'Demo bot', ready: true, problems: [], notes: [] }),
    google: { signIn: flow, sessions, onSignedOut },
  });
  return { app, close: async () => { await app.close(); store.close(); } };
};

describe('Google routes (FR-1, FR-2, FR-3, FR-6, FR-21)', () => {
  const setup = async (reply = { status: 200, body: GOOD_TOKENS as Record<string, unknown> }) => {
    const sessions = new SessionStore(join(dir, 'secrets', 'google-session.json'));
    const { fetchImpl } = tokenEndpoint(reply);
    const flow = signIn({ fetch: fetchImpl, sessions });
    let signedOut = 0;
    const platform = await appWithGoogle(flow, sessions, () => (signedOut += 1));
    return { ...platform, sessions, signedOut: () => signedOut };
  };

  const startSignIn = async (app: Awaited<ReturnType<typeof setup>>['app']) => {
    const response = await app.inject({ method: 'GET', url: '/api/google/sign-in?from=http://localhost:5173' });
    expect(response.statusCode).toBe(302);
    const location = String(response.headers.location);
    expect(location.startsWith('https://accounts.google.com/o/oauth2/v2/auth?')).toBe(true);
    return new URL(location).searchParams.get('state') ?? '';
  };

  it('signs in, sends the admin back to Settings and never shows the token', async () => {
    const { app, close, sessions } = await setup();
    const state = await startSignIn(app);
    const callback = await app.inject({ method: 'GET', url: `/api/google/callback?code=c&state=${state}` });
    expect(callback.statusCode).toBe(302);
    expect(callback.headers.location).toBe('http://localhost:5173/settings?google=signed-in');
    expect('session' in sessions.read()).toBe(true);
    for (const response of [callback]) {
      expect(response.body).not.toContain(GOOD_TOKENS.refresh_token);
      expect(String(response.headers.location)).not.toContain(GOOD_TOKENS.refresh_token);
    }
    await close();
  });

  it('sends each failure back as a reason code', async () => {
    const { app, close } = await setup({
      status: 200,
      body: { ...GOOD_TOKENS, id_token: idToken({ email: 'juan@gmail.com', email_verified: true }) },
    });
    const wrong = await app.inject({ method: 'GET', url: `/api/google/callback?code=c&state=${await startSignIn(app)}` });
    expect(wrong.headers.location).toBe('http://localhost:5173/settings?google=error&reason=wrong-domain&email=juan%40gmail.com');

    const expired = await app.inject({ method: 'GET', url: '/api/google/callback?code=c&state=nope' });
    expect(expired.headers.location).toBe('http://localhost:4000/settings?google=error&reason=expired-state');

    const cancelled = await app.inject({
      method: 'GET',
      url: `/api/google/callback?error=access_denied&state=${await startSignIn(app)}`,
    });
    expect(cancelled.headers.location).toBe('http://localhost:5173/settings?google=error&reason=cancelled');
    await close();
  });

  it('signs out by deleting the saved sign-in', async () => {
    const { app, close, sessions, signedOut } = await setup();
    await app.inject({ method: 'GET', url: `/api/google/callback?code=c&state=${await startSignIn(app)}` });
    const response = await app.inject({ method: 'POST', url: '/api/google/sign-out' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ signedIn: false });
    expect(sessions.read()).toEqual({ missing: true });
    expect(signedOut()).toBe(1);
    await close();
  });
});
