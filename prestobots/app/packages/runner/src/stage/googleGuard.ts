import { ALLOWED_PROJECTS, GuardError } from './guard.ts';

/**
 * Safety rules for every request the platform sends to Google with the admin's sign-in: only the
 * sign-in pages, the token service and salud-stage's Firestore data, nothing else.
 */

/** The only permissions the platform asks Google for. */
export const GOOGLE_SCOPES = ['openid', 'email', 'https://www.googleapis.com/auth/cloud-platform'] as const;

const SIGN_IN_HOSTS = ['accounts.google.com', 'oauth2.googleapis.com'];
const FIRESTORE_HOST = 'firestore.googleapis.com';

export const assertGoogleRequest = (url: string, projectId: string): void => {
  if (!(ALLOWED_PROJECTS as readonly string[]).includes(projectId)) {
    throw new GuardError(
      `Project «${projectId}» is not allowed. The platform only reads: ${ALLOWED_PROJECTS.join(', ')}.`
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new GuardError('The platform tried to call Google with an invalid address. Refusing.');
  }
  if (parsed.protocol !== 'https:') {
    throw new GuardError('Requests to Google must use https://. Refusing.');
  }
  if (SIGN_IN_HOSTS.includes(parsed.hostname)) return;

  if (parsed.hostname === FIRESTORE_HOST) {
    const base = `/v1/projects/${projectId}/databases/(default)/documents`;
    const rest = parsed.pathname.slice(base.length);
    if (parsed.pathname.startsWith(base) && (rest === '' || rest.startsWith('/') || rest.startsWith(':'))) return;
    throw new GuardError(`The platform only reads data from «${projectId}». Refusing a request to ${parsed.pathname}.`);
  }

  throw new GuardError(`«${parsed.hostname}» is not one of the Google addresses the platform may use. Refusing.`);
};

/** A `fetch` that refuses, before sending, any request the Google rules above don't allow. */
export const guardedFetch =
  (fetchImpl: typeof fetch, projectId: string): typeof fetch =>
  async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    assertGoogleRequest(url, projectId);
    return fetchImpl(input, init);
  };
