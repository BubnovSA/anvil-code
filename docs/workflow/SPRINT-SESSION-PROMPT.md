# Промпт для новой сессии спринта

> Копировать целиком в начало каждой сессии. Менять только ТЕКУЩИЙ ДЕНЬ и СТАТУС.

---

```
Проект: RAG System v1.37 — 7-Day Production Sprint
Репо: /Users/admin/Documents/work/rag-system (ветка main, HEAD: 04f95dc)
GitHub: https://github.com/BubnovSA/rag-system-for-dev
Sandbox: /Users/admin/Documents/work/rag-system-sandbox
Стек: Turborepo, 12 TS пакетов, Gemma 4 26B via llama-swap @ 172.20.10.4:8080

═══════════════════════════════════════════════════════════
ТЕКУЩИЙ ДЕНЬ: 1 / 7
ТЕМА: Диагностика на реальном коде
═══════════════════════════════════════════════════════════

SPRINT ПЛАН: docs/workflow/SPRINT-7DAY.md
CHECKLIST СЕГОДНЯ: читать из SPRINT-7DAY.md → секция "День N"

КОНТЕКСТ ПРОЕКТА:
RAG System — локальный AI-ассистент для TypeScript проектов. Принимает задачу
на естественном языке → анализирует кодовую базу через RAG → пишет изменения →
валидирует (tsc + tесты) → делает git commit. Всё локально, без облака.

ТЕКУЩИЕ ВОЗМОЖНОСТИ (доказано бенчами):
- 1-4 файла: ~87-90% корректных коммитов
- 100-файловый реальный репо: ~83% (Gemma + RAG_MAX=3000)
- TESTER_ENABLED=true: работает, 28/28 vitest тестов в последнем тесте
- Cumulative mode: 5/6 но требует ручного merge — ФИКСИРУЕМ в День 3

КОНФИГ (не менять без причины):
- LLM_LARGE_MODEL=gemma (gemma-4-26b-a4b-it-mxfp4-moe-ctx-32k-q8-0-kv-t07)
- LLM_SMALL_MODEL=qwen3
- TOOL_CALLING_CODER=true, TESTER_ENABLED=true
- RAG_MAX_CONTEXT_TOKENS=3000, COMMIT_ONLY_IF_VALID=true

ПРАВИЛО: Каждый день начинается с bench, заканчивается bench.
НЕ переходить к следующему дню пока checklist текущего не закрыт ≥80%.

═══════════════════════════════════════════════════════════
ЗАДАЧА ЭТОЙ СЕССИИ (День N):
[вставить задачу дня из SPRINT-7DAY.md]
═══════════════════════════════════════════════════════════

С ЧЕГО НАЧАТЬ:
1. Прочитать SPRINT-7DAY.md целиком
2. Найти секцию "День N" 
3. Открыть checklist и работать по нему сверху вниз
4. Каждый пункт отмечать [x] сразу после выполнения
5. В конце сессии обновить таблицу прогресса в SPRINT-7DAY.md

API контракт: POST /task с {task, mode:"balanced", project:"<id>"}
Cleanup sandbox перед каждым бенчем:
  git -C /Users/admin/Documents/work/rag-system-sandbox checkout main
  git -C /Users/admin/Documents/work/rag-system-sandbox branch | grep "auto/" | \
    xargs git -C /Users/admin/Documents/work/rag-system-sandbox branch -D 2>/dev/null
```

---

## Как обновлять промпт между сессиями

После каждой сессии:
1. Поменять `ТЕКУЩИЙ ДЕНЬ: N` → `N+1`
2. Обновить статус в таблице SPRINT-7DAY.md (`⬜` → `✅`)
3. Добавить в секцию "КОНТЕКСТ ПРОЕКТА" ключевые изменения дня

## Пример промпта для Дня 2

```
ТЕКУЩИЙ ДЕНЬ: 2 / 7
ТЕМА: Build Validation + Rules File

НОВОЕ С ВЧЕРА:
- Реальный репо: fastify/fastify (248 файлов) — failure patterns задокументированы
- Главные проблемы: LLM parse fail на >150 файлах (40%), context noise
- Bench результат: 6/10 задач успешно (было 8.3/10 на sandbox)
- Run file: docs/benchmarks/runs/2026-05-12-real-repo-diagnostic.md
```
