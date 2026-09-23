# Tasks: Amazon как продавец — правило вердикта (spec 012)

- [x] T001 `shared/competition.js`: `amazonAsins`, `amazonRevenueShare` по виду; `shared/thresholds.js`: группа `amazon`, строки в `thresholdOverrides`
- [x] T002 `shared/amazon.js` (`amazonPresence`) + подключение в `compute()` (перезапись `competition.amazonSells` по области) + `results.amazon`; `verdictCeiling`: правило блокировки; AI-пейлоад; `stripNew`
- [x] T003 Интерфейс: пороги-списки (`THR_OPTIONS`), чип в «Конкурентной карте», чеклист с областью, подсказки, справка
- [x] T004 Тесты `tests/amazon.test.js` (детекция по листингам и коридору, режимы, ручной ответ, вердикт, отпечатки); проба `scripts/ui-probe20.mjs`
- [x] T005 Регрессия, коммит, push, деплой при `health.running = 0`, память и внешний CLAUDE.md

## Выпуск

- 2026-09-23: реализовано и на проде (без миграций). По умолчанию Amazon в нише → No-Go (решающий «Amazon в нише»); пороги «Amazon как продавец»: режим block/consider, область niche/band; детекция по Seller/Fulfillment каждого листинга вида; чип в «Конкурентной карте», чеклист с областью и режимом; строковые пороги — списком во вкладке «Пороги». Отпечатки прежних расчётов не изменились. Тесты amazon (7), проба ui-probe20 — 13 проверок.
