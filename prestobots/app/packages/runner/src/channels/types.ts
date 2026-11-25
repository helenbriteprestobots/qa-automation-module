import type { ChatMessage, ChatOption, ChatbotMode, StepAction } from '@ctp/shared';

import { includesNormalized, normalizeText } from '../text.ts';

/**
 * A step could not be completed (as opposed to a check that came out false). The message is
 * shown to admins, so it must be in plain words.
 */
export class StepError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StepError';
  }
}

/** One conversation between the simulated patient and the bot, for one test case. */
export interface ChannelSession {
  /**
   * Gets the conversation ready before the first step (for example sends the reset message).
   * Returns the messages exchanged, so the report can show them apart from the test itself.
   */
  prepare(signal: AbortSignal): Promise<ChatMessage[]>;
  /** Performs the patient's action and returns the patient's message as sent. */
  send(action: StepAction, lastReplies: ChatMessage[], signal: AbortSignal): Promise<ChatMessage>;
  /** Waits for the bot's replies to the last message sent. Returns [] if the bot stays silent. */
  collectReplies(signal: AbortSignal): Promise<ChatMessage[]>;
  /** Conversation id in the chatbot's database, if known. */
  conversationId(): string | undefined;
  close(): Promise<void>;
}

/** A way of talking to a chatbot: the built-in demo bot or the real one on salud-stage. */
export interface ChatChannel {
  readonly mode: ChatbotMode;
  /** Human description, e.g. "salud-stage · QA clinic". */
  readonly target: string;
  openSession(): Promise<ChannelSession>;
  /** A reason to stop the whole run (e.g. the Google sign-in expired), checked after each test. */
  fatal?(): string | undefined;
}

/**
 * Finds the option the patient wants to tap among the ones the bot offered in its last replies.
 * Exact match (ignoring case and accents) first, then "contains".
 */
export const resolveOption = (
  wanted: string,
  replies: ChatMessage[]
): { option: ChatOption; message: ChatMessage } => {
  const candidates = replies
    .filter((reply) => reply.from === 'bot')
    .flatMap((message) => message.options.map((option) => ({ option, message })));

  const exact = candidates.find((c) => normalizeText(c.option.title) === normalizeText(wanted));
  const partial = candidates.find((c) => includesNormalized(c.option.title, wanted));
  const found = exact ?? partial;

  if (!found) {
    const offered = candidates.map((c) => `«${c.option.title}»`).join(', ');
    throw new StepError(
      candidates.length > 0
        ? `The bot did not offer an option called «${wanted}». It offered: ${offered}.`
        : `The patient should tap «${wanted}», but the bot's last reply had no buttons or list.`
    );
  }
  return found;
};
