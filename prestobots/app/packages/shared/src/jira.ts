import { z } from 'zod';

export const JIRA_ISSUE_TYPES = ['Bug', 'Task'] as const;
export type JiraIssueType = (typeof JIRA_ISSUE_TYPES)[number];

/** What the admin sends to Jira, after editing the pre-filled draft. */
export const jiraCardInputSchema = z.discriminatedUnion('mode', [
  z.object({
    mode: z.literal('create'),
    issueType: z.enum(JIRA_ISSUE_TYPES),
    title: z.string().trim().min(1).max(200),
    description: z.string().trim().min(1).max(30_000),
  }),
  z.object({
    mode: z.literal('comment'),
    /** Key of an earlier card created by the platform, e.g. "CHAT-12". */
    issueKey: z.string().regex(/^[A-Z][A-Z0-9_]*-\d+$/),
    description: z.string().trim().min(1).max(30_000),
  }),
]);
export type JiraCardInput = z.infer<typeof jiraCardInputSchema>;

/** A card created (or commented on) by the platform. Only its link is kept: no status sync. */
export interface JiraCard {
  id: number;
  /** "created" a new card, or added a "comment" to an earlier one. */
  kind: 'created' | 'comment';
  issueKey: string;
  issueType: JiraIssueType;
  /** Card title (for comments: the title of the card commented on). */
  title: string;
  url: string;
  testCaseId: string;
  resultId: string;
  runId: string;
  createdAt: string;
}

/** Pre-filled card shown to the admin before sending. */
export interface JiraCardDraft {
  issueType: JiraIssueType;
  /** Full title, including the "[SAL-…]" prefix. */
  title: string;
  /** Plain text. "## " lines are headings, "- " lines are bullets, ``` fences wrap the conversation. */
  description: string;
  labels: string[];
  /** Cards created earlier for the same test case, newest first. */
  earlierCards: JiraCard[];
  /** True when the AI wrote the title and problem paragraph. */
  aiWritten: boolean;
  /** Plain-words note, e.g. why the AI wasn't used. */
  note?: string;
}

export interface JiraStatus {
  configured: boolean;
  /** e.g. "yourcompany.atlassian.net". */
  site?: string;
  projectKey?: string;
  labels: string[];
  priority?: string;
  /** Missing or wrong settings, in plain words. */
  problems: string[];
}
