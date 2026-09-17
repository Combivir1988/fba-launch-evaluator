# Implementation Plan: FBA Launch Evaluator (веб-приложение)

**Branch**: `main` (проект `fba-launch-evaluator/`, собственный git-репозиторий) | **Date**: 2026-09-17 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `fba-launch-evaluator/specs/001-fba-launch-evaluator/spec.md`

## Summary

Одностраничное веб-приложение на русском, воспроизводящее скилл `fba-launch-evaluator`: пользователь загружает Helium 10 Xray/Cerebro CSV (+ опционально POE JSON, SQP CSV), вводит экономические переменные; браузер детерминированно считает Критерий 1 (1a–1h), Gate 1/2, критерии 3–8, scorecard, стоп-вопросы урока 07, бюджет урока 08, распределение трафика урока 09 и рисует интерактивный дашборд (Chart.js, ползунки с мгновенным пересчётом). Один Node/Express-сервер раздаёт статику и проксирует **только AI-синтез** в Claude (`@anthropic-ai/sdk`, `claude-opus-5`, structured outputs, SSE-стрим), защищён общим паролем. История — IndexedDB + экспорт/импорт JSON; дашборд скачивается автономным HTML и JSON. Деплой — Dockerfile на Render Free (плюс конфиги Railway/HF Spaces).

## Technical Context

**Language/Version**: Node.js 22 LTS (сервер, тесты), браузерный JavaScript ES2022 (ES-модули, без транспиляции)
**Primary Dependencies**: `express` 4, `@anthropic-ai/sdk` (актуальная), `chart.js` 4 (UMD, вендорится), `papaparse` 5 (вендорится); dev: нет (тесты — встроенный `node:test`)
**Storage**: IndexedDB в браузере (история), файлы JSON/HTML (экспорт); сервер без состояния
**Testing**: `node --test` на фикстурах из реальных экспортов (`tests/fixtures/`), smoke-тест сервера с `MOCK_AI=1`
**Target Platform**: Linux-контейнер (Render Free / Railway / HF Spaces), браузеры Chromium/Firefox/Safari последних 2 версий, ширина ≥ 360 px
**Project Type**: web-service (статика + тонкий API) в одном пакете
**Performance Goals**: разбор Xray ≤ 500 строк + Cerebro ≤ 10 000 строк < 5 с; пересчёт по ползунку ≤ 100 мс; первый байт SSE от AI < 5 с после запроса
**Constraints**: ноль платной инфраструктуры; ключ Claude только в env сервера; без сборочного шага; автономный HTML без внешних запросов; тёмная/светлая тема
**Scale/Scope**: 1–3 оператора; десятки анализов в истории; ~15 секций дашборда; ~12 расчётных модулей

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

`.specify/memory/constitution.md` — незаполненный шаблон (принципы не ратифицированы). Применены общие гейты Spec Kit:

| Гейт | Статус | Комментарий |
|---|---|---|
| Простота (минимум проектов) | ✅ | Один пакет `fba-launch-evaluator/`, один сервер, без сборки |
| Тестируемость ядра | ✅ | Расчёты — чистые ESM-функции в `shared/`, тестируются `node:test` на реальных фикстурах |
| Нет лишних абстракций | ✅ | Нет ORM/БД/фреймворка на фронте; IndexedDB-обёртка ≤ 50 строк |
| Безопасность секретов | ✅ | Ключ AI в env; пароль доступа; `.env` в `.gitignore` |
| Наблюдаемость | ✅ | Структурные логи запросов к `/api/analyze` (модель, токены, длительность, без содержимого) |

Post-design re-check: без изменений, нарушений нет.

## Project Structure

### Documentation (this feature)

```text
fba-launch-evaluator/specs/001-fba-launch-evaluator/
├── spec.md
├── plan.md              # этот файл
├── research.md          # Phase 0
├── data-model.md        # Phase 1
├── quickstart.md        # Phase 1
├── contracts/
│   ├── api.md                   # HTTP/SSE контракт сервера
│   ├── ai-verdict.schema.json   # JSON Schema ответа Claude (structured outputs)
│   └── analysis.schema.md       # формат документа анализа / экспорта истории
├── checklists/requirements.md
└── tasks.md             # Phase 2 (/speckit-tasks)
```

### Source Code (`fba-launch-evaluator/`)

