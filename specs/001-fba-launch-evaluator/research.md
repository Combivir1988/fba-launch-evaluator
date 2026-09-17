# Research: FBA Launch Evaluator (веб)

**Date**: 2026-09-17 · **Spec**: [spec.md](spec.md)

## R1. Бесплатный хостинг

- **Decision**: Один Node-сервер (статика + `/api/*`), упакованный в Dockerfile. Целевой хост — **Render Free Web Service** (`render.yaml`, план `free`, health-check `/api/health`). Дополнительно: `railway.json` (Railway — Dockerfile-деплой) и совместимость с Hugging Face Spaces (Docker SDK, слушаем `PORT`, по умолчанию 7860 на HF / 3000 локально).
- **Rationale**: Railway с 2023 г. даёт лишь пробный кредит ($5 / 30 дней), затем Hobby $5/мес — не «бесплатно навсегда». Render Free: 750 ч/мес, засыпает через 15 мин простоя (холодный старт 30–60 с), без лимита длительности запроса — подходит для потокового AI-вызова 30–120 с. Serverless-варианты (Vercel/Netlify Functions) отброшены: таймауты функций 10–60 с рискованны для Opus-синтеза; Netlify MCP доступен, но модель «функция + статика» усложняет SSE.
- **Alternatives**: Fly.io (free allowance фактически убран), Deno Deploy (нужен Deno), Cloudflare Workers (CPU-лимит 30 мс free — не для SSE-прокси с ожиданием), Vercel Hobby с Fluid compute (300 с) — рабочий запасной вариант, но два деплой-профиля не нужны в v1.

## R2. Хранение истории

- **Decision**: **IndexedDB в браузере** (собственная обёртка ~50 строк, без зависимостей) + экспорт/импорт JSON (один анализ или вся история). Сервер не хранит ничего.
- **Rationale**: На Render Free файловая система эфемерна, бесплатный Postgres живёт 30 дней; внешние free-БД (Supabase/Neon/Turso) добавляют секреты и регистрацию. Личный инструмент одного оператора — локальное хранение + файл экспорта закрывает FR-021–023 и требование «загрузить историю». localStorage отброшен: лимит ~5 МБ, история с агрегатами Cerebro его превысит.
- **Alternatives**: Turso/libSQL free (500 МБ) — кандидат для v2 «синхронизация между устройствами» (бэклог).

## R3. Claude API

- **Decision**: Официальный SDK `@anthropic-ai/sdk`. Модель по умолчанию `claude-opus-5` (переопределяется `CLAUDE_MODEL`). Вызов — `client.messages.stream(...)` с `output_config.format = {type: "json_schema", schema}` (structured outputs, JSON-схема вердикта в `contracts/ai-verdict.schema.json`), `thinking: {type: "adaptive", display: "summarized"}` (сводка размышлений стримится в UI как прогресс), `output_config.effort` из env (`CLAUDE_EFFORT`, по умолчанию `high`), `max_tokens: 16000`. Системный промпт (методология скилла + правила вывода) — стабильный первый блок с `cache_control: {type: "ephemeral"}`; изменяемые данные ниши — в user-сообщении (prompt caching по префиксу). Ответ сервер ретранслирует клиенту как SSE-события (`thinking`, `delta`, `done`, `error`).
- **Fallbacks**: по умолчанию включён серверный `fallbacks: "default"` с бетой `server-side-fallback-2026-07-01` через `client.beta.messages.stream`; при 400 на неподдерживаемом сочетании — автоматический повтор без беты (`CLAUDE_FALLBACKS=0` отключает).
- **Валидация**: `parsed` JSON проверяется по схеме (ajv не нужен — достаточно ручной проверки обязательных полей) и **правилами согласованности** (`shared/verdict-rules.js`): не «Go» при Gate 1/2 NO-GO, при красных критериях 6/8, при Критерии 1 < 6/8 → максимум «Доработка». При расхождении — флаг `adjustedByRules` и оба значения.
- **Стоимость**: ~6–10 k входных токенов (агрегаты, топ-20 ASIN, топ-20 запросов, 10+10 тем отзывов, гейты) + ~2–3 k выходных ≈ $0.03–0.05 вход + $0.05–0.08 выход на Opus 5 → **$0.08–0.13/анализ**; при `CLAUDE_MODEL=claude-sonnet-5` ≈ $0.04. Ориентир SC-006 ($0.10) достижим на Opus при `effort: medium` или на Sonnet — выбор за оператором через env.
- **Rationale**: Structured outputs убирают парсинг «JSON из текста»; стриминг снимает риск таймаута; кэширование системного промпта (~4 k токенов) экономит ~90 % на повторных вызовах.
- **Alternatives**: `messages.parse()` (без стриминга — UI 60 с без прогресса), tool-use с `tool_choice` (не нужен: нет действий, только формат).

