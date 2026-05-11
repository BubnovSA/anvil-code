# Sprint 7 Days — Production-Ready на 100 файлах

> **Старт:** 2026-05-12 (следующая сессия)
> **Финиш:** 2026-05-18 (воскресенье)
> **Главная цель:** Система стабильно работает на 100-файловых реальных репо + scaffold from spec + VSCode extension как primary UX

---

## Прогресс (обновлять каждый день)

| День | Статус | Ключевой результат |
|---|---|---|
| 1 — Диагностика | ⬜ | failure patterns на реальном репо |
| 2 — Build + Rules | ⬜ | npm run build в pipeline, .claude/rules.md |
| 3 — Cumulative pipeline | ⬜ | 10 задач автономно без ручного merge |
| 4 — Scaffold mode | ⬜ | "создай проект" → working build |
| 5 — VSCode extension | ⬜ | full workflow только через extension |
| 6 — Benchmark + cleanup | ⬜ | 15 задач на 2 реальных репо, README |
| 7 — Release | ⬜ | v1.40 tagged + GitHub public |

**Легенда:** ⬜ pending · 🔄 in progress · ✅ done · ❌ blocked

---

## Метрики (baseline → цель)

| Метрика | Сейчас | Цель Day 7 |
|---|---|---|
| 1-4 файла success rate | 87-90% | ≥95% |
| 100-файловый реальный репо | 83% | ≥88% |
| Логические баги (тесты ловят) | ~50% | ≥75% |
| Cumulative pipeline | ручной | автономный |
| Scaffold "create project" | нет | working |
| Build validation | tsc только | npm build |
| VSCode workflow | partial | production |
| Setup time (новый пользователь) | ~60 мин | ≤20 мин |

---

## День 1 — Диагностика на реальном коде

**Цель:** точно знать что ломается на 100+ файлах, не гадать.

### Checklist
- [ ] Выбрать 2 реальных open-source TypeScript репо (предпочтительно 100-300 файлов)
- [ ] Зарегистрировать оба как project через POST /project
- [ ] Проиндексировать (POST /index)
- [ ] Прогнать по 8-10 задач на каждом (смешать L1-L3 уровни)
- [ ] Записать результаты в `docs/benchmarks/runs/YYYY-MM-DD-real-repo-diagnostic.md`
- [ ] Составить таблицу паттернов: LLM parse fail / Reviewer reject / tsc fail / validation fail / no-op

**НЕ переходить к Дню 2 пока нет таблицы паттернов.**

### Кандидаты для real repos
- `fastify/fastify` (~250 TS файлов) — хорошо знаем
- `honojs/hono` (~180 TS файлов)
- `trpc/trpc` (~200 TS файлов)
- Любой другой popular TypeScript проект с vitest/jest

---

## День 2 — Build Validation + Rules File

**Цель:** `npm run build` в pipeline + convention rules всегда применяются.

### Checklist
- [ ] `TestRunner` или отдельный `BuildRunner`: запускать `npm run build` после tsc
- [ ] `.claude/rules.md` поддержка: если файл есть в проекте — всегда включать в контекст
- [ ] Дефолтный шаблон `.claude/rules.md` при регистрации нового project
- [ ] Bench: те же задачи что в День 1, сравнить результат

### Дефолтный .claude/rules.md шаблон
```markdown
# Project Rules (auto-included in every task)

## TypeScript
- strict mode always on
- NodeNext module resolution — .js suffix in ALL imports
- No implicit any

## Code quality
- Error handling for all async operations
- 404 for not-found resources, 400 for validation errors
- No TODO comments in committed code

## Build
- Project must build (npm run build) after every change
- All tsc errors must be resolved — no @ts-ignore without justification

## Testing
- New endpoints need integration tests
- New service methods need unit tests
```

---

## День 3 — Cumulative Pipeline Auto

**Цель:** цепочка из 10 задач выполняется полностью автономно.

### Checklist
- [ ] Worker: после successful commit — авто-merge auto-branch в main
- [ ] Worker: следующая задача стартует только после merge
- [ ] Обработка merge conflicts: Fixer пробует resolve, если нет — task marked as blocked
- [ ] Test: запустить cumulative chain из 10 задач без вмешательства
- [ ] Bench: cumulative 10/10 успех rate

