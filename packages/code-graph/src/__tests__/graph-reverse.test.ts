import { describe, it, expect } from 'vitest';

vi.mock('@rag-system/shared', async () => {
  const actual = await vi.importActual<typeof import('@rag-system/shared')>('@rag-system/shared');
  return {
    ...actual,
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    config: {
      ...actual.config,
      rag: { ...actual.config.rag, graphsPath: '/tmp/test-graphs' },
    },
  };
});

import { vi } from 'vitest';
const { CodeGraph } = await import('../graph.js');

const sym = (name: string, text: string, file = 'src/a.ts') => ({
  name,
  kind: 'function' as const,
  filePath: file,
  startLine: 1,
  endLine: 10,
  text,
  exportedNames: [name],
});

describe('CodeGraph reverse index (v1.43)', () => {
  it('getCallers returns symbols that reference the given name', () => {
    const g = new CodeGraph('/tmp/test-graphs');
    g.addFile('src/a.ts', [sym('DataLoader', 'function DataLoader() {}')]);
    g.addFile('src/b.ts', [sym('createClient', 'function createClient() { const dl = new DataLoader(); }')]);
    g.addFile('src/c.ts', [sym('runBatch', 'function runBatch() { DataLoader.batch(); }')]);

    const callers = g.getCallers('DataLoader');
    const callerNames = callers.map(c => c.name);
    expect(callerNames).toContain('createClient');
    expect(callerNames).toContain('runBatch');
  });

  it('getCallers excludes the symbol itself', () => {
    const g = new CodeGraph('/tmp/test-graphs');
    g.addFile('src/a.ts', [sym('Foo', 'function Foo() { return new Foo(); }')]);
    const callers = g.getCallers('Foo');
    expect(callers.every(c => c.name !== 'Foo')).toBe(true);
  });

  it('reverse index updates incrementally on addFile', () => {
    const g = new CodeGraph('/tmp/test-graphs');
    g.addFile('src/a.ts', [sym('Target', 'class Target {}')]);
    g.addFile('src/b.ts', [sym('User', 'class User { t = new Target(); }')]);
    expect(g.getCallers('Target').map(c => c.name)).toContain('User');

    // Replace file b with a version that no longer references Target
    g.addFile('src/b.ts', [sym('User', 'class User { x = 42; }')]);
    expect(g.getCallers('Target')).toHaveLength(0);
  });

  it('reverse index clears on removeFile', () => {
    const g = new CodeGraph('/tmp/test-graphs');
    g.addFile('src/a.ts', [sym('Alpha', 'class Alpha {}')]);
    g.addFile('src/b.ts', [sym('Beta', 'class Beta extends Alpha {}')]);
    expect(g.getCallers('Alpha').map(c => c.name)).toContain('Beta');

    g.removeFile('src/b.ts');
    expect(g.getCallers('Alpha')).toHaveLength(0);
  });

  it('returns empty array for symbol with no callers', () => {
    const g = new CodeGraph('/tmp/test-graphs');
    g.addFile('src/a.ts', [sym('Orphan', 'class Orphan {}')]);
    expect(g.getCallers('Orphan')).toHaveLength(0);
    expect(g.getCallers('NonExistent')).toHaveLength(0);
  });
});
