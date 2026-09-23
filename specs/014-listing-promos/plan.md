# Implementation Plan: промо на листингах (spec 014)

**Spec**: [spec.md](spec.md) · **Date**: 2026-09-23 · **Migrations**: нет · **Новые зависимости**: нет

## Design decisions

- **D1 — Разбор на сервере из того же ответа**: `server/promo-parse.js` → `parsePromo(html)` берёт текст только внутри блоков `apex_desktop`/`corePrice*` (List Price / Typical price, «−N %», «$X with N percent savings»), `promoPriceBlockMessage` + `couponBadge` + `vpcButton` (купон «Save 10% with coupon», акции «Buy 2, save 5%»), `dealBadge` (Limited time deal и т. п.), `snsAccordionRowMiddle` (Subscribe & Save «Save 5% … up to 15%»). `normalizeProduct` получает `html = result.content` и кладёт `listing.promo`; MOCK даёт промо детерминированно.
- **D2 — Данные**: `listing.promo = { price, listPrice, discountPct, coupon: {text, value, unit} | null, deal, sns: {min, max} | null, promotions: [], hasPromo }`; старые записи без `promo` считаются «неизвестно» (не «нет промо»).
- **D3 — Ниша**: `shared/promo-stats.js` → `promoStats(listings, xray.asins, asins таблицы)` → доли листингов и выручки с купоном / дилом / скидкой / S&S, средняя глубина скидки, `saturation` (high ≥ 50 % выручки с купоном или дилом, some ≥ 20 %, low), дата снимка. В `compute()` → `results.config.promo`; чеклист «Купоны/дилы» в положении «—/авто» берёт `saturation` (scorecard: high → −1 как раньше).
- **D4 — Интерфейс**: карточки «Промо в нише» в секции этапа 2, столбец «Промо» в таблице ASIN × поля (чипы −15 % / купон 10 % / дил / S&S 5–15 % / акция), пояснение про снимок и старый кэш; в AI-пейлоад и факты ТЗ.
- **D5 — Стоимость**: ноль дополнительных запросов; HTML уже в ответе. `cost_budget` на страницу поднят до 80 (ескалация обхода защиты доходила до 130 — такие страницы честно падают в failed, а не сжигают кредиты).

## Files

`server/promo-parse.js` (новый), `server/scrapfly.js`, `shared/promo-stats.js` (новый), `shared/compute.js`, `shared/ai-payload.js`, `shared/tz-payload.js`, `public/js/render.js`, `public/index.html`, `tests/promo.test.js`, `tests/fixtures/amazon-promo-B00UOXMCBI.html`, `tests/helpers/results-hash.js`.
