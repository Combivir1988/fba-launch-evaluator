# Tasks: FBA Launch Evaluator (веб-приложение)

**Input**: Design documents from `fba-launch-evaluator/specs/001-fba-launch-evaluator/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/

**Tests**: расчётное ядро покрывается `node:test` (требование spec SC-002, research R9) — тесты пишутся **перед** реализацией соответствующего модуля и должны падать до неё.

**Organization**: задачи сгруппированы по user stories; пути — относительно `fba-launch-evaluator/`.

## Format: `[ID] [P?] [Story] Description`

## Phase 1: Setup

- [x] T001 Инициализировать пакет: `package.json` (`"type":"module"`, scripts `start`/`test`/`vendor`), зависимости `express`, `@anthropic-ai/sdk`, `chart.js`, `papaparse`; `.gitignore`, `.env.example`, `README.md`
- [x] T002 [P] `scripts/vendor.js` — копирование `chart.umd.js`, `papaparse.min.js` в `public/vendor/`; выполнить и закоммитить вендоры
- [x] T003 [P] Фикстуры: скопировать `Helium_10_Xray_2026-08-21.csv`, `US_AMAZON_cerebro__2026-08-21.csv`, `POE_urinal_screen_deodorizer_2026-09-15.json` в `tests/fixtures/`
- [x] T004 [P] Деплой-конфиги: `Dockerfile` (node:22-alpine, `npm ci --omit=dev`, `PORT`), `render.yaml` (free, healthCheckPath `/api/health`), `railway.json`

## Phase 2: Foundational

- [x] T005 `shared/thresholds.js` — пороги по умолчанию (R7) + `methodologyVersion`
- [x] T006 [P] `tests/num.test.js` → `shared/num.js`: `toNum` («69,95», «6 892», «>100,000», «N/A», «-»), `parseDateEn` («Aug 22, 2017»), `median`, `pct`
- [x] T007 [P] `shared/analysis.js` — `newAnalysis()`, `migrate()`, `slug()`; `shared/ai-payload.js` каркас
- [x] T008 `server/index.js` + `server/auth.js` + `server/log.js` — Express, статика `public/` и `shared/`, `/api/health`, `/api/auth/check`, `X-App-Token`, rate-limit, CSP, лимит тела 1 МБ; `tests/server.test.js` (health 200, analyze 401 без токена, 503 без APP_PASSWORD)
- [x] T009 `public/index.html`, `public/css/app.css` (темы light/dark, палитра dataviz как CSS-переменные, сетка, компоненты: tile/gate/chip/verdict/slider), `public/js/i18n.ru.js`, экран входа (пароль → localStorage → `/api/auth/check`)

## Phase 3: US1 — Оценка ниши по файлам и вердикт (P1) 🎯 MVP

- [x] T010 [P] [US1] `tests/parse-xray.test.js` → `shared/parse-xray.js` (BOM, европейские числа, дубли ASIN, иерархия Display Order, contamination-кандидаты)
- [x] T011 [P] [US1] `tests/parse-cerebro.test.js` → `shared/parse-cerebro.js` (ASIN-строки, брендовые фразы, `>100,000`, автокластер по словам core-ключа)
- [x] T012 [P] [US1] `tests/parse-poe.test.js` → `shared/parse-poe.js` (schemaVersion 1, строковые числа, launchPotential current/qoq/yoy, trends, pdr, insights → текст); `shared/parse-sqp.js`
- [x] T013 [US1] `tests/criterion1.test.js` → `shared/criterion1.js` (1a–1h, статусы ok/warn/fail/na, прокси POE, manualOverrides, `okCount` только по ok, `proxyDelta` при появлении Xray/Cerebro)
- [x] T014 [P] [US1] `shared/competition.js` (доли брендов, top-5, барьер отзывов, игроки >100 отзывов, Amazon-продавец) + `shared/traffic.js` (кластер, Adj. SV, топ-2, ≥30 ключей, POE concentration) + тесты
- [x] T015 [US1] `shared/challenger.js` (критерии 3–8, статусы, обязательные 6/8) + `shared/scorecard.js` + `shared/verdict-rules.js` (потолок вердикта, `reconcile(ai, results)`) + `tests/verdict-rules.test.js`
- [x] T016 [US1] `public/js/files.js` — загрузка файлов, PapaParse, вызов парсеров, выбор ключей кластера (чекбоксы), исключение брендов; `public/js/app.js` — состояние Analysis, `compute()`, привязка к UI
- [x] T017 [US1] `public/js/charts.js` + `public/js/render.js` — секции дашборда: обзор (KPI), Критерий 1 (таблица-гейт + итог), конкуренты (bar + таблица топ-20, подсветка «мой SKU»), ценовые сегменты, запросы (топ-20), сезонность (line по trends), структура ниши, отзывы (diverging bar), scorecard (radar), сверка источников
- [x] T018 [US1] `server/prompt.js` (системный промпт: методология скилла + уроки курса + правила вывода; `cache_control`) + `server/claude.js` (`messages.stream`, `output_config.format` json_schema из `contracts/ai-verdict.schema.json`, adaptive thinking summarized, fallbacks с повтором без беты, типизированные ошибки → коды SSE) + `server/mock-verdict.js` + маршрут `POST /api/analyze` (SSE)
- [x] T019 [US1] `public/js/ai.js` — fetch + чтение SSE, прогресс (thinking/delta), `reconcile()` с результатами, блок AI-вердикта/рекомендаций/дифференциации в `render.js`, кнопка «Повторить»
- [x] T020 [US1] `tests/ai-payload.test.js` → `shared/ai-payload.js` (компактный агрегат ≤ ~10k токенов: топ-20 ASIN, топ-20 запросов, 10+10 тем, гейты, inputs) + `tests/server.test.js` e2e с `MOCK_AI=1`

**Checkpoint**: файлы → дашборд → AI-вердикт работает end-to-end.

## Phase 4: US2 — Живая экономика и бюджет (P1)

- [x] T021 [P] [US2] `tests/economics.test.js` (Jitsu 12-pack vs 48-pack, дешёвый сегмент <$25, Критерий 2 ⚪ без COGS, маржа без/с рекламой) → `shared/economics.js`
- [x] T022 [P] [US2] `tests/budget.test.js` (примеры урока 08: 7$×10×60=4200×2; 10$×10×90=9000×2; стоп-вопросы урока 07; ROI-подсказки урока 10) → `shared/budget.js`
- [x] T023 [US2] Панель «Экономика и бюджет» в `index.html`/`app.js`: поля + ползунки (CVR, PPC share, цена, COGS, CPC), мгновенный пересчёт (`requestAnimationFrame`, без сети), график «Net after ads vs CVR», статусы Gate 1/2, таблица 2a–2k, бюджет двух партий, стоп-вопросы; панель «Пороги»

**Checkpoint**: ползунки меняют графики/статусы ≤100 мс; Критерий 2 пуст без COGS.

## Phase 5: US3 — История и экспорт (P2)

- [x] T024 [P] [US3] `public/js/history.js` — IndexedDB (store `analyses`), list/get/put/delete, автосохранение после `compute()`/AI, экспорт одного/всех, импорт без дублей (по `id`+`updatedAt`), вкладка «История» с поиском
- [x] T025 [P] [US3] `public/js/export.js` — JSON анализа; автономный HTML (inline CSS + `vendor/chart.umd.js` + `render.js` + данные, `FBARender.render(..., {static:true})`); имена файлов `FBA_<slug>_<date>`
- [x] T026 [US3] Восстановление из истории: `migrate()` → `compute()` → рендер, пометка `ai.staleSince` при изменении входов, подтверждение перезаписи vs «сохранить как новую версию»

## Phase 6: US4 — Чеклист рисков (P3)

- [x] T027 [US4] Панель «Риски и compliance» (уроки 03/04/11/12/13/14): поля Checklist из data-model; влияние на критерии 7/8 (статусы 🟢🟡🔵⚪), 1e (Amazon-продавец), ось Operational Risk; ссылки USPTO / Google Patents / WIPO / Compliance Reference / Sales Estimator
- [x] T028 [US4] Секция «Критерии 3–8» в дашборде: таблица со статусами, обязательные 6/8, итог «N из 8», предупреждение «Gate 4 не обсуждён»

## Phase 7: Polish

- [x] T029 [P] `README.md` (рус.: назначение, запуск, деплой Render/Railway/HF, env, стоимость AI) + `specs/.../quickstart.md` актуализация
- [x] T030 [P] Адаптив ≤ 360 px, тёмная тема всех графиков, `prefers-reduced-motion`, aria для ползунков
- [x] T031 Прогон quickstart.md вручную (локально, MOCK_AI и, при наличии ключа, реальный вызов); `npm test` зелёный
- [x] T032 Git: собственный репозиторий `fba-launch-evaluator` (private), первый коммит + push; внешний репо — `.gitignore` + `CLAUDE.md` активная спека

## Отклонения от плана (зафиксировано при реализации 2026-09-17)

- `public/js/charts.js` и `public/js/i18n.ru.js` не создавались: обёртки Chart.js живут внутри `render.js` (нужно для инлайна в автономный HTML), строки интерфейса — прямо в шаблонах (UI только русский).
- Добавлен `shared/compute.js` (оркестратор) и `shared/validate-verdict.js`; схема AI-ответа — `shared/ai-verdict.schema.json` (копия в contracts/).
- Быстрые ползунки вынесены в отдельную секцию дашборда `quick`, которая не перерисовывается при пересчёте (иначе браузер терял drag).
- Тесты: 42 (`node --test`), включая DOM-smoke рендера через jsdom (devDependency) и e2e сервера в `MOCK_AI=1`. Живой вызов Claude локально не проверялся — ключа в среде нет (T031 частично: quickstart прогнан в MOCK).
- T024–T026 (история), T027–T028 (чеклист), T030 (адаптив/тёмная тема) реализованы; проверка в реальном браузере — за хозяином (в среде нет браузера).

## Dependencies

Setup → Foundational → US1 (T010–T012 ∥, затем T013–T015, затем UI T016–T019, T020) → US2 (T021/T022 ∥ → T023) → US3 (T024/T025 ∥ → T026) → US4 → Polish. US2 расчётные модули (T021/T022) не зависят от US1 и могут идти параллельно с T010–T015.

## Implementation Strategy

MVP = Phase 1–3 (US1) + T021–T023 (US2, ползунки — явное требование хозяина). Затем US3 (история/экспорт), US4, polish. Коммит после каждой фазы.

## Дополнения после релиза (2026-09-18)

- OpenRouter как основной AI-провайдер (`server/openrouter.js`), выбор модели в UI, стоимость запроса.
- Правила Cerebro: multi-ASIN (Ranking Competitors ≥ N), порог SV, Keyword Sales, сортировки.
- **Патентный скан** (`server/patents.js`, `POST /api/patents/scan`): AI-запросы → Google Patents XHR (поиск GRANT/APPLICATION/DESIGN, карточки с abstract/claims/датами/статусом) → AI-оценка пересечения по независимым claims → секция «Патенты / FTO»; критерий 8 получает 🟡 «допущение» (никогда 🟢 автоматически), `mandatoryOk` требует подтверждения человеком; conflict → потолок No-Go. Тесты: `tests/patents.test.js` (парсер на реальной карточке US9309657B2, mock-скан, интеграция с критерием 8). PatentsView API из среды недоступен (DNS), поэтому источник — Google Patents.
- Фоновые задачи (`server/jobs.js`, SSE replay, восстановление после F5), нормализация ответов слабых моделей, детерминированные статусы гейтов в AI-блоке, вкладка «Настройки» (модели для AI и патентов), человеческие подписи порогов, сворачиваемая панель, no-cache для статики, graceful shutdown + Railway draining/overlap 300 с. Деплой — только при `/api/health.running = 0`.

## Дополнение 2026-09-20 — Google AI Studio как источник бесплатных моделей

- [x] `server/openrouter.js`: `endpointFor(model, cfg)` — модели с префиксом `aistudio/` идут напрямую в Google AI Studio (OpenAI-совместимый эндпоинт, ключ `GOOGLE_AI_STUDIO_KEY`), без шага strict-схемы (Google отвечает 400) и без полей `usage`/`reasoning`; понятные сообщения для 429 (лимит) и 503 (перегрузка). Причина: OpenRouter снял бесплатный DeepSeek, а общий бесплатный пул Gemma/Qwen/Nemotron на нашем запросе отвечал 429/503/таймаутом (замеры 2026-09-20). Результат замера: `aistudio/gemini-3.5-flash-lite` — вердикт за 5–6 с (3 из 3), патентный скан за 22 с; Gemma 4 и старшие Flash на бесплатном уровне — 429/503.
- [x] `tests/aistudio.test.js` (5 тестов); подпись в «Настройках»: «бесплатно, Google AI Studio (быстро)».

## Дополнение 2026-09-20 — подсказка CVR из SQP

- [x] `shared/cvr-hint.js`: конверсия «клик → покупка» из Search Query Performance (покупки / клики, взвешенно по кликам) — по рынку и по ASIN продавца; отбор запросов: кластер → главный ключ → весь отчёт; пометка малой выборки (< 200 кликов рынка, < 50 своих). CVR по умолчанию остаётся 10 % (допущение курса); подсказка сама ничего не меняет — кнопка «подставить» под ползунком. «Purchase rate %» из SQP и «конверсия поиска» POE не используются: это покупки на объём поиска.
- [x] `shared/parse-sqp.js` читает `Clicks: ASIN Count`; `compute.js` → `results.cvrHint` + сверка в примечании 2c; `ai-payload.js` → `cvrHint`; панель `#cvr-hint`; справка; `tests/cvr-hint.test.js` (4), фикстура `SQP_synthetic_urinal_screen.csv` (синтетическая), проба `scripts/ui-probe10.mjs`.
