import { z } from 'zod';

/** Areas of the chatbot. They are part of the test case id: SAL-<AREA>-<NNN>. */
export const AREAS = ['GREET', 'BOOK', 'REM', 'CANCEL', 'HUMAN', 'INFO', 'FALLBACK'] as const;
export type Area = (typeof AREAS)[number];

export const AREA_LABELS: Record<Area, string> = {
  GREET: 'Greeting and menu',
  BOOK: 'Booking appointments',
  REM: 'Reminder replies',
  CANCEL: 'Cancelling or rescheduling',
  HUMAN: 'Hand-over to a person',
  INFO: 'Questions and information',
  FALLBACK: 'Messages the bot does not understand',
};

/** proposed → waiting for an admin; rejected → an admin said no (the AI won't propose it again). */
export const TEST_CASE_STATUSES = ['proposed', 'active', 'archived', 'rejected'] as const;
export type TestCaseStatus = (typeof TEST_CASE_STATUSES)[number];

/** Where a test case came from. */
export const TEST_CASE_ORIGINS = ['starter', 'generated', 'manual'] as const;
export type TestCaseOrigin = (typeof TEST_CASE_ORIGINS)[number];

export const REPLY_KINDS = ['text', 'buttons', 'list', 'flow', 'link'] as const;

/** A yes/no question asked about the bot's replies to one patient message. */
export const checkSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('bot_replied') }),
  z.object({ type: z.literal('offers_choices') }),
  z.object({ type: z.literal('reply_kind'), kind: z.enum(REPLY_KINDS) }),
  z.object({ type: z.literal('offers_option'), option: z.string().min(1) }),
  z.object({ type: z.literal('mentions_any'), words: z.array(z.string().min(1)).min(1) }),
  z.object({ type: z.literal('mentions_none'), words: z.array(z.string().min(1)).min(1) }),
  /**
   * Judged by the AI: does the bot's reply do what `criteria` says? Used for meaning, not exact words
   * (e.g. "asks the patient which specialty they need").
   */
  z.object({ type: z.literal('ai_judge'), criteria: z.string().min(1) }),
]);
export type Check = z.infer<typeof checkSchema>;

/** What the simulated patient does in one step. */
export const stepActionSchema = z.discriminatedUnion('type', [
  /** Writes a text message. */
  z.object({ type: z.literal('say'), text: z.string().min(1) }),
  /** Taps a button or list option the bot offered in its last replies. */
  z.object({ type: z.literal('choose'), option: z.string().min(1) }),
]);
export type StepAction = z.infer<typeof stepActionSchema>;

export const stepSchema = z.object({
  action: stepActionSchema,
  expect: z.array(checkSchema).default([{ type: 'bot_replied' }]),
});
export type Step = z.infer<typeof stepSchema>;

export const TEST_CASE_ID_PATTERN = /^SAL-([A-Z]+)-(\d{3})$/;

export const testCaseSchema = z.object({
  id: z.string().regex(TEST_CASE_ID_PATTERN),
  title: z.string().min(1),
  area: z.enum(AREAS),
  /** The story in plain words, readable by anyone. */
  story: z.string().min(1),
  status: z.enum(TEST_CASE_STATUSES),
  origin: z.enum(TEST_CASE_ORIGINS),
  steps: z.array(stepSchema).min(1),
  /** Only for test cases proposed by "Generate test cases". */
  proposal: z
    .object({
      generationId: z.string(),
      /** Why the AI proposed it: what it covers that wasn't tested. */
      why: z.string(),
      rejectedReason: z.string().optional(),
    })
    .optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type TestCase = z.infer<typeof testCaseSchema>;

/** Next free id for an area, e.g. SAL-BOOK-004 when SAL-BOOK-001..003 exist. Ids are never reused. */
export const nextTestCaseId = (area: Area, existingIds: readonly string[]): string => {
  let max = 0;
  for (const id of existingIds) {
    const match = TEST_CASE_ID_PATTERN.exec(id);
    if (match && match[1] === area) {
      max = Math.max(max, Number(match[2]));
    }
  }
  return `SAL-${area}-${String(max + 1).padStart(3, '0')}`;
};

/** Plain-words description of a check, for the web page and reports. */
export const describeCheck = (check: Check): string => {
  switch (check.type) {
    case 'bot_replied':
      return 'The bot replies';
    case 'offers_choices':
      return 'The bot offers buttons or a list to choose from';
    case 'reply_kind':
      return `The bot replies with ${
        { text: 'a text', buttons: 'buttons', list: 'a list', flow: 'a WhatsApp form', link: 'a link' }[check.kind]
      }`;
    case 'offers_option':
      return `The bot offers the option «${check.option}»`;
    case 'mentions_any':
      return `The reply mentions ${check.words.map((w) => `«${w}»`).join(' or ')}`;
    case 'mentions_none':
      return `The reply does not mention ${check.words.map((w) => `«${w}»`).join(' nor ')}`;
    case 'ai_judge':
      return `AI judge: ${check.criteria}`;
  }
};

/** A test case as proposed by the AI or being edited, before it gets its permanent id. */
export const testCaseDraftSchema = z.object({
  title: z.string().min(1),
  area: z.enum(AREAS),
  story: z.string().min(1),
  steps: z.array(stepSchema).min(1),
  /** What the AI assumed because the request was ambiguous. Shown to the admin. */
  assumptions: z.array(z.string()).default([]),
});
export type TestCaseDraft = z.infer<typeof testCaseDraftSchema>;

/** Plain-words description of what the patient does. */
export const describeAction = (action: StepAction): string => {
  switch (action.type) {
    case 'say':
      return `Patient writes «${action.text}»`;
    case 'choose':
      return `Patient taps «${action.option}»`;
  }
};
