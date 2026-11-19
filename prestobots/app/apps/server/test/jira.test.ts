import { AiError } from '@ctp/ai';
import { DemoChannel, STARTER_TEST_CASES } from '@ctp/runner';
import type { AiStatus, JiraCard, JiraCardDraft, Run, TestResult } from '@ctp/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { type AiFacade, currentMonth } from '../src/ai.ts';
import { buildApp } from '../src/app.ts';
import { Store } from '../src/db.ts';
import { toAdf } from '../src/jira/adf.ts';
import { JiraClient, parseJiraSettings } from '../src/jira/client.ts';
import { createJiraService } from '../src/jira/service.ts';
import { GenerationManager } from '../src/generation/generationManager.ts';
import { RunManager } from '../src/runManager.ts';

describe('Jira text format', () => {
  it('turns headings, bullets, paragraphs and the conversation block into Jira format', () => {
    const doc = toAdf('## What went wrong\nLine one\nLine two\n\n- a\n- b\n```\n[Bot] hola\n\n[Patient] hi\n```\nEnd');
    expect(doc.content.map((block) => block.type)).toEqual(['heading', 'paragraph', 'bulletList', 'codeBlock', 'paragraph']);
    expect(JSON.stringify(doc.content[1])).toContain('hardBreak');
    expect(JSON.stringify(doc.content[3])).toContain('[Bot] hola\\n\\n[Patient] hi');
    // Jira rejects empty text nodes.
    expect(JSON.stringify(toAdf('```\n```'))).not.toContain('"text":""');
  });
});

describe('Jira settings', () => {
  it('accepts a bare site name and normalizes labels', () => {
    const parsed = parseJiraSettings({ site: 'acme.atlassian.net/', email: 'a@b.c', apiToken: 't', projectKey: 'chat', labels: 'chatbot qa, e2e' });
    expect(parsed.problems).toEqual([]);
    expect(parsed.settings).toMatchObject({ baseUrl: 'https://acme.atlassian.net', projectKey: 'CHAT', labels: ['chatbot-qa', 'e2e'] });
  });

  it('lists what is missing and refuses http', () => {
    const parsed = parseJiraSettings({ site: 'http://acme.atlassian.net' });
    expect(parsed.settings).toBeUndefined();
    expect(parsed.problems.join(' ')).toMatch(/https.*JIRA_EMAIL.*JIRA_API_TOKEN.*JIRA_PROJECT_KEY/);
  });
});

/** A fake Jira Cloud: records what it receives. Never talks to a real site. */
const fakeJira = (options: { rejectAuth?: boolean } = {}) => {
  const received: Array<{ method: string; path: string; body: any; auth: string | null }> = [];
  let next = 41;
  const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
    const { pathname } = new URL(String(url));
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    received.push({ method: init?.method ?? 'GET', path: pathname, body, auth: new Headers(init?.headers).get('authorization') });
    const json = (status: number, data: unknown) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
    if (options.rejectAuth) return json(401, {});
    if (pathname === '/rest/api/3/myself') return json(200, { displayName: 'QA Bot' });
    if (pathname === '/rest/api/3/project/CHAT')
      return json(200, { name: 'Chatbot', issueTypes: [{ id: '1', name: 'Error' }, { id: '2', name: 'Tarea' }, { id: '3', name: 'Subtarea', subtask: true }] });
    if (pathname === '/rest/api/3/issue') return json(201, { id: '100', key: `CHAT-${(next += 1)}` });
    if (/\/rest\/api\/3\/issue\/CHAT-\d+\/comment/.test(pathname)) return json(201, { id: '900' });
    return json(404, { errorMessages: ['Not found'] });
  }) as typeof fetch;
  return { fetchImpl, received };
};

const aiFacade = (jiraText: AiFacade['jiraText']): AiFacade => ({
  status: (): AiStatus => ({
    enabled: true,
    models: { author: 'a', judge: 'j' },
    budget: { month: currentMonth(), spentUsd: 0, limitUsd: 20, level: 'ok' },
  }),
  breakdown: () => ({ month: currentMonth(), byPurpose: [], byModel: [] }),
  setBudget: () => undefined,
  draft: async () => {
    throw new AiError('not used');
  },
  forRuns: () => undefined,
  jiraText,
  estimateProposal: () => ({ lowUsd: 0, highUsd: 0 }),
  propose: async () => ({ proposals: [], notes: [] }),
});

