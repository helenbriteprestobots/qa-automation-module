import { describe, expect, it } from 'vitest';

import { GOOGLE_SCOPES, assertGoogleRequest, guardedFetch } from '../src/stage/googleGuard.ts';
import { GuardError } from '../src/stage/guard.ts';

const FIRESTORE = 'https://firestore.googleapis.com/v1/projects/salud-stage/databases/(default)/documents';

describe('assertGoogleRequest (FR-10)', () => {
  it.each([
    'https://accounts.google.com/o/oauth2/v2/auth?client_id=x',
    'https://oauth2.googleapis.com/token',
    `${FIRESTORE}/organizations/qa-org?mask.fieldPaths=name`,
    `${FIRESTORE}:runQuery`,
    `${FIRESTORE}/conversations/c1:runQuery`,
  ])('allows %s', (url) => {
    expect(() => assertGoogleRequest(url, 'salud-stage')).not.toThrow();
  });

  it.each([
    ['plain http', 'http://oauth2.googleapis.com/token'],
    ['another host', 'https://example.com/token'],
    ['a look-alike host', 'https://oauth2.googleapis.com.evil.test/token'],
    ['the userinfo host', 'https://openidconnect.googleapis.com/v1/userinfo'],
    ['production data', 'https://firestore.googleapis.com/v1/projects/salud-prod/databases/(default)/documents/x'],
    ['another Firestore database', 'https://firestore.googleapis.com/v1/projects/salud-stage/databases/other/documents/x'],
    ['a Firestore admin path', 'https://firestore.googleapis.com/v1/projects/salud-stage/databases/(default)/indexes'],
    ['not a URL', 'nonsense'],
  ])('refuses %s', (_label, url) => {
    expect(() => assertGoogleRequest(url, 'salud-stage')).toThrow(GuardError);
  });

  it('refuses a project that is not on the allow-list', () => {
    expect(() =>
      assertGoogleRequest('https://firestore.googleapis.com/v1/projects/salud-prod/databases/(default)/documents/x', 'salud-prod')
    ).toThrow(GuardError);
    expect(() => assertGoogleRequest('https://oauth2.googleapis.com/token', 'salud-prod')).toThrow(GuardError);
  });

  it('asks only for the three scopes the spec allows', () => {
    expect([...GOOGLE_SCOPES]).toEqual(['openid', 'email', 'https://www.googleapis.com/auth/cloud-platform']);
  });
});

describe('guardedFetch (FR-10)', () => {
  it('never calls the real fetch for a refused request', async () => {
    let calls = 0;
    const inner = (async () => {
      calls += 1;
      return new Response('ok');
    }) as typeof fetch;
    const guarded = guardedFetch(inner, 'salud-stage');
    await expect(guarded('https://example.com/x')).rejects.toThrow(GuardError);
    expect(calls).toBe(0);
    await guarded('https://oauth2.googleapis.com/token', { method: 'POST' });
    expect(calls).toBe(1);
  });
});
