import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import os from 'os';
import fs from 'fs';
import path from 'path';

vi.mock('@rag-system/shared', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const { TypeChecker } = await import('../type-checker.js');

describe('TypeChecker', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'type-checker-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('skips when no tsconfig.json or tsconfig.base.json exists', async () => {
    const checker = new TypeChecker(tmpDir);
    const result = await checker.run();
    expect(result.success).toBe(true);
    expect(result.skipped).toBe('no tsconfig.json');
  });

  it('finds tsconfig.json when present', async () => {
    fs.writeFileSync(
      path.join(tmpDir, 'tsconfig.json'),
      JSON.stringify({ compilerOptions: { noEmit: true } }),
    );
    // Project doesn't include any TS files but tsconfig is present, so it shouldn't skip
    const checker = new TypeChecker(tmpDir, 5_000);
    const result = await checker.run();
    expect(result.skipped).toBeUndefined();
  });
});

// runOn tests mock the underlying run() to isolate filtering logic from tsc availability.
describe('TypeChecker.runOn', () => {
  const TSC_ERROR_IN_BROKEN =
    'src/broken.ts(1,22): error TS2322: Type \'string\' is not assignable to type \'number\'.\n';

  it('passes through the skipped result when no tsconfig exists', async () => {
    const checker = new TypeChecker('/nonexistent');
    const skippedResult = { success: true, output: '', exitCode: 0, durationMs: 0, skipped: 'no tsconfig.json' };
    vi.spyOn(checker as unknown as { run(): Promise<typeof skippedResult> }, 'run').mockResolvedValue(skippedResult);
    const result = await checker.runOn(['src/foo.ts']);
    expect(result.skipped).toBe('no tsconfig.json');
    expect(result.success).toBe(true);
  });

  it('passes through a clean tsc result unchanged', async () => {
    const checker = new TypeChecker('/nonexistent');
    const cleanResult = { success: true, output: '', exitCode: 0, durationMs: 50 };
    vi.spyOn(checker as unknown as { run(): Promise<typeof cleanResult> }, 'run').mockResolvedValue(cleanResult);
    const result = await checker.runOn(['src/valid.ts']);
    expect(result.success).toBe(true);
  });

  it('returns failure when our file has tsc errors', async () => {
    const checker = new TypeChecker('/nonexistent');
    const errResult = { success: false, output: TSC_ERROR_IN_BROKEN, exitCode: 2, durationMs: 80 };
    vi.spyOn(checker as unknown as { run(): Promise<typeof errResult> }, 'run').mockResolvedValue(errResult);
    const result = await checker.runOn(['src/broken.ts']);
    expect(result.success).toBe(false);
    expect(result.output).toContain('broken.ts');
  });

  it('returns success when errors are only in other files (not in our changed list)', async () => {
    const checker = new TypeChecker('/nonexistent');
    // tsc fails on other.ts — but we only care about clean.ts
    const errResult = {
      success: false,
      output: 'src/other.ts(1,22): error TS2322: Type \'string\' is not assignable to type \'number\'.\n',
      exitCode: 2,
      durationMs: 80,
    };
    vi.spyOn(checker as unknown as { run(): Promise<typeof errResult> }, 'run').mockResolvedValue(errResult);
    const result = await checker.runOn(['src/clean.ts']);
    expect(result.success).toBe(true);
    expect(result.output).toBe('');
  });
});
