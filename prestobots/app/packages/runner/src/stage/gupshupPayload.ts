import { randomUUID } from 'node:crypto';

/**
 * Builds the JSON that Gupshup (v2 subscription) posts to the chatbot's `webhookGupshupMessages`
 * when a patient writes on WhatsApp. Shapes copied from the chatbot's own test fixtures
 * (prestobotsv3 `functions/test/fixtures/gupshup.ts`).
 *
 * The chatbot finds the clinic by `app` (= the clinic's `settings.gupshup.appName`) and the patient
 * by `payload.sender.phone`.
 */

interface Base {
  appName: string;
  phone: string;
  name: string;
  now?: number;
}

export type InboundMessage =
  | { type: 'text'; text: string }
  | { type: 'button_reply'; optionId: string; title: string; replyToExternalId?: string }
  | { type: 'list_reply'; optionId: string; title: string; replyToExternalId?: string };

export interface GupshupInboundPayload {
  app: string;
  timestamp: number;
  version: number;
  type: 'message';
  payload: {
    id: string;
    source: string;
    type: string;
    payload: Record<string, unknown>;
    sender: { phone: string; name: string; country_code: string; dial_code: string };
    context?: Record<string, unknown>;
    timestamp: number;
  };
}

/** Message ids start with `qa-` so the developers can recognise test traffic in the logs. */
export const buildGupshupInbound = (base: Base, message: InboundMessage): GupshupInboundPayload => {
  const now = base.now ?? Date.now();
  const sender = {
    phone: base.phone,
    name: base.name,
    country_code: base.phone.slice(0, 2),
    dial_code: base.phone.slice(2),
  };
  const id = `qa-${randomUUID()}`;

  let type: string;
  let payload: Record<string, unknown>;
  let context: Record<string, unknown> | undefined;

  switch (message.type) {
    case 'text':
      type = 'text';
      payload = { text: message.text };
      break;
    case 'button_reply':
    case 'list_reply': {
      type = message.type;
      context = message.replyToExternalId
        ? { id: message.replyToExternalId, gsId: message.replyToExternalId }
        : undefined;
      payload = {
        title: message.title,
        id: message.optionId,
        reply: message.title,
        postbackText: message.type === 'list_reply' ? message.optionId : '',
        ...(message.type === 'list_reply' ? { description: '' } : {}),
        ...(context ? { context } : {}),
      };
      break;
    }
  }

  return {
    app: base.appName,
    timestamp: now,
    version: 2,
    type: 'message',
    payload: {
      id,
      source: base.phone,
      type,
      payload,
      sender,
      ...(context ? { context } : {}),
      timestamp: now,
    },
  };
};
