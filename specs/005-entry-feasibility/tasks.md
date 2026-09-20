# Tasks: Реально ли сюда зайти (spec 005)

## Phase 1 — основа

- [x] T001 Контрольные отпечатки до смены методики: `tests/helpers/results-hash.js` исключает `budget`/`verdict`/новые ключи, значения сняты `scripts/baseline-hash.mjs` на коде до изменений
- [x] T002 Пороги `entry`, `cashflow`, `borderline` в `shared/thresholds.js`, `METHODOLOGY_VERSION = "2026-09-20"`; новые входы в `defaultInputs()` (`horizonMonths`, `rampMonths`, `startSalesMonthly`, `firstBatchUnits`, `startupCosts`, `reviewRate`, `vineReviews`)

## Phase 2 — US1 + US2: трафик, когорта, отзывы (P1)

- [x] T003 Тесты `tests/entry.test.js` (сначала): продажи на 1 % кликов = ручной расчёт; требуемая доля и разброс; когорта и причины отсева; наследник отзывов; нехватка данных; независимость от ценового диапазона; срок до планки в двух точках, Vine-only, допущение 2 %
- [x] T004 `shared/entry.js`: `percentile`, `salesPerClickPct`, `newEntrantCohort`, `reach`, `reviewBarrier`, `entryFeasibility`
- [x] T005 Подключение в `shared/compute.js` (по всей нише, опорная дата D3)

## Phase 3 — US3: деньги по месяцам (P1)

- [x] T006 Тесты `tests/cashflow.test.js` (сначала): SC-003 (оплаты партий = штуки × себестоимость, себестоимость не вычитается с продаж), разгон, дозаказ с учётом срока поставки, «нет в наличии», пик и месяц возврата, CPC неизвестен, срок поставки больше горизонта, CVR до планки отзывов
- [x] T007 `shared/cashflow.js`
- [x] T008 `shared/budget.js`: стоп-вопрос по пику вложений, прежняя сумма справочно; правка `tests/budget.test.js`, текст факта в `verdict-rules.js`

## Phase 4 — US4 + US5: честные цифры и регуляторика (P2)

- [x] T009 `clickWeightedPrice` и `poeDataNotes` в `shared/entry.js` + тесты
- [x] T010 `shared/borderline.js` + `tests/borderline-regulatory.test.js` (SC-005)
- [x] T011 `shared/regulatory.js` + `tests/borderline-regulatory.test.js` (SC-006: срабатывания и отсутствие ложных)

## Phase 5 — интерфейс и интеграции

- [x] T012 `public/js/render.js`: секции «Вход в нишу», «Деньги по месяцам» (таблица + график), «Пограничные значения», триггеры в чеклисте, подписи POE; `ECON_DEPENDENT`
- [x] T013 Панель: поля сценария в `public/index.html`, привязка в `app.js`, подписи порогов, стили
- [x] T014 `shared/ai-payload.js` + `server/prompt.js` (правило 8) + `server/mock-verdict.js`
- [x] T015 `shared/share-snapshot.js`: `no_economics` удаляет помесячные деньги и экономические пограничные строки; тест утечек
- [x] T016 Тест рендера `tests/entry-render.test.js` (секции в HTML, статичный режим, скрытие в ссылке без экономики)
- [x] T017 Справка в `public/index.html`

## Phase 6 — проверка и выпуск

- [x] T018 `scripts/ui-probe12.mjs`: секции видны, ползунок цели меняет требуемую долю и пик, 360 px без горизонтальной прокрутки
- [ ] T019 Все тесты и пробы 6, 7, 9, 12; коммит, push, деплой при `health.running = 0`, проверка на проде
- [ ] T020 Память проекта и внешний CLAUDE.md
