import { describe, it, expect } from 'vitest';
import {
  PlanOutputSchema,
} from '../planner.js';
import { CoderOutputSchema } from '../coder.js';
import { ArchitectOutputSchema } from '../architect.js';
import { TesterOutputSchema } from '../tester.js';
import { ReviewerOutputSchema } from '../reviewer.js';
import { FixerOutputSchema } from '../fixer.js';

// ── PlanOutputSchema ─────────────────────────────────────────────────────────

describe('PlanOutputSchema', () => {
  it('accepts a valid plan', () => {
    expect(() =>
      PlanOutputSchema.parse({ steps: [{ id: '1', description: 'foo', dependencies: [] }] })
    ).not.toThrow();
  });

  it('fills missing dependencies with []', () => {
    const result = PlanOutputSchema.parse({ steps: [{ id: '1', description: 'foo' }] });
    expect(result.steps[0].dependencies).toEqual([]);
  });

  it('rejects null steps', () => {
    expect(() => PlanOutputSchema.parse({ steps: null })).toThrow();
  });

  it('rejects empty steps array', () => {
    expect(() => PlanOutputSchema.parse({ steps: [] })).toThrow();
  });

  it('rejects missing description', () => {
    expect(() => PlanOutputSchema.parse({ steps: [{ id: '1' }] })).toThrow();
  });
});

// ── CoderOutputSchema ────────────────────────────────────────────────────────

describe('CoderOutputSchema', () => {
  it('accepts a valid create change', () => {
    expect(() =>
      CoderOutputSchema.parse({
        files: [{ action: 'create', path: 'src/foo.ts', content: 'export {}' }],
      })
    ).not.toThrow();
  });

  it('accepts a valid modify change with edits', () => {
    expect(() =>
      CoderOutputSchema.parse({
        files: [{
          action: 'modify',
          path: 'src/bar.ts',
          edits: [{ search: 'foo', replace: 'bar' }],
        }],
      })
    ).not.toThrow();
  });

  it('accepts a valid delete change (no extra fields needed)', () => {
    expect(() =>
      CoderOutputSchema.parse({
        files: [{ action: 'delete', path: 'src/old.ts' }],
      })
    ).not.toThrow();
  });

  it('accepts empty files array', () => {
    expect(() => CoderOutputSchema.parse({ files: [] })).not.toThrow();
  });

  it('rejects invalid action', () => {
    expect(() =>
      CoderOutputSchema.parse({
        files: [{ action: 'write', path: 'src/foo.ts', content: '' }],
      })
    ).toThrow();
  });

  it('rejects empty path', () => {
    expect(() =>
      CoderOutputSchema.parse({
        files: [{ action: 'create', path: '', content: '' }],
      })
    ).toThrow();
  });

  it('rejects modify without edits', () => {
    expect(() =>
      CoderOutputSchema.parse({
        files: [{ action: 'modify', path: 'src/x.ts' }],
      })
    ).toThrow();
  });

  it('rejects modify with empty edits array', () => {
    expect(() =>
      CoderOutputSchema.parse({
        files: [{ action: 'modify', path: 'src/x.ts', edits: [] }],
      })
    ).toThrow();
  });

  it('rejects modify with empty search string', () => {
    expect(() =>
      CoderOutputSchema.parse({
        files: [{
          action: 'modify',
          path: 'src/x.ts',
          edits: [{ search: '', replace: 'y' }],
        }],
      })
    ).toThrow();
  });

  it('rejects missing files field', () => {
    expect(() => CoderOutputSchema.parse({})).toThrow();
  });
});

// ── ArchitectOutputSchema ────────────────────────────────────────────────────

describe('ArchitectOutputSchema', () => {
  it('accepts valid design', () => {
    expect(() => ArchitectOutputSchema.parse({ design: 'Use factory pattern' })).not.toThrow();
  });

  it('rejects empty design string', () => {
    expect(() => ArchitectOutputSchema.parse({ design: '' })).toThrow();
  });

  it('rejects missing design', () => {
    expect(() => ArchitectOutputSchema.parse({})).toThrow();
  });
});

// ── TesterOutputSchema ───────────────────────────────────────────────────────

describe('TesterOutputSchema', () => {
  it('accepts valid test files (create only)', () => {
    expect(() =>
      TesterOutputSchema.parse({
        testFiles: [{ action: 'create', path: 'src/__tests__/foo.test.ts', content: 'describe()' }],
      })
    ).not.toThrow();
  });

  it('rejects modify action — Tester only creates new test files', () => {
    expect(() =>
      TesterOutputSchema.parse({
        testFiles: [{ action: 'modify', path: 'src/__tests__/foo.test.ts', edits: [{ search: 'a', replace: 'b' }] }],
      })
    ).toThrow();
  });

  it('accepts empty testFiles array', () => {
    expect(() => TesterOutputSchema.parse({ testFiles: [] })).not.toThrow();
  });

  it('rejects missing testFiles field', () => {
    expect(() => TesterOutputSchema.parse({})).toThrow();
  });
});

// ── ReviewerOutputSchema ─────────────────────────────────────────────────────

describe('ReviewerOutputSchema', () => {
  it('accepts approved review', () => {
    expect(() => ReviewerOutputSchema.parse({ isApproved: true, issues: [] })).not.toThrow();
  });

  it('accepts rejected review with issues', () => {
    expect(() =>
      ReviewerOutputSchema.parse({ isApproved: false, issues: ['Missing error handling'] })
    ).not.toThrow();
  });

  it('rejects string isApproved (LLM sends "true" as string)', () => {
    expect(() => ReviewerOutputSchema.parse({ isApproved: 'true', issues: [] })).toThrow();
  });

  it('rejects missing isApproved', () => {
    expect(() => ReviewerOutputSchema.parse({ issues: [] })).toThrow();
  });
});

// ── FixerOutputSchema ────────────────────────────────────────────────────────

describe('FixerOutputSchema', () => {
  it('accepts a fixed file with edits', () => {
    expect(() =>
      FixerOutputSchema.parse({
        files: [{
          action: 'modify',
          path: 'src/foo.ts',
          edits: [{ search: 'broken', replace: 'fixed' }],
        }],
      })
    ).not.toThrow();
  });

  it('accepts a newly created helper file', () => {
    expect(() =>
      FixerOutputSchema.parse({
        files: [{ action: 'create', path: 'src/helper.ts', content: 'export {};' }],
      })
    ).not.toThrow();
  });

  it('rejects null files', () => {
    expect(() => FixerOutputSchema.parse({ files: null })).toThrow();
  });
});
