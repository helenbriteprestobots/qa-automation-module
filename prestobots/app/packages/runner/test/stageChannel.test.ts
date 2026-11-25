import type { GoogleSession } from '@ctp/shared';
import { describe, expect, it } from 'vitest';

import { StepError } from '../src/channels/types.ts';
import { GuardError } from '../src/stage/guard.ts';
import { StageChannel, type StageChannelConfig } from '../src/stage/stageChannel.ts';

const BASE = 'https://firestore.googleapis.com/v1/projects/salud-stage/databases/(default)/documents';
const WEBHOOK = 'https://us-central1-salud-stage.cloudfunctions.net/webhookGupshupMessages';

const SESSION: GoogleSession = {
  email: 'juan@prestobots.com',
  refreshToken: 'refresh-1',
  scopes: ['openid', 'email', 'https://www.googleapis.com/auth/cloud-platform'],
  signedInAt: '2026-11-23T15:00:00.000Z',
};

const str = (value: string) => ({ stringValue: value });

interface FakeGoogle {
  calls: Array<{ url: string; method: string; body: string }>;
  fetch: typeof fetch;
  /** Messages the bot "saved", returned by the messages query. */
  messages: Array<{ id: string; fields: Record<string, unknown> }>;
  tokenStatus: number;
  /** When true, Firestore answers 401 (the access token was revoked). */
  unauthorized: boolean;
  webhookBody: string;
  clinic: { status: number; fields?: Record<string, unknown> };
}

/** Fake Google + webhook, routing on the address. */
const fakeGoogle = (): FakeGoogle => {
  const state: FakeGoogle = {
    calls: [],
    messages: [],
    tokenStatus: 200,
    unauthorized: false,
    webhookBody: 'ACK',
    clinic: { status: 200, fields: { name: str('TESTING MACENA'), settings: { mapValue: { fields: { gupshup: { mapValue: { fields: { appName: str('qa-app') } } } } } } } },
    fetch: (async () => new Response()) as typeof fetch,
  };
  state.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const body = String(init?.body ?? '');
    state.calls.push({ url, method: init?.method ?? 'GET', body });
    const json = (status: number, value: unknown) => new Response(JSON.stringify(value), { status });

    if (url === 'https://oauth2.googleapis.com/token') {
      return state.tokenStatus === 200
        ? json(200, { access_token: 'access-1', expires_in: 3600 })
        : json(400, { error: 'invalid_grant' });
    }
    if (url.startsWith(BASE) && state.unauthorized) return json(401, {});
    if (url.startsWith(`${BASE}/organizations/`)) return json(state.clinic.status, { fields: state.clinic.fields });
    if (url === `${BASE}:runQuery`) return json(200, [{ document: { name: `${BASE}/conversations/conv-1`, fields: {} } }]);
    if (url === `${BASE}/conversations/conv-1:runQuery`) {
      return json(200, state.messages.map((m) => ({ document: { name: `${BASE}/conversations/conv-1/messages/${m.id}`, fields: m.fields } })));
    }
    if (url === WEBHOOK) return new Response(state.webhookBody, { status: 200 });
    return json(500, { error: { message: `unexpected ${url}` } });
  }) as typeof fetch;
  return state;
};

const config = (google: FakeGoogle, change: Partial<StageChannelConfig> = {}): StageChannelConfig => ({
  projectId: 'salud-stage',
  orgId: 'qa-org',
  webhookUrl: WEBHOOK,
  patientPhone: '5492610000000',
  patientName: 'QA Paciente',
  replyTimeoutMs: 300,
  quietMs: 20,
  pollMs: 10,
  google: { clientId: 'client-id', clientSecret: 'client-secret', session: SESSION },
  fetch: google.fetch,
  ...change,
});

const botText = (id: string, text: string, at = new Date(Date.now() + 1000).toISOString()) => ({
  id,
  fields: {
    messageType: str('text'),
    senderType: str('bot'),
    createdAt: { timestampValue: at },
    payload: { mapValue: { fields: { text: str(text) } } },
  },
});

describe('StageChannel.create (FR-8, FR-9)', () => {
  it('refuses production before talking to Google', async () => {
    const google = fakeGoogle();
    await expect(StageChannel.create(config(google, { projectId: 'salud-prod' }))).rejects.toBeInstanceOf(GuardError);
    expect(google.calls).toHaveLength(0);
  });

  it('refuses to start without a Google sign-in', async () => {
    const google = fakeGoogle();
    await expect(
      StageChannel.create(config(google, { google: { clientId: 'c', clientSecret: 's', session: undefined } }))
    ).rejects.toThrow(/Sign in with Google/);
    expect(google.calls).toHaveLength(0);
  });

  it('reads only the QA clinic name and Gupshup app, signed in as the admin', async () => {
    const google = fakeGoogle();
    const channel = await StageChannel.create(config(google));
    expect(channel.target).toBe('salud-stage · TESTING MACENA');
    const clinicCall = google.calls.find((c) => c.url.includes('/organizations/'));
    expect(clinicCall?.url).toBe(`${BASE}/organizations/qa-org?mask.fieldPaths=name&mask.fieldPaths=settings.gupshup.appName`);
  });

  it('explains a missing clinic or a clinic without Gupshup', async () => {
    const missing = fakeGoogle();
    missing.clinic = { status: 404 };
    await expect(StageChannel.create(config(missing))).rejects.toThrow('The QA clinic «qa-org» does not exist in salud-stage.');

    const noApp = fakeGoogle();
    noApp.clinic = { status: 200, fields: { name: str('TESTING MACENA') } };
    const error = await StageChannel.create(config(noApp)).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(StepError);
    expect((error as Error).message).toContain('has no Gupshup app configured');
  });
});

