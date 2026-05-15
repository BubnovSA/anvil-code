# Run 2026-05-16 — Cross-Repo Bench: vite (v2, post-fix)

## Configuration

| | |
|---|---|
| Date | 2026-05-16 |
| Repo | `vitejs/vite` (monorepo, ~1413 files) |
| rag-system revision | `34526c4` (v1.52) for V1-V6; `b800f95` (v1.53) for V5c |
| Mode | balanced |
| LLM_LARGE_MODEL | `gemma` (gemma-4-26b-a4b-it-mxfp4-moe-ctx-32k) |
| LLM_SMALL_MODEL | `qwen3` (qwen3-6-35b-a3b ctx-16k) |
| Backend | llama-swap @ 172.20.10.4:8080 |
| Setup | `pnpm build` run before bench (v1 had no build → ERR_MODULE_NOT_FOUND) |

## Goal

Validate that v1.52 healthcheck workflow enables reliable cross-repo bench:
1. healthcheck detects infra issues before bench
2. After `pnpm build`, tasks that previously failed with vitest crash now succeed
3. Diagnose remaining failure patterns

## Healthcheck pre-flight

```
GET /project/2e4c5c197ed7/healthcheck
→ ready:false, testsOk:false, issue: "Test runner startup failed — likely missing node_modules or build artifacts"
```

After `pnpm build`:
```
GET /project/2e4c5c197ed7/healthcheck?force=true
→ ready:false, testsOk:false, issue: "Tests fail on clean baseline — baseline detection will filter them"
```

`ready:false` is now a soft-warning: tests run but some fail (e2e tests in full suite).
Healthcheck correctly changed from hard infra error to "known failing baseline".

## Results — V1.52 run (all 6 tasks, sequential)

| Task | Result | Pattern | Time |
|------|--------|---------|------|
| V1 — JSDoc on defineConfig | ❌ error | `llm_parse_fail` (Gemma ~10% rate) | ~2.5min |
| V2 — getViteVersion helper (new file) | ❌ commit_skipped | TesterAgent: `await` in sync `beforeEach` | ~8.4min |
| V3 — parseAcceptHeader in utils.ts | ❌ error | `exceed_context_size` (19262 > context) | ~0.8min |
| V4 — requestLogger middleware (new file) | ❌ commit_skipped | Reviewer: "code identical to original" | ~5.4min |
| V5 — HMR_HEADER_NAME constant | ❌ commit_skipped | e2e tests in `npm test` blocked validation | ~8.3min |
| V6 — JSDoc on createServer | ❌ noop | Complex re-export chain | ~2min |

**0/6 commits** on v1.52.

## Root cause analysis

### V5 — key finding: `npm test` chains e2e (v1.53 fix)

vite's `package.json` `test` script = `pnpm test-unit && pnpm test-serve && pnpm test-build`.
TestRunner ran `npm test` which includes e2e tests that require a browser/server — these always
time out or fail in our environment. Result: baseline captured no fingerprints (timeout truncated
output), so any post-change test failure was treated as new → `commit_skipped`.

**Fix (v1.53)**: TestRunner now detects `test-unit` / `test:unit` scripts. If one exists AND
`test` chains via `&&`, uses the unit-only variant. Vite baseline now runs in 4s, passes 802 tests.

### V2 — TesterAgent bad test pattern

Code was correct (`getViteVersion.ts` reads version from package.json). TesterAgent generated
a complex `fs.readFileSync` mock with `await import(...)` inside a _synchronous_ `beforeEach`:
```ts
beforeEach(() => {
  ...
  const module = await import('./getViteVersion');  // ← SyntaxError: await in non-async
```
Test fails with TS compilation error → commit_skipped. Coder output = correct; Tester = broken.

### V3 — context size (unchanged from v1.50)

`utils.ts` is 1835 lines. llama-swap returns HTTP 400 `request (19262 tokens) exceeds context`.
Fix requires auxiliary model with 32K ctx (qwen3 Reviewer is on 16K ctx).

### V4 — Reviewer noop rejection

Coder produced no file changes (noop). Reviewer correctly rejected "code identical to original".
Root cause: Coder couldn't locate the right attach point in server/index.ts (large file).

### V6 — navigation failure (unchanged from v1.50)

`createServer` is exported via a complex re-export chain. Coder returned 0 edits. Same noop.

## Re-test: V5c on v1.53 (clean repo)

After fixing TestRunner (v1.53), re-ran V5 alone on clean vite main:

```
V5c: completed in ~90s → COMMITTED ✅
diff: +export const HMR_HEADER_NAME = 'x-vite-hmr'  (packages/vite/src/node/constants.ts)
```

## Dirty working tree side-effect (observed, not primary cause)

`commit_skipped` tasks leave files untracked/modified in the working tree. Subsequent tasks
start from the same dirty state (untracked spec files get picked up by vitest discovery).
After the e2e fix, this is less critical since unit tests properly filter baseline.

## Summary

| Metric | v1.50 baseline | v1.52+build | v1.53 (unit fix) |
|--------|----------------|-------------|------------------|
| Commits | 0/6 | 0/6 | 1/1 (V5 re-test) |
| Infra failures | 3 (ERR_MODULE_NOT_FOUND) | 0 | 0 |
| V5 (constant) | ❌ vitest crash | ❌ e2e timeout | ✅ committed (90s) |
| V1 (llm_parse_fail) | ❌ | ❌ | expected same |
| V3 (context) | ❌ | ❌ | expected same (needs 32K aux) |

## Open issues

1. **TesterAgent bad async pattern** — needs fix for complex mocking scenarios (V2 pattern)
2. **Large-file navigation** — V3, V4, V6 all fail on large files (>1500 lines). Needs aux 32K ctx.
3. **Dirty working tree** — leftover uncommitted files from commit_skipped tasks. Consider
   adding `git clean -fd` + `git checkout -- .` at task start before branch creation.
