import type { ChatAuthor, ChatKind, ChatMessage, ChatOption } from '@ctp/shared';

/**
 * Converts a message stored by the chatbot (`conversations/{id}/messages/{msgId}`, type
 * `PrestobotsMessage` in prestobotsv3 `packages/core/types/src/conversations.ts`) into the
 * platform's simple ChatMessage.
 */

type Raw = Record<string, unknown>;

const asRecord = (value: unknown): Raw =>
  typeof value === 'object' && value !== null ? (value as Raw) : {};
const asString = (value: unknown): string => (typeof value === 'string' ? value : '');

const AUTHORS: Record<string, ChatAuthor> = {
  bot: 'bot',
  user: 'patient',
  support: 'staff',
  supportAsUser: 'staff',
  system: 'system',
};

/** Firestore Timestamp, Date, ISO string or millis → ISO string. */
export const toIso = (value: unknown): string => {
  if (value instanceof Date) return value.toISOString();
  const record = asRecord(value);
  if (typeof record.toDate === 'function') {
    return (record.toDate as () => Date)().toISOString();
  }
  if (typeof value === 'string' || typeof value === 'number') {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) return date.toISOString();
  }
  return new Date(0).toISOString();
};

export const normalizeFirestoreMessage = (id: string, data: Raw): ChatMessage => {
  const messageType = asString(data.messageType);
  const payload = asRecord(data.payload);
  const from = AUTHORS[asString(data.senderType)] ?? 'system';

  let kind: ChatKind = 'other';
  let text = '';
  let options: ChatOption[] = [];

  switch (messageType) {
    case 'text':
      kind = 'text';
      text = asString(payload.text);
      break;
    case 'button':
      if (Array.isArray(payload.buttons)) {
        kind = 'buttons';
        text = asString(payload.text);
        options = payload.buttons.map((button) => {
          const b = asRecord(button);
          return { id: asString(b.id), title: asString(b.title) };
        });
      } else {
        kind = 'text';
        text = asString(payload.title) || asString(payload.reply);
      }
      break;
    case 'list':
      if (Array.isArray(payload.sections)) {
        kind = 'list';
        text = asString(payload.text);
        options = payload.sections.flatMap((section) => {
          const rows = asRecord(section).rows;
          return Array.isArray(rows)
            ? rows.map((row) => {
                const r = asRecord(row);
                return { id: asString(r.id), title: asString(r.title) };
              })
            : [];
        });
      } else {
        kind = 'text';
        text = asString(payload.title) || asString(payload.reply);
      }
      break;
    case 'flow':
      kind = 'flow';
      text = asString(payload.text);
      options = [{ id: 'flow', title: asString(payload.cta) || 'Abrir formulario' }];
      break;
    case 'ctaUrl':
      kind = 'link';
      text = asString(payload.text);
      options = Array.isArray(payload.buttons)
        ? payload.buttons.map((button, index) => ({
            id: `link_${index}`,
            title: asString(asRecord(button).label),
          }))
        : [];
      break;
    case 'alert': {
      kind = 'alert';
      const title = asString(payload.title);
      const body = asString(payload.text);
      text = [title, body].filter(Boolean).join(': ');
      break;
    }
    case 'image':
    case 'file':
    case 'audio':
    case 'video':
    case 'sticker':
      kind = 'media';
      text = asString(payload.altText) || asString(payload.name) || `[${messageType}]`;
      break;
    default:
      text = messageType ? `[${messageType}]` : '[message]';
  }

  const status = asString(data.status);
  return {
    id,
    from: kind === 'alert' ? 'system' : from,
    kind,
    text,
    options,
    externalId: asString(data.externalId) || undefined,
    at: toIso(data.createdAt),
    deliveryStatus: status || undefined,
  };
};