## R4. Фронтенд без сборки

- **Decision**: Vanilla JS, ES-модули (`public/js/*.js`), CSS-переменные для тем, **Chart.js 4 (UMD)** и **PapaParse** вендорятся в `public/vendor/` (копируются из `node_modules` скриптом `npm run vendor`, коммитятся). Расчётное ядро — `shared/*.js` (ESM), одно и то же для браузера (статика `/shared/`) и `node --test`.
- **Rationale**: Ноль сборки = ноль CI-шагов на бесплатном хосте, файлы можно править на месте. Chart.js покрывает line/bar/radar/doughnut/horizontal-bar; вендоринг обязателен для автономного HTML-экспорта (без CDN, FR-019).
- **Alternatives**: React+Vite (сборка, оверхед), Svelte (то же), ECharts (тяжелее, 1 МБ).

## R5. Автономный HTML-экспорт

- **Decision**: Рендер дашборда — классический скрипт `public/js/render.js` (`window.FBARender`), без import. Экспорт собирает файл: `<style>` (inline CSS), `<script>` Chart.js (текст из `/vendor/chart.umd.js`), `<script>` render.js, `<script>` `window.__FBA_DATA__ = {...}` и вызов рендера. Снимок статичен (ползунки отображают значения, но не пересчитывают); для интерактивности — импорт JSON обратно в приложение.
- **Rationale**: Инлайн ES-модулей с взаимными import невозможен без import-map/data-URL; статический снимок закрывает FR-019 (офлайн, те же цифры) при минимальной сложности.
- **Alternatives**: `window.print()` → PDF (дополнительно доступно через браузер, отдельного кода не нужно).

## R6. Парсинг файлов

- **Decision**: PapaParse (`header: true`, `skipEmptyLines`), затем нормализация значений: удаление BOM, ` `/пробел как разделитель тысяч → «», запятая → точка; `N/A`, `-`, `n/a`, `>100,000` → числовые `null`/нижняя граница с флагом. Xray: `drop_duplicates(ASIN)`; иерархия `Display Order` («3.», «3.1.») → родитель/вариация; `Parent Level Revenue` не суммируется по вариациям (берём `ASIN Revenue`). Cerebro: строки-ASIN (`^b0[a-z0-9]{8}$`) и фразы, содержащие бренд из Xray, помечаются `excluded` по умолчанию. POE: `schemaVersion === 1`, строковые числа → Number. SQP: пропуск первой служебной строки (`ASIN or Product=[...]`).
- **Rationale**: Прямо из ловушек скилла и реальных файлов (`Helium_10_Xray_2026-08-21.csv`: «69,95», «6 892», «Aug 22, 2017»).

## R7. Формулы (свод, источник — SKILL.md + references)

