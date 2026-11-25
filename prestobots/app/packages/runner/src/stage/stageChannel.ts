import type { ChatMessage, GoogleSession, StepAction } from '@ctp/shared';

import { type ChannelSession, type ChatChannel, StepError, resolveOption } from '../channels/types.ts';
import { sleep } from '../text.ts';
import { FirestoreRest } from './firestoreRest.ts';
import { type AccessTokenProvider, SignInExpiredError, createAccessTokenProvider } from './googleToken.ts';
import { type InboundMessage, buildGupshupInbound } from './gupshupPayload.ts';
import { normalizeFirestoreMessage } from './firestoreMessages.ts';
import { assertStageAccess } from './guard.ts';

/**
 * Talks to the real Cauce chatbot on salud-stage, exactly the way WhatsApp does:
 *
 *   fake Gupshup message ──POST──▶ webhookGupshupMessages ─▶ Pub/Sub ─▶ handler ─▶ engine
 *   reply ◀── read (read-only, as the signed-in admin) ── Firestore conversations/{id}/messages
 *
 * Reads Firestore through its REST API with the admin's Google sign-in. Never writes to the
 * chatbot's database.
 */

export interface StageChannelConfig {
  projectId: string;
  orgId: string;
  webhookUrl: string;
  patientPhone: string;
  patientName: string;
  /** Sent before each test so the bot starts from scratch. Optional. */
  resetMessage?: string;
  /** Max wait for the bot's first reply to a message. */
  replyTimeoutMs: number;
  /** After the last reply, how long without new messages before we consider the bot done. */
  quietMs?: number;
  pollMs?: number;
  /** The OAuth client and the admin's saved Google sign-in (undefined when not signed in). */
  google: { clientId: string; clientSecret: string; session: GoogleSession | undefined };
  /** False once the admin signed out, so a run in progress stops (FR-11). */
  isSignedIn?: () => boolean;
  /** For tests: replaces `fetch` for Google and the webhook. */
  fetch?: typeof fetch;
  now?: () => number;
}

const WHATSAPP_CHANNEL = 'wsp';
const SIX_MONTHS_MS = 6 * 30 * 24 * 60 * 60 * 1000;
/** Margin for clock differences between this computer and Google's servers. */
const CLOCK_SKEW_MS = 30_000;
const EXPIRED_MESSAGE = new SignInExpiredError().message;

export class StageChannel implements ChatChannel {
  readonly mode = 'stage' as const;
  target: string;
  private appName = '';

  private constructor(
    private readonly config: StageChannelConfig,
    private readonly firestore: FirestoreRest,
    private readonly tokens: AccessTokenProvider
  ) {
    this.target = `${config.projectId} · ${config.orgId}`;
  }

  /** Checks every safety rule, then connects read-only to salud-stage and reads the QA clinic. */
  static async create(config: StageChannelConfig): Promise<StageChannel> {
    const session = config.google.session;
    assertStageAccess(
      { projectId: config.projectId, webhookUrl: config.webhookUrl, orgId: config.orgId },
      session?.email
    );
    if (!session) throw new StepError('Not signed in. Sign in with Google in Settings to use the real bot.');

    if (!/^\d{10,15}$/.test(config.patientPhone)) {
      throw new StepError('The test patient phone must be digits only, with country code (e.g. 549261…).');
    }

    const tokens = createAccessTokenProvider({
      clientId: config.google.clientId,
      clientSecret: config.google.clientSecret,
      refreshToken: session.refreshToken,
      projectId: config.projectId,
      fetch: config.fetch,
      now: config.now,
    });
    const firestore = new FirestoreRest({ projectId: config.projectId, account: session.email, tokens, fetch: config.fetch });
    const channel = new StageChannel(config, firestore, tokens);
    const clinic = await channel.readClinic();
    channel.appName = clinic.appName;
    channel.target = `${config.projectId} · ${clinic.name}`;
    return channel;
  }

  /** Reads only the QA clinic's name and Gupshup app: the clinic document also holds integration credentials. */
  async readClinic(): Promise<{ name: string; appName: string }> {
    const { orgId, projectId } = this.config;
    const data = await this.firestore.getDocument(`organizations/${encodeURIComponent(orgId)}`, [
      'name',
      'settings.gupshup.appName',
    ]);
    if (!data) throw new StepError(`The QA clinic «${orgId}» does not exist in ${projectId}.`);
    const settings = data.settings as { gupshup?: { appName?: unknown } } | undefined;
    const appName = settings?.gupshup?.appName;
    if (typeof appName !== 'string' || !appName) {
      throw new StepError(
        `The QA clinic «${orgId}» has no Gupshup app configured, so the bot cannot receive messages.`
      );
    }
    return { name: typeof data.name === 'string' && data.name ? data.name : orgId, appName };
  }

  /** A reason to stop the whole run (the Google sign-in expired or was removed), or undefined. */
  fatal(): string | undefined {
    if (this.tokens.expired()) return EXPIRED_MESSAGE;
    if (this.config.isSignedIn && !this.config.isSignedIn()) return EXPIRED_MESSAGE;
    return undefined;
  }

  async openSession(): Promise<StageSession> {
    return new StageSession(this.config, this.firestore, this.appName);
  }

  async dispose(): Promise<void> {}
}

const fieldFilter = (fieldPath: string, op: string, value: Record<string, unknown>) => ({
  fieldFilter: { field: { fieldPath }, op, value },
});

export class StageSession implements ChannelSession {
  private readonly seen = new Set<string>();
  private conversation: string | undefined;
  private lastSentAt = 0;
  private acceptedAt: number | undefined;

  private readonly now: () => number;

