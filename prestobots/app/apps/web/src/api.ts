import type {
  AiStatus,
  AiUsageBreakdown,
  Generation,
  ProposalTrial,
  JiraCard,
  JiraCardDraft,
  JiraCardInput,
  JiraIssueType,
  PlatformStatus,
  StageChecks,
  TestMessageResult,
  ResultStatus,
  Run,
  TestCase,
  TestCaseDraft,
  TestCaseStatus,
  TestResult,
} from '@ctp/shared';

export type TestCaseRow = TestCase & {
  lastResult: { runId: string; status: ResultStatus; finishedAt?: string } | null;
};

export interface TestCaseDetail {
  testCase: TestCase;
  history: Array<Pick<TestResult, 'id' | 'runId' | 'status' | 'finishedAt' | 'error'>>;
  jiraCards: JiraCard[];
  /** For proposals: how the proposal behaved when it was tried. */
  proposalTrial: ProposalTrial | null;
}

/** A generation in the list: without the menu map and the conversations. */
export type GenerationRow = Omit<Generation, 'map' | 'trials'> & {
  paths: number;
  trials: Array<Omit<ProposalTrial, 'result'>>;
};

export interface RunDetail {
  run: Run;
  results: TestResult[];
  jiraCards: JiraCard[];
}

const request = async <T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> => {
  const hasBody = init?.body !== undefined;
  const response = await fetch(path, {
    method: init?.method ?? 'GET',
    headers: hasBody ? { 'Content-Type': 'application/json' } : undefined,
    body: hasBody ? JSON.stringify(init?.body) : undefined,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error((data as { error?: string }).error ?? `Request failed (${response.status})`);
  }
  return data as T;
};

export const api = {
  status: () => request<PlatformStatus>('/api/status'),
  testCases: () => request<TestCaseRow[]>('/api/test-cases'),
  testCase: (id: string) => request<TestCaseDetail>(`/api/test-cases/${id}`),
  setTestCaseStatus: (id: string, status: TestCaseStatus, reason?: string) =>
    request<TestCase>(`/api/test-cases/${id}`, { method: 'PATCH', body: { status, reason } }),
  runs: () => request<Run[]>('/api/runs'),
  run: (id: string) => request<RunDetail>(`/api/runs/${id}`),
  startRun: (body: { testCaseIds?: string[]; allActive?: boolean }) =>
    request<Run>('/api/runs', { method: 'POST', body }),
  cancelRun: (id: string) => request<{ ok: true }>(`/api/runs/${id}/cancel`, { method: 'POST', body: {} }),
  aiUsage: () => request<{ status: AiStatus; breakdown: AiUsageBreakdown }>('/api/ai/usage'),
  stageChecks: (fresh = false) => request<StageChecks>(`/api/stage/checks${fresh ? '?fresh=1' : ''}`),
  signOut: () => request<{ signedIn: false }>('/api/google/sign-out', { method: 'POST' }),
  sendTestMessage: () => request<TestMessageResult>('/api/stage/test-message', { method: 'POST' }),
  setBudget: (limitUsd: number) => request<AiStatus>('/api/ai/budget', { method: 'PUT', body: { limitUsd } }),
  draftTestCase: (body: { request: string; currentId?: string; draft?: TestCaseDraft }) =>
    request<TestCaseDraft>('/api/test-cases/draft', { method: 'POST', body }),
  tryDraft: (draft: TestCaseDraft) => request<Run>('/api/test-cases/trial', { method: 'POST', body: { draft } }),
  createTestCase: (draft: TestCaseDraft, status: 'active' | 'proposed') =>
    request<TestCase>('/api/test-cases', { method: 'POST', body: { draft, status } }),
  updateTestCase: (id: string, draft: TestCaseDraft) =>
    request<TestCase>(`/api/test-cases/${id}`, { method: 'PUT', body: { draft } }),
  generations: () => request<GenerationRow[]>('/api/generations'),
  generation: (id: string) => request<Generation>(`/api/generations/${id}`),
  startGeneration: () => request<Generation>('/api/generations', { method: 'POST', body: {} }),
  confirmGeneration: (id: string) => request<Generation>(`/api/generations/${id}/confirm`, { method: 'POST', body: {} }),
  cancelGeneration: (id: string) => request<Generation>(`/api/generations/${id}/cancel`, { method: 'POST', body: {} }),
  jiraCheck: () =>
    request<{ user: string; projectName: string; issueTypes: Record<JiraIssueType, string | null> }>('/api/jira/check', {
      method: 'POST',
      body: {},
    }),
  jiraDraft: (resultId: string) => request<JiraCardDraft>(`/api/results/${resultId}/jira/draft`, { method: 'POST', body: {} }),
  sendJira: (resultId: string, input: JiraCardInput) =>
    request<JiraCard>(`/api/results/${resultId}/jira`, { method: 'POST', body: input }),
};
