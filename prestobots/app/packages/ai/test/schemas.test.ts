import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { describe, expect, it } from 'vitest';
import { z } from 'zod/v4';

import { DRAFT_OUTPUT_SCHEMA } from '../src/drafting.ts';
import { JIRA_CARD_OUTPUT_SCHEMA } from '../src/jiraCard.ts';
import { PROPOSALS_OUTPUT_SCHEMA, buildProposalPrompt, estimateProposalCost } from '../src/proposing.ts';

describe('AI answer formats', () => {
  it('the test-case format converts to a JSON schema the API accepts (no unsupported features)', () => {
    const format = zodOutputFormat(DRAFT_OUTPUT_SCHEMA) as unknown as { type: string; schema: Record<string, unknown> };
    expect(format.type).toBe('json_schema');
    const json = JSON.stringify(format.schema);
    expect(json).toContain('anyOf');
    expect(json).not.toMatch(/minLength|maxLength|"\$ref":"#\/definitions/);
  });

  it('a well-formed answer parses', () => {
    const answer = {
      title: 'Patient books',
      area: 'BOOK',
      story: 'Un paciente reserva.',
      steps: [{ action: { type: 'say', text: 'Hola' }, expect: [{ type: 'bot_replied' }, { type: 'ai_judge', criteria: 'Greets' }] }],
      assumptions: [],
    };
    expect(() => DRAFT_OUTPUT_SCHEMA.parse(answer)).not.toThrow();
    expect(() => z.toJSONSchema(DRAFT_OUTPUT_SCHEMA)).not.toThrow();
  });

  it('the Jira card format converts to a JSON schema the API accepts', () => {
    const format = zodOutputFormat(JIRA_CARD_OUTPUT_SCHEMA) as unknown as { type: string; schema: Record<string, unknown> };
    expect(format.type).toBe('json_schema');
    expect(JSON.stringify(format.schema)).not.toMatch(/minLength|maxLength/);
    expect(JIRA_CARD_OUTPUT_SCHEMA.parse({ issueType: 'Bug', title: 'Bot ignores cancel', problem: 'x' }).issueType).toBe('Bug');
  });

  it('the proposals format converts to a JSON schema the API accepts', () => {
    const format = zodOutputFormat(PROPOSALS_OUTPUT_SCHEMA) as unknown as { type: string; schema: Record<string, unknown> };
    expect(format.type).toBe('json_schema');
    expect(JSON.stringify(format.schema)).not.toMatch(/minLength|maxLength|"\$ref":"#\/definitions/);
  });

  it('builds the proposal prompt with the map, the existing tests and the rejected ones, and estimates its cost', () => {
    const prompt = buildProposalPrompt({
      mode: 'demo',
      map: {
        truncated: false,
        nodes: [
          {
            path: [],
            offered: ['Sacar turno'],
            skipped: [{ option: 'Hablar con una persona', reason: 'would hand the chat over to clinic staff' }],
            replies: [{ id: '1', from: 'bot', kind: 'buttons', text: '¿En qué te ayudo?', options: [{ id: 'a', title: 'Sacar turno' }], at: '' }],
          },
        ],
      },
      existing: [{ id: 'SAL-GREET-001', title: 'Patient greets', status: 'active', story: 'Saluda.', steps: [{ action: { type: 'say', text: 'Hola' }, expect: [] }] }],
      rejected: [{ title: 'Patient asks for parking', story: 'Pregunta por estacionamiento.', reason: 'Not offered by clinics' }],
      maxProposals: 6,
    });
    expect(prompt.user).toContain('PATH «Hola»');
    expect(prompt.user).toContain('skipped «Hablar con una persona»');
    expect(prompt.user).toContain('SAL-GREET-001 [active]');
    expect(prompt.user).toContain('rejected because: Not offered by clinics');
    expect(prompt.system).toContain('propose new test cases');
    const estimate = estimateProposalCost('claude-opus-5-5', prompt);
    expect(estimate.lowUsd).toBeGreaterThan(0);
    expect(estimate.highUsd).toBeGreaterThan(estimate.lowUsd);
    expect(estimate.highUsd).toBeLessThan(1);
  });
});
