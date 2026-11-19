import type { ChatMessage } from './chat.ts';
import type { ChatbotMode, ResultStatus, TestResult } from './run.ts';

/**
 * One place in the bot's menus that the explorer reached: the options tapped from the start
 * ("Hola"), what the bot replied, and what it offered next.
 */
export interface BotMapNode {
  /** Option titles tapped after "Hola", in order. [] is the bot's first answer. */
  path: string[];
  replies: ChatMessage[];
  /** Options the bot offered in these replies. */
  offered: string[];
  /** Offered options the explorer deliberately did not tap, with the reason in plain words. */
  skipped: Array<{ option: string; reason: string }>;
  /** Set when this path could not be completed. */
  error?: string;
}

export interface BotMap {
  nodes: BotMapNode[];
  /** True when the explorer stopped at its limit and some paths were not explored. */
  truncated: boolean;
}

/** The WhatsApp form (flow) definition found in the chatbot code, summarized. */
export interface FormSummary {
  name: string;
  screens: Array<{ id: string; title: string; fields: string[] }>;
}

export const GENERATION_STATUSES = [
  'exploring',
  'awaiting_confirmation',
  'writing',
  'trying',
  'finished',
  'failed',
  'cancelled',
  'interrupted',
] as const;
export type GenerationStatus = (typeof GENERATION_STATUSES)[number];

export const isGenerationBusy = (status: GenerationStatus): boolean =>
  status === 'exploring' || status === 'writing' || status === 'trying';

/** How a proposal behaved when it was tried twice. */
export type TrialOutcome = 'passed' | 'failed' | 'inconsistent' | 'error';

export interface ProposalTrial {
  testCaseId: string;
  outcome: TrialOutcome;
  attempts: ResultStatus[];
  /** The first attempt, with the full conversation. */
  result: TestResult;
}

/** One click on "Generate test cases": explore → confirm cost → AI writes → try each twice. */
export interface Generation {
  id: string;
  status: GenerationStatus;
  mode: ChatbotMode;
  /** Plain-words description of what is happening now. */
  progress: string;
  map?: BotMap;
  form?: FormSummary;
  /** Estimated cost of the AI writing step, shown before it starts. */
  estimate?: { lowUsd: number; highUsd: number };
  /** Ids of the test cases proposed (status "proposed", origin "generated"). */
  proposals: string[];
  trials: ProposalTrial[];
  /** Plain-words notes from the AI, e.g. things it could not test. */
  notes: string[];
  /** Real AI cost of this generation so far. */
  costUsd: number;
  error?: string;
  createdAt: string;
  finishedAt?: string;
}
