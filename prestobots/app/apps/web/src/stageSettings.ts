import type { GoogleSignInError, StageCheck } from '@ctp/shared';

/** What the Settings page says after Google sends the admin back. */
export interface SignInNotice {
  kind: 'success' | 'error';
  text: string;
}

const ERROR_TEXTS: Record<GoogleSignInError, (email: string) => string> = {
  'expired-state': () => 'The sign-in link expired or was not started here. Click Sign in with Google again.',
  cancelled: () => 'You cancelled the Google sign-in. Try again.',
  'exchange-failed': () => 'Google did not complete the sign-in. Try again.',
  'wrong-domain': (email) => `Sign in with your prestobots.com account (you used ${email}).`,
  'unverified-email': (email) => `Sign in with your prestobots.com account (you used ${email}).`,
};

/** Reads `?google=…` from the page address. Null when the page was not opened by a sign-in. */
export const signInNotice = (search: string): SignInNotice | null => {
  const params = new URLSearchParams(search);
  const google = params.get('google');
  if (google === 'signed-in') return { kind: 'success', text: 'You are signed in with Google.' };
  if (google !== 'error') return null;
  const reason = params.get('reason') ?? '';
  const text = Object.hasOwn(ERROR_TEXTS, reason) ? ERROR_TEXTS[reason as GoogleSignInError] : undefined;
  return { kind: 'error', text: text ? text(params.get('email') ?? 'another account') : 'Sign-in failed. Try again.' };
};

const SYMBOLS: Record<StageCheck['state'], string> = { passed: '✔', failed: '✘', skipped: '–' };

export const checkSymbol = (state: StageCheck['state']): string => SYMBOLS[state];
