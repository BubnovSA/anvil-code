# RAG System

**Local autonomous coding agent.** Give it a task in plain English; it plans, writes code, runs tests, fixes failures, and commits — entirely on your machine.

```
POST /task  →  Planner  →  Coder  →  Reviewer  →  Fixer (retry ×3)  →  git commit
```

No cloud. No subscriptions. Any OpenAI-compatible LLM backend.

---

## What it does

- Decomposes a natural-language task into a DAG of steps (Planner)
- Writes TypeScript/JavaScript files using structural AST tools (`add_method`, `replace_function`, …) with line-level fallback (Coder)
- Runs the project's test suite and iterates through a validation loop until tests pass (Fixer)
- Commits the result to an isolated branch with a structured message (Git Engine)
- Indexes your codebase with hybrid BM25 + dense vector search (RRF) for context retrieval

## Architecture

The system is a **Turborepo monorepo** of 12 TypeScript packages. An HTTP API (Fastify) accepts tasks and queues them for an async Worker. The Worker hands each task to an Orchestrator that runs agents in sequence: Planner decomposes the task, Coder produces file changes via tool-calling, Reviewer checks the result, and a validation loop invokes Fixer (up to 3 attempts) if tests fail. All file writes go through Safe Exec (backup → diff → write) and are committed via Git Engine to a `auto/task-*` branch. Context is supplied by a RAG Engine that combines an HNSW vector index with a BM25 keyword index and a graph traversal step over an AST-derived code graph.

---

## Requirements

| | Minimum |
|---|---|
| Node.js | 18 LTS |
| npm | 9+ |
| Git | 2.30+ |
| LLM backend | llama-swap, llama-server, or any OpenAI-compatible `/v1/chat/completions` endpoint |

Tested with **llama-swap** fronting:
- `qwen-coder-long` — coder/fixer/architect (16 K context required)
- `qwen3` — planner/reviewer/tester
- `nomic-embed-text-v1.5` (`embed` alias) — embeddings (768 dim)
- a cross-encoder reranker (`reranker` alias)

---

## Quickstart

### 1. Start your LLM backend

Configure [llama-swap](https://github.com/mostlygeek/llama-swap) with the model aliases above, or point any OpenAI-compatible server at port 8080.

### 2. Clone and build

```bash
git clone https://github.com/bubnovsa/rag-system.git
cd rag-system
npm install
npm run build
```

### 3. Configure environment

```bash
cp .env.example .env
```

Key variables (see `.env.example` for the full list):

```env
LLM_BACKEND=llamacpp
LLM_URL=http://localhost:8080
LLM_LARGE_MODEL=qwen-coder-long
LLM_SMALL_MODEL=qwen3
LLM_EMBED_MODEL=embed
PROJECT_ROOT=/path/to/your/repo
```

### 4. Start the API

```bash
source .env   # or: set -a && . .env && set +a
node packages/api/dist/index.js
```

Server starts on `http://localhost:3000`.

### 5. Install the VS Code extension

```bash
cd packages/vscode-extension
npm run build
npx vsce package        # produces rag-system-vscode-*.vsix
```

In VS Code: **Extensions → ⋯ → Install from VSIX…** → select the `.vsix` file.

The extension adds a **RAG System** panel in the Activity Bar. Set the API URL (`RAG: Set API URL`), register your project, and submit tasks from the sidebar.

### 6. Submit your first task

Via curl:

```bash
curl -X POST http://localhost:3000/task \
  -H "Content-Type: application/json" \
  -d '{"task": "Add input validation to the POST /users endpoint", "projectRoot": "/path/to/your/repo"}'
```

Poll for status:

```bash
curl http://localhost:3000/task/<task_id>
```

---

## Known limitations

- **TypeScript / JavaScript only** — the AST parser and structural edit tools are TS-native; other languages fall back to line-based edits.
- **Context scales to ~50-file projects** — retrieval works well on small/medium codebases; repos larger than ~90 files hit the 16 K context window on complex multi-file tasks (L2+ bench level). Multi-hop closure is planned post-release.
- **No streaming** — `GET /task/:id` returns final status only; the VS Code extension polls. SSE streaming is on the roadmap.
- **Single machine** — no auth, no multi-user isolation. Designed for personal local use.
- **Fixer is probabilistic** — the validation loop improves reliability but does not guarantee a passing commit on every run; `COMMIT_ONLY_IF_VALID=true` (default) skips the commit rather than landing broken code.

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE)