| Метрика | Формула | Порог |
|---|---|---|
| 1a Niche Revenue | Σ `ASIN Revenue` (Xray, без contamination) / прокси POE: `(minUnitsT360+maxUnitsT360)/2 × avgPrice / 12` | ≥ $500k/мес |
| 1b Средняя цена | MEDIAN(Price) по листингам с Review Count ≥ 100 (fallback — все) | ≥30 OK; 25–30 warn; <25 fail |
| 1c Adj. SV | `SV_core + 0.4 × Σ SV_cluster` (Cerebro) / прокси POE: Σ `searchVolumeT360/12` по кластеру | ≥ 3 000 |
| 1d Отзывы ниши | AVG и MEDIAN Review Count (Xray) / POE `launchPotential.avgReviewCount` | <300 OK; 300–1000 warn; >1000 fail |
| 1e Доминация | Top Brand Revenue Share (Xray) / POE click share по бренду; + флаг Amazon-продавец | <25 % и нет Amazon |
| 1f Top-5 брендов | Σ revenue share топ-5 брендов (Xray) / POE `top5BrandsClickShareT360` | <45 OK; 45–65 warn; >65 fail |
| 1g Сезонность | POE `trendsMetrics.searchVolumeT7`: (peak−trough)/peak; иначе ручной ввод | <30 OK; 30–50 warn; >50 fail |
| 1h Запуски | `successfulLaunchesT360 / newProductsLaunchedT360` + `searchVolumeGrowthT360` | ≥30 % OK; 10–30 warn; <10 fail |
| Gate 1 | `net0 = price − cogs − shipping − price×referral − fba`; `margin0 = net0/price` | margin>30 % И (net0>15 ИЛИ margin>40 % при price<25) |
| Gate 2 | `adCost(cvr) = cpc/cvr`; `net(cvr) = net0 − adCost×ppcShare` при CVR 8/10/12/15 % | PASS если net>0 при CVR≤12 %; ДОРАБОТКА если только при 15 %; иначе NO-GO |
| ROI (урок 09/10) | `net0 / (cogs+shipping) × 100` | ≥150 % OK; 100–150 низкий; <100 убыток; >200 «перепроверь» |
| 2j ROI с рекламой | `totalProfit / (COGS_sold + adSpend)` | >20–30 % |
| 2k Маржа с рекламой | `totalProfit / revenue` | ≥25 % |
| Бюджет (урок 08) | `batch = cogs_landed × units/day × (prodDays + shipDays + 15)`; `need = 2×batch + adsReserve` | ≤ бюджет |
| Трафик (урок 09) | доля SV топ-2 релевантных ключей; число ключей с SV≥N; групп ≥3 | топ-2 <80 %; ключей ≥30 |
| Scorecard | Market 25 / Competition 25 / Economics 25 / Brand-fit 15 / OpRisk 10 | ≥80 Go priority; 60–79 Go; 40–59 Доработка; <40 No-Go |

Пороги — в `shared/thresholds.js`, редактируются в UI (панель «Пороги»), сохраняются в анализе.

## R8. Безопасность

- **Decision**: `APP_PASSWORD` (env) → клиент вводит один раз, хранит в `localStorage`, шлёт заголовок `X-App-Token`; сервер сравнивает через `crypto.timingSafeEqual`. Все `/api/*` кроме `/api/health` защищены. Лимит запросов к `/api/analyze`: 20/час на IP (in-memory). Тело ≤ 1 МБ. Заголовки `X-Content-Type-Options`, `Referrer-Policy`, CSP (`default-src 'self'`; inline-скрипты не используются в приложении). Ключ Claude не покидает сервер.
- **Rationale**: Публичный URL на бесплатном хосте без защиты = чужие траты AI-бюджета (SC-007).

## R9. Тесты

- **Decision**: `node --test tests/*.test.js` на реальных фикстурах в `tests/fixtures/` (Xray + Cerebro 2026-08-21, POE urinal screen deodorizer 2026-09-15; репозиторий приватный). Проверяются парсеры (числа/дубли/иерархия), Критерий 1 на фикстурах, Gate 1/2 на кейсе Jitsu (12-pack vs 48-pack), бюджет на примерах урока 08, правила согласования вердикта, JSON-схема AI-ответа (валидатор). Сервер — smoke-тест `/api/health` и отказ 401 без пароля; AI-вызов покрывается `MOCK_AI=1` (детерминированный ответ) для e2e без ключа.
