export * from './chat.ts';
export * from './generation.ts';
export * from './google.ts';
export * from './jira.ts';
export * from './run.ts';
export * from './testCase.ts';

import type { JiraStatus } from './jira.ts';

/** What the platform reports about itself (GET /api/status). Never contains secrets. */
export interface PlatformStatus {
  mode: 'demo' | 'stage';
  /** Human description of the chatbot under test. */
  target: string;
  ready: boolean;
  /** Plain-words problems that block runs (missing settings, wrong project…). */
  problems: string[];
  /** Plain-words notes that don't block runs. */
  notes: string[];
  activeRunId: string | null;
  /** "Generate test cases" job that is using the chatbot right now. */
  activeGenerationId: string | null;
  ai: AiStatus;
  jira: JiraStatus;
}

export type BudgetLevel = 'ok' | 'warning' | 'exhausted';

export interface AiStatus {
  /** False when there is no Claude API key. */
  enabled: boolean;
  models: { author: string; judge: string };
  budget: {
    month: string;
    spentUsd: number;
    limitUsd: number;
    level: BudgetLevel;
  };
}

export interface AiUsageBreakdown {
  month: string;
  byPurpose: Array<{ purpose: string; calls: number; costUsd: number }>;
  byModel: Array<{ model: string; calls: number; costUsd: number }>;
}
