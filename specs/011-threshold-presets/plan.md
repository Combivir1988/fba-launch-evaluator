# Implementation Plan: личные наборы порогов (spec 011)

**Spec**: [spec.md](spec.md) · **Date**: 2026-09-23 · **Migrations**: нет · **Новые зависимости**: нет

## Design decisions

- **D1 — Хранение**: `users.settings.thresholdPresets = [{ id, name, thresholds, updatedAt }]` через существующий `PATCH /api/auth/settings` (уже личный: пользователь читает и пишет только свои настройки — SC-002 бесплатно). Сервер проверяет форму (`sanitizePresets` в `shared/thresholds.js`): ≤ 20 наборов, имя ≤ 60, пороги — только известные `группа.ключ` правильного типа (число / массив чисел / объект чисел) и только отличия от умолчаний (`thresholdOverrides`). Тело укладывается в лимит `jsonSmall` (100 KB).
- **D2 — Только отличия**: набор хранит diff от `DEFAULT_THRESHOLDS`, поэтому смена значений по умолчанию в новой версии методологии не «замораживается» старыми наборами.
- **D3 — Интерфейс** во вкладке «Пороги»: панель «Мои наборы порогов» — выбор набора, «Загрузить в этот анализ», «Сохранить текущие как…» (имя через prompt), «Обновить набор», «Удалить» (confirm); строка состояния «В этом анализе изменено порогов: N / по умолчанию». Загрузка = `S.a.thresholds = clone(preset.thresholds)` → пересчёт и сохранение анализа как обычно.
- **D4 — Новый анализ**: `newAnalysis()` уже даёт `thresholds: {}`; наборы никогда не применяются автоматически (FR-002, SC-003).
- **D5 — Справка**: пункт «Наборы порогов» в «Справке» и текст во вкладке «Пороги».

## Files

`shared/thresholds.js` (`thresholdOverrides`, `sanitizePresets`, `PRESET_LIMITS`), `server/users.js` (ключ `thresholdPresets` в `updateSettings`), `public/index.html` (панель наборов, справка), `public/js/app.js` (наборы), `tests/thresholds-presets.test.js`, `tests/users.test.js`, `scripts/ui-probe19.mjs`.
