import { describe, expect, it } from 'vitest';

import { StepError } from '../src/channels/types.ts';
import { SignInExpiredError, createAccessTokenProvider } from '../src/stage/googleToken.ts';

const tokenEndpoint = (responses: Array<{ status: number; body: unknown }>) => {
  const calls: Array<{ url: string; body: string }> = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), body: String(init?.body ?? '') });
    const next = responses.shift() ?? { status: 500, body: {} };
    return new Response(JSON.stringify(next.body), { status: next.status });
  }) as typeof fetch;
  return { calls, fetchImpl };
};

const options = (fetchImpl: typeof fetch, clock: { now: number }) => ({
  clientId: 'client-id',
  clientSecret: 'client-secret',
  refreshToken: 'refresh-1',
  projectId: 'salud-stage',
  fetch: fetchImpl,
  now: () => clock.now,
});

describe('createAccessTokenProvider (FR-11)', () => {
  it('refreshes once, reuses the token until 60 s before it expires, then refreshes again', async () => {
    const clock = { now: 1_000_000 };
    const { calls, fetchImpl } = tokenEndpoint([
      { status: 200, body: { access_token: 'access-1', expires_in: 3600 } },
      { status: 200, body: { access_token: 'access-2', expires_in: 3600 } },
    ]);
    const provider = createAccessTokenProvider(options(fetchImpl, clock));

    expect(await provider.token()).toBe('access-1');
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe('https://oauth2.googleapis.com/token');
    const body = new URLSearchParams(calls[0]?.body);
    expect(body.get('grant_type')).toBe('refresh_token');
    expect(body.get('refresh_token')).toBe('refresh-1');
    expect(body.get('client_id')).toBe('client-id');

    clock.now += (3600 - 61) * 1000;
    expect(await provider.token()).toBe('access-1');
    expect(calls).toHaveLength(1);

    clock.now += 2000;
    expect(await provider.token()).toBe('access-2');
    expect(calls).toHaveLength(2);
  });

  it('refreshes before the cached token runs out when asked to', async () => {
    const clock = { now: 0 };
    const { calls, fetchImpl } = tokenEndpoint([
      { status: 200, body: { access_token: 'access-1', expires_in: 3600 } },
      { status: 200, body: { access_token: 'access-2', expires_in: 3600 } },
    ]);
    const provider = createAccessTokenProvider(options(fetchImpl, clock));
    await provider.token();
    expect(await provider.token(true)).toBe('access-2');
    expect(calls).toHaveLength(2);
  });

  it('reports an expired or revoked sign-in in plain words', async () => {
    const { fetchImpl } = tokenEndpoint([{ status: 400, body: { error: 'invalid_grant', error_description: 'Token has been expired or revoked.' } }]);
    const provider = createAccessTokenProvider(options(fetchImpl, { now: 0 }));
    expect(provider.expired()).toBe(false);

    const error = await provider.token().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(SignInExpiredError);
    expect(error).toBeInstanceOf(StepError);
    expect((error as Error).message).toBe('Your Google sign-in expired. Sign in again in Settings.');
    expect(provider.expired()).toBe(true);
  });

  it('explains other token failures without the token in the message', async () => {
    const { fetchImpl } = tokenEndpoint([{ status: 503, body: { error: 'unavailable' } }]);
    const provider = createAccessTokenProvider(options(fetchImpl, { now: 0 }));
    const error = (await provider.token().catch((e: unknown) => e)) as Error;
    expect(error).toBeInstanceOf(StepError);
    expect(error).not.toBeInstanceOf(SignInExpiredError);
    expect(error.message).toContain('503');
    expect(error.message).not.toContain('refresh-1');
    expect(provider.expired()).toBe(false);
  });
});