const aiOff: AiFacade['jiraText'] = async () => {
  throw new AiError('AI is off');
};

let store: Store;
let runs: RunManager | undefined;
let app: Awaited<ReturnType<typeof buildApp>> | undefined;
let jiraFake: ReturnType<typeof fakeJira>;

const setup = async (opts: { configured?: boolean; jiraText?: AiFacade['jiraText']; rejectAuth?: boolean } = {}) => {
  jiraFake = fakeJira({ rejectAuth: opts.rejectAuth });
  const parsed = parseJiraSettings({ site: 'acme.atlassian.net', email: 'qa@example.com', apiToken: 'secret-token', projectKey: 'CHAT', priority: 'Medium' });
  const ai = aiFacade(opts.jiraText ?? aiOff);
  runs = new RunManager(store, async () => new DemoChannel({ replyDelayMs: 1 }), 'demo', 'Demo bot');
  app = await buildApp({
    store,
    runs,
    ai,
    generations: new GenerationManager(store, async () => new DemoChannel({ replyDelayMs: 1 }), 'demo', ai, runs),
    jira: createJiraService({
      store,
      ai,
      client: opts.configured === false ? undefined : new JiraClient(parsed.settings!, jiraFake.fetchImpl),
      status: {
        configured: opts.configured !== false,
        site: parsed.site,
        projectKey: 'CHAT',
        labels: parsed.labels,
        problems: opts.configured === false ? ['Missing: JIRA_SITE'] : [],
      },
    }),
    status: async () => ({ mode: 'demo', target: 'Demo bot', ready: true, problems: [], notes: [] }),
  });
};

/** Runs every starter test on the demo bot. SAL-CANCEL-002 fails on purpose. */
const runAll = async () => {
  const run = (await app!.inject({ method: 'POST', url: '/api/runs', payload: { allActive: true } })).json<Run>();
  await runs!.whenIdle();
  const detail = (await app!.inject({ method: 'GET', url: `/api/runs/${run.id}` })).json<{ run: Run; results: TestResult[]; jiraCards: JiraCard[] }>();
  return {
    run: detail.run,
    failed: detail.results.find((r) => r.testCaseId === 'SAL-CANCEL-002')!,
    passed: detail.results.find((r) => r.status === 'passed')!,
  };
};

beforeEach(() => {
  store = new Store(':memory:');
  STARTER_TEST_CASES.forEach((testCase) => store.saveTestCase(testCase));
});

afterEach(async () => {
  await runs?.whenIdle();
  await app?.close();
  runs = undefined;
  app = undefined;
  store.close();
});

