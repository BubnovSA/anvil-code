import { describe, it, expect } from 'vitest';
import { applyEdits } from '../edit-applier.js';

describe('applyEdits', () => {
  it('applies a single replace at the unique match', () => {
    const before = `function hello() {\n  return 'hi';\n}\n`;
    const r = applyEdits(before, [
      { search: `return 'hi';`, replace: `return 'hello';` },
    ]);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.result).toBe(`function hello() {\n  return 'hello';\n}\n`);
  });

  it('applies multiple edits sequentially, each seeing the previous result', () => {
    const before = `let x = 1;\nlet y = 2;\n`;
    const r = applyEdits(before, [
      { search: 'let x = 1;', replace: 'const x = 1;' },
      { search: 'let y = 2;', replace: 'const y = 2;' },
    ]);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.result).toBe(`const x = 1;\nconst y = 2;\n`);
  });

  it('lets a later edit operate on the result of an earlier one', () => {
    // First edit introduces "FOO", second edit modifies it
    const before = 'a';
    const r = applyEdits(before, [
      { search: 'a', replace: 'FOO' },
      { search: 'FOO', replace: 'BAR' },
    ]);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.result).toBe('BAR');
  });

  it('preserves multi-line whitespace exactly', () => {
    const before = `if (x) {\n  doIt();\n  more();\n}\n`;
    const r = applyEdits(before, [
      {
        search: `  doIt();\n  more();`,
        replace: `  doIt();\n  log();\n  more();`,
      },
    ]);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.result).toBe(`if (x) {\n  doIt();\n  log();\n  more();\n}\n`);
  });

  it('errors when search is not found', () => {
    const r = applyEdits('hello world', [{ search: 'banana', replace: 'apple' }]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/not found/);
  });

  it('errors when search is ambiguous (multiple matches)', () => {
    const before = `console.log(x);\nconsole.log(x);`;
    const r = applyEdits(before, [
      { search: 'console.log(x);', replace: 'logger.info(x);' },
    ]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/ambiguous/);
  });

  it('errors on empty edits list', () => {
    const r = applyEdits('x', []);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/no edits/);
  });

  it('errors on empty search string', () => {
    const r = applyEdits('x', [{ search: '', replace: 'y' }]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/empty/);
  });

  it('aborts the whole operation if any edit fails — no partial application', () => {
    const before = 'a b c';
    const r = applyEdits(before, [
      { search: 'a', replace: 'A' },
      { search: 'NOT_THERE', replace: 'X' },
    ]);
    expect(r.ok).toBe(false);
    // Caller never sees the partial 'A b c'; original is intact in their view.
  });

  it('handles edits that delete lines (replace with empty)', () => {
    const before = `keep\nremove\nalso keep\n`;
    const r = applyEdits(before, [
      { search: 'remove\n', replace: '' },
    ]);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.result).toBe(`keep\nalso keep\n`);
  });

  it('handles edits at start and end of file', () => {
    const before = `START\nmiddle\nEND`;
    const r = applyEdits(before, [
      { search: 'START', replace: 'BEGIN' },
      { search: 'END', replace: 'FINISH' },
    ]);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.result).toBe(`BEGIN\nmiddle\nFINISH`);
  });
});
