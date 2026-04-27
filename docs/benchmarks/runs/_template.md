# Run YYYY-MM-DD — &lt;tag&gt;

## Configuration

| | |
|---|---|
| Date | YYYY-MM-DD |
| rag-system revision | `git rev-parse --short HEAD` |
| Iteration tag | v1.X (what this run tests) |
| LARGE model | `OLLAMA_MODEL_LARGE=...` |
| SMALL model | `OLLAMA_MODEL_SMALL=...` |
| TESTER_ENABLED | true / false |
| PLANNER_MAX_STEPS | N |
| Other ENV diffs from default | ... |
| Cumulative? | no (each task on clean main) / yes (chained) |

## Tasks

### L1.1 — &lt;short title&gt;

| | |
|---|---|
| Plan size | N step(s) |
| Files touched | path/a, path/b |
| Validation | pass / fail / skipped |
| Commit | yes / commit_skipped |
| Wall time | Nm Ns |

**Diff highlights:**
```diff
+ ...
```

**Issues / observations:**
- ...

**Score:**
| Correctness | Architecture | Style | Completeness | Idiomatic | **Avg** |
|---|---|---|---|---|---|
| N/10 | N/10 | N/10 | N/10 | N/10 | **N/10** |

---

(repeat for each task)

## Aggregate

| | |
|---|---|
| Tasks attempted | N |
| Green commits | N |
| Validation pass rate | N/N |
| Run score (avg) | N/10 |

## What worked

- ...

## What broke

- ...

## Lessons / next iteration ideas

- ...
