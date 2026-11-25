import {
  FirestoreUnavailableError,
  ReadAccessError,
  SignInExpiredError,
  StepError,
  assertSafeAccount,
  assertSafeTarget,
} from '@ctp/runner';
import type { ChatMessage, ChatbotMode, PlatformStatus, StageCheck, StageCheckId, StageChecks, TestMessageResult } from '@ctp/shared';

import { stageSettingsProblems } from '../config.ts';
import type { SessionStore } from '../google/sessionStore.ts';

/** One conversation with the real bot, as used by "Send test hola". */
export interface TestSession {
  /** Ignores earlier messages, sends the reset message and collects the bot's replies. */
  prepare(signal: AbortSignal): Promise<ChatMessage[]>;
  /** When the webhook answered "ACK" (ms). */
  lastAcceptedAt(): number | undefined;
  close(): Promise<void>;
}

/** Opens a read-only connection to salud-stage (it reads the QA clinic first). */
export type StageConnect = (options?: { resetMessage?: string }) => Promise<{
  target: string;
  dispose?: () => Promise<void>;
  openSession?: () => Promise<TestSession>;
}>;

/** "Send test hola" can't be sent right now (something else uses the chatbot, or it is not ready). */
export class StageTestConflictError extends Error {}

export const TEST_MESSAGE_BUSY = "A test message is waiting for the bot's reply. Try again in a few seconds.";

/** "Send test hola" did not get a reply. The message says which half failed and what to check. */
export class StageTestFailedError extends Error {}

export interface StageServiceOptions {
  mode: ChatbotMode;
  stage: {
    projectId: string;
    orgId?: string;
    webhookUrl?: string;
    patientPhone?: string;
    resetMessage?: string;
    replyTimeoutMs: number;
  };
  sessions: SessionStore;
  /** STAGE_SERVICE_ACCOUNT_FILE is still in .env (FR-8). */
  legacyKeyFileSet: boolean;
  connect: StageConnect;
  /** A reason when a run or "Generate test cases" is using the chatbot. */
  busyElsewhere?: () => string | null;
  now?: () => number;
}

/** The part of /api/status that depends on the chatbot. */
export type BaseStatus = Omit<PlatformStatus, 'activeRunId' | 'activeGenerationId' | 'ai' | 'jira'>;

const CACHE_MS = 60_000;
const DEMO_TARGET = 'Demo bot (simulated, not the real chatbot)';

const LABELS: Record<StageCheckId, string> = {
  settings: 'Stage settings filled in',
  guard: 'Target is safe',
  signedIn: 'Signed in with Google',
  domain: 'prestobots.com account',
  readAccess: 'Can read salud-stage',
  clinic: 'QA clinic found',
};

const DEMO_NOTE = 'Only needed for the real bot (CHATBOT_MODE=stage)';
const NEEDS_ABOVE = 'Needs the check above.';
const LEGACY_NOTE = 'STAGE_SERVICE_ACCOUNT_FILE is no longer used; sign in with Google in Settings instead.';

const passed = (id: StageCheckId, message: string): StageCheck => ({ id, label: LABELS[id], state: 'passed', message });
const failed = (id: StageCheckId, message: string, fix: string): StageCheck => ({
  id,
  label: LABELS[id],
  state: 'failed',
  message,
  fix,
});
const skipped = (id: StageCheckId, message = NEEDS_ABOVE): StageCheck => ({ id, label: LABELS[id], state: 'skipped', message });

/**
 * Everything about the real bot that the Settings page shows: the six connection checks.
 */
export class StageService {
  private cache: { at: number; result: StageChecks } | null = null;
  private sending = false;
  private readonly now: () => number;

  constructor(private readonly options: StageServiceOptions) {
    this.now = options.now ?? Date.now;
  }

  /** Forgets the last result (after a sign-in, a sign-out or an expired sign-in). */
  invalidate(): void {
    this.cache = null;
  }

  /** The connection check, reused for up to 60 s unless `fresh`. */
  async checks(options: { fresh?: boolean } = {}): Promise<StageChecks> {
    if (!options.fresh && this.cache && this.now() - this.cache.at < CACHE_MS) return this.cache.result;
    const { result, keep } = await this.runChecks();
    this.cache = keep ? { at: this.now(), result } : null;
    return result;
  }

