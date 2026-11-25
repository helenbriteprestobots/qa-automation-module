import { describe, expect, it } from 'vitest';

import { GOOGLE_SIGN_IN_ERRORS, googleSessionSchema, stageCheckSchema } from '../src/google.ts';

const SESSION = {
  email: 'juan@prestobots.com',
  refreshToken: '1//0g-refresh',
  scopes: ['openid', 'email', 'https://www.googleapis.com/auth/cloud-platform'],
  signedInAt: '2026-11-23T15:04:05.000Z',
};

describe('googleSessionSchema (FR-22)', () => {
  it('accepts a saved session', () => {
    expect(googleSessionSchema.parse(SESSION)).toEqual(SESSION);
  });

  it.each([
    ['a missing refresh token', { refreshToken: undefined }],
    ['an empty refresh token', { refreshToken: '' }],
    ['a bad email', { email: 'not-an-email' }],
    ['a date that is not ISO', { signedInAt: 'yesterday' }],
  ])('rejects %s', (_label, change) => {
    expect(googleSessionSchema.safeParse({ ...SESSION, ...change }).success).toBe(false);
  });
});

describe('stage check types (FR-2, FR-13)', () => {
  it('lists the five sign-in error codes', () => {
    expect([...GOOGLE_SIGN_IN_ERRORS]).toEqual([
      'expired-state',
      'cancelled',
      'exchange-failed',
      'wrong-domain',
      'unverified-email',
    ]);
  });

  it('validates a check row', () => {
    const row = { id: 'readAccess', label: 'Can read salud-stage', state: 'failed', message: 'No access', fix: 'Ask Pachi' };
    expect(stageCheckSchema.parse(row)).toEqual(row);
    expect(stageCheckSchema.safeParse({ ...row, state: 'broken' }).success).toBe(false);
  });
});
