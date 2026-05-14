# Architecture

Turborepo monorepo of 12 TypeScript packages. The system is a request-driven pipeline: the API accepts a task, queues it, and an Orchestrator walks it through a chain of LLM-backed agents until the result is committed (or skipped, if validation fails).

## Data flow — task to commit

```
┌───────────┐
│ POST /task│
└─────┬─────┘
      │ task description, project id, mode
      ▼
┌─────────────────┐         ┌──────────────┐
│  api/server.ts  │ ──────► │ job-system    │
│  (Fastify)      │  queue  │ (MemoryQueue) │
└─────┬───────────┘         └──────┬───────┘
      │ SSE /task/:id/stream       │ worker dequeues
      ▼                            ▼
┌──────────────────────────────────────────────┐
│             agents/orchestrator              │
│                                              │
│  1. Planner       — decompose to DAG of steps│
│  2. Architect     — file-level plan          │
│  3. Coder         — tool-calling edits       │
│       │  read_file / replace_in_file /       │
│       │  create_file / delete_file / done    │
│  4. Tester        — generate tests           │
│  5. ValidationLoop                           │
│       │  TypeScript check (filtered to       │
│       │  changed prod paths)                 │
│       │  Test runner (vitest / jest)         │
│       │  Fixer ×3 if failing                 │
│  6. Reviewer      — lenient gate (blocks     │
│                     only on runtime bugs)    │
│  7. Git Engine    — commit to auto/task-*    │
└──────────────────────────────────────────────┘
      │ events all the way through:
      │   queued / running / plan / step_start /
      │   coder_file_ready / validation_pass /
      │   commit / done
      ▼
   SSE clients (VS Code extension, curl -N)
```

Every agent reads from a shared **RAG Engine** that combines an HNSW vector index, a BM25 keyword index (merged via RRF), a 2-hop graph traversal (forward deps + reverse callers) over an AST-derived code graph, and a pinned monorepo meta item (tsconfig paths + package exports) for correct workspace import generation.

All file writes go through **Safe Exec** (backup → diff → write) and only land via **Git Engine** at the very end.

## Agent responsibilities

| Agent     | Input                                | Output                                                     | Notes |
|-----------|--------------------------------------|------------------------------------------------------------|-------|
| Planner   | Task description, repo summary       | DAG of typed steps (`feature` / `bugfix` / `refactor`)     | Hard cap `PLANNER_MAX_STEPS` |
| Architect | Step description, retrieval context  | File-level plan (which files to create / modify / delete)  | Skipped for atomic steps |
| Coder     | Step + retrieval context             | Sequence of tool calls; emits `coder_file_ready` per write | Tool-calling protocol since v1.32-d |
| Tester    | Newly written files                  | Test files (vitest / jest based on project conventions)    | `TESTER_ENABLED=true` |
| Fixer     | Failed validation output             | Same tool-calling protocol as Coder; targeted retries      | Max 3 attempts |
| Reviewer  | Final diff                           | Pass / block (with reasons)                                | Lenient since v1.36 |

## RAG retrieval

`packages/rag/src/`:

- **`vector-store.ts`** — HNSW index, 768-dim vectors from `nomic-embed-text-v1.5`. Persists to `data/vectors/*.hnsw` + `*.json`.
- **`bm25.ts`** — pure-TS BM25 (k1=1.5, b=0.75). No external deps.
- **`graph-retriever.ts`** — query path: BM25 candidates ∪ dense candidates → RRF merge (k=60) → optional cross-encoder rerank → **2-hop expansion** (top-k symbols + 1-hop deps + reverse-dep callers) → monorepo meta injection → token-budgeted output.

`retrieveContextItems` retrieval layers (v1.43+):
1. **Dense + BM25 hybrid** → top-k symbols
2. **1-hop forward** (`getDependencies`) — symbols the top-k use
3. **2-hop reverse** (`getCallers`) — symbols that reference the top-k (usage context)
4. **Monorepo meta** (pinned) — tsconfig paths aliases + package exports, always appended so LLM generates correct workspace import paths

The code graph (`packages/code-graph/`) carries a **reverse index** (`reverseIndex: Map<name, Set<callerName>>`) maintained incrementally on `addFile`/`removeFile` and rebuilt on `loadFromDisk`. This enables `getCallers()` in O(1) per symbol.

**Monorepo meta** (`indexMonorepoMeta`): at the end of `indexCodebase`, parses `tsconfig.json compilerOptions.paths` and `packages/*/package.json exports`. Persisted to `graphsDir/monorepo-meta.json` for reload across restarts.

`buildRepoMap()` produces a token-budgeted summary used for Planner/Architect prompts.

## Edit safety

`packages/safe-exec/`:

| Component        | Role                                                                 |
|------------------|----------------------------------------------------------------------|
| `SafeWriter`     | Atomic write with rollback                                           |
| `BackupManager`  | Pre-write copy to `data/backups/`, prune at `BACKUP_MAX_AGE_DAYS`    |
| `DiffEngine`     | Computes unified diff for Reviewer / events                          |
| `edit-applier`   | Strict + tolerant strategies for `replace_in_file` (anchors and lines)|
| `prettier-runner`| Best-effort formatter pass before commit                             |
| `test-runner`    | Wraps vitest/jest, parses pass/fail per file                         |

