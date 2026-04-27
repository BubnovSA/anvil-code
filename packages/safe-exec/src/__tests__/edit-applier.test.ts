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

  it('reports empty tolerantEdits when every edit matches strictly', () => {
    const r = applyEdits('hello', [{ search: 'hello', replace: 'world' }]);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.tolerantEdits).toEqual([]);
  });

  describe('whitespace-tolerant fallback', () => {
    it('matches a one-line minified search against multi-line target', () => {
      // The qwen2.5-coder:32b L2.3 cumulative failure mode: model collapsed
      // a multi-line existing block into a single line in `search`.
      const before = `if (x) {\n  doIt();\n  more();\n}\n`;
      const r = applyEdits(before, [
        {
          search: `if (x) { doIt(); more(); }`,
          replace: `if (x) {\n  doIt();\n  log();\n  more();\n}`,
        },
      ]);
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.result).toBe(`if (x) {\n  doIt();\n  log();\n  more();\n}\n`);
        expect(r.tolerantEdits).toEqual([0]);
      }
    });

    it('collapses repeated whitespace differences (tabs vs spaces, extra indent)', () => {
      const before = `class A {\n\tfoo() {\n\t\treturn 1;\n\t}\n}\n`;
      const r = applyEdits(before, [
        {
          search: `class A {\n  foo() {\n    return 1;\n  }\n}`,
          replace: `class A {\n  foo() {\n    return 2;\n  }\n}`,
        },
      ]);
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.result).toBe(`class A {\n  foo() {\n    return 2;\n  }\n}\n`);
        expect(r.tolerantEdits).toEqual([0]);
      }
    });

    it('preserves replace verbatim — does not normalize replace whitespace', () => {
      // Replace contains its own deliberate formatting; tolerant matching must
      // not touch it. The matched slice is what gets substituted out, not the
      // search string itself.
      const before = `function f() { return    1; }`;
      const r = applyEdits(before, [
        {
          search: `function f() {\n  return 1;\n}`,
          replace: `function f() {\n\treturn 42; // intentional tab\n}`,
        },
      ]);
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.result).toBe(`function f() {\n\treturn 42; // intentional tab\n}`);
        expect(r.tolerantEdits).toEqual([0]);
      }
    });

    it('rejects ambiguity when tolerant pattern matches multiple places', () => {
      // Two multi-line blocks; minified search would tolerant-match both.
      const before = `if (x) {\n  foo();\n}\nif (x) {\n  foo();\n}\n`;
      const r = applyEdits(before, [
        { search: `if (x) { foo(); }`, replace: `if (x) bar();` },
      ]);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toMatch(/ambiguous/);
    });

    it('strict path wins when both strict and tolerant could match', () => {
      // 'foo bar' appears strict in the file. A tolerant match would also fire,
      // but tolerantEdits must stay empty because we hit on strict first.
      const before = `foo bar baz\nfoo  bar baz`;
      const r = applyEdits(before, [
        { search: `foo bar baz`, replace: `FOO BAR BAZ` },
      ]);
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.result).toBe(`FOO BAR BAZ\nfoo  bar baz`);
        expect(r.tolerantEdits).toEqual([]);
      }
    });

    it('escapes regex metacharacters in the tolerant pattern', () => {
      // $, (, ), *, ., ?, [, ] — any of these in a literal search would break
      // a naive regex build. Tolerant matching must escape them.
      const before = `const price = $100.00 (USD); arr[0] = a*b;`;
      const r = applyEdits(before, [
        {
          search: `const price = $100.00 (USD);   arr[0] = a*b;`,
          replace: `const price = $200.00 (EUR); arr[0] = a*b;`,
        },
      ]);
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.result).toBe(`const price = $200.00 (EUR); arr[0] = a*b;`);
        expect(r.tolerantEdits).toEqual([0]);
      }
    });

    it('refuses whitespace-only search (would match anywhere under \\s+)', () => {
      const before = `keep this`;
      const r = applyEdits(before, [
        { search: `   \n  `, replace: `INJECTED` },
      ]);
      expect(r.ok).toBe(false);
      // Strict miss → tolerant guard kicks in → reported as not-found, not ambiguous.
      if (!r.ok) expect(r.error).toMatch(/not found/);
    });

    it('reports tolerant indices per-edit when mixed with strict edits', () => {
      const before = `let a = 1;\nif (x) {\n  foo();\n}\nlet b = 2;\n`;
      const r = applyEdits(before, [
        { search: `let a = 1;`, replace: `const a = 1;` },          // strict
        { search: `if (x) { foo(); }`, replace: `if (x) bar();` },  // tolerant (minified)
        { search: `let b = 2;`, replace: `const b = 2;` },          // strict
      ]);
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.result).toBe(`const a = 1;\nif (x) bar();\nconst b = 2;\n`);
        expect(r.tolerantEdits).toEqual([1]);
      }
    });
  });
});
