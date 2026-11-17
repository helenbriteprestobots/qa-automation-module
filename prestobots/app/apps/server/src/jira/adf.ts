/**
 * Converts the card's plain text to Atlassian Document Format (what Jira Cloud's API expects).
 * Supported: "## " headings, "- " bullets, ``` fences (code block), paragraphs separated by blank lines.
 */

type Inline = { type: 'text'; text: string } | { type: 'hardBreak' };
type Block =
  | { type: 'heading'; attrs: { level: number }; content: Inline[] }
  | { type: 'paragraph'; content: Inline[] }
  | { type: 'bulletList'; content: Array<{ type: 'listItem'; content: Block[] }> }
  | { type: 'codeBlock'; attrs: Record<string, never>; content: Inline[] };

export interface AdfDoc {
  version: 1;
  type: 'doc';
  content: Block[];
}

/** Jira rejects empty text nodes, so empty strings produce no node. */
const text = (value: string): Inline[] => (value === '' ? [] : [{ type: 'text', text: value }]);

const paragraph = (lines: string[]): Block => ({
  type: 'paragraph',
  content: lines.flatMap((line, i) => [...(i > 0 ? [{ type: 'hardBreak' } as const] : []), ...text(line)]),
});

export const toAdf = (input: string): AdfDoc => {
  const blocks: Block[] = [];
  const lines = input.replace(/\r\n/g, '\n').split('\n');
  let para: string[] = [];
  let bullets: string[] = [];

  const flush = (): void => {
    if (para.length > 0) blocks.push(paragraph(para));
    if (bullets.length > 0) {
      blocks.push({
        type: 'bulletList',
        content: bullets.map((item) => ({ type: 'listItem', content: [paragraph([item])] })),
      });
    }
    para = [];
    bullets = [];
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!;
    const trimmed = line.trim();

    if (trimmed.startsWith('```')) {
      flush();
      const code: string[] = [];
      for (i += 1; i < lines.length && !lines[i]!.trim().startsWith('```'); i += 1) code.push(lines[i]!);
      blocks.push({ type: 'codeBlock', attrs: {}, content: text(code.join('\n')) });
      continue;
    }
    if (trimmed === '') {
      flush();
      continue;
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(trimmed);
    if (heading) {
      flush();
      blocks.push({ type: 'heading', attrs: { level: Math.min(6, heading[1]!.length + 1) }, content: text(heading[2]!) });
      continue;
    }
    const bullet = /^[-*]\s+(.*)$/.exec(trimmed);
    if (bullet) {
      if (para.length > 0) flush();
      bullets.push(bullet[1]!);
      continue;
    }
    if (bullets.length > 0) flush();
    para.push(trimmed);
  }
  flush();

  return { version: 1, type: 'doc', content: blocks.length > 0 ? blocks : [paragraph(['(empty)'])] };
};
