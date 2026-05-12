# Real Repo Diagnostic — День 1 Sprint (2026-05-12)

**Цель:** Установить failure patterns на реальных open-source TypeScript репозиториях.

**Конфиг:**
```
LLM_LARGE_MODEL=gemma-4-26b (ctx=32768)
LLM_SMALL_MODEL=qwen3 (ctx=16384)
TOOL_CALLING_CODER=true
TESTER_ENABLED=true
RAG_MAX_CONTEXT_TOKENS=3000
COMMIT_ONLY_IF_VALID=true
mode=balanced
```

**Найден и исправлен баг в этом сеансе:** `Promise.race([])` зависал когда все шаги синхронно скипнуты (step dependencies failed). Fix: `orchestrator.ts` line 456.

---

## Репозиторий 1: honojs/hono

**Размер:** 326 TS файлов (src/, включая тесты)  
**Setup:** bun-based, tsconfig с project references (`"files": []`), vitest  
**Deps:** npm install выполнен  
**Проект ID:** `9c7b84a5ef96`

### Задачи hono

| # | Уровень | Задача | Commit | Failure Pattern |
|---|---------|--------|--------|-----------------|
| T1 | L1 | JSDoc к Hono.constructor | ❌ skipped | `validation_fail:tsc` — no deps on task start |
| T2 | L1 | requestId middleware | ❌ error | `exceed_context_size` 33120 > 32768 |
| T3 | L1 | getHeader() в Context | ❌ error | `exceed_context_size` 33054 > 32768 |
| T4 | L2 | timing middleware (уже есть) | ❌ skipped | `test_fail:snapshot` — LLM modified stream.ts/cache.ts |
| T5 | L2 | json() в Context | ❌ error | `exceed_context_size` 33054 > 32768 |
| T6 | L2 | compress middleware (уже есть) | ❌ partial | `test_fail:snapshot` + unrecovered: compress.ts |
| T7 | L3 | cache middleware (уже есть) | ❌ skipped | `test_fail:snapshot` — LLM rewrote existing cache |
| T8 | L3 | basicAuth middleware (уже есть) | ❌ error | `reviewer_reject` 3 attempts |
| T9 | L3 | csrf middleware (уже есть) | ❌ skipped | `test_fail:snapshot` — same destructive edits as T4/T7 |

**Результат: 0/9 commits (0%)**

### Разбор паттернов hono

**test_fail:snapshot (T4, T6, T7, T9) — ключевой инсайт:**
Все 4 задачи сделали **идентичные изменения** к одним и тем же файлам:
```
M  src/helper/streaming/sse.ts     (+14, -14)
M  src/helper/streaming/stream.ts  (+13, -13)  ← abort() стал async
M  src/middleware/cache/index.ts   (+39, -167) ← полная деструктивная перезапись
M  src/utils/stream.ts             (+12, -3)
```
Root cause: RAG retrieves cache/stream файлы для ВСЕХ middleware запросов. LLM создаёт новый middleware (верно) + переписывает cache/index.ts (неверно). `abort()` стал async → breaks ReadableStream snapshot tests.

---

## Репозиторий 2: trpc/trpc

**Размер:** 714 TS файлов, pnpm monorepo, turbo  
**Deps:** pnpm install выполнен  
**Проект ID:** `545ec882a53b`

### Задачи trpc

| # | Уровень | Задача | Commit | Failure Pattern |
|---|---------|--------|--------|-----------------|
| TT1 | L1 | onError в standalone | ❌ error | `exceed_context_size` 34750 в Fixer |
| TT2 | L1 | requestTimeout в standalone | ❌ error | `ts_precheck_fail`: workspace links broken |
| TT3 | L1 | JSDoc в express adapter | ❌ error | `exceed_context_size` 36114 в Fixer |
| TT4 | L2 | healthEndpoint в standalone | ❌ error | `ts_precheck_fail` + `promise_race_hang` bug |
| TT5 | L2 | maxBodySize в HTTP handler | ❌ error | `ts_precheck_fail`: mockImplementation missing |
| TT6 | L2 | retry в dataLoader | ❌ error | `reviewer_reject` 3 attempts |
| TT7 | L3 | Cloudflare Workers adapter | ❌ error | `llm_parse_fail`: bad JSON from Planner |
| TT8 | L3 | batchScheduler в dataLoader | ❌ error | `exceed_context_size` 33304 в validation |
| TT9 | L1 | TRPC_ERROR_CODES_BY_NUMBER | ❌ skipped | `validation_fail:ts`: pre-existing openapi error |

**Результат: 0/9 commits (0%)**

### Разбор паттернов trpc

**ts_precheck_fail (TT2, TT4, TT5) — pre-existing errors:**
- `standalone.test.ts(159,12): error TS2451: Cannot redeclare block-scoped variable 'promise'` — vitest globals not typed
- `__tests__/standalone.test.ts(4,27): error TS2307: Cannot find module '../node-http.js'` — workspace links
- `nodeHTTPRequestHandler.test.ts: Property 'mockImplementation' does not exist` — vitest mock types

Все три — pre-existing TypeScript errors в test files trpc. TypeChecker.runOn() не фильтрует их (ошибки в неизменённых файлах попадают в output).

**TT9 validation_fail:** `openapi/test/.../client.gen.ts not found` — generated file не входит в repo.

---

## Итоговая таблица паттернов (18 задач)