describe('StageSession reading replies (FR-8)', () => {
  it('finds the test patient conversation and returns new bot replies', async () => {
    const google = fakeGoogle();
    const channel = await StageChannel.create(config(google));
    const session = await channel.openSession();
    const controller = new AbortController();
    await session.send({ type: 'say', text: 'Hola' }, [], controller.signal);
    google.messages = [botText('m1', '¡Hola! ¿En qué te ayudo?')];

    const replies = await session.collectReplies(controller.signal);
    expect(replies.map((r) => r.text)).toEqual(['¡Hola! ¿En qué te ayudo?']);
    expect(session.conversationId()).toBe('conv-1');

    const conversationQuery = JSON.parse(google.calls.find((c) => c.url === `${BASE}:runQuery`)?.body ?? '{}');
    expect(conversationQuery.structuredQuery).toMatchObject({
      from: [{ collectionId: 'conversations' }],
      orderBy: [{ field: { fieldPath: 'createdAt' }, direction: 'DESCENDING' }],
      limit: 1,
    });
    const filters = conversationQuery.structuredQuery.where.compositeFilter.filters.map(
      (f: { fieldFilter: { field: { fieldPath: string }; op: string } }) => `${f.fieldFilter.field.fieldPath} ${f.fieldFilter.op}`
    );
    expect(filters).toEqual([
      'channelIdentifier.channelIdentifierUserId EQUAL',
      'lastActivityMessageAt GREATER_THAN_OR_EQUAL',
      'organizationId EQUAL',
      'channel EQUAL',
    ]);
    const messagesQuery = JSON.parse(google.calls.find((c) => c.url.endsWith('conv-1:runQuery'))?.body ?? '{}');
    expect(messagesQuery.structuredQuery).toMatchObject({
      from: [{ collectionId: 'messages' }],
      where: { fieldFilter: { field: { fieldPath: 'createdAt' }, op: 'GREATER_THAN_OR_EQUAL' } },
      orderBy: [{ field: { fieldPath: 'createdAt' }, direction: 'ASCENDING' }],
    });
  });
});

describe('StageChannel.fatal (FR-11)', () => {
  it('is empty while the sign-in works', async () => {
    const channel = await StageChannel.create(config(fakeGoogle()));
    expect(channel.fatal()).toBeUndefined();
  });

  it('reports an expired sign-in once Google refuses the token', async () => {
    const google = fakeGoogle();
    const channel = await StageChannel.create(config(google));
    const session = await channel.openSession();
    google.unauthorized = true;
    google.tokenStatus = 400;
    await expect(session.collectReplies(new AbortController().signal)).rejects.toThrow('Your Google sign-in expired');
    expect(channel.fatal()).toBe('Your Google sign-in expired. Sign in again in Settings.');
  });

  it('reports a sign-out made during the run', async () => {
    let signedIn = true;
    const channel = await StageChannel.create(config(fakeGoogle(), { isSignedIn: () => signedIn }));
    signedIn = false;
    expect(channel.fatal()).toBe('Your Google sign-in expired. Sign in again in Settings.');
  });
});

describe('StageSession webhook (FR-17, FR-18)', () => {
  it('records when the webhook accepted the message', async () => {
    const clock = { now: 1_700_000_000_000 };
    const google = fakeGoogle();
    const channel = await StageChannel.create(config(google, { now: () => clock.now }));
    const session = await channel.openSession();
    expect(session.lastAcceptedAt()).toBeUndefined();
    clock.now += 500;
    await session.send({ type: 'say', text: 'hola' }, [], new AbortController().signal);
    expect(session.lastAcceptedAt()).toBe(1_700_000_000_500);
  });

  it('explains a webhook that answers without ACK', async () => {
    const google = fakeGoogle();
    google.webhookBody = 'error: no app';
    const session = await (await StageChannel.create(config(google))).openSession();
    const error = (await session.send({ type: 'say', text: 'hola' }, [], new AbortController().signal).catch((e: unknown) => e)) as Error;
    expect(error).toBeInstanceOf(StepError);
    expect(error.message).toBe('The bot did not accept the message (HTTP 200: «error: no app»).');
    expect(session.lastAcceptedAt()).toBeUndefined();
  });
});
