import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

import type { UsageEntry } from '@ctp/ai';
import {
  type AiUsageBreakdown,
  type ChatMessage,
  type ChatbotMode,
  type Generation,
  type JiraCard,
  type Run,
  type TestCase,
  type TestResult,
  runSchema,
  testCaseSchema,
  testResultSchema,
} from '@ctp/shared';
import Database from 'better-sqlite3';

/**
 * Local storage: one SQLite file. Each row keeps the full object as JSON (validated on read) plus a
 * few columns used for filtering and sorting.
 */
export class Store {
  private readonly db: Database.Database;

  constructor(file: string) {
    if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
    this.db = new Database(file);
    this.db.pragma('journal_mode = WAL');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS test_cases (
        id TEXT PRIMARY KEY,
        status TEXT NOT NULL,
        area TEXT NOT NULL,
        data TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS runs (
        id INTEGER PRIMARY KEY,
        status TEXT NOT NULL,
        data TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS test_results (
        id TEXT PRIMARY KEY,
        run_id INTEGER NOT NULL,
        test_case_id TEXT NOT NULL,
        position INTEGER NOT NULL,
        status TEXT NOT NULL,
        data TEXT NOT NULL,
        finished_at TEXT
      );
      CREATE INDEX IF NOT EXISTS test_results_run ON test_results (run_id, position);
      CREATE INDEX IF NOT EXISTS test_results_case ON test_results (test_case_id, run_id);
      CREATE TABLE IF NOT EXISTS ai_usage (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        at TEXT NOT NULL,
        month TEXT NOT NULL,
        purpose TEXT NOT NULL,
        model TEXT NOT NULL,
        input_tokens INTEGER NOT NULL,
        output_tokens INTEGER NOT NULL,
        cache_read_tokens INTEGER NOT NULL,
        cache_write_tokens INTEGER NOT NULL,
        cost_usd REAL NOT NULL
      );
      CREATE INDEX IF NOT EXISTS ai_usage_month ON ai_usage (month);
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS generations (
        id INTEGER PRIMARY KEY,
        status TEXT NOT NULL,
        data TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS jira_cards (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        kind TEXT NOT NULL,
        issue_key TEXT NOT NULL,
        issue_type TEXT NOT NULL,
        title TEXT NOT NULL,
        url TEXT NOT NULL,
        test_case_id TEXT NOT NULL,
        result_id TEXT NOT NULL,
        run_id INTEGER NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS jira_cards_case ON jira_cards (test_case_id);
      CREATE INDEX IF NOT EXISTS jira_cards_run ON jira_cards (run_id);
    `);
  }

  // ── Settings ───────────────────────────────────────────────────────────────

  getSetting(key: string): string | undefined {
    const row = this.db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
    return row?.value;
  }

  setSetting(key: string, value: string): void {
    this.db
      .prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
      .run(key, value);
  }

  // ── "Generate test cases" jobs ─────────────────────────────────────────────

  nextGenerationId(): string {
    const row = this.db.prepare('SELECT COALESCE(MAX(id), 0) + 1 AS next FROM generations').get() as { next: number };
    return String(row.next);
  }

  saveGeneration(generation: Generation): void {
    this.db
      .prepare(
        `INSERT INTO generations (id, status, data, created_at) VALUES (@id, @status, @data, @createdAt)
         ON CONFLICT(id) DO UPDATE SET status = @status, data = @data`
      )
      .run({ id: Number(generation.id), status: generation.status, data: JSON.stringify(generation), createdAt: generation.createdAt });
  }

  getGeneration(id: string): Generation | undefined {
    const row = this.db.prepare('SELECT data FROM generations WHERE id = ?').get(Number(id)) as { data: string } | undefined;
    return row ? (JSON.parse(row.data) as Generation) : undefined;
  }

  listGenerations(limit = 20): Generation[] {
    const rows = this.db.prepare('SELECT data FROM generations ORDER BY id DESC LIMIT ?').all(limit) as Array<{ data: string }>;
    return rows.map((row) => JSON.parse(row.data) as Generation);
  }

  /** AI cost of calls made since `at` (ISO date). */
  aiSpendSince(at: string): number {
    const row = this.db.prepare('SELECT COALESCE(SUM(cost_usd), 0) AS total FROM ai_usage WHERE at >= ?').get(at) as { total: number };
    return row.total;
  }

  // ── Jira cards (only the link is kept: no status sync) ─────────────────────

  addJiraCard(card: Omit<JiraCard, 'id'>): JiraCard {
    const info = this.db
      .prepare(
        `INSERT INTO jira_cards (kind, issue_key, issue_type, title, url, test_case_id, result_id, run_id, created_at)
         VALUES (@kind, @issueKey, @issueType, @title, @url, @testCaseId, @resultId, @runId, @createdAt)`
      )
      .run({ ...card, runId: Number(card.runId) });
    return { ...card, id: Number(info.lastInsertRowid) };
  }

  private jiraCards(where: string, value: string | number): JiraCard[] {
    const rows = this.db
      .prepare(
        `SELECT id, kind, issue_key AS issueKey, issue_type AS issueType, title, url, test_case_id AS testCaseId,
                result_id AS resultId, run_id AS runId, created_at AS createdAt
         FROM jira_cards WHERE ${where} = ? ORDER BY id DESC`
      )
      .all(value) as Array<Omit<JiraCard, 'runId'> & { runId: number }>;
    return rows.map((row) => ({ ...row, runId: String(row.runId) }));
  }

  jiraCardsForTestCase(testCaseId: string): JiraCard[] {
    return this.jiraCards('test_case_id', testCaseId);
  }

  jiraCardsForRun(runId: string): JiraCard[] {
    return this.jiraCards('run_id', Number(runId));
  }

  // ── AI usage ───────────────────────────────────────────────────────────────

  recordAiUsage(entry: UsageEntry): void {
    this.db
      .prepare(
        `INSERT INTO ai_usage (at, month, purpose, model, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost_usd)
         VALUES (@at, @month, @purpose, @model, @inputTokens, @outputTokens, @cacheReadTokens, @cacheWriteTokens, @costUsd)`
      )
      .run({ ...entry, month: entry.at.slice(0, 7) });
  }

  aiSpend(month: string): number {
    const row = this.db.prepare('SELECT COALESCE(SUM(cost_usd), 0) AS total FROM ai_usage WHERE month = ?').get(month) as {
      total: number;
    };
    return row.total;
  }

  aiBreakdown(month: string): Omit<AiUsageBreakdown, 'month'> {
    const byPurpose = this.db
      .prepare('SELECT purpose, COUNT(*) AS calls, SUM(cost_usd) AS costUsd FROM ai_usage WHERE month = ? GROUP BY purpose ORDER BY costUsd DESC')
      .all(month) as AiUsageBreakdown['byPurpose'];
    const byModel = this.db
      .prepare('SELECT model, COUNT(*) AS calls, SUM(cost_usd) AS costUsd FROM ai_usage WHERE month = ? GROUP BY model ORDER BY costUsd DESC')
      .all(month) as AiUsageBreakdown['byModel'];
    return { byPurpose, byModel };
  }

  /** Bot messages from recent runs in this mode: what the bot really says, for the AI. */
  recentBotMessages(mode: ChatbotMode, resultLimit = 40): ChatMessage[] {
    const rows = this.db
      .prepare(
        `SELECT r.data AS data FROM test_results r JOIN runs u ON u.id = r.run_id
         WHERE json_extract(u.data, '$.mode') = ? AND r.status NOT IN ('pending', 'running')
         ORDER BY r.run_id DESC, r.position LIMIT ?`
      )
      .all(mode, resultLimit) as Array<{ data: string }>;
    return rows.flatMap((row) => {
      const result = testResultSchema.parse(JSON.parse(row.data));
      return [...result.setup, ...result.steps.flatMap((step) => step.replies)].filter((m) => m.from === 'bot');
    });
  }

  close(): void {
    this.db.close();
  }

  // ── Test cases ─────────────────────────────────────────────────────────────

  countTestCases(): number {
    return (this.db.prepare('SELECT COUNT(*) AS n FROM test_cases').get() as { n: number }).n;
  }

  listTestCases(): TestCase[] {
    const rows = this.db.prepare('SELECT data FROM test_cases ORDER BY area, id').all() as Array<{ data: string }>;
    return rows.map((row) => testCaseSchema.parse(JSON.parse(row.data)));
  }

  getTestCase(id: string): TestCase | undefined {
    const row = this.db.prepare('SELECT data FROM test_cases WHERE id = ?').get(id) as { data: string } | undefined;
    return row ? testCaseSchema.parse(JSON.parse(row.data)) : undefined;
  }

  saveTestCase(testCase: TestCase): void {
    const valid = testCaseSchema.parse(testCase);
    this.db
      .prepare(
        `INSERT INTO test_cases (id, status, area, data, updated_at) VALUES (@id, @status, @area, @data, @updatedAt)
         ON CONFLICT(id) DO UPDATE SET status = @status, area = @area, data = @data, updated_at = @updatedAt`
      )
      .run({ id: valid.id, status: valid.status, area: valid.area, data: JSON.stringify(valid), updatedAt: valid.updatedAt });
  }

  // ── Runs ───────────────────────────────────────────────────────────────────

  nextRunId(): string {
    const row = this.db.prepare('SELECT COALESCE(MAX(id), 0) + 1 AS next FROM runs').get() as { next: number };
    return String(row.next);
  }

  saveRun(run: Run): void {
    const valid = runSchema.parse(run);
    this.db
      .prepare(
        `INSERT INTO runs (id, status, data, created_at) VALUES (@id, @status, @data, @createdAt)
         ON CONFLICT(id) DO UPDATE SET status = @status, data = @data`
      )
      .run({ id: Number(valid.id), status: valid.status, data: JSON.stringify(valid), createdAt: valid.createdAt });
  }

  getRun(id: string): Run | undefined {
    const row = this.db.prepare('SELECT data FROM runs WHERE id = ?').get(Number(id)) as { data: string } | undefined;
    return row ? runSchema.parse(JSON.parse(row.data)) : undefined;
  }

  listRuns(limit = 100): Run[] {
    const rows = this.db.prepare('SELECT data FROM runs ORDER BY id DESC LIMIT ?').all(limit) as Array<{ data: string }>;
    return rows.map((row) => runSchema.parse(JSON.parse(row.data)));
  }

  /** Runs left unfinished when the platform stopped. */
  listUnfinishedRuns(): Run[] {
    const rows = this.db
      .prepare(`SELECT data FROM runs WHERE status IN ('queued', 'running')`)
      .all() as Array<{ data: string }>;
    return rows.map((row) => runSchema.parse(JSON.parse(row.data)));
  }

  // ── Results ────────────────────────────────────────────────────────────────

  saveResult(result: TestResult, position: number): void {
    const valid = testResultSchema.parse(result);
    this.db
      .prepare(
        `INSERT INTO test_results (id, run_id, test_case_id, position, status, data, finished_at)
         VALUES (@id, @runId, @testCaseId, @position, @status, @data, @finishedAt)
         ON CONFLICT(id) DO UPDATE SET status = @status, data = @data, finished_at = @finishedAt`
      )
      .run({
        id: valid.id,
        runId: Number(valid.runId),
        testCaseId: valid.testCaseId,
        position,
        status: valid.status,
        data: JSON.stringify(valid),
        finishedAt: valid.finishedAt ?? null,
      });
  }

  getResult(id: string): TestResult | undefined {
    const row = this.db.prepare('SELECT data FROM test_results WHERE id = ?').get(id) as { data: string } | undefined;
    return row ? testResultSchema.parse(JSON.parse(row.data)) : undefined;
  }

  listResults(runId: string): TestResult[] {
    const rows = this.db
      .prepare('SELECT data FROM test_results WHERE run_id = ? ORDER BY position')
      .all(Number(runId)) as Array<{ data: string }>;
    return rows.map((row) => testResultSchema.parse(JSON.parse(row.data)));
  }

  /** Latest results of one test case, newest first, without the conversation (lighter). */
  historyOf(testCaseId: string, limit = 20): Array<Pick<TestResult, 'id' | 'runId' | 'status' | 'finishedAt' | 'error'>> {
    const rows = this.db
      .prepare(
        `SELECT data FROM test_results WHERE test_case_id = ? AND status NOT IN ('pending', 'running')
         ORDER BY run_id DESC LIMIT ?`
      )
      .all(testCaseId, limit) as Array<{ data: string }>;
    return rows.map((row) => {
      const { id, runId, status, finishedAt, error } = testResultSchema.parse(JSON.parse(row.data));
      return { id, runId, status, finishedAt, error };
    });
  }

  /** Latest finished result per test case. */
  lastResults(): Map<string, Pick<TestResult, 'runId' | 'status' | 'finishedAt'>> {
    const rows = this.db
      .prepare(
        `SELECT r.test_case_id AS testCaseId, r.run_id AS runId, r.status AS status, r.finished_at AS finishedAt
         FROM test_results r
         JOIN (SELECT test_case_id, MAX(run_id) AS run_id FROM test_results
               WHERE status NOT IN ('pending', 'running') GROUP BY test_case_id) last
           ON last.test_case_id = r.test_case_id AND last.run_id = r.run_id`
      )
      .all() as Array<{ testCaseId: string; runId: number; status: TestResult['status']; finishedAt: string | null }>;
    return new Map(
      rows.map((row) => [
        row.testCaseId,
        { runId: String(row.runId), status: row.status, finishedAt: row.finishedAt ?? undefined },
      ])
    );
  }
}
