# Benchmark methodology

Each iteration of the system (new prompt, new architecture, new model) gets one run file in `runs/`. The goal: detect regressions early and measure progress objectively.

## Task suite

Lives in [tasks.md](tasks.md) — 7 fixed tasks, levels L1 (atomic) to L4 (cross-file feature). Same task descriptions for every run, so results are comparable.

## Run protocol

For each run:

1. Create a new run file from `runs/_template.md`, named `YYYY-MM-DD-<short-tag>.md`.
2. Fill in the "Configuration" section (model, ENV settings, code revision).
3. Reset sandbox to a known starting state (`git checkout main`, prune auto-branches).
4. For each task in `tasks.md`:
   - Reset sandbox to clean baseline OR keep cumulative (note in run file)
   - Submit task via API
   - Wait for `done` / `error` event
   - Capture: plan size, files touched, validation result, commit/skipped, diff snippet
   - Score the result 0-10 across 5 axes (correctness, architecture, style, completeness, idiomatic)
5. Compute aggregate stats and lessons-learned at the bottom of the run file.

## Score axes

- **Correctness** — typecheck passes, tests pass, runtime semantics match the task
- **Architecture** — touched only what was needed, no parallel duplicates, entry points preserved
- **Style** — matches project conventions (test framework, imports, indentation, naming)
- **Completeness** — every part of the task description was addressed (no silent partials)
- **Idiomatic** — what a senior engineer would write (or close to it)

Average across the 5 axes is the task score. Average across all tasks is the run score.

## Why files instead of a database

Markdown files in git are:
- Diff-able between runs
- Reviewable in PRs
- Survive context resets — when an agent loses memory, the run files stay
- Easy to grep / cite by URL when discussing
