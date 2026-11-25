import { describe, expect, it } from 'vitest';

import { StepError } from '../src/channels/types.ts';
import { FirestoreRest, FirestoreUnavailableError, ReadAccessError, decodeFields } from '../src/stage/firestoreRest.ts';
import { type AccessTokenProvider, SignInExpiredError } from '../src/stage/googleToken.ts';

const BASE = 'https://firestore.googleapis.com/v1/projects/salud-stage/databases/(default)/documents';

type Reply = { status: number; body: unknown } | Error;

/** Fake Google: answers each request in turn and records what was asked. */
const fakeFetch = (replies: Reply[]) => {
  const calls: Array<{ url: string; method: string; auth: string; body: string }> = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    calls.push({ url: String(input), method: init?.method ?? 'GET', auth: headers.get('authorization') ?? '', body: String(init?.body ?? '') });
    const next = replies.shift() ?? { status: 500, body: {} };
    if (next instanceof Error) throw next;
    return new Response(JSON.stringify(next.body), { status: next.status });
  }) as typeof fetch;
  return { calls, fetchImpl };
};

const fakeTokens = (behavior: 'ok' | 'expired' = 'ok') => {
  const forced: boolean[] = [];
  let count = 0;
  const tokens: AccessTokenProvider = {
    token: async (force = false) => {
      forced.push(force);
      if (behavior === 'expired') throw new SignInExpiredError();
      count += 1;
      return `access-${count}`;
    },
    expired: () => behavior === 'expired',
  };
  return { tokens, forced };
};

const client = (fetchImpl: typeof fetch, tokens = fakeTokens().tokens) =>
  new FirestoreRest({ projectId: 'salud-stage', account: 'juan@prestobots.com', tokens, fetch: fetchImpl });

describe('decodeFields', () => {
  it('turns Firestore REST values into plain values', () => {
    expect(
      decodeFields({
        text: { stringValue: 'Hola' },
        count: { integerValue: '42' },
        ratio: { doubleValue: 0.5 },
        on: { booleanValue: true },
        nothing: { nullValue: null },
        createdAt: { timestampValue: '2026-11-16T12:00:00.123456Z' },
        payload: {
          mapValue: {
            fields: {
              buttons: { arrayValue: { values: [{ mapValue: { fields: { id: { stringValue: 'b1' } } } }] } },
              empty: { arrayValue: {} },
            },
          },
        },
        ref: { referenceValue: 'projects/p/databases/(default)/documents/a/b' },
      })
    ).toEqual({
      text: 'Hola',
      count: 42,
      ratio: 0.5,
      on: true,
      nothing: null,
      createdAt: '2026-11-16T12:00:00.123Z',
      payload: { buttons: [{ id: 'b1' }], empty: [] },
      ref: 'projects/p/databases/(default)/documents/a/b',
    });
  });

  it('accepts a document without fields', () => {
    expect(decodeFields(undefined)).toEqual({});
  });
});

