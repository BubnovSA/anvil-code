import { describe, it, expect } from 'vitest';
import { streamFileChanges, type PartialFile } from '../partial-json.js';

/** Chunk a string into an async iterable, simulating an LLM token stream. */
async function *chunks(text: string, size: number): AsyncIterable<string> {
  for (let i = 0; i < text.length; i += size) {
    yield text.slice(i, i + size);
  }
}

async function collect(source: AsyncIterable<PartialFile>): Promise<PartialFile[]> {
  const out: PartialFile[] = [];
  for await (const f of source) out.push(f);
  return out;
}

/** Type-narrowing helper for tests that need .content. */
function asCreate(f: PartialFile): { path: string; content: string; action: 'create' } {
  if (f.action !== 'create') throw new Error(`expected create, got ${f.action}`);
  return f;
}

describe('streamFileChanges', () => {
  it('yields a single create file once its closing brace arrives', async () => {
    const payload = `{"files":[{"action":"create","path":"src/a.ts","content":"export {};"}]}`;
    const files = await collect(streamFileChanges(chunks(payload, 4)));
    expect(files).toEqual([
      { action: 'create', path: 'src/a.ts', content: 'export {};' },
    ]);
  });

  it('yields each file eagerly when multiple are in the array', async () => {
    const payload = JSON.stringify({
      files: [
        { action: 'create', path: 'a.ts', content: 'one' },
        { action: 'modify', path: 'b.ts', edits: [{ search: 'old', replace: 'new' }] },
        { action: 'delete', path: 'c.ts' },
      ],
    });
    const files = await collect(streamFileChanges(chunks(payload, 10)));
    expect(files.map(f => f.path)).toEqual(['a.ts', 'b.ts', 'c.ts']);
    expect(files.map(f => f.action)).toEqual(['create', 'modify', 'delete']);
  });

  it('yields a modify file with edits array', async () => {
    const payload = JSON.stringify({
      files: [
        { action: 'modify', path: 'src/x.ts', edits: [
          { search: 'foo', replace: 'bar' },
          { search: 'baz', replace: 'qux' },
        ] },
      ],
    });
    const files = await collect(streamFileChanges(chunks(payload, 8)));
    expect(files).toHaveLength(1);
    expect(files[0].action).toBe('modify');
    if (files[0].action === 'modify') {
      expect(files[0].edits).toHaveLength(2);
      expect(files[0].edits[0]).toEqual({ search: 'foo', replace: 'bar' });
    }
  });

  it('handles chunks that split mid-string', async () => {
    const payload = JSON.stringify({
      files: [{ action: 'create', path: 'x.ts', content: 'a-very-long-string-content' }],
    });
    // 1-byte chunks — exercises the scanner on every boundary
    const files = await collect(streamFileChanges(chunks(payload, 1)));
    expect(files).toHaveLength(1);
    expect(asCreate(files[0]).content).toBe('a-very-long-string-content');
  });

  it('is string-aware: braces inside content do not trip depth counting', async () => {
    const inner = 'if (x) { doThing({ y: 1 }); }';
    const payload = JSON.stringify({
      files: [{ action: 'create', path: 'f.ts', content: inner }],
    });
    const files = await collect(streamFileChanges(chunks(payload, 3)));
    expect(files).toEqual([{ action: 'create', path: 'f.ts', content: inner }]);
  });

  it('respects escaped quotes inside string content', async () => {
    const inner = 'const s = "hi \\"friend\\"";';
    const payload = JSON.stringify({
      files: [{ action: 'create', path: 'q.ts', content: inner }],
    });
    const files = await collect(streamFileChanges(chunks(payload, 5)));
    expect(asCreate(files[0]).content).toBe(inner);
  });

  it('strips a leading markdown fence', async () => {
    const body = JSON.stringify({
      files: [{ action: 'create', path: 'fenced.ts', content: 'x' }],
    });
    const payload = '```json\n' + body + '\n```';
    const files = await collect(streamFileChanges(chunks(payload, 6)));
    expect(files.map(f => f.path)).toEqual(['fenced.ts']);
  });

  it('ignores extra top-level keys before the files array', async () => {
    const payload = `{"meta":"preamble","extra":42,"files":[{"action":"create","path":"a.ts","content":""}]}`;
    const files = await collect(streamFileChanges(chunks(payload, 7)));
    expect(files.map(f => f.path)).toEqual(['a.ts']);
  });

  it('emits nothing when stream ends before first object closes', async () => {
    const payload = `{"files":[{"action":"create","path":"incomplete.ts","content":"half`;
    const files = await collect(streamFileChanges(chunks(payload, 8)));
    expect(files).toEqual([]);
  });

  it('skips malformed entries without aborting the stream', async () => {
    // Middle object is "modify" but missing edits — isPartialFile returns false
    const payload = `{"files":[
      {"action":"create","path":"ok1.ts","content":"a"},
      {"action":"modify","path":"bad.ts"},
      {"action":"modify","path":"ok2.ts","edits":[{"search":"x","replace":"y"}]}
    ]}`;
    const files = await collect(streamFileChanges(chunks(payload, 12)));
    expect(files.map(f => f.path)).toEqual(['ok1.ts', 'ok2.ts']);
  });

  it('handles large chunks that deliver the whole payload at once', async () => {
    const payload = JSON.stringify({
      files: [
        { action: 'create', path: 'a.ts', content: 'one' },
        { action: 'modify', path: 'b.ts', edits: [{ search: 'a', replace: 'b' }] },
      ],
    });
    const files = await collect(streamFileChanges(chunks(payload, payload.length)));
    expect(files).toHaveLength(2);
  });
});
