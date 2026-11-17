import { describe, expect, it } from 'vitest';

import { DemoChannel } from '../src/channels/demoChannel.ts';
import { executeTestCase } from '../src/executeTestCase.ts';
import { STARTER_TEST_CASES } from '../src/starterTestCases.ts';

describe('starter test cases on the demo bot', () => {
  const channel = new DemoChannel({ replyDelayMs: 1 });

  it.each(STARTER_TEST_CASES.map((testCase) => [testCase.id, testCase] as const))(
    '%s',
    async (id, testCase) => {
      const result = await executeTestCase({
        testCase,
        channel,
        runId: 'r1',
        resultId: `r1-${id}`,
        signal: new AbortController().signal,
      });

      if (id === 'SAL-CANCEL-002') {
        // The demo bot does not understand a written cancellation, on purpose.
        expect(result.status).toBe('failed');
        expect(result.steps[1]?.checks.find((c) => !c.passed)?.detail).toMatch(/cancel/);
      } else {
        expect(result.status, JSON.stringify(result, null, 2)).toBe('passed');
        expect(result.steps).toHaveLength(testCase.steps.length);
      }
    }
  );

  it('reports an error in plain words when an option is missing', async () => {
    const [first] = STARTER_TEST_CASES;
    const result = await executeTestCase({
      testCase: {
        ...first!,
        steps: [{ action: { type: 'choose', option: 'Pediatría' }, expect: [{ type: 'bot_replied' }] }],
      },
      channel,
      runId: 'r1',
      resultId: 'r1-x',
      signal: new AbortController().signal,
    });
    expect(result.status).toBe('error');
    expect(result.error).toMatch(/no buttons or list/);
  });

  it('stops when the run is cancelled', async () => {
    const controller = new AbortController();
    controller.abort();
    const result = await executeTestCase({
      testCase: STARTER_TEST_CASES[0]!,
      channel,
      runId: 'r1',
      resultId: 'r1-y',
      signal: controller.signal,
    });
    expect(result.status).toBe('error');
    expect(result.error).toMatch(/cancelled/);
  });
});
