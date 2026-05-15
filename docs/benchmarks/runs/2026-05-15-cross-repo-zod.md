# Run 2026-05-15 — Cross-Repo Bench: zod

## Configuration

| | |
|---|---|
| Date | 2026-05-15 |
| Repo | `colinhacks/zod` (402 TS files, 1761 vectors) |
| Indexed | 12s |
| Test setup | `pnpm install` only — `pnpm test` runs cleanly: 339 files / 3811 tests pass / 19s |
| rag-system revision | `27a5885` (v1.50 + cross-repo) |

## Goal

After vite revealed infrastructure friction, try zod — smaller, cleaner test setup, single package — to isolate code-quality vs infrastructure failures.

## Results

| Task | Result | Notes | Time |
|------|--------|-------|------|
| Z1 — JSDoc on `flattenError` (overloaded, errors.ts 455 lines) | ❌ test_fail | Coder produced 1 file (validation_fail in tests) | 393s |
| Z2 — `getZodVersion` helper (new file) | 🟡 validation_pass + git fail | Code correct (`version.ts` added). TesterAgent generated `.test.js` which is in zod's `.gitignore` — git add rejected. | 113s |
| Z3 — `summarizeErrors` helper (errors.ts) | ❌ test_fail | 1 file produced; tests broke | 242s |
| Z4 — `ZOD_LOCALE_VERSION` constant in en.ts | ❌ test_fail | 1 file produced; tests broke | 189s |

**0/4 commits**, but Z2 produced correct code (validation passed → only git/test infrastructure blocked).

Earlier round with hallucinated function names: Z1 (`issuesToZodError` — doesn't exist) and Z3 (`formatZodError` — same as existing `formatError`) → both noop. Coder correctly returned no changes for non-existent target functions.

## Findings

### Code generation works
- Z2: full `version.ts` produced and TS-validated. The fail was in git-add (`.gitignore` blocks `.test.js` artifacts; TesterAgent generated `.test.js` instead of `.test.ts`).
- Z1, Z3, Z4: Coder produced 1 file each (commit_skipped fileCount=1) → real edits, but downstream test suite breaks.

### TesterAgent file-extension assumption
TesterAgent generates `.test.js` by default (legacy). zod uses strictly `.test.ts`, with `.test.js` excluded via `.gitignore`. Result: even when Coder code is correct, TesterAgent's test file is rejected at commit. Same TesterAgent bug surfaced in vite.

### Test sensitivity
zod has 3811 tests that pass on clean state. Even small code additions (a new helper function, a JSDoc comment) trigger failures somewhere. Likely: TesterAgent-generated tests fail at runtime; the v1.44 dry-run might not catch these because they import zod internals that aren't fully resolved without a build step.

### Coder noop on non-existent targets is correct behavior
First-round Z1/Z3 with hallucinated function names → noop. Good — Coder doesn't fabricate edits when the target doesn't exist. The bench task descriptions need real symbol names.

## Cross-repo summary (vite + zod)

| Repo | Tasks | Commits | Pattern |
|------|-------|---------|---------|
| hono (v1.47) | 6 | 6/6 ✅ 100% | trained-on |
| trpc (v1.43 best) | 6 | 5/6 (83%) | trained-on, model variance on T2/T5 |
| vite | 6 | 0/6 | infra: vitest setup, context limits |
| zod | 4 | 0/4 (1 produced correct code) | TesterAgent .test.js + test sensitivity |

## Honest takeaway

Cross-repo transferability is **not free**. Hono/trpc benches measure code quality on adapted-to repos. Real-world deployment to a new repo requires:

1. **Pre-flight check**: confirm `npm test` runs cleanly on baseline before bench
2. **TesterAgent extension awareness**: detect project test extension convention (`.test.ts` vs `.test.js`) from existing files instead of defaulting to `.js`
3. **Per-project context budget tuning**: large source files (zod's schemas.ts at 4730 lines, vite's utils.ts at 1835) exceed auxiliary model context

V1.50 system architecture is sound — code generation, retrieval, structural anchors all work. The friction is in the validation pipeline assumptions about how a project is structured.

## Next priorities surfaced

1. **TesterAgent: detect test extension from project** — look at existing test files to choose `.test.ts` vs `.test.js`
2. **Auxiliary model context upgrade** — qwen3 16K → larger model for files >1500 lines
3. **Pre-flight `/project/:id/healthcheck`** — surface infrastructure issues before bench runs waste time
