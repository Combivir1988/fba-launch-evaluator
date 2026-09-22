# Tasks: этап 2 — конфигурация продукта и ТЗ производителю (spec 010)

Порядок — снизу вверх по зависимостям: ядро → сервер → интерфейс → пробы → выпуск. Тесты пишутся вместе с модулем.

## Фаза 1 — ядро (`shared/`, чисто, без сети)

- [x] T001 `shared/thresholds.js`: группа `config` (D11) + подписи в `THR_NAMES`/`THR_LABELS`; `shared/analysis.js`: `config: null` в новом документе, `configDone` в `metaFromCore`
- [x] T002 `shared/config-scope.js`: `configScope(analysis, th)` → область ASIN (D4); тест на дубли, исключённые бренды, порог 150
- [x] T003 `shared/config-extract.js`: `normalizeValue(field, raw)`, `mergeExtraction(schema, prevTable, aiItems, listings)` с сохранением `manual` и покрытием (D6); `renameOption(schema, table, fieldId, from, to)`; тесты
- [x] T004 `shared/config-stats.js`: `configStats(schema, table, xray, { band })` (D7): доли, «нет данных», премия, доминанта, числовые интервалы; инвариант суммы 100 %; тест на фикстуре; подключение в `compute()` → `results.config`; `stripNew` в `tests/helpers/results-hash.js` (отпечатки без изменений)
- [x] T005 `shared/tz-payload.js`: `buildTzPayload(analysis)` + `collectTzNumbers(payload)` для постпроверки чисел (D9); `share-snapshot.js`: удаление `config.tz` и `aggregates.listings` (D10); тесты

## Фаза 2 — сервер

- [x] T006 `server/scrapfly.js`: `fetchListing(asin, cfg, { fetchImpl, signal })`, `normalizeProduct(data)`, `fetchMany(asins, …, { concurrency: 3, onProgress })`, классификация ошибок, `mockListing` (D2, D12); фикстуры `tests/fixtures/scrapfly-*.json` из ответов пробы (только `extracted_data.data`, без отзывов/служебных полей); `tests/scrapfly.test.js`
- [x] T007 `server/config-prompts.js` (`FIELDS_SCHEMA`, `EXTRACT_SCHEMA`, `TZ_SCHEMA`, тексты промптов без упоминаний курса), `server/mock-config.js`, `server/config-jobs.js`: `schemaStream`, `extractStream`, `tzStream` (D3, D5, D6, D9) с `fetchImpl`/`aiJson` для тестов; `tests/config-jobs.test.js` (кэш не перезагружается, предел 150, пачки, частичный результат при ошибке кредитов, `unverified` в ТЗ)
- [x] T008 `server/tz-docx.js` (`buildTzDocx(tz, meta)` на пакете `docx`) + `tests/tz-docx.test.js` (распаковка zip-записи `word/document.xml` и проверка текста); `package.json`
- [x] T009 `server/claude.js` (`scrapflyKey`), `server/index.js`: маршруты `POST /api/config/schema|extract|tz`, `POST /api/tz/docx`, `scrapfly` в health, 400 без ключа; `tests/analyses-api.test.js`/`server.test.js` — маршруты и health

## Фаза 3 — интерфейс

- [x] T010 `public/js/render.js`: секции `config` (счётчики, кнопки, переключатель диапазона, сетка doughnut-диаграмм, доминирующая конфигурация, таблица ASIN × поля в `<details>`, незагруженные) и `tz` (таблица с правкой, DOCX); подсказки в `TIPS`/`KEY_TIPS`; `tests/render.test.js` + `tips.test.js`
- [x] T011 `public/js/ai.js` (`runConfigSchema/Extract/Tz`, `pendingJob` типы), `public/js/app.js` (запуск задач с прогрессом, слияние `listings`, диалог `#schema-dlg`, правки клеток и строк ТЗ → `markDirty`, «Скачать DOCX» через `fetch` + `download`), `public/index.html` (диалог, справка «Этап 2»), `public/css/app.css`
- [x] T012 `scripts/ui-probe17.mjs` (MOCK): Xray → схема → правка схемы → извлечение → диаграммы (сумма 100 %) → переключатель диапазона → правка клетки → ТЗ → DOCX скачан (PK-заголовок) → F5 во время задачи → публичная ссылка без ТЗ

## Фаза 4 — выпуск

- [ ] T013 Регрессия (`npm test`, пробы 12–17), grep на «урок»/бренды, коммит, push, `SCRAPFLY_API_KEY` в переменные Railway, деплой при `health.running = 0`, живая проверка на анализе «Amaranthus» (≤ 20 ASIN — контроль кредитов), память проекта и внешний CLAUDE.md
