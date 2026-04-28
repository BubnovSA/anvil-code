import { describe, it, expect } from 'vitest';
import type { FileChange } from '@rag-system/shared';
import { buildFixerAllowedSet, ToolCallingFixerAgent } from '../tool-calling-fixer.js';

describe('buildFixerAllowedSet', () => {
  it('includes all file paths the Coder produced', () => {
    const files: FileChange[] = [
      { action: 'create', path: 'src/foo.ts', content: 'x' },
      { action: 'create', path: 'src/bar.ts', content: 'y' },
      { action: 'delete', path: 'src/old.ts' },
    ];
    const out = buildFixerAllowedSet(files, []);
    expect(out.has('src/foo.ts')).toBe(true);
    expect(out.has('src/bar.ts')).toBe(true);
    expect(out.has('src/old.ts')).toBe(true);
  });

  it('extracts paths from typecheck-style issue messages', () => {
    const issues = [
      'TypeScript compilation failed (exit 2):\nsrc/server.ts(42,5): error TS2304: Cannot find name X.',
      'src/utils/helpers.ts(7,12): error TS2362: ...',
    ];
    const out = buildFixerAllowedSet([], issues);
    expect(out.has('src/server.ts')).toBe(true);
    expect(out.has('src/utils/helpers.ts')).toBe(true);
  });

  it('unions Coder paths and issue-mentioned paths', () => {
    const files: FileChange[] = [{ action: 'create', path: 'src/coder-output.ts', content: 'z' }];
    const issues = ['src/elsewhere.ts: TS error'];
    const out = buildFixerAllowedSet(files, issues);
    expect(out.has('src/coder-output.ts')).toBe(true);
    expect(out.has('src/elsewhere.ts')).toBe(true);
    expect(out.size).toBe(2);
  });

  it('returns empty when no Coder files and no path-bearing issues', () => {
    const out = buildFixerAllowedSet([], ['Tests failed (exit 1):\nUnknown error']);
    expect(out.size).toBe(0);
  });

  it('does not double-count when the same path appears in both sources', () => {
    const files: FileChange[] = [{ action: 'create', path: 'src/foo.ts', content: 'x' }];
    const issues = ['src/foo.ts(1,1): error TS2304'];
    const out = buildFixerAllowedSet(files, issues);
    expect(out.size).toBe(1);
  });
});

describe('ToolCallingFixerAgent shape', () => {
  it('exposes the expected role and name', () => {
    // Minimal smoke check: instantiating with a shaped router and reading the
    // public fields is enough — the heavy logic is covered by the dispatcher
    // tests in tool-calling-coder.test.ts (Fixer reuses the same dispatcher).
    const fakeRouter = {} as never;
    const agent = new ToolCallingFixerAgent(fakeRouter);
    expect(agent.role).toBe('fixer');
    expect(agent.name).toBe('Fixer(tool-calling)');
  });
});
