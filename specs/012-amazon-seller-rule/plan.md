# Implementation Plan: Amazon как продавец — правило вердикта (spec 012)

**Spec**: [spec.md](spec.md) · **Date**: 2026-09-23 · **Migrations**: нет · **Новые зависимости**: нет

## Design decisions

- **D1 — Детекция по листингам**: `competition()` считает `amazonAsins` (Seller/Fulfillment ~ /^amazon(\.com)?$/i) и `amazonRevenueShare` по переданному виду (вся ниша или коридор цен); флаг `xray.flags.amazonSells` больше не используется как источник — он относился ко всей выгрузке и в виде коридора врал. Ручной ответ чеклиста (`inputs.checklist.amazonSells` yes/no) по-прежнему главнее.
- **D2 — Порог**: `thresholds.amazon = { mode: "block" | "consider", scope: "niche" | "band" }`, умолчания `block` / `niche`. Вкладка «Пороги» учится показывать строковые пороги списком (`THR_OPTIONS`); `thresholdOverrides` принимает строки, когда умолчание — строка (наборы порогов spec 011 работают).
- **D3 — `results.amazon`** (`shared/amazon.js`, `amazonPresence`): `{ mode, scope, scopeLabel, present, presentNiche, presentBand, source, asins, count, revenueShare, blocks, note }`. Считается в `compute()` сразу после конкуренции; `p.competition.amazonSells/amazonSellsSource` перезаписываются результатом по выбранной области, чтобы 1e, scorecard и чеклист смотрели туда же, куда и вердикт.
- **D4 — Вердикт**: `verdictCeiling` — первое правило: `r.amazon.blocks` → `no_go`, решающий «Amazon в нише», причина с числом листингов и долей выручки. `reconcile()` уже не даёт AI смягчить потолок.
- **D5 — Интерфейс**: чип в заголовке «Конкурентной карты»; чеклист показывает область; подсказки; справка. Отпечатки: `stripNew` удаляет `amazon` и новые поля конкуренции.

## Files

`shared/amazon.js` (новый), `shared/competition.js`, `shared/compute.js`, `shared/thresholds.js`, `shared/verdict-rules.js`, `shared/ai-payload.js`, `public/js/app.js` (пороги-списки), `public/js/render.js`, `public/index.html`, `tests/amazon.test.js`, `tests/helpers/results-hash.js`, `scripts/ui-probe20.mjs`.
