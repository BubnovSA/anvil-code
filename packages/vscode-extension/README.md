# RAG System — VSCode Extension

GUI sidebar for the local RAG system: switch projects, fire tasks, watch
agents stream output in real time.

## Features

- **Projects** sidebar — list of registered projects, click to set active
- **Tasks** sidebar — recent tasks per project, status icons (queued / running / completed / failed)
- **Status bar** — shows the active project; click to switch
- **Run Task** command — quick prompt + mode picker, posts to `/task`, auto-opens the live stream
- **Index Active Project** command — triggers `POST /index`, streams progress events
- **Live SSE stream** — task progress (plan, step start/done, agent tokens, file ready, validation, commit, done) prints to the *RAG System* output channel

## Install (end users)

**Prerequisites:** the RAG System API must be running and reachable. Quickstart
lives in the [repo root README](../../README.md) — start `llama-swap`, point
`.env` at it, then run `node packages/api/dist/index.js` with the env loaded.

1. Grab `rag-system-vscode-0.1.0.vsix` from the GitHub release (or build it
   yourself — see *Build from source* below).
2. In VS Code: **Extensions** view → **…** menu → **Install from VSIX…** and
   pick the file. Reload when prompted.
3. Open the **Activity Bar** → 🚀 *RAG System*. Run the command palette and
   execute **`RAG: Set API URL`** — point it at your API
   (default `http://localhost:3000`).
4. **`RAG: Register Project`** to add the repo you want the agent to work on,
   then click it in the *Projects* sidebar to mark it active.
5. **`RAG: Index Active Project`** once (first time only).
6. **`RAG: Run Task`** → type a prompt, pick a mode (auto / plan / coder).
   The *RAG System* output channel opens and streams progress live; on success
   you get a commit on an `auto/task/...` branch in the target repo.

## Build from source

```bash
# from the monorepo root
npm install
npx turbo run build --filter=rag-system-vscode
```

In VSCode: **Run → Start Debugging** (with `packages/vscode-extension` as the
workspace folder) opens an Extension Development Host with this extension
loaded. The activity bar gets a 🚀 icon — click it to open the sidebar.

## Packaging a `.vsix`

```bash
npm install -g @vscode/vsce
cd packages/vscode-extension
vsce package --no-dependencies
```

Produces `rag-system-vscode-0.1.0.vsix` you can install via
**Extensions → … → Install from VSIX**.
