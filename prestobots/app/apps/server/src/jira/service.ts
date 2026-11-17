import { AiError, BudgetExceededError } from '@ctp/ai';
import type { JiraCard, JiraCardDraft, JiraCardInput, JiraIssueType, JiraStatus, TestCase, TestResult } from '@ctp/shared';

import type { AiFacade } from '../ai.ts';
import type { Store } from '../db.ts';
import { TRIAL_TEST_CASE_ID } from '../runManager.ts';
import { cardDescription, cardTitle, commentHeader, plainProblem, suggestedIssueType } from './cardText.ts';
import { type JiraClient, JiraError } from './client.ts';

/** A request the admin can fix (not found, not allowed…). Shown as is. */
export class JiraInputError extends Error {
  constructor(
    message: string,
    readonly statusCode = 400
  ) {
    super(message);
    this.name = 'JiraInputError';
  }
}

export interface JiraService {
  status(): JiraStatus;
  check(): Promise<{ user: string; projectName: string; issueTypes: Record<JiraIssueType, string | null> }>;
  draft(resultId: string): Promise<JiraCardDraft>;
  send(resultId: string, input: JiraCardInput): Promise<JiraCard>;
}

export const createJiraService = (options: {
  store: Store;
  ai: AiFacade;
  client: JiraClient | undefined;
  status: JiraStatus;
}): JiraService => {
  const { store, ai, client } = options;

  const requireClient = (): JiraClient => {
    if (!client) {
      throw new JiraInputError(`Jira is not set up. ${options.status.problems.join(' ')} Add the Jira lines to .env and restart.`);
    }
    return client;
  };

  /** Loads the failed result with its run and test case. */
  const load = (resultId: string): { result: TestResult; run: NonNullable<ReturnType<Store['getRun']>>; testCase: TestCase } => {
    const result = store.getResult(resultId);
    if (!result) throw new JiraInputError(`Result ${resultId} does not exist.`, 404);
    if (result.status !== 'failed' && result.status !== 'error') {
      throw new JiraInputError('Jira cards can only be created for tests that failed or could not run.');
    }
    const run = store.getRun(result.runId);
    if (!run) throw new JiraInputError(`Run #${result.runId} does not exist.`, 404);
    if (run.trial || result.testCaseId === TRIAL_TEST_CASE_ID) {
      throw new JiraInputError('This was a try-out of an unsaved test case. Save the test case and run it before creating a card.');
    }
    const testCase = store.getTestCase(result.testCaseId);
    if (!testCase) throw new JiraInputError(`Test case ${result.testCaseId} does not exist.`, 404);
    return { result, run, testCase };
  };

  return {
    status: () => options.status,

    check: async () => requireClient().check(),

    draft: async (resultId) => {
      const { result, run, testCase } = load(resultId);
      let issueType = suggestedIssueType(result);
      let headline = testCase.title;
      let problem = plainProblem(result);
      let aiWritten = false;
      let note: string | undefined;

      try {
        const text = await ai.jiraText({ mode: run.mode, testCase, result });
        issueType = text.issueType;
        headline = text.title;
        problem = text.problem;
        aiWritten = true;
      } catch (error) {
        if (error instanceof BudgetExceededError) note = 'The monthly AI budget is used up, so the card was pre-filled without AI.';
        else if (error instanceof AiError && ai.status().enabled) note = `The AI could not write the card (${error.message}). It was pre-filled without AI.`;
        else if (!(error instanceof AiError)) throw error;
      }

      if (run.mode === 'demo') {
        note = [note, 'This run used the demo bot (simulated). Create a card only to try out the Jira connection.'].filter(Boolean).join(' ');
      }

      return {
        issueType,
        title: cardTitle(testCase.id, headline, run.mode === 'demo'),
        description: cardDescription({ run, testCase, result, problem }),
        labels: [...options.status.labels, testCase.id],
        earlierCards: store.jiraCardsForTestCase(testCase.id).filter((card) => card.kind === 'created'),
        aiWritten,
        note,
      };
    },

    send: async (resultId, input) => {
      const jira = requireClient();
      const { result, run, testCase } = load(resultId);
      const base = { testCaseId: testCase.id, resultId: result.id, runId: run.id, createdAt: new Date().toISOString() };

      if (input.mode === 'create') {
        const created = await jira.createIssue({
          issueType: input.issueType,
          title: input.title,
          description: input.description,
          labels: [...options.status.labels, testCase.id],
        });
        return store.addJiraCard({ ...base, kind: 'created', issueKey: created.key, issueType: input.issueType, title: input.title, url: created.url });
      }

      const earlier = store.jiraCardsForTestCase(testCase.id).find((card) => card.kind === 'created' && card.issueKey === input.issueKey);
      if (!earlier) throw new JiraInputError(`Card ${input.issueKey} was not created by this platform for ${testCase.id}.`);
      const comment = await jira.addComment(input.issueKey, `${commentHeader(run, result)}\n\n${input.description}`);
      return store.addJiraCard({ ...base, kind: 'comment', issueKey: earlier.issueKey, issueType: earlier.issueType, title: earlier.title, url: comment.url });
    },
  };
};

export { JiraError };
