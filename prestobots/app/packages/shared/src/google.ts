import { z } from 'zod';

import type { ChatMessage } from './chat.ts';

/**
 * The admin's Google sign-in, saved by the server in `app/secrets/google-session.json`.
 * Never sent to the web page.
 */
export const googleSessionSchema = z.object({
  email: z.string().email(),
  refreshToken: z.string().min(1),
  scopes: z.array(z.string()),
  /** ISO date. */
  signedInAt: z.string().datetime(),
});

export type GoogleSession = z.infer<typeof googleSessionSchema>;

/** Why a Google sign-in did not finish, as sent back to the Settings page. */
export const GOOGLE_SIGN_IN_ERRORS = [
  'expired-state',
  'cancelled',
  'exchange-failed',
  'wrong-domain',
  'unverified-email',
] as const;

export type GoogleSignInError = (typeof GOOGLE_SIGN_IN_ERRORS)[number];

/** The six checks the real bot needs, in the order they run. */
export const STAGE_CHECK_IDS = ['settings', 'guard', 'signedIn', 'domain', 'readAccess', 'clinic'] as const;

export type StageCheckId = (typeof STAGE_CHECK_IDS)[number];

export const stageCheckSchema = z.object({
  id: z.enum(STAGE_CHECK_IDS),
  label: z.string(),
  state: z.enum(['passed', 'failed', 'skipped']),
  message: z.string(),
  /** What to do, when the check failed. */
  fix: z.string().optional(),
});

export type StageCheck = z.infer<typeof stageCheckSchema>;

/** Result of the connection check. `ready` is true only when every check passed. */
export interface StageChecks {
  ready: boolean;
  account: { email: string } | null;
  checks: StageCheck[];
}

/** Result of "Send test hola". */
export interface TestMessageResult {
  sent: ChatMessage;
  replies: ChatMessage[];
  /** From the webhook's ACK to the bot's first saved reply, rounded to 0.1 s, never below 0. */
  replySeconds: number;
}