  /** True while a test message waits for the bot's reply (runs and generations must wait). */
  busy(): boolean {
    return this.sending;
  }

  /** Sends the reset message ("hola") as the test patient and waits for the bot's reply. */
  async sendTestMessage(): Promise<TestMessageResult> {
    // Claimed before any await, so a second click can never send twice.
    if (this.sending) throw new StageTestConflictError(TEST_MESSAGE_BUSY);
    const elsewhere = this.options.busyElsewhere?.();
    if (elsewhere) throw new StageTestConflictError(elsewhere);
    this.sending = true;
    try {
      const checks = await this.checks();
      if (!checks.ready) {
        const failedLabels = checks.checks.filter((check) => check.state === 'failed').map((check) => check.label);
        throw new StageTestConflictError(
          `The real bot is not ready: fix the failed checks in Settings first (${failedLabels.join(', ')}).`
        );
      }
      return await this.send();
    } finally {
      this.sending = false;
    }
  }

  private async send(): Promise<TestMessageResult> {
    const { stage } = this.options;
    const text = stage.resetMessage || 'hola';
    const link = await this.options.connect({ resetMessage: text });
    const session = await link.openSession?.();
    if (!session) {
      await link.dispose?.().catch(() => undefined);
      throw new StageTestFailedError('The test message can only be sent to the real bot (CHATBOT_MODE=stage).');
    }
    try {
      let messages: ChatMessage[];
      try {
        messages = await session.prepare(new AbortController().signal);
      } catch (error) {
        const message = (error as Error).message;
        const webhook = message.startsWith('The bot did not accept') || message.startsWith('Could not reach the chatbot');
        throw new StageTestFailedError(webhook ? `${message} Check STAGE_WEBHOOK_URL with the developers.` : message);
      }
      const [sent, ...replies] = messages;
      const first = replies.find((reply) => reply.from === 'bot' || reply.from === 'staff');
      if (!sent || !first) {
        const seconds = Math.round(stage.replyTimeoutMs / 1000);
        throw new StageTestFailedError(
          `The bot accepted the message but no reply was saved in salud-stage within ${seconds} s. Check that the QA clinic's bot is on, then try again.`
        );
      }
      const acceptedAt = session.lastAcceptedAt() ?? Date.parse(sent.at);
      const replySeconds = Math.max(0, Math.round((Date.parse(first.at) - acceptedAt) / 100) / 10);
      return { sent, replies, replySeconds };
    } finally {
      await session.close().catch(() => undefined);
      await link.dispose?.().catch(() => undefined);
    }
  }

  /** What the page header shows about the chatbot. */
  async status(): Promise<BaseStatus> {
    if (this.options.mode === 'demo') {
      return {
        mode: 'demo',
        target: DEMO_TARGET,
        ready: true,
        problems: [],
        notes: [
          'Demo mode: tests talk to a simulated bot. Set CHATBOT_MODE=stage in .env to test the real chatbot.',
          ...this.notes(),
        ],
      };
    }
    const result = await this.checks();
    const clinic = result.checks.find((check) => check.id === 'clinic');
    const { projectId, orgId } = this.options.stage;
    return {
      mode: 'stage',
      target: clinic?.state === 'passed' ? clinic.message : `${projectId} · ${orgId ?? 'QA clinic not set'}`,
      ready: result.ready,
      problems: result.checks
        .filter((check) => check.state === 'failed')
        .map((check) => {
          const message = /[.!?]$/.test(check.message) ? check.message : `${check.message}.`;
          return check.fix ? `${message} ${check.fix}` : message;
        }),
      notes: this.notes(),
    };
  }

  /** Plain-words notes that don't block runs. */
  notes(): string[] {
    const notes: string[] = [];
    if (this.options.legacyKeyFileSet) notes.push(LEGACY_NOTE);
    if (this.options.mode === 'stage' && !this.options.stage.resetMessage) {
      notes.push("No reset message is set: each test continues the test patient's existing conversation.");
    }
    return notes;
  }