```text
fba-launch-evaluator/
├── package.json                 # "type": "module"; scripts: start, test, vendor
├── server/
│   ├── index.js                 # Express: статика, auth, rate-limit, /api/*
│   ├── auth.js                  # X-App-Token vs APP_PASSWORD (timingSafeEqual)
│   ├── claude.js                # вызов SDK: stream + structured output + fallbacks + mock
│   ├── prompt.js                # системный промпт (методология) + сборка user-payload
│   └── log.js
├── shared/                      # чистое расчётное ядро (ESM, браузер + node)
│   ├── thresholds.js            # пороги по умолчанию (редактируемые)
│   ├── num.js                   # нормализация чисел/дат (европейский формат, N/A, >100,000)
│   ├── parse-xray.js
│   ├── parse-cerebro.js
│   ├── parse-poe.js
│   ├── parse-sqp.js
│   ├── criterion1.js            # 1a–1h + итог N/8
│   ├── economics.js             # Gate 1/2, ROI, 2a–2k, маржа без/с рекламой
│   ├── budget.js                # урок 08 + стоп-вопросы урока 07
│   ├── traffic.js               # урок 09 (кластер, топ-2, ≥30 ключей) + урок 11 (POE click share)
│   ├── competition.js           # доли брендов, барьер отзывов, contamination, критерий 5
│   ├── challenger.js            # критерии 3–8, статусы 🟢🟡🔵⚪, итог 6/8 + обязательные 6 и 8
│   ├── scorecard.js             # 5 осей + итог %
│   ├── verdict-rules.js         # детерминированный вердикт по гейтам + согласование с AI
│   ├── ai-payload.js            # агрегаты → компактный JSON для Claude
│   └── analysis.js              # сборка/версия документа Analysis, миграции схемы
├── public/
│   ├── index.html               # SPA: панель ввода, дашборд, история, настройки
│   ├── css/app.css              # темы (light/dark), сетка, компоненты
│   ├── js/
│   │   ├── app.js               # состояние, маршрутизация вкладок, связывание ползунков
│   │   ├── files.js             # загрузка файлов → PapaParse → shared/parse-*
│   │   ├── ai.js                # fetch SSE /api/analyze, прогресс, валидация
│   │   ├── history.js           # IndexedDB CRUD, экспорт/импорт
│   │   ├── export.js            # standalone HTML + JSON
│   │   ├── charts.js            # обёртки Chart.js (палитра dataviz, темы)
│   │   ├── render.js            # классический скрипт window.FBARender (используется и экспортом)
│   │   └── i18n.ru.js           # строки интерфейса
│   └── vendor/                  # chart.umd.js, papaparse.min.js (коммитятся)
├── tests/
│   ├── fixtures/                # Xray/Cerebro 2026-08-21, POE urinal screen 2026-09-15
│   ├── num.test.js, parse-xray.test.js, parse-cerebro.test.js, parse-poe.test.js
│   ├── criterion1.test.js, economics.test.js, budget.test.js, challenger.test.js
│   ├── verdict-rules.test.js, ai-payload.test.js
│   └── server.test.js           # health, 401, MOCK_AI e2e
├── scripts/vendor.js            # копирует UMD-сборки из node_modules в public/vendor
├── Dockerfile
├── render.yaml
├── railway.json
├── .env.example
├── .gitignore
└── README.md
```

**Structure Decision**: один пакет без разделения на backend/frontend-подпроекты — сервер тонкий (2 эндпоинта), а всё ядро (`shared/`) общее для браузера и тестов; это исключает дублирование формул (тот же принцип «один рдзень», что и в спеках 027/028 дашборда).

## Ключевые решения (D1–D8)

- **D1 — Расчёты в браузере, AI только синтез.** Файлы не покидают устройство (в Claude уходит компактный агрегат ≤ 10 k токенов). Пересчёт ползунков — чистые функции без сети (FR-013).
- **D2 — Одно расчётное ядро `shared/`** для UI, экспорта и тестов; пороги — данные (`thresholds.js`), не код, редактируются в UI и сохраняются в анализе.
- **D3 — Structured outputs + правила согласования.** Claude возвращает JSON по схеме; `verdict-rules.js` независимо выводит «потолок» вердикта из гейтов и понижает AI-вердикт при конфликте (FR-015), флаг `adjustedByRules`.
- **D4 — SSE-стрим** `/api/analyze`: события `thinking` (сводка размышлений), `delta` (JSON по мере генерации, только для индикатора), `done` (валидированный объект + usage), `error`.
- **D5 — Критерий 2 только от менеджера.** UI не подставляет оценок COGS; пока пусто — ⚪ и «прикидка», не гейт (FR-008).
- **D6 — История в IndexedDB, схема `analysis.schemaVersion=1`** с миграциями в `shared/analysis.js`; экспорт всей истории — один JSON.
- **D7 — Автономный HTML = статический снимок** (Chart.js + render.js + данные инлайн); интерактивность восстанавливается импортом JSON.
- **D8 — Безопасность:** пароль доступа, rate-limit, CSP без inline-скриптов в приложении, лог без содержимого запросов.

## Complexity Tracking

Нарушений Constitution Check нет — таблица не требуется.

## Phase 0 → research.md ✅ · Phase 1 → data-model.md, contracts/, quickstart.md ✅ · Phase 2 → /speckit-tasks
