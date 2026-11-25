import { describe, expect, it } from 'vitest';

import { normalizeFirestoreMessage } from '../src/stage/firestoreMessages.ts';
import { GuardError, assertSafeAccount, assertSafeTarget, assertStageAccess } from '../src/stage/guard.ts';
import { buildGupshupInbound } from '../src/stage/gupshupPayload.ts';

const base = { appName: 'qa-app', phone: '5492610000000', name: 'QA Paciente', now: 1_700_000_000_000 };

describe('buildGupshupInbound', () => {
  it('builds a v2 text message like the chatbot fixtures', () => {
    const payload = buildGupshupInbound(base, { type: 'text', text: 'Hola' });
    expect(payload).toMatchObject({
      app: 'qa-app',
      version: 2,
      type: 'message',
      payload: {
        source: '5492610000000',
        type: 'text',
        payload: { text: 'Hola' },
        sender: { phone: '5492610000000', name: 'QA Paciente', country_code: '54' },
      },
    });
    expect(payload.payload.id).toMatch(/^qa-/);
  });

  it('builds a button reply pointing at the bot message it answers', () => {
    const payload = buildGupshupInbound(base, {
      type: 'button_reply',
      optionId: 'btn-1',
      title: 'Sacar turno',
      replyToExternalId: 'gs-123',
    });
    expect(payload.payload.type).toBe('button_reply');
    expect(payload.payload.payload).toMatchObject({ id: 'btn-1', title: 'Sacar turno', reply: 'Sacar turno' });
    expect(payload.payload.context).toEqual({ id: 'gs-123', gsId: 'gs-123' });
  });
});

describe('normalizeFirestoreMessage', () => {
  const createdAt = { toDate: () => new Date('2026-11-16T12:00:00.000Z') };

  it('reads outbound buttons', () => {
    const message = normalizeFirestoreMessage('m1', {
      messageType: 'button',
      senderType: 'bot',
      status: 'sent',
      externalId: 'gs-1',
      createdAt,
      payload: { text: '¿Qué necesitás?', buttons: [{ id: 'b1', title: 'Sacar turno' }] },
    });
    expect(message).toMatchObject({
      from: 'bot',
      kind: 'buttons',
      text: '¿Qué necesitás?',
      options: [{ id: 'b1', title: 'Sacar turno' }],
      externalId: 'gs-1',
      at: '2026-11-16T12:00:00.000Z',
    });
  });

  it('reads list rows across sections and patient replies', () => {
    const list = normalizeFirestoreMessage('m2', {
      messageType: 'list',
      senderType: 'bot',
      createdAt,
      payload: { text: 'Elegí', buttonText: 'Ver', sections: [{ rows: [{ id: 'r1', title: 'A' }] }, { rows: [{ id: 'r2', title: 'B' }] }] },
    });
    expect(list.options.map((o) => o.title)).toEqual(['A', 'B']);

    const reply = normalizeFirestoreMessage('m3', {
      messageType: 'button',
      senderType: 'user',
      createdAt,
      payload: { title: 'Sacar turno', reply: 'Sacar turno', context: {} },
    });
    expect(reply).toMatchObject({ from: 'patient', kind: 'text', text: 'Sacar turno' });
  });

  it('marks alerts as system notices and flows with their button', () => {
    expect(
      normalizeFirestoreMessage('m4', { messageType: 'alert', senderType: 'bot', createdAt, payload: { title: 'Transferencia', text: 'Pasó a operador' } })
    ).toMatchObject({ from: 'system', kind: 'alert', text: 'Transferencia: Pasó a operador' });
    expect(
      normalizeFirestoreMessage('m5', { messageType: 'flow', senderType: 'bot', createdAt, payload: { text: 'Reservá', cta: 'Ver horarios' } }).options
    ).toEqual([{ id: 'flow', title: 'Ver horarios' }]);
  });
});

describe('assertSafeTarget (FR-9)', () => {
  const ok = {
    projectId: 'salud-stage',
    webhookUrl: 'https://us-central1-salud-stage.cloudfunctions.net/webhookGupshupMessages',
    orgId: 'qa-org',
  };

  it('accepts salud-stage', () => {
    expect(() => assertSafeTarget(ok)).not.toThrow();
  });

  it.each([
    ['production project', { projectId: 'salud-prod' }],
    ['production webhook', { webhookUrl: 'https://us-central1-salud-prod.cloudfunctions.net/webhookGupshupMessages' }],
    ['non-Google host', { webhookUrl: 'https://example.com/webhook' }],
    ['plain http', { webhookUrl: 'http://us-central1-salud-stage.cloudfunctions.net/x' }],
    ['missing clinic', { orgId: ' ' }],
  ])('refuses a %s', (_label, change) => {
    expect(() => assertSafeTarget({ ...ok, ...change })).toThrow(GuardError);
  });
});

describe('assertSafeAccount (FR-9)', () => {
  it('requires a Google sign-in', () => {
    expect(() => assertSafeAccount(undefined)).toThrow(/Sign in with Google/);
  });

  it('refuses accounts outside prestobots.com', () => {
    expect(() => assertSafeAccount('juan@gmail.com')).toThrow(GuardError);
    expect(() => assertSafeAccount('juan@prestobots.com.evil.test')).toThrow(GuardError);
  });

  it('accepts prestobots.com in any letter case', () => {
    expect(() => assertSafeAccount('Juan@PrestoBots.com')).not.toThrow();
  });
});

describe('assertStageAccess (FR-9)', () => {
  const target = {
    projectId: 'salud-prod',
    webhookUrl: 'https://us-central1-salud-stage.cloudfunctions.net/webhookGupshupMessages',
    orgId: 'qa-org',
  };

  it('checks the account first, then the target', () => {
    expect(() => assertStageAccess(target, undefined)).toThrow(/Sign in with Google/);
    expect(() => assertStageAccess(target, 'juan@prestobots.com')).toThrow(/salud-prod/);
    expect(() => assertStageAccess({ ...target, projectId: 'salud-stage' }, 'juan@prestobots.com')).not.toThrow();
  });
});
