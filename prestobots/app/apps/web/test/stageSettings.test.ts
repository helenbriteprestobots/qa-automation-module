import { describe, expect, it } from 'vitest';

import { checkSymbol, signInNotice } from '../src/stageSettings';

describe('signInNotice (FR-2, FR-3, FR-4, FR-5)', () => {
  it('confirms a finished sign-in', () => {
    expect(signInNotice('?google=signed-in')).toEqual({ kind: 'success', text: 'You are signed in with Google.' });
  });

  it.each([
    ['expired-state', 'The sign-in link expired or was not started here. Click Sign in with Google again.'],
    ['cancelled', 'You cancelled the Google sign-in. Try again.'],
    ['exchange-failed', 'Google did not complete the sign-in. Try again.'],
  ])('explains %s', (reason, text) => {
    expect(signInNotice(`?google=error&reason=${reason}`)).toEqual({ kind: 'error', text });
  });

  it.each(['wrong-domain', 'unverified-email'])('names the account for %s', (reason) => {
    expect(signInNotice(`?google=error&reason=${reason}&email=juan%40gmail.com`)).toEqual({
      kind: 'error',
      text: 'Sign in with your prestobots.com account (you used juan@gmail.com).',
    });
  });

  it('falls back to a generic message for an unknown reason', () => {
    expect(signInNotice('?google=error&reason=strange')).toEqual({ kind: 'error', text: 'Sign-in failed. Try again.' });
  });

  it('shows nothing when the page was not opened by a sign-in', () => {
    expect(signInNotice('')).toBeNull();
    expect(signInNotice('?tab=ai')).toBeNull();
  });
});

describe('checkSymbol (FR-13)', () => {
  it('marks each state', () => {
    expect(checkSymbol('passed')).toBe('✔');
    expect(checkSymbol('failed')).toBe('✘');
    expect(checkSymbol('skipped')).toBe('–');
  });
});