| Паттерн | hono | trpc | Итого | % |
|---------|------|------|-------|---|
| `exceed_context_size` | 3 | 3 | **6** | **33%** |
| `test_fail:snapshot` | 4 | 0 | 4 | 22% |
| `ts_precheck_fail` | 0 | 3 | 3 | 17% |
| `validation_fail:ts` | 1 | 1 | 2 | 11% |
| `reviewer_reject` | 1 | 1 | 2 | 11% |
| `llm_parse_fail` | 0 | 1 | 1 | 6% |

**Общий success rate: 0/18 commits (0%)**

---

## Root Cause Analysis

### #1 КРИТИЧНО: Context overflow (33%)

Бюджет токенов gemma-4-26b (32768 ctx):
```
Фиксированные расходы:
  system_prompt:    ~1455 токенов
  tool_definitions: ~1500 токенов
  RAG context:      ~3000 токенов (RAG_MAX_CONTEXT_TOKENS)
  initial message:  ~200 токенов
  ──────────────────────────────
  overhead:         ~6155 токенов

Доступно для чата: 32768 - 6155 = 26613 токенов

После pruning (HISTORY_KEEP_TAIL=16 messages × avg 1600 tokens):
  chat history:     ~25600 токенов

Итого: ~31755 токенов → overflow при добавлении validation errors Fixer'а
```

Когда overflow: Coder читает файлы через read_file (каждый = 300-3000 токенов) → после нескольких reads context заполнен → Fixer не помещается.

**Фиксы (приоритет):**
1. Truncate `read_file` output до 150 lines / 6000 chars
2. Уменьшить `HISTORY_KEEP_TAIL` с 16 до 8
3. Уменьшить `RAG_MAX_CONTEXT_TOKENS` с 3000 до 2000 для репо > 100 файлов

### #2 ВЫСОКИЙ: LLM делает destructive side-effect changes (22%)

"Read-grants-write" rule приводит к тому, что LLM, прочитав `cache/index.ts` как контекст, переписывает его. Все T4/T6/T7/T9 (hono) модифицировали одни файлы:
- `stream.ts` — `abort()` стал async (breaking change)
- `cache/index.ts` — 167 строк → 42 (полная замена логики)

**Фикс:**
- Ограничить write scope только к файлам, **явно названным в task description** (убрать RAG-retrieved файлы из allowed write set)
- Или: добавить pre-flight check "файл уже существует с другой логикой → warn LLM"

### #3 ВЫСОКИЙ: Pre-existing TypeScript errors блокируют commit (17%)

trpc и другие monorepos содержат pre-existing TS errors:
- Workspace links не настроены (test files не могут найти `node-http.js`)
- vitest globals не typed (`mockImplementation`, `it`, `describe` без types)
- Generated files отсутствуют (`client.gen.ts`)

TypeChecker.runOn() уже фильтрует errors по изменённым файлам, но `applyAndCheckTs` pre-check DOESN'T filter — использует `typeChecker.runOn()` который должен фильтровать, НО в данном случае ошибки в тест-файлах появляются из-за incomplete workspace setup.

**Фикс:**
- Перед запуском задачи: запустить baseline tsc check и записать pre-existing errors → игнорировать их при validation
- Или: skip tsc на `__tests__/` и `test/` файлах которые Coder не трогал

### #4 СРЕДНИЙ: Reviewer reject (11%)

T8 (hono) и TT6 (trpc) были отклонены после 3 попыток Fixer. Детали:
- T8: LLM создал 9 файлов но качество кода не прошло review
- TT6: LLM создал 4 файла (retry logic в dataLoader) но Reviewer нашёл issues

**Фикс:** Улучшить Reviewer prompt для объяснения конкретных issues, а не generic "doesn't meet standards".

### #5 НИЗКИЙ: Planner LLM parse fail (6%)

TT7: Planner сгенерировал невалидный JSON ("Bad escaped character in JSON at position 4268"). Для сложных задач (L3: Cloudflare Workers adapter) Planner генерирует большой JSON с описаниями steps, и LLM производит escaped chars которые не валидны в JSON.

**Фикс:** Добавить JSON repair / retry в Planner output parsing.

### #6 БАГ ИСПРАВЛЕН: Promise.race([]) hang

TT4 завис на `Promise.race([])` (empty array) когда step2 был синхронно скипнут без добавления в inFlight. Fix применён в `packages/agents/src/orchestrator.ts` line 455-459.

---

## Сравнение с baseline

| Метрика | Sandbox baseline | hono real-world | trpc real-world |
|---------|-----------------|-----------------|-----------------|
| Success rate | **87-90%** | **0%** | **0%** |
| Context overflow | ~0% | 33% | 33% |
| LLM scope issues | ~0% | 44% | 0% |
| Workspace/pre-existing | ~0% | 11% | 28% |

**Разрыв критический.** Sandbox работает на ~20-50 файлах где контекст никогда не превышает лимит. На реальных 100-700 файловых репо — система не производит ни одного коммита.

---

## Приоритет фиксов для Дней 2-3

| # | Фикс | Impact | Файлы | День |
|---|------|--------|-------|------|
| 1 | Truncate read_file (≤150 lines) | -33% overflow | `task-agents/runner.ts`, `tool-calling-coder.ts` | 2 |
| 2 | Reduce HISTORY_KEEP_TAIL 16→8 | -20% overflow | `tool-calling-fixer.ts` | 2 |
| 3 | Strict write scope (no RAG files) | -22% destructive edits | `task-agents/feature.ts` | 2 |
| 4 | Baseline tsc pre-check (skip pre-existing errors) | -17% precheck_fail | `orchestrator.ts`, `type-checker.ts` | 2-3 |
| 5 | JSON repair в Planner | -6% parse_fail | `planner.ts` | 3 |
| 6 | ✅ Promise.race([]) fix | bug eliminated | `orchestrator.ts` | DONE |