describe('Jira cards', () => {
  it('pre-fills a card without AI, creates it, then offers to comment on it next time', async () => {
    await setup();
    const { failed, passed } = await runAll();

    const draftResponse = await app!.inject({ method: 'POST', url: `/api/results/${failed.id}/jira/draft` });
    expect(draftResponse.statusCode).toBe(200);
    const draft = draftResponse.json<JiraCardDraft>();
    expect(draft.aiWritten).toBe(false);
    expect(draft.issueType).toBe('Bug');
    expect(draft.title).toMatch(/^\[DEMO\] \[SAL-CANCEL-002\] /);
    expect(draft.description).toContain('## Full conversation');
    expect(draft.description).toContain('Quiero cancelar mi turno');
    expect(draft.labels).toEqual(['chatbot-qa', 'SAL-CANCEL-002']);
    expect(draft.earlierCards).toEqual([]);
    expect(draft.note).toMatch(/demo bot/);

    const created = await app!.inject({
      method: 'POST',
      url: `/api/results/${failed.id}/jira`,
      payload: { mode: 'create', issueType: draft.issueType, title: draft.title, description: draft.description },
    });
    expect(created.statusCode).toBe(201);
    const card = created.json<JiraCard>();
    expect(card).toMatchObject({ kind: 'created', issueKey: 'CHAT-42', url: 'https://acme.atlassian.net/browse/CHAT-42' });

    const sent = jiraFake.received.find((r) => r.method === 'POST' && r.path === '/rest/api/3/issue')!;
    expect(sent.auth).toBe(`Basic ${Buffer.from('qa@example.com:secret-token').toString('base64')}`);
    expect(sent.body.fields).toMatchObject({
      project: { key: 'CHAT' },
      issuetype: { id: '1' }, // "Error" is Bug on a Spanish-language site
      labels: ['chatbot-qa', 'SAL-CANCEL-002'],
      priority: { name: 'Medium' },
    });
    expect(sent.body.fields.assignee).toBeUndefined();
    expect(sent.body.fields.description.type).toBe('doc');

    // The run report lists the card.
    const detail = (await app!.inject({ method: 'GET', url: `/api/runs/${failed.runId}` })).json<{ jiraCards: JiraCard[] }>();
    expect(detail.jiraCards.map((c) => c.issueKey)).toEqual(['CHAT-42']);

    // A second failure of the same test case: the earlier card is offered.
    const second = await runAll();
    const again = (await app!.inject({ method: 'POST', url: `/api/results/${second.failed.id}/jira/draft` })).json<JiraCardDraft>();
    expect(again.earlierCards.map((c) => c.issueKey)).toEqual(['CHAT-42']);

    const comment = await app!.inject({
      method: 'POST',
      url: `/api/results/${second.failed.id}/jira`,
      payload: { mode: 'comment', issueKey: 'CHAT-42', description: again.description },
    });
    expect(comment.statusCode).toBe(201);
    expect(comment.json<JiraCard>()).toMatchObject({ kind: 'comment', issueKey: 'CHAT-42', url: expect.stringContaining('focusedCommentId=900') });
    const commentBody = jiraFake.received.find((r) => r.path.endsWith('/comment'))!.body;
    expect(JSON.stringify(commentBody)).toContain(`Seen again in run #${second.run.id}`);

    // The test case page lists both.
    const testCase = (await app!.inject({ method: 'GET', url: '/api/test-cases/SAL-CANCEL-002' })).json<{ jiraCards: JiraCard[] }>();
    expect(testCase.jiraCards.map((c) => c.kind)).toEqual(['comment', 'created']);

    // Passed tests don't get cards; comments only go to cards the platform created.
    expect((await app!.inject({ method: 'POST', url: `/api/results/${passed.id}/jira/draft` })).statusCode).toBe(400);
    const foreign = await app!.inject({
      method: 'POST',
      url: `/api/results/${second.failed.id}/jira`,
      payload: { mode: 'comment', issueKey: 'OTHER-1', description: 'x' },
    });
    expect(foreign.statusCode).toBe(400);
  });

  it('uses the AI text when the AI is on', async () => {
    await setup({ jiraText: async () => ({ issueType: 'Task', title: 'Cancel option renamed', problem: 'The AI problem paragraph.' }) });
    const { failed } = await runAll();
    const draft = (await app!.inject({ method: 'POST', url: `/api/results/${failed.id}/jira/draft` })).json<JiraCardDraft>();
    expect(draft).toMatchObject({ aiWritten: true, issueType: 'Task', title: '[DEMO] [SAL-CANCEL-002] Cancel option renamed' });
    expect(draft.description).toContain('The AI problem paragraph.');
  });

  it('explains in plain words when Jira is not set up or rejects the token', async () => {
    await setup({ configured: false });
    const { failed } = await runAll();
    const response = await app!.inject({
      method: 'POST',
      url: `/api/results/${failed.id}/jira`,
      payload: { mode: 'create', issueType: 'Bug', title: 't', description: 'd' },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json<{ error: string }>().error).toMatch(/Jira is not set up/);
    await app!.close();

    await setup({ rejectAuth: true });
    const check = await app!.inject({ method: 'POST', url: '/api/jira/check' });
    expect(check.statusCode).toBe(502);
    expect(check.json<{ error: string }>().error).toMatch(/JIRA_EMAIL and JIRA_API_TOKEN/);
    expect(check.json<{ error: string }>().error).not.toContain('secret-token');
  });

  it('checks the connection and finds the card types', async () => {
    await setup();
    const check = await app!.inject({ method: 'POST', url: '/api/jira/check' });
    expect(check.json()).toEqual({ user: 'QA Bot', projectName: 'Chatbot', issueTypes: { Bug: 'Error', Task: 'Tarea' } });
  });
});
