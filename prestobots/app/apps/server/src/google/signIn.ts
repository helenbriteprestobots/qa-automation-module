import { createHash, randomBytes } from 'node:crypto';

import { GOOGLE_SCOPES, assertGoogleRequest, guardedFetch } from '@ctp/runner';
import type { GoogleSignInError } from '@ctp/shared';

import type { SessionStore } from './sessionStore.ts';

/**
 * "Sign in with Google" for a program running on this computer (OAuth for installed apps):
 * Google sends the admin back to the platform on 127.0.0.1, with a one-time `state` and PKCE.
 */

export interface GoogleSignInOptions {
  clientId: string;
  clientSecret: string;
  /** Port of the platform server (Google sends the admin back here). */
  port: number;
  projectId: string;
  sessions: SessionStore;
  fetch?: typeof fetch;
  now?: () => number;
  /** Called after a new sign-in is saved (to refresh the connection check). */
  onSignedIn?: () => void;
}

export type SignInOutcome =
  | { origin: string; email: string }
  | { origin: string; reason: GoogleSignInError; email?: string };

const CONSENT_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const ALLOWED_DOMAIN = '@prestobots.com';
/** Port of the Vite page in development. */
const DEV_WEB_PORT = 5173;
const STATE_TTL_MS = 10 * 60 * 1000;

const base64url = (buffer: Buffer): string => buffer.toString('base64url');

export class GoogleSignIn {
  private readonly pending = new Map<string, { origin: string; verifier: string; at: number }>();
  private readonly now: () => number;

  constructor(private readonly options: GoogleSignInOptions) {
    this.now = options.now ?? Date.now;
  }

  get redirectUri(): string {
    return `http://127.0.0.1:${this.options.port}/api/google/callback`;
  }

  /** The platform's own address, used when the starting page is not one we know. */
  get defaultOrigin(): string {
    return `http://localhost:${this.options.port}`;
  }

  /** Google's consent page for a new sign-in started from the page at `from`. */
  start(from: string | undefined): string {
    const allowed = new RegExp(`^http://(localhost|127\\.0\\.0\\.1):(${this.options.port}|${DEV_WEB_PORT})$`);
    const origin = from && allowed.test(from) ? from : this.defaultOrigin;
    const state = randomBytes(16).toString('hex');
    const verifier = base64url(randomBytes(32));
    this.dropOld();
    this.pending.set(state, { origin, verifier, at: this.now() });

    const url = new URL(CONSENT_URL);
    url.search = new URLSearchParams({
      client_id: this.options.clientId,
      redirect_uri: this.redirectUri,
      response_type: 'code',
      scope: GOOGLE_SCOPES.join(' '),
      state,
      code_challenge: base64url(createHash('sha256').update(verifier).digest()),
      code_challenge_method: 'S256',
      access_type: 'offline',
      prompt: 'consent',
    }).toString();
    assertGoogleRequest(url.href, this.options.projectId);
    return url.href;
  }

  /** Handles Google's redirect back: checks the state, gets the tokens and saves the session. */
  async finish(query: { code?: string; state?: string; error?: string }): Promise<SignInOutcome> {
    const entry = query.state ? this.pending.get(query.state) : undefined;
    if (query.state) this.pending.delete(query.state);
    if (!entry || this.now() - entry.at > STATE_TTL_MS) return { origin: this.defaultOrigin, reason: 'expired-state' };
    const { origin } = entry;
    if (query.error) return { origin, reason: 'cancelled' };
    if (!query.code) return { origin, reason: 'exchange-failed' };

    const fetchImpl = guardedFetch(this.options.fetch ?? fetch, this.options.projectId);
    let tokens: { refresh_token?: unknown; id_token?: unknown; scope?: unknown };
    try {
      const response = await fetchImpl(TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code: query.code,
          code_verifier: entry.verifier,
          client_id: this.options.clientId,
          client_secret: this.options.clientSecret,
          redirect_uri: this.redirectUri,
        }),
      });
      if (!response.ok) return { origin, reason: 'exchange-failed' };
      tokens = (await response.json()) as typeof tokens;
    } catch {
      return { origin, reason: 'exchange-failed' };
    }
    if (typeof tokens.refresh_token !== 'string' || typeof tokens.id_token !== 'string') {
      return { origin, reason: 'exchange-failed' };
    }

    // The id_token comes straight from Google over https, so its claims can be read without checking the signature.
    let claims: { email?: unknown; email_verified?: unknown };
    try {
      claims = JSON.parse(Buffer.from(tokens.id_token.split('.')[1] ?? '', 'base64url').toString('utf8')) as typeof claims;
    } catch {
      return { origin, reason: 'exchange-failed' };
    }
    if (typeof claims.email !== 'string') return { origin, reason: 'exchange-failed' };
    const email = claims.email;
    if (claims.email_verified !== true) return { origin, reason: 'unverified-email', email };
    if (!email.toLowerCase().endsWith(ALLOWED_DOMAIN)) return { origin, reason: 'wrong-domain', email };

    this.options.sessions.save({
      email,
      refreshToken: tokens.refresh_token,
      scopes: typeof tokens.scope === 'string' ? tokens.scope.split(' ') : [...GOOGLE_SCOPES],
      signedInAt: new Date(this.now()).toISOString(),
    });
    this.options.onSignedIn?.();
    return { origin, email };
  }

  /** Where a pending sign-in will send the admin back (for tests and the callback). */
  pendingOrigin(state: string): string | undefined {
    return this.pending.get(state)?.origin;
  }

  private dropOld(): void {
    const oldest = this.now() - STATE_TTL_MS;
    for (const [state, entry] of this.pending) {
      if (entry.at < oldest) this.pending.delete(state);
    }
  }
}
