import type { JiraIssueType } from '@ctp/shared';

import { type AdfDoc, toAdf } from './adf.ts';

export interface JiraSettings {
  /** Normalized to "https://host", without a trailing slash. */
  baseUrl: string;
  email: string;
  apiToken: string;
  projectKey: string;
  labels: string[];
  priority?: string;
}

/** A Jira problem explained in plain words for admins. */
export class JiraError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'JiraError';
  }
}

/** Names Jira may use for each type, depending on the site's language. */
const TYPE_NAMES: Record<JiraIssueType, string[]> = {
  Bug: ['bug', 'error', 'defecto', 'falla'],
  Task: ['task', 'tarea'],
};

type FetchLike = typeof fetch;

interface ProjectInfo {
  name: string;
  issueTypes: Array<{ id: string; name: string; subtask?: boolean }>;
}

/** Minimal Jira Cloud client (REST API v3, email + API token). */
export class JiraClient {
  private project: ProjectInfo | null = null;

  constructor(
    readonly settings: JiraSettings,
    private readonly fetchImpl: FetchLike = fetch
  ) {}

  browseUrl(issueKey: string): string {
    return `${this.settings.baseUrl}/browse/${issueKey}`;
  }

  /** Checks the credentials and the project. Returns plain-words facts for the Settings page. */
  async check(): Promise<{ user: string; projectName: string; issueTypes: Record<JiraIssueType, string | null> }> {
    const me = await this.call<{ displayName?: string; emailAddress?: string }>('GET', '/rest/api/3/myself');
    this.project = null;
    const project = await this.projectInfo();
    return {
      user: me.displayName ?? me.emailAddress ?? this.settings.email,
      projectName: project.name,
      issueTypes: { Bug: this.findType(project, 'Bug')?.name ?? null, Task: this.findType(project, 'Task')?.name ?? null },
    };
  }

  async createIssue(input: { issueType: JiraIssueType; title: string; description: string; labels: string[] }): Promise<{ key: string; url: string }> {
    const project = await this.projectInfo();
    const type = this.findType(project, input.issueType);
    if (!type) {
      throw new JiraError(
        `Project ${this.settings.projectKey} has no "${input.issueType}" card type. Available: ${project.issueTypes
          .filter((t) => !t.subtask)
          .map((t) => t.name)
          .join(', ')}.`
      );
    }
    const fields: Record<string, unknown> = {
      project: { key: this.settings.projectKey },
      issuetype: { id: type.id },
      summary: input.title.slice(0, 250),
      description: toAdf(input.description),
      labels: input.labels,
    };
    if (this.settings.priority) fields.priority = { name: this.settings.priority };

    const created = await this.call<{ key: string }>('POST', '/rest/api/3/issue', { fields });
    return { key: created.key, url: this.browseUrl(created.key) };
  }

  async addComment(issueKey: string, text: string): Promise<{ url: string }> {
    const body: { body: AdfDoc } = { body: toAdf(text) };
    const comment = await this.call<{ id: string }>('POST', `/rest/api/3/issue/${encodeURIComponent(issueKey)}/comment`, body);
    return { url: `${this.browseUrl(issueKey)}?focusedCommentId=${comment.id}` };
  }

  private findType(project: ProjectInfo, wanted: JiraIssueType): ProjectInfo['issueTypes'][number] | undefined {
    const candidates = project.issueTypes.filter((t) => !t.subtask);
    for (const name of TYPE_NAMES[wanted]) {
      const found = candidates.find((t) => t.name.trim().toLowerCase() === name);
      if (found) return found;
    }
    return undefined;
  }

  private async projectInfo(): Promise<ProjectInfo> {
    if (!this.project) {
      const project = await this.call<Partial<ProjectInfo>>('GET', `/rest/api/3/project/${encodeURIComponent(this.settings.projectKey)}`);
      this.project = { name: project.name ?? this.settings.projectKey, issueTypes: project.issueTypes ?? [] };
    }
    return this.project;
  }

  private async call<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    const auth = Buffer.from(`${this.settings.email}:${this.settings.apiToken}`).toString('base64');
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.settings.baseUrl}${path}`, {
        method,
        headers: {
          Authorization: `Basic ${auth}`,
          Accept: 'application/json',
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(20_000),
      });
    } catch {
      throw new JiraError(`Could not reach Jira at ${this.settings.baseUrl}. Check JIRA_SITE and the internet connection.`);
    }

    const data = (await response.json().catch(() => ({}))) as {
      errorMessages?: string[];
      errors?: Record<string, string>;
    };
    if (response.ok) return data as T;

    const details = [...(data.errorMessages ?? []), ...Object.entries(data.errors ?? {}).map(([field, msg]) => `${field}: ${msg}`)].join(' ');
    switch (response.status) {
      case 401:
        throw new JiraError('Jira did not accept the email or API token. Check JIRA_EMAIL and JIRA_API_TOKEN in .env.');
      case 403:
        throw new JiraError(`The Jira account is not allowed to do this in project ${this.settings.projectKey}. ${details}`.trim());
      case 404:
        throw new JiraError(
          `Jira could not find ${path.includes('/comment') ? 'that card' : `project ${this.settings.projectKey}`}, or the account can't see it. ${details}`.trim()
        );
      case 429:
        throw new JiraError('Jira is receiving too many requests. Try again in a minute.');
      default:
        if (response.status >= 500) throw new JiraError('Jira is temporarily unavailable. Try again shortly.');
        throw new JiraError(`Jira refused the request. ${details || `(status ${response.status})`}`);
    }
  }
}

/** Reads the Jira settings from the environment. Returns the problems when incomplete. */
export const parseJiraSettings = (env: {
  site?: string;
  email?: string;
  apiToken?: string;
  projectKey?: string;
  labels?: string;
  priority?: string;
}): { settings?: JiraSettings; problems: string[]; site?: string; labels: string[] } => {
  const problems: string[] = [];
  const labels = (env.labels ?? 'chatbot-qa')
    .split(',')
    .map((label) => label.trim().replace(/\s+/g, '-'))
    .filter(Boolean);

  let baseUrl: string | undefined;
  if (env.site) {
    const raw = /^[a-z]+:\/\//i.test(env.site) ? env.site : `https://${env.site}`;
    try {
      const url = new URL(raw);
      if (url.protocol !== 'https:') problems.push('JIRA_SITE must use https.');
      else baseUrl = `https://${url.host}`;
    } catch {
      problems.push('JIRA_SITE is not a valid address (expected something like yourcompany.atlassian.net).');
    }
  }
  const projectKey = env.projectKey?.toUpperCase();
  if (projectKey && !/^[A-Z][A-Z0-9_]+$/.test(projectKey)) problems.push('JIRA_PROJECT_KEY looks wrong (expected something like CHAT).');

  const missing = [
    !env.site && 'JIRA_SITE (e.g. yourcompany.atlassian.net)',
    !env.email && 'JIRA_EMAIL (the account that creates the cards)',
    !env.apiToken && 'JIRA_API_TOKEN',
    !env.projectKey && 'JIRA_PROJECT_KEY',
  ].filter((m): m is string => Boolean(m));
  problems.push(...missing.map((m) => `Missing: ${m}`));

  const site = baseUrl?.replace('https://', '');
  if (problems.length > 0 || !baseUrl || !projectKey) return { problems, site, labels };
  return {
    settings: { baseUrl, email: env.email!, apiToken: env.apiToken!, projectKey, labels, priority: env.priority },
    problems,
    site,
    labels,
  };
};
