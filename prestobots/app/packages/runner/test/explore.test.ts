import { describe, expect, it } from 'vitest';

import { DemoChannel } from '../src/channels/demoChannel.ts';
import { exploreBot, riskyReason } from '../src/explore.ts';

describe('exploring the bot', () => {
  it('maps the demo bot menus without tapping risky options', async () => {
    const map = await exploreBot({ channel: new DemoChannel({ replyDelayMs: 0 }), signal: new AbortController().signal });
    const paths = map.nodes.map((node) => node.path.join(' > '));

    expect(paths[0]).toBe('');
    expect(map.nodes[0]!.offered).toEqual(['Sacar turno', 'Mis turnos', 'Hablar con una persona']);
    expect(paths).toContain('Sacar turno');
    expect(paths).toContain('Sacar turno > Cardiología');
    expect(paths).toContain('Mis turnos');

    // Never taps: hand-over, confirming or cancelling an appointment, or an appointment time.
    const tapped = map.nodes.flatMap((node) => node.path);
    expect(tapped).not.toContain('Hablar con una persona');
    expect(tapped).not.toContain('Cancelar turno');
    expect(tapped).not.toContain('Confirmar asistencia');
    expect(tapped).not.toContain('Martes 10:00');

    const skipped = map.nodes.flatMap((node) => node.skipped);
    expect(skipped).toContainEqual({ option: 'Hablar con una persona', reason: 'would hand the chat over to clinic staff' });
    expect(skipped.find((s) => s.option === 'Martes 10:00')?.reason).toMatch(/appointment time/);
    expect(map.truncated).toBe(false);
  });

  it('stops at the path limit and says so', async () => {
    const map = await exploreBot({ channel: new DemoChannel({ replyDelayMs: 0 }), signal: new AbortController().signal, maxPaths: 2 });
    expect(map.nodes).toHaveLength(2);
    expect(map.truncated).toBe(true);
  });

  it('recognizes risky options regardless of accents and case', () => {
    expect(riskyReason('Sí, CANCELAR')).toBeDefined();
    expect(riskyReason('Confirmar asistencia')).toBeDefined();
    expect(riskyReason('Miércoles 15:30')).toBeDefined();
    expect(riskyReason('Sacar turno')).toBeUndefined();
    expect(riskyReason('Pediatría')).toBeUndefined();
  });
});
