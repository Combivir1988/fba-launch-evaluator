# Tasks: Ценовой диапазон анализа (spec 003)

**Input**: `specs/003-price-band-filter/` — spec.md (US1–US3), plan.md (D1–D8), research.md (R1–R6), data-model.md, quickstart.md
**Tests**: обязательны; тест перед реализацией. **Пути** — относительно `fba-launch-evaluator/`.

## Format: `[ID] [P?] [Story] Description`

## Phase 1: Setup

- [ ] T001 `shared/thresholds.js`: `DEFAULT_THRESHOLDS.priceBand = { smallSample: 15, minSample: 5 }`, повысить `METHODOLOGY_VERSION`; `shared/analysis.js`: `defaultInputs()` += `priceMin: null, priceMax: null`
- [ ] T002 [P] `tests/helpers/fixture-analysis.js`: параметр `overrides.inputs` уже есть — добавить хелпер `bandOf(a, min, max)` (пересчёт с диапазоном) для тестов

## Phase 2: Foundational

- [ ] T003 `tests/price-band.test.js` → `shared/price-band.js`: `normalizeBand(inputs)` (пустой, открытый с одной стороны, `min > max`, отрицательные, строки с запятой → `valid/error`), `inBand(price, band)` (границы включительные, `null`-цена → false), `applyPriceBand(p)` → `{ view:{xray, poe}, summary }` по data-model.md: счётчики, `noPrice`, выручка и доля (для POE — доля кликов, `weightLabel`), уровень выборки по порогам, `myPriceOutside`; исходные объекты не мутируются; при неактивном диапазоне `view` — те же ссылки на исходные данные

**Checkpoint**: модуль покрыт тестами, в расчёты ещё не подключён.

## Phase 3: US1 — Анализ конкурентов внутри диапазона (P1) 🎯 MVP

- [ ] T004 [US1] `tests/price-band.test.js` (интеграция) → `shared/compute.js`: вид строится один раз; `competition`, `criterion1`, `challenger`, `scorecard` получают вид; `traffic`, `gate0`, `priceSegments`, `reconciliation` — всю нишу; `results.priceBand = summary`; цена по умолчанию (медиана 1b) — уже по диапазону. Тесты: (a) **совместимость** — при пустом диапазоне `compute` даёт те же результаты, что и до изменения (снимок «до» зафиксировать в тесте сравнением с расчётом без новых полей), кроме `priceBand` и `computedAt`; (b) диапазон Mid из `priceSegments` → `competition.brands`, `topBrandShare`, `top5Share`, `reviewBarrier` совпадают с ручным расчётом по отфильтрованным листингам фикстуры (SC-003); (c) `traffic`, 1c, 1g, 1h, `gate0.level` не меняются при любом диапазоне
- [ ] T005 [US1] `shared/criterion1.js` + тесты в `tests/criterion1.test.js`: 1a считается по `p.xrayAll` (вся ниша) и получает `bandValue`, `bandShare`; 1b/1d/1e/1f получают `inBand: true`; счёт «N из 8» от ширины коридора по 1a не зависит
- [ ] T006 [P] [US1] `shared/competition.js` (`priceSegments`): поле `selected` у сегментов, пересекающихся с диапазоном; всегда по всей нише; тест
- [ ] T007 [US1] `public/index.html` + `public/js/app.js`: блок «Ценовой диапазон анализа» в панели (поля `#f-pmin`, `#f-pmax` с `data-input`, счётчик `#band-stats`, кнопка «Сбросить»); проверка `от ≤ до` с подсветкой и текстом причины; изменение диапазона → `markDirty()` + полный пересчёт; синхронизация формы при открытии анализа
- [ ] T008 [US1] `public/js/render.js`: таблица и график конкурентов — только листинги диапазона (по `R.priceBand`); в секции «Ценовые сегменты» подсветка выбранных сегментов и кнопки выбора сегмента (не в static-режиме) → `app.js` подставляет границы

## Phase 4: US2 — Честная картина (P1)

- [ ] T009 [US2] `public/js/render.js`: пометка в шапке «Анализ сужен до цен $A–$B: N из M листингов, X % выручки ниши» (во всех режимах, включая static и снимок ссылки); у 1a — две цифры (ниша / диапазон + доля); значки «в диапазоне» у 1b/1d/1e/1f и «вся ниша» у 1c, трафика, сезонности, запусков; блок сравнения «в диапазоне / в нише» (доля топ-бренда, топ-5, медиана цены, отзывы) в секции конкурентов
- [ ] T010 [US2] Предупреждения: малая выборка (`sample="small"`), недостаточная (`"insufficient"` → конкурентные показатели `na` с пояснением в `note`), цена товара вне диапазона (`myPriceOutside`), некорректный диапазон; логика в `shared/price-band.js` + `compute.js`, показ в `render.js` и счётчике панели; тесты на каждый случай
- [ ] T011 [P] [US2] `shared/ai-payload.js` + `server/prompt.js` + `tests/ai-payload.test.js`: `payload.priceBand`, `payload.wholeNiche`, топ-20 конкурентов из диапазона; правило в системном промпте (research R6); `server/mock-verdict.js` упоминает диапазон в summary
- [ ] T012 [P] [US2] `public/js/app.js`: подписи порогов `priceBand.smallSample`, `priceBand.minSample` в `THR_LABELS` / `THR_NAMES`
- [ ] T013 [US2] `tests/render.test.js`: шапка с диапазоном в обычном, static-режиме и снимке; таблица конкурентов только из диапазона; предупреждение малой выборки; нет кнопок выбора сегмента в static

## Phase 5: US3 — Сохранение и совместимость (P2)

- [ ] T014 [US3] `tests/analyses.test.js` / `tests/share-snapshot.test.js`: диапазон сохраняется в `core`, открывается коллегой; старый документ без полей → `migrate` даёт `null`, результаты прежние; в снимке `no_economics` диапазон и пометка остаются, `findEconomicsLeaks` пуст
- [ ] T015 [US3] Изменение диапазона помечает AI-вердикт устаревшим (`markDirty` уже делает это — тест-проверка в пробе)

## Phase 6: Polish & выпуск

- [ ] T016 [P] Вкладка «Справка» в `public/index.html`: что фильтр сужает и что нет, почему 1a по всей нише, малая выборка; `README.md` — строка в возможностях
- [ ] T017 `scripts/ui-probe9.mjs`: загрузка Xray+POE → ввод 20–30 → шапка, счётчик, изменившиеся и неизменившиеся показатели → выбор сегмента кнопкой → некорректный диапазон → сброс (значения как в начале) → F5 → публичная ссылка с пометкой
- [ ] T018 Полный прогон `npm test` + пробы 1–9; выпуск на Railway при `health.running = 0`; обновить память проекта и `CLAUDE.md`; отметить задачи

## Dependencies

T001 → T003 → T004 → T005; T006 ‖ T005; T007, T008 после T004; US2 после US1; T011 ‖ T012; T014 после T004; T017 после T007–T010.

## Implementation strategy

MVP = Phase 1–3 (диапазон работает и пересчитывает конкурентов). US2 выпускается вместе с MVP одним релизом: без честных пометок фильтр вводит в заблуждение, поэтому отдельно US1 на прод не выкатывается.

**Итого**: 18 задач — Setup 2, Foundational 1, US1 5, US2 5, US3 2, Polish 3.
