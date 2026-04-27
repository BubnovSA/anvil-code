import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import os from 'os';
import fs from 'fs';
import path from 'path';
import { taskEvents } from '@rag-system/shared';
import type { TaskEvent } from '@rag-system/shared';

vi.mock('@rag-system/shared', async () => {
  const actual = await vi.importActual<typeof import('@rag-system/shared')>('@rag-system/shared');
  return {
    ...actual,
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    config: {
      ...actual.config,
      rag: { ...actual.config.rag, embedConcurrency: 4, fileConcurrency: 2 },
      codeGraph: { ...actual.config.codeGraph, include: ['**/*.ts'], exclude: ['node_modules', 'dist', '.git'] },
    },
  };
});

vi.mock('hnswlib-node', async () => {
  // Import fs lazily inside the factory so vitest's mocking machinery is happy.
  const { writeFileSync } = await import('fs');
  return {
    HierarchicalNSW: class {
      initIndex(): void {}
      resizeIndex(): void {}
      addPoint(): void {}
      searchKnn(): { neighbors: number[]; distances: number[] } { return { neighbors: [], distances: [] }; }
      // The real binding writes a binary index file. We just touch the path so
      // VectorStore.save()'s subsequent renameSync(.tmp → real) succeeds.
      writeIndexSync(p: string): void { writeFileSync(p, ''); }
      readIndexSync(): void {}
      markDelete(): void {}
    },
  };
});

const { GraphRetriever } = await import('../graph-retriever.js');
const { OllamaClient } = await import('@rag-system/model-router');

function captureEvents(channel: string): { all: TaskEvent[]; off: () => void } {
  const all: TaskEvent[] = [];
  const handler = (e: TaskEvent) => all.push(e);
  taskEvents.on(channel, handler);
  return { all, off: () => taskEvents.off(channel, handler) };
}

describe('GraphRetriever.indexCodebase progress events', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'index-evt-'));
    vi.spyOn(OllamaClient.prototype, 'embed').mockResolvedValue(new Array(768).fill(0));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  function writeFiles(count: number): void {
    for (let i = 0; i < count; i++) {
      fs.writeFileSync(path.join(tmpDir, `f${i}.ts`), `export function fn${i}() {}`);
    }
  }

  it('emits index_start, then index_done with summary, on a fixed indexId channel', async () => {
    writeFiles(3);
    const retriever = new GraphRetriever();
    const indexId = 'idx-test-1';
    const cap = captureEvents(`task:${indexId}`);
    try {
      const returned = await retriever.indexCodebase(tmpDir, { indexId });
      expect(returned).toBe(indexId);

      const types = cap.all.map(e => e.type);
      expect(types[0]).toBe('index_start');
      expect(types[types.length - 1]).toBe('index_done');

      const start = cap.all[0];
      expect((start.data as { totalFiles: number }).totalFiles).toBe(3);

      const done = cap.all[cap.all.length - 1];
      expect(done.data).toMatchObject({ indexed: 3, skipped: 0, totalFiles: 3 });
      expect((done.data as { durationMs: number }).durationMs).toBeGreaterThanOrEqual(0);
    } finally {
      cap.off();
    }
  });

  it('emits at least one index_file event with progress percent', async () => {
    writeFiles(4);
    const indexId = 'idx-test-2';
    const cap = captureEvents(`task:${indexId}`);
    try {
      await new GraphRetriever().indexCodebase(tmpDir, { indexId });
      const fileEvents = cap.all.filter(e => e.type === 'index_file');
      expect(fileEvents.length).toBeGreaterThan(0);
      const last = fileEvents[fileEvents.length - 1];
      expect((last.data as { percent: number }).percent).toBe(100);
      expect((last.data as { processed: number; totalFiles: number }).processed).toBe(4);
    } finally {
      cap.off();
    }
  });

  it('generates an indexId when none is supplied and returns it', async () => {
    writeFiles(1);
    const id = await new GraphRetriever().indexCodebase(tmpDir);
    expect(id).toMatch(/^idx-\d+$/);
  });

  it('high-frequency index_file events are not retained in history', async () => {
    writeFiles(2);
    const indexId = 'idx-test-history';
    await new GraphRetriever().indexCodebase(tmpDir, { indexId });
    const history = taskEvents.getHistory(indexId);
    const types = history.map(e => e.type);
    expect(types).toContain('index_start');
    expect(types).toContain('index_done');
    expect(types).not.toContain('index_file'); // transient — not replayed
    taskEvents.clearHistory(indexId);
  });

  it('reports skipped files via index_skip when content hashes are unchanged', async () => {
    writeFiles(2);
    const hashes = new Map<string, string>();
    const store = {
      getFileHash: (p: string) => hashes.get(p),
      saveFileHash: (p: string, h: string) => { hashes.set(p, h); },
      deleteFileHash: (p: string) => { hashes.delete(p); },
      getCachedEmbedding: () => undefined,
      saveCachedEmbedding: () => undefined,
    };

    const retriever = new GraphRetriever(store);
    // First pass — populates the hash map
    await retriever.indexCodebase(tmpDir, { indexId: 'idx-warm' });

    // Second pass — every file should be skipped
    const indexId = 'idx-cold';
    const cap = captureEvents(`task:${indexId}`);
    try {
      await retriever.indexCodebase(tmpDir, { indexId });
      const done = cap.all.find(e => e.type === 'index_done')!;
      expect(done.data).toMatchObject({ indexed: 0, skipped: 2 });
      // Some skip ticks should have fired (or at least the last one for 100%)
      const hadSkipTick = cap.all.some(e => e.type === 'index_skip');
      expect(hadSkipTick).toBe(true);
    } finally {
      cap.off();
    }
  });

  // v1.25.2 — when a previously-indexed file disappears from disk (e.g.
  // `git reset --hard`, manual delete), the next reindex must drop its
  // symbols from the graph. Otherwise repo-map and RAG keep advertising
  // ghosts and patch-based edits fail with "search not found".
  it('prunes graph entries for files that vanished between reindexes', async () => {
    writeFiles(3); // f0.ts, f1.ts, f2.ts

    const hashes = new Map<string, string>();
    const store = {
      getFileHash: (p: string) => hashes.get(p),
      saveFileHash: (p: string, h: string) => { hashes.set(p, h); },
      deleteFileHash: (p: string) => { hashes.delete(p); },
      getCachedEmbedding: () => undefined,
      saveCachedEmbedding: () => undefined,
    };

    const retriever = new GraphRetriever(store);

    // First pass populates the graph with all 3 files.
    await retriever.indexCodebase(tmpDir, { indexId: 'idx-prune-1' });
    expect(retriever.graph.getAll().length).toBe(3);

    // Simulate `git reset --hard` deleting one file.
    fs.unlinkSync(path.join(tmpDir, 'f1.ts'));

    // Second pass — must drop f1's symbol AND report `pruned` in index_done.
    const indexId = 'idx-prune-2';
    const cap = captureEvents(`task:${indexId}`);
    try {
      await retriever.indexCodebase(tmpDir, { indexId });
      const remaining = retriever.graph.getAll().map(s => path.basename(s.filePath));
      expect(remaining.sort()).toEqual(['f0.ts', 'f2.ts']);

      const done = cap.all.find(e => e.type === 'index_done')!;
      expect((done.data as { pruned: number }).pruned).toBe(1);
      // The vanished file's hash must also be cleaned up so a future
      // re-creation triggers fresh indexing rather than a stale skip.
      expect(hashes.has(path.join(tmpDir, 'f1.ts'))).toBe(false);
    } finally {
      cap.off();
    }
  });
});
