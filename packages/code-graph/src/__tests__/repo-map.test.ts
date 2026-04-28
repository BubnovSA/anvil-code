import { describe, it, expect } from 'vitest';
import os from 'os';
import path from 'path';
import { CodeGraph } from '../graph.js';
import { buildRepoMap } from '../repo-map.js';
import type { CodeSymbol } from '../types.js';

const PROJECT_ROOT = path.join(os.tmpdir(), 'repo-map-test-root');

function makeSymbol(partial: Partial<CodeSymbol> & { name: string; filePath: string; text: string; kind: CodeSymbol['kind'] }): CodeSymbol {
  return {
    startLine: 1,
    endLine: 10,
    ...partial,
  };
}

function makeGraph(symsByFile: Record<string, CodeSymbol[]>): CodeGraph {
  const graph = new CodeGraph(path.join(PROJECT_ROOT, '.tmp-graphs'));
  for (const [file, syms] of Object.entries(symsByFile)) {
    graph.addFile(file, syms);
  }
  return graph;
}

describe('buildRepoMap', () => {
  it('returns empty string for an empty graph', () => {
    const graph = makeGraph({});
    expect(buildRepoMap(graph, PROJECT_ROOT)).toBe('');
  });

  it('renders a single function declaration as a one-liner', () => {
    const filePath = path.join(PROJECT_ROOT, 'src/utils.ts');
    const graph = makeGraph({
      [filePath]: [
        makeSymbol({
          name: 'add',
          kind: 'function',
          filePath,
          text: 'export function add(a: number, b: number): number {\n  return a + b;\n}',
        }),
      ],
    });

    const map = buildRepoMap(graph, PROJECT_ROOT);
    expect(map).toContain('src/utils.ts:');
    expect(map).toContain('function add(a: number, b: number): number');
    expect(map).not.toContain('return a + b'); // body not leaked
    expect(map).not.toContain('export '); // export keyword stripped
  });

  it('renders class methods as indented signatures under the class header', () => {
    const filePath = path.join(PROJECT_ROOT, 'src/services/user-service.ts');
    const graph = makeGraph({
      [filePath]: [
        makeSymbol({
          name: 'UserService',
          kind: 'class',
          filePath,
          text:
            'export class UserService {\n' +
            '  static list(): User[] {\n' +
            '    return Array.from(users.values());\n' +
            '  }\n' +
            '  static get(id: string): User | null {\n' +
            '    return users.get(id) ?? null;\n' +
            '  }\n' +
            '  static create(input: { name: string; email: string }): User {\n' +
            '    return { id: "x", ...input } as User;\n' +
            '  }\n' +
            '}',
        }),
      ],
    });

    const map = buildRepoMap(graph, PROJECT_ROOT);
    expect(map).toMatch(/class UserService:/);
    expect(map).toContain('static list(): User[]');
    expect(map).toContain('static get(id: string): User | null');
    expect(map).toContain('static create(input: { name: string; email: string }): User');
    // Body contents must not leak.
    expect(map).not.toContain('Array.from');
    expect(map).not.toContain('return users');
  });

  it('renders interface members as indented field lines', () => {
    const filePath = path.join(PROJECT_ROOT, 'src/types.ts');
    const graph = makeGraph({
      [filePath]: [
        makeSymbol({
          name: 'User',
          kind: 'interface',
          filePath,
          text:
            'export interface User {\n' +
            '  id: string;\n' +
            '  name: string;\n' +
            '  email: string;\n' +
            '  deletedAt: string | null;\n' +
            '}',
        }),
      ],
    });

    const map = buildRepoMap(graph, PROJECT_ROOT);
    expect(map).toMatch(/interface User:/);
    expect(map).toContain('id: string');
    expect(map).toContain('deletedAt: string | null');
  });

  it('places highlighted files first in caller-supplied order, others alphabetic', () => {
    const a = path.join(PROJECT_ROOT, 'src/a.ts');
    const m = path.join(PROJECT_ROOT, 'src/main.ts');
    const z = path.join(PROJECT_ROOT, 'src/z.ts');
    const graph = makeGraph({
      [a]: [makeSymbol({ name: 'aFn', kind: 'function', filePath: a, text: 'export function aFn(): void {}' })],
      [m]: [makeSymbol({ name: 'main', kind: 'function', filePath: m, text: 'export function main(): void {}' })],
      [z]: [makeSymbol({ name: 'zFn', kind: 'function', filePath: z, text: 'export function zFn(): void {}' })],
    });

    const map = buildRepoMap(graph, PROJECT_ROOT, {
      highlightFiles: ['src/main.ts'],
    });
    const idxMain = map.indexOf('src/main.ts:');
    const idxA = map.indexOf('src/a.ts:');
    const idxZ = map.indexOf('src/z.ts:');
    expect(idxMain).toBeGreaterThanOrEqual(0);
    expect(idxMain).toBeLessThan(idxA);
    expect(idxA).toBeLessThan(idxZ);
  });

  it('drops non-highlighted files when budget is exceeded and adds a truncation footer', () => {
    const root = PROJECT_ROOT;
    const sym = (name: string, file: string) =>
      makeSymbol({
        name,
        kind: 'function',
        filePath: file,
        text: `export function ${name}(): void {}`,
      });

    const files: Record<string, CodeSymbol[]> = {};
    for (let i = 0; i < 20; i++) {
      const fp = path.join(root, `src/f${i}.ts`);
      files[fp] = [sym(`fn${i}`, fp)];
    }
    const graph = makeGraph(files);

    // Tight budget — fits only a handful.
    const map = buildRepoMap(graph, root, { maxBytes: 200 });
    expect(map).toMatch(/more production files? omitted/);
    expect(map.length).toBeLessThan(400); // sanity ceiling
  });

  it('preserves highlighted files even when total exceeds maxBytes (they are load-bearing)', () => {
    const root = PROJECT_ROOT;
    const big = path.join(root, 'src/server.ts');
    const small = path.join(root, 'src/util.ts');
    const longText = 'export function doMany(' + 'a: string, '.repeat(20) + ' last: number): Promise<void> { /* body */ }';
    const graph = makeGraph({
      [big]: [makeSymbol({ name: 'doMany', kind: 'function', filePath: big, text: longText })],
      [small]: [
        makeSymbol({ name: 'noop', kind: 'function', filePath: small, text: 'export function noop(): void {}' }),
      ],
    });

    const map = buildRepoMap(graph, root, {
      maxBytes: 30, // ridiculous to force tail truncation
      highlightFiles: ['src/server.ts'],
    });
    expect(map).toContain('src/server.ts:');
    expect(map).toContain('doMany');
    // Tail file fell off; footer announces the omission.
    expect(map).toMatch(/more production files? omitted/);
    expect(map).not.toContain('src/util.ts:');
  });

  it('truncates a very long signature to ~120 chars with an ellipsis', () => {
    const filePath = path.join(PROJECT_ROOT, 'src/big.ts');
    const longArgs = 'a: string, '.repeat(40); // ~440 chars
    const graph = makeGraph({
      [filePath]: [
        makeSymbol({
          name: 'monster',
          kind: 'function',
          filePath,
          text: `export function monster(${longArgs} z: number): void {}`,
        }),
      ],
    });

    const map = buildRepoMap(graph, PROJECT_ROOT);
    const monsterLine = map.split('\n').find(l => l.includes('monster'));
    expect(monsterLine).toBeDefined();
    expect(monsterLine!.length).toBeLessThanOrEqual(125); // 120 + small indent
    expect(monsterLine).toMatch(/\.\.\.$/);
  });

  it('handles export const object literals (variable kind) with method-like members', () => {
    const filePath = path.join(PROJECT_ROOT, 'src/legacy-service.ts');
    const graph = makeGraph({
      [filePath]: [
        makeSymbol({
          name: 'LegacyService',
          kind: 'variable',
          filePath,
          text:
            'export const LegacyService = {\n' +
            '  list(): User[] {\n' +
            '    return [];\n' +
            '  },\n' +
            '  create(input: { name: string }): User {\n' +
            '    return { id: "x", name: input.name } as User;\n' +
            '  },\n' +
            '};',
        }),
      ],
    });

    const map = buildRepoMap(graph, PROJECT_ROOT);
    expect(map).toMatch(/const LegacyService:/);
    expect(map).toContain('list(): User[]');
    expect(map).toContain('create(input: { name: string }): User');
  });

  it('strips export/declare/default keywords from headers and ignores control-flow ids in class bodies', () => {
    const filePath = path.join(PROJECT_ROOT, 'src/wrap.ts');
    const graph = makeGraph({
      [filePath]: [
        makeSymbol({
          name: 'Wrap',
          kind: 'class',
          filePath,
          text:
            'export default class Wrap {\n' +
            '  doIt(x: number): number {\n' +
            '    if (x > 0) {\n' +
            '      for (let i = 0; i < x; i++) { console.log(i); }\n' +
            '    }\n' +
            '    return x;\n' +
            '  }\n' +
            '}',
        }),
      ],
    });

    const map = buildRepoMap(graph, PROJECT_ROOT);
    expect(map).toMatch(/class Wrap:/);
    expect(map).toContain('doIt(x: number): number');
    // Control-flow keywords must not appear as "methods".
    const methodLines = map.split('\n').filter(l => l.startsWith('    '));
    for (const ml of methodLines) {
      expect(ml).not.toMatch(/^\s+(if|for|while|switch|return)\(/);
    }
  });

  // v1.29.1 — production sources rank ahead of test files; section headers
  // appear when both groups are present. v1.29 scale benchmark surfaced the
  // opposite default (alphabetic sort puts __tests__/ near production code in
  // the same package), causing scope-creep into test files.
  describe('production / test split', () => {
    it('orders production files before test files and adds section headers', () => {
      const root = PROJECT_ROOT;
      const prod = path.join(root, 'packages/agents/src/orchestrator.ts');
      const test = path.join(root, 'packages/agents/src/__tests__/orchestrator.test.ts');
      const graph = makeGraph({
        [prod]: [
          makeSymbol({
            name: 'Orchestrator',
            kind: 'class',
            filePath: prod,
            text: 'export class Orchestrator {\n  runTask(): void {}\n}',
          }),
        ],
        [test]: [
          makeSymbol({
            name: 'orchestratorMock',
            kind: 'function',
            filePath: test,
            text: 'export function orchestratorMock(): void {}',
          }),
        ],
      });

      const map = buildRepoMap(graph, root);
      const idxProdHeader = map.indexOf('## Production sources');
      const idxTestHeader = map.indexOf('## Tests');
      const idxProdFile = map.indexOf('packages/agents/src/orchestrator.ts:');
      const idxTestFile = map.indexOf('packages/agents/src/__tests__/orchestrator.test.ts:');

      expect(idxProdHeader).toBeGreaterThanOrEqual(0);
      expect(idxTestHeader).toBeGreaterThan(idxProdHeader);
      expect(idxProdFile).toBeGreaterThan(idxProdHeader);
      expect(idxProdFile).toBeLessThan(idxTestHeader);
      expect(idxTestFile).toBeGreaterThan(idxTestHeader);
    });

    it('omits section headers when only one of the two groups has entries', () => {
      const prod = path.join(PROJECT_ROOT, 'src/util.ts');
      const graph = makeGraph({
        [prod]: [makeSymbol({ name: 'helper', kind: 'function', filePath: prod, text: 'export function helper(): void {}' })],
      });

      const map = buildRepoMap(graph, PROJECT_ROOT);
      expect(map).not.toContain('## Production sources');
      expect(map).not.toContain('## Tests');
      expect(map).toContain('src/util.ts:');
    });

    it('truncates tests first when budget is tight, keeping production visible', () => {
      const root = PROJECT_ROOT;
      const prod = path.join(root, 'src/main.ts');
      const test = path.join(root, 'src/__tests__/main.test.ts');
      const graph = makeGraph({
        [prod]: [makeSymbol({ name: 'main', kind: 'function', filePath: prod, text: 'export function main(): void {}' })],
        [test]: [makeSymbol({ name: 'mainTest', kind: 'function', filePath: test, text: 'export function mainTest(): void {}' })],
      });

      // Just enough budget for production but not test.
      const map = buildRepoMap(graph, root, { maxBytes: 80 });
      expect(map).toContain('src/main.ts:');
      expect(map).not.toContain('src/__tests__/main.test.ts:');
      expect(map).toMatch(/test files? omitted/);
    });

    it('detects .spec. and .test. naming conventions, not just __tests__/', () => {
      const root = PROJECT_ROOT;
      const a = path.join(root, 'src/foo.test.ts');
      const b = path.join(root, 'src/bar.spec.ts');
      const c = path.join(root, 'src/foo.ts');
      const graph = makeGraph({
        [a]: [makeSymbol({ name: 'fooTest', kind: 'function', filePath: a, text: 'export function fooTest(): void {}' })],
        [b]: [makeSymbol({ name: 'barSpec', kind: 'function', filePath: b, text: 'export function barSpec(): void {}' })],
        [c]: [makeSymbol({ name: 'foo', kind: 'function', filePath: c, text: 'export function foo(): void {}' })],
      });

      const map = buildRepoMap(graph, root);
      const idxFooProd = map.indexOf('src/foo.ts:');
      const idxFooTest = map.indexOf('src/foo.test.ts:');
      const idxBarSpec = map.indexOf('src/bar.spec.ts:');

      // Production foo.ts must precede the .test/.spec siblings.
      expect(idxFooProd).toBeGreaterThan(0);
      expect(idxFooProd).toBeLessThan(idxFooTest);
      expect(idxFooProd).toBeLessThan(idxBarSpec);
    });
  });
});
