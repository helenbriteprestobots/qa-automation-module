import { StepError } from '../channels/types.ts';
import { guardedFetch } from './googleGuard.ts';

/** The admin's Google sign-in no longer works (expired, revoked or signed out). */
export class SignInExpiredError extends StepError {
  constructor(message = 'Your Google sign-in expired. Sign in again in Settings.') {
    super(message);
    this.name = 'SignInExpiredError';
  }
}

export interface AccessTokenOptions {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  projectId: string;
  fetch?: typeof fetch;
  now?: () => number;
}

export interface AccessTokenProvider {
  /** A valid access token. `force` gets a new one even if the cached one has not run out. */
  token(force?: boolean): Promise<string>;
  /** True once Google said the sign-in is expired or revoked. */
  expired(): boolean;
}

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
/** Get a new token this long before the current one runs out. */
const MARGIN_MS = 60_000;

/** Turns the saved refresh token into short-lived access tokens, as Google's sign-in requires. */
export const createAccessTokenProvider = (options: AccessTokenOptions): AccessTokenProvider => {
  const fetchImpl = guardedFetch(options.fetch ?? fetch, options.projectId);
  const now = options.now ?? Date.now;
  let cached: { token: string; expiresAt: number } | null = null;
  let isExpired = false;

  const refresh = async (): Promise<string> => {
    let response: Response;
    try {
      response = await fetchImpl(TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: options.refreshToken,
          client_id: options.clientId,
          client_secret: options.clientSecret,
        }),
      });
    } catch (error) {
      throw new StepError(`Could not reach Google's sign-in service: ${(error as Error).message}`);
    }
    const body = (await response.json().catch(() => ({}))) as {
      access_token?: unknown;
      expires_in?: unknown;
      error?: unknown;
    };
    if (body.error === 'invalid_grant') {
      isExpired = true;
      cached = null;
      throw new SignInExpiredError();
    }
    if (!response.ok || typeof body.access_token !== 'string') {
      const reason = typeof body.error === 'string' ? `: ${body.error}` : '';
      throw new StepError(`Google's sign-in service did not answer (HTTP ${response.status}${reason}).`);
    }
    const seconds = typeof body.expires_in === 'number' ? body.expires_in : 3600;
    cached = { token: body.access_token, expiresAt: now() + seconds * 1000 };
    return body.access_token;
  };

  return {
    token: async (force = false) => {
      if (!force && cached && cached.expiresAt - MARGIN_MS > now()) return cached.token;
      return refresh();
    },
    expired: () => isExpired,
  };
};
