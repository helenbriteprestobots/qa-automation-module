import {
  type AiModels,
  AiClient,
  AiError,
  BudgetExceededError,
  analyzeFailure,
  type JiraCardText,
  type Proposal,
  type ProposalRequest,
  buildProposalPrompt,
  createJudge,
  estimateProposalCost,
  proposeTestCases,
  draftJiraCardText,
  draftTestCase,
  summarizeRun,
} from '@ctp/ai';
import type { Judge } from '@ctp/runner';
import type {
  AiStatus,
  AiUsageBreakdown,
  BudgetLevel,
  ChatbotMode,
  FailureAnalysis,
  Run,
  TestCase,
  TestCaseDraft,
  TestResult,
} from '@ctp/shared';

import type { Store } from './db.ts';

/** AI used during and after a run. */
export interface RunAi {
  judge: Judge;
  analyze(input: { mode: ChatbotMode; testCase: TestCase; result: TestResult }): Promise<FailureAnalysis>;
  summarize(run: Run, results: TestResult[]): Promise<string>;
}

/** Everything the server needs from the AI. An interface so tests can use a fake. */
export interface AiFacade {
  status(): AiStatus;
  breakdown(): AiUsageBreakdown;
  setBudget(limitUsd: number): void;
  /** Writes a new test case, or changes `current`, from the admin's words. */
  draft(input: { request: string; current?: TestCaseDraft }): Promise<TestCaseDraft>;
  /** Undefined when the AI is off. */
  forRuns(): RunAi | undefined;
  /** Title, problem paragraph and card type for a Jira card. Throws AiError when the AI is off. */
  jiraText(input: { mode: ChatbotMode; testCase: TestCase; result: TestResult }): Promise<JiraCardText>;
  /** Estimated cost range of `propose`, shown before it runs. */
  estimateProposal(request: ProposalRequest): { lowUsd: number; highUsd: number };
  /** New test cases for what isn't tested yet. Throws AiError when the AI is off. */
  propose(request: ProposalRequest, signal?: AbortSignal): Promise<{ proposals: Proposal[]; notes: string[] }>;
}

const BUDGET_KEY = 'ai_monthly_budget_usd';

/** Current month in UTC, e.g. "2026-11". */
export const currentMonth = (): string => new Date().toISOString().slice(0, 7);

export const createAiFacade = (options: {
  store: Store;
  apiKey: string | undefined;
  models: AiModels;
  defaultBudgetUsd: number;
  mode: ChatbotMode;
}): AiFacade => {
  const { store, models, mode } = options;

  const limit = (): number => {
    const saved = store.getSetting(BUDGET_KEY);
    return saved !== undefined ? Number(saved) : options.defaultBudgetUsd;
  };

  const budget = (): AiStatus['budget'] => {
    const month = currentMonth();
    const spentUsd = store.aiSpend(month);
    const limitUsd = limit();
    const level: BudgetLevel = spentUsd >= limitUsd ? 'exhausted' : spentUsd >= limitUsd * 0.8 ? 'warning' : 'ok';
    return { month, spentUsd, limitUsd, level };
  };

  const client = options.apiKey
    ? new AiClient(options.apiKey, models, {
        assertBudget: () => {
          if (budget().level === 'exhausted') throw new BudgetExceededError();
        },
        record: (entry) => store.recordAiUsage(entry),
      })
    : undefined;

  const requireClient = (): AiClient => {
    if (!client) throw new AiError('AI is off: add ANTHROPIC_API_KEY to the .env file and restart the platform.');
    return client;
  };

  const runAi: RunAi | undefined = client && {
    judge: createJudge(client),
    analyze: (input) => analyzeFailure(client, input),
    summarize: (run, results) => summarizeRun(client, run, results),
  };

  return {
    status: () => ({ enabled: Boolean(client), models, budget: budget() }),

    breakdown: () => ({ month: currentMonth(), ...store.aiBreakdown(currentMonth()) }),

    setBudget: (limitUsd) => store.setSetting(BUDGET_KEY, String(limitUsd)),

    draft: async ({ request, current }) => {
      const ai = requireClient();
      const botMessages = store.recentBotMessages(mode);
      const options = [...new Set(botMessages.flatMap((m) => m.options.map((o) => o.title.trim())).filter(Boolean))].slice(0, 80);
      const sampleReplies = [...new Set(botMessages.map((m) => m.text.trim().slice(0, 200)).filter(Boolean))].slice(0, 25);
      return draftTestCase(ai, {
        request,
        current,
        vocabulary: { mode, options, sampleReplies },
        existing: store.listTestCases().map((t) => ({ id: t.id, title: t.title })),
      });
    },

    forRuns: () => runAi,

    jiraText: (input) => draftJiraCardText(requireClient(), input),

    estimateProposal: (request) => estimateProposalCost(models.author, buildProposalPrompt(request)),

    propose: (request, signal) => proposeTestCases(requireClient(), request, signal),
  };
};