describe('FirestoreRest.getDocument (FR-8, FR-12, FR-14)', () => {
  it('reads only the asked fields, with the access token', async () => {
    const { calls, fetchImpl } = fakeFetch([
      { status: 200, body: { name: `${BASE}/organizations/qa`, fields: { name: { stringValue: 'TESTING MACENA' } } } },
    ]);
    const data = await client(fetchImpl).getDocument('organizations/qa', ['name', 'settings.gupshup.appName']);
    expect(data).toEqual({ name: 'TESTING MACENA' });
    expect(calls[0]).toMatchObject({
      url: `${BASE}/organizations/qa?mask.fieldPaths=name&mask.fieldPaths=settings.gupshup.appName`,
      method: 'GET',
      auth: 'Bearer access-1',
    });
  });

  it('returns undefined when the document does not exist', async () => {
    const { fetchImpl } = fakeFetch([{ status: 404, body: { error: { message: 'not found' } } }]);
    expect(await client(fetchImpl).getDocument('organizations/none', ['name'])).toBeUndefined();
  });

  it('explains a missing read permission and names the account', async () => {
    const { fetchImpl } = fakeFetch([{ status: 403, body: { error: { message: 'Missing or insufficient permissions.' } } }]);
    const error = (await client(fetchImpl).getDocument('organizations/qa', ['name']).catch((e: unknown) => e)) as Error;
    expect(error).toBeInstanceOf(ReadAccessError);
    expect(error.message).toBe(
      "Your account juan@prestobots.com can't read salud-stage. Ask Pachi for read access (Cloud Datastore Viewer) on salud-stage."
    );
  });

  it('gets a new token once after a 401, and reports an expired sign-in if Google still refuses', async () => {
    const { tokens, forced } = fakeTokens();
    const ok = fakeFetch([
      { status: 401, body: {} },
      { status: 200, body: { fields: {} } },
    ]);
    expect(await client(ok.fetchImpl, tokens).getDocument('organizations/qa', ['name'])).toEqual({});
    expect(forced).toEqual([false, true]);
    expect(ok.calls[1]?.auth).toBe('Bearer access-2');

    const refused = fakeFetch([
      { status: 401, body: {} },
      { status: 401, body: {} },
    ]);
    await expect(client(refused.fetchImpl).getDocument('organizations/qa', ['name'])).rejects.toBeInstanceOf(SignInExpiredError);
  });

  it('passes an expired sign-in through', async () => {
    const { fetchImpl, calls } = fakeFetch([]);
    await expect(client(fetchImpl, fakeTokens('expired').tokens).getDocument('organizations/qa', ['name'])).rejects.toBeInstanceOf(
      SignInExpiredError
    );
    expect(calls).toHaveLength(0);
  });

  it.each([
    ['a Google server error', { status: 503, body: { error: { message: 'The service is currently unavailable.' } } }, 'The service is currently unavailable.'],
    ['no internet', new Error('getaddrinfo ENOTFOUND firestore.googleapis.com'), 'getaddrinfo ENOTFOUND'],
  ])('reports %s as "could not reach salud-stage"', async (_label, reply, detail) => {
    const { fetchImpl } = fakeFetch([reply as Reply]);
    const error = (await client(fetchImpl).getDocument('organizations/qa', ['name']).catch((e: unknown) => e)) as Error;
    expect(error).toBeInstanceOf(FirestoreUnavailableError);
    expect(error).toBeInstanceOf(StepError);
    expect(error.message).toMatch(/^Could not reach salud-stage: /);
    expect(error.message).toContain(detail);
  });
});

describe('FirestoreRest.runQuery (FR-8, FR-14)', () => {
  const query = {
    from: [{ collectionId: 'messages' }],
    where: { fieldFilter: { field: { fieldPath: 'createdAt' }, op: 'GREATER_THAN_OR_EQUAL', value: { timestampValue: '2026-11-16T12:00:00.000Z' } } },
    orderBy: [{ field: { fieldPath: 'createdAt' }, direction: 'ASCENDING' }],
  };

  it('posts the query under the given parent and returns the documents with their ids', async () => {
    const { calls, fetchImpl } = fakeFetch([
      {
        status: 200,
        body: [
          { document: { name: `${BASE}/conversations/c1/messages/m1`, fields: { messageType: { stringValue: 'text' } } }, readTime: 'x' },
          { document: { name: `${BASE}/conversations/c1/messages/m2`, fields: {} }, readTime: 'x' },
        ],
      },
    ]);
    const docs = await client(fetchImpl).runQuery('conversations/c1', query);
    expect(docs).toEqual([
      { id: 'm1', data: { messageType: 'text' } },
      { id: 'm2', data: {} },
    ]);
    expect(calls[0]).toMatchObject({ url: `${BASE}/conversations/c1:runQuery`, method: 'POST', auth: 'Bearer access-1' });
    expect(JSON.parse(calls[0]?.body ?? '')).toEqual({ structuredQuery: query });
  });

  it('queries the root collections when there is no parent, and skips empty rows', async () => {
    const { calls, fetchImpl } = fakeFetch([{ status: 200, body: [{ readTime: '2026-11-16T12:00:00Z' }] }]);
    expect(await client(fetchImpl).runQuery('', { from: [{ collectionId: 'conversations' }] })).toEqual([]);
    expect(calls[0]?.url).toBe(`${BASE}:runQuery`);
  });

  it('maps errors like a document read', async () => {
    const denied = fakeFetch([{ status: 403, body: {} }]);
    await expect(client(denied.fetchImpl).runQuery('', query)).rejects.toBeInstanceOf(ReadAccessError);
    const index = fakeFetch([{ status: 400, body: { error: { message: 'The query requires an index.' } } }]);
    await expect(client(index.fetchImpl).runQuery('', query)).rejects.toThrow('Could not reach salud-stage: The query requires an index.');
  });
});
