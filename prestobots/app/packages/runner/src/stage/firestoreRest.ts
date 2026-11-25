import { StepError } from '../channels/types.ts';
import { guardedFetch } from './googleGuard.ts';
import { type AccessTokenProvider, SignInExpiredError } from './googleToken.ts';

/**
 * Minimal read-only client for Firestore's REST API, signed in as the admin. It only reads
 * (document GET and runQuery); every address goes through the Google guard first.
 */

/** The signed-in account has no read permission on the project. */
export class ReadAccessError extends StepError {
  constructor(account: string, projectId: string) {
    super(
      `Your account ${account} can't read ${projectId}. Ask Pachi for read access (Cloud Datastore Viewer) on ${projectId}.`
    );
    this.name = 'ReadAccessError';
  }
}

/** Google could not be reached or answered with an unexpected error. */
export class FirestoreUnavailableError extends StepError {
  constructor(detail: string) {
    super(`Could not reach salud-stage: ${detail}`);
    this.name = 'FirestoreUnavailableError';
  }
}

type RestValue = Record<string, unknown>;
type RestFields = Record<string, RestValue> | undefined;

const decodeValue = (value: RestValue): unknown => {
  if ('stringValue' in value) return value.stringValue;
  if ('integerValue' in value) return Number(value.integerValue);
  if ('doubleValue' in value) return Number(value.doubleValue);
  if ('booleanValue' in value) return value.booleanValue;
  if ('nullValue' in value) return null;
  if ('timestampValue' in value) return new Date(String(value.timestampValue)).toISOString();
  if ('referenceValue' in value) return value.referenceValue;
  if ('mapValue' in value) return decodeFields((value.mapValue as { fields?: RestFields }).fields);
  if ('arrayValue' in value) {
    const values = (value.arrayValue as { values?: RestValue[] }).values ?? [];
    return values.map(decodeValue);
  }
  return null;
};

/** Firestore REST `fields` → plain object (timestamps become ISO strings). */
export const decodeFields = (fields: RestFields): Record<string, unknown> =>
  Object.fromEntries(Object.entries(fields ?? {}).map(([key, value]) => [key, decodeValue(value)]));

export interface FirestoreRestOptions {
  projectId: string;
  /** Email of the signed-in admin, for the "no access" message. */
  account: string;
  tokens: AccessTokenProvider;
  fetch?: typeof fetch;
}

export interface FirestoreDocument {
  id: string;
  data: Record<string, unknown>;
}

export class FirestoreRest {
  private readonly fetchImpl: typeof fetch;
  readonly base: string;

  constructor(private readonly options: FirestoreRestOptions) {
    this.fetchImpl = guardedFetch(options.fetch ?? fetch, options.projectId);
    this.base = `https://firestore.googleapis.com/v1/projects/${options.projectId}/databases/(default)/documents`;
  }

  /** Reads one document, only the given fields. Undefined when it does not exist. */
  async getDocument(path: string, fieldMask: string[]): Promise<Record<string, unknown> | undefined> {
    const query = fieldMask.map((field) => `mask.fieldPaths=${encodeURIComponent(field)}`).join('&');
    const response = await this.request(`${this.base}/${path}${query ? `?${query}` : ''}`, { method: 'GET' });
    if (response.status === 404) return undefined;
    const body = (await response.json()) as { fields?: RestFields };
    return decodeFields(body.fields);
  }

  /**
   * Runs a structured query on the collections under `parentPath` ('' for the root collections,
   * e.g. 'conversations/c1' for its messages). Returns the matching documents in order.
   */
  async runQuery(parentPath: string, structuredQuery: Record<string, unknown>): Promise<FirestoreDocument[]> {
    const url = `${this.base}${parentPath ? `/${parentPath}` : ''}:runQuery`;
    const response = await this.request(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ structuredQuery }),
    });
    const rows = (await response.json()) as Array<{ document?: { name: string; fields?: RestFields } }>;
    return rows.flatMap((row) =>
      row.document ? [{ id: row.document.name.split('/').pop() ?? '', data: decodeFields(row.document.fields) }] : []
    );
  }

  /** Sends a request with the access token and turns Google's errors into plain-words errors. */
  protected async request(url: string, init: RequestInit): Promise<Response> {
    let response = await this.send(url, init, false);
    if (response.status === 401) response = await this.send(url, init, true);
    if (response.status === 401) throw new SignInExpiredError();
    if (response.status === 403) throw new ReadAccessError(this.options.account, this.options.projectId);
    if (response.ok || response.status === 404) return response;
    const body = (await response.json().catch(() => ({}))) as { error?: { message?: unknown } };
    const detail = typeof body.error?.message === 'string' ? body.error.message : `HTTP ${response.status}`;
    throw new FirestoreUnavailableError(detail);
  }

  private async send(url: string, init: RequestInit, forceToken: boolean): Promise<Response> {
    let token: string;
    try {
      token = await this.options.tokens.token(forceToken);
    } catch (error) {
      if (error instanceof SignInExpiredError) throw error;
      throw new FirestoreUnavailableError((error as Error).message);
    }
    try {
      return await this.fetchImpl(url, {
        ...init,
        headers: { ...(init.headers as Record<string, string> | undefined), Authorization: `Bearer ${token}` },
      });
    } catch (error) {
      if (error instanceof Error && error.name === 'GuardError') throw error;
      throw new FirestoreUnavailableError((error as Error).message);
    }
  }
}
