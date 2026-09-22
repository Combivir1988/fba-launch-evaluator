# Implementation Plan: история версий и «последний анализ» в учётной записи (spec 009)

**Spec**: [spec.md](spec.md) · **Date**: 2026-09-22 · **Migrations**: `004_analysis_versions.sql` · **Новые зависимости**: нет

## Design decisions

- **D1 — «последний анализ» — в `users.settings.lastAnalysisId`** через существующий `PATCH /api/auth/settings` (значение — uuid или null). Клиент читает его из `/api/auth/me` при входе и пишет при открытии/сохранении (не чаще одного запроса на смену id). `localStorage.fba_last` больше не читается и очищается.
- **D2 — чужой анализ** помечается над дашбордом (`#foreign-note`: автор + «Работать над копией» → существующий `copy`), когда `meta.createdBy.id !== S.user.id`.
- **D3 — архив в момент перезаписи.** Таблица `analysis_versions` хранит ПРЕЖНЕЕ состояние строки: `core` всегда, `aggregates_gz` — только когда сохранение меняет отчёты; `state_at/state_by` — когда и кем это состояние было записано, `archived_at/archived_by` — чьё сохранение его вытеснило, `reason` = save | restore. `saveCore`/`saveAggregates` идут в транзакции: `SELECT … FOR UPDATE` → проверка версии (устаревшая — ничего не архивируем, обычный 409) → архив → `UPDATE`.
- **D4 — схлопывание сеанса правок**: новая запись не создаётся, если последнюю запись архивировал тот же человек, состояние по-прежнему его, прошло меньше 10 минут и отчёты не меняются. Смена автора, замена отчётов или 10 минут — новая запись.
- **D5 — хранение**: не больше 30 записей на анализ; `aggregates_gz` остаётся только у 3 последних записей с отчётами (каждый набор — сотни килобайт). Удаление анализа удаляет историю (`ON DELETE CASCADE`).
- **D6 — восстановление** (`POST /api/analyses/:id/versions/:vid/restore`): текущее состояние архивируется принудительно (`reason = restore`, с отчётами, если версия их вернёт), затем `core` версии (id и `updatedAt` обновлены) и `aggregates_gz = COALESCE(версия, текущие)`; ответ — как `GET /api/analyses/:id` плюс `aggregatesRestored`. Права — как у правки общей истории (любой вошедший).
- **D7 — `patchResult`** (результат AI/патентов) версий не создаёт: это добавление, не правка.
- **D8 — интерфейс**: кнопка «🕘 Версии» в действиях, диалог с таблицей (состояние на / кто записал / ниша / вердикт · К1 / отчёты / Восстановить); перед восстановлением несохранённое сохраняется.

## Files

`server/db/migrations/004_analysis_versions.sql`, `server/analyses.js` (archive, listVersions, restoreVersion, транзакции в save*), `server/index.js` (маршруты), `server/users.js` (lastAnalysisId), `public/js/history.js`, `public/js/app.js`, `public/index.html`, `tests/versions.test.js`, `tests/helpers/db.js`, `scripts/ui-probe16.mjs`.
