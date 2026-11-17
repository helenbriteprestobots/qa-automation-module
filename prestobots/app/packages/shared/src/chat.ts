import { z } from 'zod';

/** Who wrote a message in the conversation. */
export const CHAT_AUTHORS = ['patient', 'bot', 'staff', 'system'] as const;

/** What a message looks like on WhatsApp, simplified. */
export const CHAT_KINDS = [
  'text',
  'buttons',
  'list',
  'flow',
  'link',
  'media',
  'alert',
  'other',
] as const;

export const chatOptionSchema = z.object({
  id: z.string(),
  title: z.string(),
});

/**
 * One message of a conversation, in the platform's own simple format. Messages read from the
 * chatbot (Firestore) or produced by the demo bot are converted to this shape.
 */
export const chatMessageSchema = z.object({
  id: z.string(),
  from: z.enum(CHAT_AUTHORS),
  kind: z.enum(CHAT_KINDS),
  text: z.string(),
  /** Buttons, list rows or the form button the patient can tap. */
  options: z.array(chatOptionSchema).default([]),
  /** Provider id of the message (Gupshup message id). Needed to answer a button. */
  externalId: z.string().optional(),
  /** ISO date. */
  at: z.string(),
  /** Delivery status as stored by the chatbot (sent, delivered, failed…), when known. */
  deliveryStatus: z.string().optional(),
});

export type ChatAuthor = (typeof CHAT_AUTHORS)[number];
export type ChatKind = (typeof CHAT_KINDS)[number];
export type ChatOption = z.infer<typeof chatOptionSchema>;
export type ChatMessage = z.infer<typeof chatMessageSchema>;
