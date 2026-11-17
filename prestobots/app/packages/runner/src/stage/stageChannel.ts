import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';

import type { ChatMessage, StepAction } from '@ctp/shared';
import { type App, cert, deleteApp, initializeApp } from 'firebase-admin/app';
import { FieldPath, type Firestore, getFirestore } from 'firebase-admin/firestore';

import { type ChannelSession, type ChatChannel, StepError, resolveOption } from '../channels/types.ts';
import { sleep } from '../text.ts';
import { type InboundMessage, buildGupshupInbound } from './gupshupPayload.ts';
import { normalizeFirestoreMessage } from './firestoreMessages.ts';
import { assertSafeTarget } from './guard.ts';

/**
 * Talks to the real Cauce chatbot on salud-stage, exactly the way WhatsApp does:
 *
 *   fake Gupshup message ──POST──▶ webhookGupshupMessages ─▶ Pub/Sub ─▶ handler ─▶ engine
 *   reply ◀── read (read-only) ── Firestore conversations/{id}/messages
 *
 * Needs only READ access to Firestore. Never writes to the chatbot's database.
 */

export interface StageChannelConfig {
  projectId: string;
  serviceAccountFile: string;
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
}

const WHATSAPP_CHANNEL = 'wsp';
const SIX_MONTHS_MS = 6 * 30 * 24 * 60 * 60 * 1000;
/** Margin for clock differences between this computer and Google's servers. */
const CLOCK_SKEW_MS = 30_000;

export class StageChannel implements ChatChannel {
  readonly mode = 'stage' as const;

  private constructor(
    private readonly config: StageChannelConfig,
    private readonly app: App,
    private readonly db: Firestore,
    private readonly appName: string,
    readonly target: string
  ) {}

  /** Validates the configuration, connects read-only to Firestore and reads the QA clinic. */
  static async create(config: StageChannelConfig): Promise<StageChannel> {
    let credentials: { project_id?: string; client_email?: string; private_key?: string };
    try {
      credentials = JSON.parse(readFileSync(config.serviceAccountFile, 'utf8'));
    } catch {
      throw new StepError(
        `Could not read the salud-stage key file at «${config.serviceAccountFile}».`
      );
    }

    assertSafeTarget({
      projectId: config.projectId,
      credentialsProjectId: credentials.project_id,
      webhookUrl: config.webhookUrl,
      orgId: config.orgId,
    });

    if (!/^\d{10,15}$/.test(config.patientPhone)) {
      throw new StepError(
        'The test patient phone must be digits only, with country code (e.g. 549261…).'
      );
    }

    const app = initializeApp(
      {
        credential: cert({
          projectId: credentials.project_id,
          clientEmail: credentials.client_email,
          privateKey: credentials.private_key,
        }),
        projectId: config.projectId,
      },
      `ctp-stage-${randomUUID()}`
    );
    const db = getFirestore(app);

    try {
      // Only the fields we need: the clinic document also holds integration credentials.
      const snapshot = await db
        .collection('organizations')
        .where(FieldPath.documentId(), '==', config.orgId)
        .select('name', 'settings.gupshup.appName')
        .limit(1)
        .get();
      const doc = snapshot.docs[0];
      if (!doc) {
        throw new StepError(`The QA clinic «${config.orgId}» does not exist in ${config.projectId}.`);
      }
      const data = doc.data() as { name?: string; settings?: { gupshup?: { appName?: string } } };
      const appName = data.settings?.gupshup?.appName;
      if (!appName) {
        throw new StepError(
          `The QA clinic «${config.orgId}» has no Gupshup app configured, so the bot cannot receive messages.`
        );
      }
      const target = `${config.projectId} · ${data.name ?? config.orgId}`;
      return new StageChannel(config, app, db, appName, target);
    } catch (error) {
      await deleteApp(app).catch(() => undefined);
      if (error instanceof StepError) throw error;
      throw new StepError(
        `Could not read the QA clinic from ${config.projectId}: ${(error as Error).message}`
      );
    }
  }

  async openSession(): Promise<ChannelSession> {
    return new StageSession(this.config, this.db, this.appName);
  }

  async dispose(): Promise<void> {
    await deleteApp(this.app).catch(() => undefined);
  }
}

class StageSession implements ChannelSession {
  private readonly seen = new Set<string>();
  private conversation: string | undefined;
  private lastSentAt = 0;

  constructor(
    private readonly config: StageChannelConfig,
    private readonly db: Firestore,
    private readonly appName: string
  ) {}

  async prepare(signal: AbortSignal): Promise<ChatMessage[]> {
    // Everything already in the conversation belongs to earlier tests: ignore it.
    const conversationId = await this.findConversationId();
    if (conversationId) {
      const existing = await this.readMessages(conversationId, Date.now() - 24 * 60 * 60 * 1000);
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

    this.lastSentAt = Date.now();
    let response: Response;
    try {
      response = await fetch(this.config.webhookUrl, {
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
      throw new StepError(
        `The chatbot did not accept the message (HTTP ${response.status}: «${body.slice(0, 120)}»).`
      );
    }

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

  conversationId(): string | undefined {
    return this.conversation;
  }

  async close(): Promise<void> {}

  /** Same query the chatbot uses (getMostRecentConversation), so the existing index serves it. */
  private async findConversationId(): Promise<string | undefined> {
    const snapshot = await this.db
      .collection('conversations')
      .where('channelIdentifier.channelIdentifierUserId', '==', this.config.patientPhone)
      .where('lastActivityMessageAt', '>=', new Date(Date.now() - SIX_MONTHS_MS))
      .where('organizationId', '==', this.config.orgId)
      .where('channel', '==', WHATSAPP_CHANNEL)
      .orderBy('createdAt', 'desc')
      .limit(1)
      .select()
      .get();
    const id = snapshot.docs[0]?.id;
    if (id) this.conversation = id;
    return id;
  }

  private async readMessages(conversationId: string, sinceMs: number): Promise<ChatMessage[]> {
    const snapshot = await this.db
      .collection('conversations')
      .doc(conversationId)
      .collection('messages')
      .where('createdAt', '>=', new Date(sinceMs))
      .orderBy('createdAt', 'asc')
      .get();
    return snapshot.docs.map((doc) => normalizeFirestoreMessage(doc.id, doc.data()));
  }
}