  private async runChecks(): Promise<{ result: StageChecks; keep: boolean }> {
    const { stage, mode } = this.options;
    const checks: StageCheck[] = [];

    // 1. Settings in .env
    const problems = stageSettingsProblems(stage);
    const settingsOk = problems.length === 0;
    checks.push(
      settingsOk
        ? passed('settings', 'QA clinic, webhook and test phone are set.')
        : failed('settings', problems.map((p) => p.message).join(' '), problems.map((p) => p.fix).join(' '))
    );

    // 2. Safe target (salud-stage only)
    let targetOk = false;
    if (!settingsOk) {
      checks.push(skipped('guard'));
    } else {
      try {
        assertSafeTarget({ projectId: stage.projectId, webhookUrl: stage.webhookUrl ?? '', orgId: stage.orgId ?? '' });
        targetOk = true;
        checks.push(passed('guard', `${stage.projectId} · QA clinic ${stage.orgId}`));
      } catch (error) {
        checks.push(
          failed(
            'guard',
            (error as Error).message,
            'Check STAGE_PROJECT_ID and STAGE_WEBHOOK_URL in app/.env: the platform only tests salud-stage.'
          )
        );
      }
    }

    // 3. Signed in with Google
    const read = this.options.sessions.read();
    const session = 'session' in read ? read.session : undefined;
    if (session) {
      checks.push(passed('signedIn', `Signed in as ${session.email}`));
    } else {
      const message = 'damaged' in read ? 'Not signed in (the saved sign-in was damaged)' : 'Not signed in';
      checks.push(failed('signedIn', message, 'Click Sign in with Google.'));
    }

    // 4. prestobots.com account
    let accountOk = false;
    if (!session) {
      checks.push(skipped('domain'));
    } else {
      try {
        assertSafeAccount(session.email);
        accountOk = true;
        checks.push(passed('domain', session.email));
      } catch (error) {
        checks.push(failed('domain', (error as Error).message, 'Sign out and sign in with your prestobots.com account.'));
      }
    }

    // 5–6. Reading salud-stage and the QA clinic
    let keep = true;
    if (mode === 'demo') {
      checks.push(skipped('readAccess', DEMO_NOTE), skipped('clinic', DEMO_NOTE));
    } else if (!(settingsOk && targetOk && session && accountOk)) {
      checks.push(skipped('readAccess', 'Needs the checks above.'), skipped('clinic', 'Needs the checks above.'));
    } else {
      const read = await this.readChecks();
      checks.push(...read.checks);
      keep = read.keep;
    }

    return {
      result: {
        ready: checks.every((check) => check.state === 'passed'),
        account: session ? { email: session.email } : null,
        checks,
      },
      keep,
    };
  }

  /** Checks 5 and 6: read the QA clinic from salud-stage as the signed-in admin. */
  private async readChecks(): Promise<{ checks: StageCheck[]; keep: boolean }> {
    try {
      const channel = await this.options.connect();
      await channel.dispose?.().catch(() => undefined);
      return { checks: [passed('readAccess', 'Reading salud-stage works.'), passed('clinic', channel.target)], keep: true };
    } catch (error) {
      const message = (error as Error).message;
      if (error instanceof ReadAccessError) {
        return { checks: [failed('readAccess', message, 'Once you have access, click Check again.'), skipped('clinic')], keep: true };
      }
      if (error instanceof SignInExpiredError) {
        // Keep nothing: the next check runs again (after a new sign-in, FR-15).
        return { checks: [failed('readAccess', message, 'Click Sign in with Google.'), skipped('clinic')], keep: false };
      }
      if (error instanceof FirestoreUnavailableError || !(error instanceof StepError)) {
        const text = error instanceof FirestoreUnavailableError ? message : `Could not reach salud-stage: ${message}`;
        return {
          checks: [failed('readAccess', text, 'Check your internet connection and click Check again'), skipped('clinic')],
          keep: false,
        };
      }
      return {
        checks: [
          passed('readAccess', 'Reading salud-stage works.'),
          failed('clinic', message, 'Check STAGE_QA_ORG_ID in app/.env (the shared QA clinic is testing-macena-gupshup-v3-qa).'),
        ],
        keep: true,
      };
    }
  }
}
