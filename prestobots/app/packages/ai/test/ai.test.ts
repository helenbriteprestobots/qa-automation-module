import type { ChatMessage } from '@ctp/shared';
import { describe, expect, it } from 'vitest';

import { costUsd } from '../src/pricing.ts';
import { transcriptToText } from '../src/transcript.ts';

describe('costUsd', () => {
  it('prices Opus 5.5 per million tokens', () => {
    expect(costUsd('claude-opus-5-5', { inputTokens: 1_000_000, outputTokens: 1_000_000, cacheReadTokens: 0, cacheWriteTokens: 0 })).toBeCloseTo(24);
  });

  it('prices Haiku 5.5 higher above 100K prompt tokens', () => {
    const short = costUsd('claude-haiku-5-5', { inputTokens: 100_000, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 });
    const long = costUsd('claude-haiku-5-5', { inputTokens: 200_000, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 });
    expect(short).toBeCloseTo(0.01);
    expect(long).toBeCloseTo(0.1);
  });

  it('never under-counts an unknown model', () => {
    const usage = { inputTokens: 1000, outputTokens: 1000, cacheReadTokens: 0, cacheWriteTokens: 0 };
    expect(costUsd('some-new-model', usage)).toBe(costUsd('claude-opus-5-5', usage));
  });
});

describe('transcriptToText', () => {
  it('shows authors, kinds and options', () => {
    const messages: ChatMessage[] = [
      { id: '1', from: 'patient', kind: 'text', text: 'Hola', options: [], at: '' },
      { id: '2', from: 'bot', kind: 'buttons', text: '¿Qué necesitás?', options: [{ id: 'a', title: 'Sacar turno' }], at: '' },
    ];
    expect(transcriptToText(messages)).toBe('[Patient] Hola\n[Bot · buttons] ¿Qué necesitás?\n    options: «Sacar turno»');
  });
});
