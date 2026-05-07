import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import os from 'os';
import fs from 'fs';
import path from 'path';

vi.mock('@rag-system/shared', async () => {
  const actual = await vi.importActual<typeof import('@rag-system/shared')>('@rag-system/shared');
  return {
    ...actual,
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    config: {
      ...actual.config,
      llmBackend: 'llamacpp',
      rag: {
        ...actual.config.rag,
        embedConcurrency: 4,
        maxContextTokens: 8000,
        rerankerEnabled: true,
        rerankerCandidates: 3,
      },
    },
  };
});

vi.mock('hnswlib-node', async () => {
  const { writeFileSync } = await import('fs');
  return {
    HierarchicalNSW: class {
      private count = 0;
      initIndex(): void {}
      resizeIndex(): void {}
      addPoint(): void { this.count++; }
      searchKnn(_vec: number[], k: number): { neighbors: number[]; distances: number[] } {
        const all = [0, 1, 2];
        const take = Math.min(k, this.count);
        return { neighbors: all.slice(0, take), distances: all.slice(0, take).map(() => 0.1) };
      }
      writeIndexSync(p: string): void { writeFileSync(p, ''); }
      readIndexSync(): void {}
      markDelete(): void {}
      getCurrentCount(): number { return this.count; }
    },
  };
});

const { GraphRetriever } = await import('../graph-retriever.js');
const { LlamaSwapClient } = await import('@rag-system/model-router');

describe('GraphRetriever two-pass reranking (v1.33)', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reranker-'));
    vi.spyOn(LlamaSwapClient.prototype, 'embed').mockResolvedValue(new Array(768).fill(0));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('reorders items according to reranker scores when reranker enabled', async () => {
    const file = path.join(tmpDir, 'svc.ts');
    fs.writeFileSync(file, [
      'export function fn0() { return 0; }',
      'export function fn1() { return 1; }',
      'export function fn2() { return 2; }',
    ].join('\n'));

    // Reranker says fn2 (index 2) is most relevant, fn1 next, fn0 last.
    const rerankSpy = vi.spyOn(LlamaSwapClient.prototype, 'rerank').mockResolvedValue([
      { index: 2, relevanceScore: -1.0 },
      { index: 1, relevanceScore: -5.0 },
      { index: 0, relevanceScore: -10.0 },
    ]);

    const r = new GraphRetriever();
    await r.indexFile(file);
    const items = await r.retrieveContextItems('query', 2);

    expect(items).toHaveLength(2);
    expect(items[0].symbolName).toBe('fn2');
    expect(items[1].symbolName).toBe('fn1');
    // rerank was called with all 3 candidates (rerankerCandidates=3), not k=2
    expect(rerankSpy).toHaveBeenCalledOnce();
    expect(rerankSpy.mock.calls[0][1]).toHaveLength(3);
  });

  it('falls back to HNSW order and logs a warning when reranker throws', async () => {
    const file = path.join(tmpDir, 'svc.ts');
    fs.writeFileSync(file, [
      'export function fn0() { return 0; }',
      'export function fn1() { return 1; }',
      'export function fn2() { return 2; }',
    ].join('\n'));

    vi.spyOn(LlamaSwapClient.prototype, 'rerank').mockRejectedValue(new Error('reranker 503'));

    const { logger } = await import('@rag-system/shared');
    const warnSpy = vi.spyOn(logger, 'warn');

    const r = new GraphRetriever();
    await r.indexFile(file);
    const items = await r.retrieveContextItems('query', 2);

    // Falls back: items come in HNSW order (fn0, fn1)
    expect(items).toHaveLength(2);
    expect(items[0].symbolName).toBe('fn0');
    expect(items[1].symbolName).toBe('fn1');
    expect(warnSpy).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.stringContaining('503') }),
      expect.stringContaining('Reranker failed'),
    );
  });

  it('searches with k (not rerankerCandidates) and skips rerank when disabled', async () => {
    const { config } = await import('@rag-system/shared');
    config.rag.rerankerEnabled = false;

    const rerankSpy = vi.spyOn(LlamaSwapClient.prototype, 'rerank');

    const file = path.join(tmpDir, 'svc.ts');
    fs.writeFileSync(file, [
      'export function fn0() { return 0; }',
      'export function fn1() { return 1; }',
    ].join('\n'));

    const r = new GraphRetriever();
    await r.indexFile(file);
    await r.retrieveContextItems('query', 5);

    expect(rerankSpy).not.toHaveBeenCalled();

    config.rag.rerankerEnabled = true; // restore
  });

  it('returns [] without calling rerank when HNSW has no candidates', async () => {
    const rerankSpy = vi.spyOn(LlamaSwapClient.prototype, 'rerank');

    // No file indexed → vectorStore empty
    const r = new GraphRetriever();
    const items = await r.retrieveContextItems('query', 5);

    expect(items).toEqual([]);
    expect(rerankSpy).not.toHaveBeenCalled();
  });

  it('v1.34 — data/backups/** files are excluded from indexCodebase (no noise in retrieval)', async () => {
    const { config } = await import('@rag-system/shared');

    // Create a source file and a backup file
    const srcFile = path.join(tmpDir, 'src', 'server.ts');
    fs.mkdirSync(path.dirname(srcFile), { recursive: true });
    fs.writeFileSync(srcFile, 'export function listen() { return true; }');

    const backupDir = path.join(tmpDir, config.safeExec.backupsPath);
    fs.mkdirSync(backupDir, { recursive: true });
    const backupFile = path.join(backupDir, 'f42a63c1.ts');
    fs.writeFileSync(backupFile, 'export function listen() { return "backup"; }');

    const r = new GraphRetriever(undefined, { vectorsDir: tmpDir, graphsDir: tmpDir });
    await r.indexCodebase(tmpDir);

    // BM25 index must contain the source symbol but NOT the backup
    // We verify via retrieveContextItems — backup body differs from src
    const items = await r.retrieveContextItems('listen function server', 5);
    const paths = items.map(i => i.filePath);
    expect(paths.some(p => p.includes('backups'))).toBe(false);
    expect(paths.some(p => p.includes('src') && p.includes('server'))).toBe(true);
  });

  it('v1.34 — RAG_BM25_ENABLED=false skips BM25 merge (kill-switch)', async () => {
    const { config } = await import('@rag-system/shared');
    config.rag.bm25Enabled = false;

    const file = path.join(tmpDir, 'svc.ts');
    fs.writeFileSync(file, 'export function myService() { return 42; }');

    const r = new GraphRetriever();
    await r.indexFile(file);
    // Should not throw; returns results via dense-only path
    const items = await r.retrieveContextItems('myService', 5);
    expect(Array.isArray(items)).toBe(true);

    config.rag.bm25Enabled = true; // restore
  });
});
