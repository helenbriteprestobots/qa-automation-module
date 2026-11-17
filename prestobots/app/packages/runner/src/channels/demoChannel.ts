import { randomUUID } from 'node:crypto';

import type { ChatMessage, StepAction } from '@ctp/shared';

import { sleep } from '../text.ts';
import { DemoBot } from './demoBot.ts';
import { type ChannelSession, type ChatChannel, resolveOption } from './types.ts';

export interface DemoChannelOptions {
  /** Simulated time the bot takes per message, in ms. */
  replyDelayMs?: number;
}

class DemoSession implements ChannelSession {
  private readonly bot = new DemoBot();
  private pending: ChatMessage[] = [];

  constructor(private readonly replyDelayMs: number) {}

  async prepare(): Promise<ChatMessage[]> {
    return [];
  }

  async send(action: StepAction, lastReplies: ChatMessage[]): Promise<ChatMessage> {
    let sent: ChatMessage;
    let optionId: string | undefined;

    if (action.type === 'say') {
      sent = message('patient', 'text', action.text);
    } else {
      const { option } = resolveOption(action.option, lastReplies);
      optionId = option.id;
      sent = message('patient', 'text', option.title);
    }

    this.pending = this.bot
      .reply({ text: sent.text, optionId })
      .map((reply) => ({ ...message(reply.from, reply.kind, reply.text), options: reply.options }));
    return sent;
  }

  async collectReplies(signal: AbortSignal): Promise<ChatMessage[]> {
    await sleep(this.replyDelayMs * Math.max(1, this.pending.length), signal);
    const replies = this.pending.map((reply) => ({ ...reply, at: new Date().toISOString() }));
    this.pending = [];
    return replies;
  }

  conversationId(): string | undefined {
    return undefined;
  }

  async close(): Promise<void> {}
}

const message = (
  from: ChatMessage['from'],
  kind: ChatMessage['kind'],
  text: string
): ChatMessage => ({
  id: randomUUID(),
  from,
  kind,
  text,
  options: [],
  at: new Date().toISOString(),
});

/** The built-in demo bot. Each test case gets a fresh conversation. */
export class DemoChannel implements ChatChannel {
  readonly mode = 'demo' as const;
  readonly target = 'Demo bot (simulated, not the real chatbot)';

  constructor(private readonly options: DemoChannelOptions = {}) {}

  async openSession(): Promise<ChannelSession> {
    return new DemoSession(this.options.replyDelayMs ?? 400);
  }
}