---

## День 4 — Scaffold Mode

**Цель:** "создай проект с нуля по спецификации" → working, building code.

### Checklist
- [ ] Planner prompt: распознавать scaffold-задачи (ключевые слова: "создай проект", "scaffold", "from scratch", "с нуля")
- [ ] Scaffold Planner: генерировать 15-25 шаговый план с правильной последовательностью (types → services → routes → tests → server)
- [ ] Каждый шаг видит что создано в предыдущих (`previousChanges` уже работает)
- [ ] Последний шаг: verify build (`npm run build`)
- [ ] Test: дать 3 разных scaffold-задачи, оценить качество результата

### Примеры scaffold задач для теста
```
"Создай REST API для очереди задач. Stack: Fastify + TypeScript.
Endpoints: POST /jobs, GET /jobs/:id, GET /jobs (list с filter by status).
In-memory queue. Должен строиться и иметь базовые тесты."
```

---

## День 5 — VSCode Extension Production UX

**Цель:** полный workflow от задачи до коммита только через VSCode.

### Checklist
- [ ] Task input: rich input с dropdown для mode (fast/balanced/deep) и project selection
- [ ] Live streaming: SSE events → OutputChannel в real-time (сейчас может быть базовый)
- [ ] Result view: после completion — показать diff, commit hash, file count
- [ ] Accept/Reject buttons: merge auto-branch или delete
- [ ] Index command: re-index прямо из extension с progress bar
- [ ] Error display: человекочитаемые сообщения об ошибках
- [ ] Test: полный workflow без открытия терминала

---

## День 6 — Benchmark + Cleanup

**Цель:** задокументированные результаты + проект понятен новому человеку.

### Checklist — Benchmark
- [ ] 15 задач на Repo 1 (из Дня 1), записать результаты
- [ ] 15 задач на Repo 2 (из Дня 1), записать результаты
- [ ] Создать `BENCHMARK.md` с честными данными и примерами
- [ ] Сравнить с baseline из Дня 1 — измеримый прогресс

### Checklist — Code Cleanup
- [ ] Удалить debug/temp файлы накопившиеся за разработку
- [ ] Проверить что все design docs закрыты или актуальны
- [ ] Убрать commented-out код, TODO без контекста
- [ ] Унифицировать error messages

### Checklist — Docs
- [ ] `README.md` rewrite: what it does, 5-min quickstart, what it can/can't do
- [ ] `docs/SETUP.md`: llama-swap setup, рекомендуемые модели, железо
- [ ] `docs/ARCHITECTURE.md`: как работает pipeline (для контрибьюторов)
- [ ] `.env.example`: каждая переменная с описанием

---

## День 7 — Final Release

**Цель:** v1.40 public, задокументированный, с benchmark data.

### Checklist
- [ ] Final comprehensive bench: 20 задач на 2 реальных репо
- [ ] Все чеклисты дней 1-6 закрыты
- [ ] `git tag v1.40`
- [ ] `git push origin main --tags`
- [ ] GitHub: Settings → Make public
- [ ] Smoke test: новый пользователь (свежая среда) поднимает за ≤20 минут

---

## Правила спринта

1. **Данные прежде правок** — каждый день начинается с bench, заканчивается bench
2. **Один фокус в день** — не переключаться на другие темы в середине дня
3. **Не переходить к следующему дню** пока checklist текущего не закрыт ≥80%
4. **Bench числа фиксируются** — no vibes, только цифры
5. **Если что-то занимает больше дня** — урезать scope, не растягивать

---

## Стек и конфиг (не менять без причины)

```
LLM_LARGE_MODEL=gemma          # gemma-4-26b-a4b-it-mxfp4-moe-ctx-32k
LLM_SMALL_MODEL=qwen3          # для Reviewer/Planner
TOOL_CALLING_CODER=true
TESTER_ENABLED=true            # починено в v1.37
RAG_MAX_CONTEXT_TOKENS=3000    # работает на 94+ файлах
COMMIT_ONLY_IF_VALID=true
```