  constructor(
    private readonly config: StageChannelConfig,
    private readonly firestore: FirestoreRest,
    private readonly appName: string
  ) {
    this.now = config.now ?? Date.now;
  }

  async prepare(signal: AbortSignal): Promise<ChatMessage[]> {
    // Everything already in the conversation belongs to earlier tests: ignore it.
    const conversationId = await this.findConversationId();
    if (conversationId) {
      const existing = await this.readMessages(conversationId, this.now() - 24 * 60 * 60 * 1000);
      existing.forEach((message) => this.seen.add(message.id));
    }

    if (!this.config.resetMessage) return [];
    const sent = await this.send({ type: 'say', text: this.config.resetMessage }, [], signal);
    const replies = await this.collectReplies(signal);
    return [sent, ...replies];
  }

  async send(action: StepAction, lastReplies: ChatMessage[], signal: AbortSignal): Promise<ChatMessage> {
    let inbound: InboundMessage;
    let shownText: string;

    if (action.type === 'say') {
      inbound = { type: 'text', text: action.text };
      shownText = action.text;
    } else {
      const { option, message } = resolveOption(action.option, lastReplies);
      if (message.kind === 'flow') {
        throw new StepError(
          `«${option.title}» opens a WhatsApp form. Filling forms is not supported yet (coming in a later iteration).`
        );
      }
      if (message.kind === 'link') {
        throw new StepError(`«${option.title}» is a link button; it opens a web page, not a reply.`);
      }
      inbound = {
        type: message.kind === 'list' ? 'list_reply' : 'button_reply',
        optionId: option.id,
        title: option.title,
        replyToExternalId: message.externalId,
      };
      shownText = option.title;
    }

    const payload = buildGupshupInbound(
      { appName: this.appName, phone: this.config.patientPhone, name: this.config.patientName },
      inbound
    );

    this.lastSentAt = this.now();
    let response: Response;
    try {
      response = await (this.config.fetch ?? fetch)(this.config.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.any([signal, AbortSignal.timeout(20_000)]),
      });
    } catch (error) {
      if (signal.aborted) throw error;
      throw new StepError(`Could not reach the chatbot: ${(error as Error).message}`);
    }
    const body = (await response.text()).trim();
    if (!response.ok || body !== 'ACK') {
      // The webhook answers 200 even when it fails internally; only "ACK" means it was accepted.
      throw new StepError(`The bot did not accept the message (HTTP ${response.status}: «${body.slice(0, 120)}»).`);
    }
    this.acceptedAt = this.now();

    return {
      id: payload.payload.id,
      from: 'patient',
      kind: 'text',
      text: shownText,
      options: [],
      at: new Date(this.lastSentAt).toISOString(),
    };
  }

  async collectReplies(signal: AbortSignal): Promise<ChatMessage[]> {
    const pollMs = this.config.pollMs ?? 1500;
    const quietMs = this.config.quietMs ?? 5000;
    const deadline = Date.now() + this.config.replyTimeoutMs;
    const replies: ChatMessage[] = [];
    let lastNewAt = 0;

    while (Date.now() < deadline) {
      await sleep(pollMs, signal);

      const conversationId = await this.findConversationId();
      if (conversationId) {
        const messages = await this.readMessages(conversationId, this.lastSentAt - CLOCK_SKEW_MS);
        for (const message of messages) {
          if (this.seen.has(message.id)) continue;
          this.seen.add(message.id);
          // The patient's own message is already shown from what we sent.
          if (message.from === 'patient') continue;
          replies.push(message);
          lastNewAt = Date.now();
        }
      }

      const botAnswered = replies.some((reply) => reply.from === 'bot' || reply.from === 'staff');
      if (botAnswered && Date.now() - lastNewAt >= quietMs) break;
    }
    return replies;
  }

  /** When the webhook last answered "ACK" (ms), or undefined if no message was accepted yet. */
  lastAcceptedAt(): number | undefined {
    return this.acceptedAt;
  }

  conversationId(): string | undefined {
    return this.conversation;
  }

  async close(): Promise<void> {}

  /** Same query the chatbot uses (getMostRecentConversation), so the existing index serves it. */
  private async findConversationId(): Promise<string | undefined> {
    const docs = await this.firestore.runQuery('', {
      from: [{ collectionId: 'conversations' }],
      where: {
        compositeFilter: {
          op: 'AND',
          filters: [
            fieldFilter('channelIdentifier.channelIdentifierUserId', 'EQUAL', { stringValue: this.config.patientPhone }),
            fieldFilter('lastActivityMessageAt', 'GREATER_THAN_OR_EQUAL', {
              timestampValue: new Date(this.now() - SIX_MONTHS_MS).toISOString(),
            }),
            fieldFilter('organizationId', 'EQUAL', { stringValue: this.config.orgId }),
            fieldFilter('channel', 'EQUAL', { stringValue: WHATSAPP_CHANNEL }),
          ],
        },
      },
      orderBy: [{ field: { fieldPath: 'createdAt' }, direction: 'DESCENDING' }],
      limit: 1,
      select: { fields: [{ fieldPath: '__name__' }] },
    });
    const id = docs[0]?.id;
    if (id) this.conversation = id;
    return id;
  }

  private async readMessages(conversationId: string, sinceMs: number): Promise<ChatMessage[]> {
    const docs = await this.firestore.runQuery(`conversations/${encodeURIComponent(conversationId)}`, {
      from: [{ collectionId: 'messages' }],
      where: fieldFilter('createdAt', 'GREATER_THAN_OR_EQUAL', { timestampValue: new Date(sinceMs).toISOString() }),
      orderBy: [{ field: { fieldPath: 'createdAt' }, direction: 'ASCENDING' }],
    });
    return docs.map((doc) => normalizeFirestoreMessage(doc.id, doc.data));
  }
}
