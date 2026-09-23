# Implementation Plan: ценовой ориентир по конфигурации (spec 013)

**Spec**: [spec.md](spec.md) · **Date**: 2026-09-23 · **Migrations**: нет · **Новые зависимости**: нет

## Design decisions

- **D1 — Ядро** `shared/price-config.js` → `priceByConfig({ config, stats, xray, listings, choice, inputs, th })`: выбранная конфигурация (`core.config.priceChoice`, по умолчанию доминанты) → аналоги = строки таблицы с совпадением всех выбранных полей; если меньше `minAnalogs` (5) — ступени 80 % и 60 % совпавших полей; если и так < 3 — предупреждение. Цены аналогов взвешиваются выручкой ASIN: медиана (рынок), P25 (вход), P75 (потолок), медиана «с учётом купонов» (spec 014). Вклад поля = средняя цена выбранного значения − средняя цена доминанты (из `results.config.whole`). Ориентир себестоимости = рынок × (1 − referral) − FBA − рынок × marginMin.
- **D2 — Хранение**: `core.config.priceChoice = { fieldId: value }` (пустой → доминанты); `results.priceConfig` в `compute()` (в `stripNew`).
- **D3 — Интерфейс**: блок «Цена вашей конфигурации» в секции этапа 2 после доминирующей конфигурации: селекты по полям choice/number (значения из статистики, доминанта помечена), карточки рынок / вход / потолок / с купонами, таблица вкладов, кнопка «Подставить $X в экономику» (пишет `inputs.price`, предупреждает, если вне ценового диапазона). Static — без селектов и кнопки.
- **D4 — ТЗ**: факты `pricing` (рынок, вход, потолок, аналоги, совпадение, ориентир себестоимости) → раздел ТЗ «цена и позиционирование».

## Files

`shared/price-config.js` (новый), `shared/compute.js`, `shared/tz-payload.js`, `server/config-prompts.js` (раздел ТЗ), `public/js/render.js`, `public/js/app.js`, `public/index.html`, `tests/price-config.test.js`, `tests/config-render.test.js`, `scripts/ui-probe17.mjs`.
