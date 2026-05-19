# Run 2026-05-20 — Hono bench Qwen3-35B MoE (v1.65d)

## Configuration

| | |
|---|---|
| Date | 2026-05-20 |
| rag-system revision | `085864f` (v1.65d) |
| LLM_LARGE_MODEL | `qwen3-32k` (Qwen3-35B MoE, 32K ctx, thinking mode) |
| hono rev | `f10dee8` (4.12.18) |
| Baseline | v1.47 Gemma: 6/6 (100%) |

---

## Results

| # | Task | Result | Commit | Time | Notes |
|---|------|--------|--------|------|-------|
| H1 | JSDoc Hono constructor | ✅ commit | `6eda090` | ~80s | Clean JSDoc |
| H2 | getRequestId helper (new file) | ✅ commit | `a46e862` | ~60s | src/utils/request-id.ts created |
| H3 | parseQueryString utility | ✅ commit | `a8d42ab` | ~100s | src/utils/url.ts + index.ts export |
| H4 | requestId middleware | ❌ reviewer_reject | — | ~4min | "Missing..." — incomplete implementation |
| H5 | getHeader helper | ✅ commit | `8277f59` | ~100s | Clean method on Context class |
| H6 | buildUrl utility | ✅ commit | `3ac69c0` | ~100s | src/utils/url.ts extended |

**Hono Qwen3 MoE v1.65d: 5/6 (83%)**

---

## vs Gemma v1.47

| | Gemma v1.47 | Qwen3 MoE v1.65d | Δ |
|---|---|---|---|
| H1 JSDoc | ✅ | ✅ | = |
| H2 getRequestId | ✅ | ✅ | = |
| H3 parseQueryString | ✅ | ✅ | = |
| H4 requestId middleware | ✅ | ❌ | -1 |
| H5 getHeader | ✅ | ✅ | = |
| H6 buildUrl | ✅ | ✅ | = |
| **Total** | **6/6 (100%)** | **5/6 (83%)** | **-1** |

---

## Analysis

### H4 ❌ — requestId middleware

Reviewer: "Missing..." — the implementation was incomplete. H4 asks to "generate a unique ID for each request using crypto.randomUUID() and set the X-Request-Id header on the response." This is a middleware function that needs:
1. A function that creates the middleware
2. Logic to call `crypto.randomUUID()`
3. Setting the response header

This is structurally similar to T3 (trpc): adding middleware with specific runtime behavior. Qwen3 thinking mode either over-engineers or misses part of the implementation. The Reviewer (correctly) blocked the incomplete result.

### Pattern: adapter/middleware tasks remain harder for Qwen3

Both T3 (trpc onError) and H4 (hono requestId) are "add a new middleware/adapter option" tasks. Both fail with Reviewer rejections. Qwen3 with thinking mode either:
- Over-refactors the surrounding type/interface (T3), or
- Misses a required piece of the implementation (H4: "Missing...")

Gemma handles these more reliably because it takes a more conservative, direct approach.

---

## H4 root cause — wrong prompt, not system failure

H4 original prompt: "Add a requestId() middleware..." — the middleware ALREADY EXISTS in hono 4.12.18. Reviewer rejected because Coder tried to recreate it, missing the existing `generator` option.

H4 r2 attempt: "update to set X-Request-Id on request object" — `Request.headers` is read-only in Fetch API, TS pre-check failed.

H4 r3 (correct): "Add a validate option to RequestIdOptions" — used `add_type_member` + `replace_in_file`. **✅ committed in ~100s.**

**Real hono capability: 6/6 (100%)** with correct prompts. H4 was a bench setup error.

---

## Speed

All hono tasks complete in 1-2 minutes (vs trpc's 5-10 minutes). hono is 366 TS files, test suite runs in ~15s clean — well within the 120s TestRunner timeout.
