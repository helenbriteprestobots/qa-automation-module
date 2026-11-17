import type { ChatMessage } from '@ctp/shared';
import { describe, expect, it } from 'vitest';

import { evaluateChecks } from '../src/checks.ts';
import { resolveOption, StepError } from '../src/channels/types.ts';

const bot = (text: string, options: string[] = [], kind: ChatMessage['kind'] = 'text'): ChatMessage => ({
  id: text,
  from: 'bot',
  kind: options.length > 0 && kind === 'text' ? 'buttons' : kind,
  text,
  options: options.map((title, i) => ({ id: `o${i}`, title })),
  at: new Date().toISOString(),
});

describe('evaluateChecks', () => {
  it('bot_replied fails when only system notices arrive', () => {
    const system: ChatMessage = { ...bot('Transferida'), from: 'system', kind: 'alert' };
    const [result] = evaluateChecks([{ type: 'bot_replied' }], [system]);
    expect(result?.passed).toBe(false);
    expect(result?.detail).toMatch(/did not answer/);
  });

  it('offers_option ignores case and accents and lists what was offered', () => {
    const replies = [bot('¿Qué necesitás?', ['Sacar turno', 'Cardiología'])];
    expect(evaluateChecks([{ type: 'offers_option', option: 'cardiologia' }], replies)[0]?.passed).toBe(true);
    const miss = evaluateChecks([{ type: 'offers_option', option: 'Pediatría' }], replies)[0];
    expect(miss?.passed).toBe(false);
    expect(miss?.detail).toContain('«Sacar turno», «Cardiología»');
  });

  it('mentions_any and mentions_none look at texts and option labels', () => {
    const replies = [bot('Tu turno fue CANCELADO', ['Volver al menú'])];
    expect(evaluateChecks([{ type: 'mentions_any', words: ['cancelado'] }], replies)[0]?.passed).toBe(true);
    expect(evaluateChecks([{ type: 'mentions_any', words: ['menu'] }], replies)[0]?.passed).toBe(true);
    expect(evaluateChecks([{ type: 'mentions_none', words: ['error'] }], replies)[0]?.passed).toBe(true);
    expect(evaluateChecks([{ type: 'mentions_none', words: ['turno'] }], replies)[0]?.passed).toBe(false);
  });

  it('reply_kind reports the kinds that arrived', () => {
    const result = evaluateChecks([{ type: 'reply_kind', kind: 'flow' }], [bot('Hola')])[0];
    expect(result?.passed).toBe(false);
    expect(result?.detail).toBe('Expected a WhatsApp form; the bot sent a text.');
  });
});

describe('resolveOption', () => {
  it('prefers an exact match over a partial one', () => {
    const replies = [bot('Menú', ['Cancelar turno', 'Cancelar'])];
    expect(resolveOption('cancelar', replies).option.title).toBe('Cancelar');
    expect(resolveOption('turno', replies).option.title).toBe('Cancelar turno');
  });

  it('explains in plain words when the option is missing', () => {
    expect(() => resolveOption('Pediatría', [bot('Menú', ['Sacar turno'])])).toThrow(StepError);
    expect(() => resolveOption('Pediatría', [bot('Hola')])).toThrow(/had no buttons or list/);
  });
});