`COMMIT_ONLY_IF_VALID=true` (default) blocks commits when validation hasn't converged. The work is preserved on the `auto/task-*` branch for human inspection.

## Cumulative mode

`CUMULATIVE_MODE=true` enables sequential task accumulation:

1. After a successful commit to `auto/task-<id>`, `GitEngine.mergeIntoCumulative()` fast-forward merges the branch into `auto/cumulative` (configurable via `CUMULATIVE_BRANCH`).
2. The next task forks from `auto/cumulative` instead of `defaultBranch` — it sees all prior commits.
3. On non-fast-forward conflict: emits `cumulative_merge_failed` event, branch is retained for manual resolution; the task itself is still `done`.
4. `JobWorker` is already sequential (single `processing` flag) — no race conditions between tasks.

Bench result: 6/6 sequential tasks committed on sandbox with zero manual merges (v1.45, 2026-05-15).

## API surface

`packages/api/`:

| Method | Path                       | Purpose                                  |
|--------|----------------------------|------------------------------------------|
| GET    | `/health`                  | Server + backend liveness                |
| POST   | `/project`                 | Register a project (root → id)           |
| GET    | `/projects`                | List registered projects                 |
| POST   | `/index`                   | Index (or re-index) a project            |
| POST   | `/task`                    | Submit a task; returns `task_id`         |
| GET    | `/task/:id`                | Final task status                        |
| GET    | `/task/:id/stream`         | SSE stream of `TaskEvent` records        |
| GET    | `/tasks`                   | List tasks (optionally filtered by project) |

The SSE event format is defined in `packages/shared/src/task-events.ts`. High-frequency events (`agent_stream`, `index_file`, `index_skip`) bypass the replay buffer; the rest are kept so late-joining SSE clients see context.

## Packages map

| Package             | Path                       | Responsibilities                         |
|---------------------|----------------------------|------------------------------------------|
| `@rag-system/shared`     | `packages/shared`     | Types, config, logger, task-event bus    |
| `@rag-system/model-router` | `packages/model-router` | LlamaSwap + Ollama clients; per-role alias routing |
| `@rag-system/memory`     | `packages/memory`     | SQLite store: tasks, ADRs, failures, embedding cache, projects |
| `@rag-system/safe-exec`  | `packages/safe-exec`  | File writes, backups, diffs, edit-applier, prettier, test runner |
| `@rag-system/git-engine` | `packages/git-engine` | `simple-git` wrapper for branch + commit |
| `@rag-system/code-graph` | `packages/code-graph` | AST parser, code-graph, repo-map builder |
| `@rag-system/rag`        | `packages/rag`        | Vector store, BM25, hybrid retriever, file watcher |
| `@rag-system/agents`     | `packages/agents`     | Planner, Architect, Coder, Tester, Reviewer, Fixer, Orchestrator |
| `@rag-system/job-system` | `packages/job-system` | In-memory queue + worker loop            |
| `@rag-system/api`        | `packages/api`        | Fastify HTTP + SSE endpoints             |
| `@rag-system/mcp-server` | `packages/mcp-server` | MCP stdio transport (7 tools, 4 resources, 4 prompts) |
| `rag-system-vscode`      | `packages/vscode-extension` | VS Code sidebar, command palette, SSE consumer |

## How to add a new agent

Agents extend `BaseAgent` (`packages/agents/src/base-agent.ts`). The minimal contract:

1. Implement `async run(input): Promise<output>`.
2. Pull the model alias from `config.agents` (e.g. `LLM_SMALL_MODEL` for fast roles, `LLM_LARGE_MODEL` for code-producing).
3. Emit a `TaskEvent` of the appropriate `type` on each meaningful step (`step_start`, `step_complete`, `agent_stream` for token chunks).
4. Wire it into `Orchestrator.executeStep()` (sequential) or `executePlanParallel()` (DAG).
5. Add prompt files alongside the agent — see `coder.ts` and `task-agents/feature.ts` for the established style (system prompt + spec + conventions).

If the new agent needs structural edits, it should call the existing `structural-edits.ts` helpers (`add_method`, `add_route`, `add_import`, …) rather than re-implementing line-based logic.

## Design references

For the rationale behind specific decisions:

- [docs/designs/v1.32-c-sub-agents.md](designs/v1.32-c-sub-agents.md) — task-agents architecture
- [docs/designs/v1.32-d-llamacpp-backend.md](designs/v1.32-d-llamacpp-backend.md) — backend swap from Ollama to llama-swap
- [docs/designs/v1.33-reranker.md](designs/v1.33-reranker.md) — cross-encoder rerank
- [docs/designs/v1.34-hybrid-search.md](designs/v1.34-hybrid-search.md) — BM25 + dense via RRF
- [docs/designs/v1.35-coder-reviewer-fix.md](designs/v1.35-coder-reviewer-fix.md) — pre-Reviewer TS check, Gemma 4 as Coder
- [docs/designs/v1.37-l5x-comprehensive-bench.md](designs/v1.37-l5x-comprehensive-bench.md) — comprehensive benchmark methodology
