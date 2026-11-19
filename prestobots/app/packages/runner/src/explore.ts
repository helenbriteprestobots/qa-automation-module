import type { BotMap, BotMapNode, ChatMessage } from '@ctp/shared';

import { StepError } from './channels/types.ts';
import type { ChatChannel } from './channels/types.ts';
import { normalizeText } from './text.ts';

/**
 * Options the explorer never taps, because on the real chatbot they could change real data
 * (appointments in the clinic's system) or hand the chat over to clinic staff.
 */
const RISKY: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /\b(confirm|acept|reserv|agend)/, reason: 'could confirm or book an appointment' },
  { pattern: /\b(cancel|anul|elimin|borr|dar de baja)/, reason: 'could cancel an appointment' },
  { pattern: /\b(reprogram|cambiar (el )?turno|mover (el )?turno)/, reason: 'could move an appointment' },
  { pattern: /\b(pag|abon)/, reason: 'could start a payment' },
  { pattern: /\b(persona|humano|operador|asesor|agente|secretari)/, reason: 'would hand the chat over to clinic staff' },
  { pattern: /^(si|ok|dale|listo)\b/, reason: 'is a "yes" that could confirm something' },
  {
    pattern: /\b\d{1,2}[:.h]\d{2}\b|\b\d{1,2}\/\d{1,2}\b|\b(lunes|martes|miercoles|jueves|viernes|sabado|domingo)\b/,
    reason: 'looks like an appointment time: choosing it could book it',
  },
];

export const riskyReason = (option: string): string | undefined => {
  const text = normalizeText(option);
  return RISKY.find((rule) => rule.pattern.test(text))?.reason;
};

export interface ExploreOptions {
  channel: ChatChannel;
  signal: AbortSignal;
  /** The first message of every conversation. */
  startMessage?: string;
  /** How many taps deep, after the start message. */
  maxDepth?: number;
  /** Maximum number of paths (conversations) to explore. */
  maxPaths?: number;
  onProgress?: (info: { explored: number; pending: number; path: string[] }) => void;
}

/** What the bot offered in a set of replies, without repeats. */
const offeredOptions = (replies: ChatMessage[]): Array<{ title: string; kind: ChatMessage['kind'] }> => {
  const seen = new Set<string>();
  return replies
    .filter((reply) => reply.from === 'bot')
    .flatMap((reply) => reply.options.map((option) => ({ title: option.title.trim(), kind: reply.kind })))
    .filter((option) => {
      const key = normalizeText(option.title);
      if (!option.title || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
};

/** Identifies "the same place" in the menus, so it is explored only once. */
const signature = (replies: ChatMessage[]): string =>
  replies
    .filter((reply) => reply.from === 'bot')
    .map((reply) => `${reply.kind}:${normalizeText(reply.text).slice(0, 120)}|${reply.options.map((o) => normalizeText(o.title)).sort().join(',')}`)
    .join('\n');

/**
 * Maps the bot's menus: starts every conversation with the start message, then taps options
 * breadth-first, one new conversation per path. It never types free text, never fills WhatsApp
 * forms, and never taps risky options (see RISKY).
 */
export const exploreBot = async (options: ExploreOptions): Promise<BotMap> => {
  const { channel, signal } = options;
  const startMessage = options.startMessage ?? 'Hola';
  const maxDepth = options.maxDepth ?? 3;
  const maxPaths = options.maxPaths ?? 25;

  const nodes: BotMapNode[] = [];
  const queue: string[][] = [[]];
  const visited = new Set<string>();
  let truncated = false;

  while (queue.length > 0) {
    signal.throwIfAborted();
    if (nodes.length >= maxPaths) {
      truncated = true;
      break;
    }
    const path = queue.shift()!;
    options.onProgress?.({ explored: nodes.length, pending: queue.length, path });

    const node: BotMapNode = { path, replies: [], offered: [], skipped: [] };
    nodes.push(node);

    const session = await channel.openSession();
    try {
      const setup = await session.prepare(signal);
      let replies: ChatMessage[] = setup.filter((m) => m.from === 'bot');
      await session.send({ type: 'say', text: startMessage }, replies, signal);
      replies = await session.collectReplies(signal);
      for (const option of path) {
        await session.send({ type: 'choose', option }, replies, signal);
        replies = await session.collectReplies(signal);
      }
      node.replies = replies;
    } catch (error) {
      if (signal.aborted) throw error;
      node.error = error instanceof StepError ? error.message : `Unexpected problem: ${(error as Error).message}`;
      continue;
    } finally {
      await session.close().catch(() => undefined);
    }

    const offered = offeredOptions(node.replies);
    node.offered = offered.map((o) => o.title);

    const place = signature(node.replies);
    if (place && visited.has(place)) continue; // Same menu as another path (e.g. back to the main menu).
    visited.add(place);

    for (const option of offered) {
      const reason =
        option.kind === 'flow'
          ? 'opens a WhatsApp form, which the platform cannot fill yet'
          : option.kind === 'link'
            ? 'opens a web link'
            : riskyReason(option.title);
      if (reason) node.skipped.push({ option: option.title, reason });
      else if (path.length < maxDepth) queue.push([...path, option.title]);
    }
  }

  if (queue.length > 0) truncated = true;
  return { nodes, truncated };
};
