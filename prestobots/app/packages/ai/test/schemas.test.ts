import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { describe, expect, it } from 'vitest';
import { z } from 'zod/v4';

import { DRAFT_OUTPUT_SCHEMA } from '../src/drafting.ts';
import { JIRA_CARD_OUTPUT_SCHEMA } from '../src/jiraCard.ts';

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
});
