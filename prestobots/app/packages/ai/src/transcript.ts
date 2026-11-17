import type { ChatMessage } from '@ctp/shared';

const WHO: Record<ChatMessage['from'], string> = {
  patient: 'Patient',
  bot: 'Bot',
  staff: 'Clinic staff',
  system: 'System notice',
};

/** Conversation as plain text for the AI, e.g. `[Bot · buttons] ¿En qué te ayudo?  options: «A» | «B»`. */
export const transcriptToText = (messages: ChatMessage[]): string =>
  messages.length === 0
    ? '(no messages)'
    : messages
        .map((message) => {
          const kind = message.kind === 'text' ? '' : ` · ${message.kind === 'flow' ? 'WhatsApp form' : message.kind}`;
          const options =
            message.options.length > 0 ? `\n    options: ${message.options.map((o) => `«${o.title}»`).join(' | ')}` : '';
          return `[${WHO[message.from]}${kind}] ${message.text}${options}`;
        })
        .join('\n');
