# Data Model: FBA Launch Evaluator

Все сущности — JSON-документы в браузере (IndexedDB, store `analyses`, key = `id`). Сервер данные не хранит. `schemaVersion` документа = 1; миграции — `shared/analysis.js#migrate`.

## Analysis

| Поле | Тип | Описание |
|---|---|---|
| id | string (ulid/uuid) | ключ хранения |
| schemaVersion | 1 | версия документа |
| methodologyVersion | string | версия порогов/формул (`thresholds.js`), напр. `2026-09-17` |
| niche | string | название ниши / кодовое имя |
| coreKeyword | string | главный ключ |
| marketplace | string | `US` по умолчанию (из POE `obfuscatedMarketplaceId`, если есть) |
| createdAt / updatedAt | ISO string | |
| status | `draft` \| `computed` \| `ai_done` | |
| sources | Sources | что загружено и когда |
| inputs | Inputs | ручные переменные |
| thresholds | Thresholds | пороги, действовавшие при расчёте (копия для воспроизводимости) |
| aggregates | Aggregates | компактные данные файлов, достаточные для восстановления дашборда |
| results | Results | детерминированные результаты |
| ai | AIVerdict \| null | |

## Sources

```json
{ "xray":  {"fileName": "...", "rows": 108, "exportedAt": null, "loadedAt": "..."} | null,
  "cerebro": {...} | null, "poe": {"fileName","nicheId","nicheTitle","capturedAt","lastUpdated"} | null,
  "sqp": {...} | null }
```

## Inputs (ручные переменные)

| Поле | Тип / диапазон | Значение по умолчанию |
|---|---|---|
| price | number ≥ 0 | из 1b (медиана), если пусто |
| cogs | number ≥ 0 \| null | null → Критерий 2 ⚪ |
| shippingPerUnit | number ≥ 0 | 0 |
| referralPct | 0–1 | 0.15 |
| fbaFee | number ≥ 0 | 0 |
| cpc | number ≥ 0 | из Cerebro `H10 PPC Sugg. Bid` core-ключа |
| cvr | 0.03–0.30 (ползунок) | 0.10 |
| ppcShare | 0–1 (ползунок) | 0.70 |
| targetAcos | 0–1 | 0.30 |
| unitsPerDay | number ≥ 0 | 10 |
| productionDays / shippingDays / receivingDays | int ≥ 0 | 30 / 30 / 15 |
| adsReserve | number ≥ 0 | 0 |
| budget | number ≥ 0 \| null | null |
| canDifferentiate | `yes` \| `no` \| `unknown` | unknown |
| myAsins / myBrand | string[] / string | [] / "" — подсветка «мой SKU» |
| evaluateAsNewEntrant | boolean | true (урок Jitsu) |
| excludedBrands | string[] | [] — contamination |
| clusterKeywords | string[] | автовыбор + правки пользователя |
| manualOverrides | `{ "1a": {value, note}, ... }` | {} — метрики, введённые вручную |
| challenger | `{ "3": {status, value, note}, "4": ..., "7": ..., "8": ... }` | статусы 🟢 confirmed / 🟡 assumed / 🔵 decided / ⚪ unknown |
| checklist | Checklist | см. ниже |
| axisManual | `{ brandFit: 0–10, opRisk: 0–10 }` \| авто | ручные оси scorecard |

### Checklist (уроки 03/04/11/12/13/14)

`gatedCategory`, `dangerousGoods`, `certificates` (CPC/FDA/Prop65/none), `patentSearch` (none/clear/design-around/conflict), `trademarkSearch`, `reviewMergingSuspected`, `amazonSells`, `couponsDealsSaturation` (low/mid/high), `designTestScore` (0–100 \| null), `lifecycleMonths` (int \| null), `listingsInSearch` (int \| null).

## Aggregates

- **xray**: `asins[]` — `{asin, parentAsin, brand, title, price, asinSales, parentSales, recentPurchases, asinRevenue, parentRevenue, bsr, reviews, rating, creationDate, seller, fulfillment, sponsored, category}`; `flags`: `{hasAsinSales, duplicatesDropped, contaminationCandidates[]}`.
- **cerebro**: `keywords[]` — `{phrase, sv, svTrend, bid, bidMin, bidMax, sponsoredAsins, competingProducts, cpr, abaClickShare, abaConvShare, keywordSales, isAsin, isBranded}` (полный список нужен для выбора кластера; для истории хранится ≤ 2 000 строк по SV).
- **poe**: `nicheSummary` (числа), `launchPotential` (`{field: {current, qoq, yoy}}`), `asinMetrics[]` (все, ≤ 100), `searchTermMetrics[]`, `trends[]` (`{date, sv, top5Brand, top5Prod, price, conv, productCount, sponsoredCount}`), `pdr` (`{negative[], positive[], returns[]}` по 10), `insights` (только текст без HTML, до 2 000 символов на вкладку).
- **sqp**: `rows[]` — `{query, volume, impressions, clicks, cartAdds, purchases, purchaseRate}`.

## Results

| Блок | Содержание |
|---|---|
| gate0 | `{level: "full"|"poe_only"|"partial"|"none", missing: []}` |
| criterion1 | `items: {"1a"…"1h": {value, unit, threshold, status: ok|warn|fail|na, source: xray|cerebro|poe|manual|proxy, note, proxyDelta?}}`, `okCount`, `pass (≥6)` |
| economics | `gate1 {net0, margin0, roi, status}`, `gate2 {byCvr: [{cvr, adCost, net}], status}`, `criterion2 {"2a"…"2k": {value, status}}`, `marginNoAds`, `marginWithAds` |
| budget | `{batchCost, twoBatches, adsReserve, need, budget, gap, status}` + `quickScreen {budgetFit, roi150, revenue500k, differentiation}` |
| traffic | `{clusterSv, adjSv, top2Share, relevantCount, groups, status}`, `poeConcentration {top5Brands, top20Brands, top5Products, sponsoredPct, searchConv, status}` |
| competition | `brands[]` (share, revenue, reviews), `topBrandShare`, `top5Share`, `reviewBarrier {leaderReviews, avg, median, tier}`, `playersOver100`, `dominantBrand` |
| challenger | `active (topBrandShare>25%)`, `items {"3"…"8": {status, note}}`, `greenCount`, `mandatoryOk`, `pass` |
| scorecard | `axes {market, competition, economics, brandFit, opRisk}` (0–10 + пояснение), `total %`, `band` |
| verdict | детерминированный: `{ceiling: go|go_conditional|rework|no_go, decisiveGate, reasons[]}` |
| reconciliation | расхождения источников `[{metric, a: {src, value}, b: {src, value}, deltaPct, level: noise|borderline|conflict}]` |

## AIVerdict

`{ verdict, decisiveGate, criterion1Summary, gates: [{gate, status, reasoning}], differentiation: [{hypothesis, evidence, specRequirement}], recommendations: [{priority: high|med|low, title, text}], risks: [], pricingPackComment, nextSteps: [3], adjustedByRules: bool, aiVerdictRaw, model, usage: {input, output, cacheRead}, createdAt }` — полная схема в `contracts/ai-verdict.schema.json`.

## HistoryExport

`{ "type": "fba-launch-evaluator/history", "schemaVersion": 1, "exportedAt": ISO, "analyses": Analysis[] }`. Импорт: по `id` — существующий заменяется только если `updatedAt` импорта новее, иначе пропуск (без дублей).

## Правила валидации

- Числовые поля Inputs — конечные, неотрицательные; `cvr`, `ppcShare`, `referralPct` в (0,1].
- `clusterKeywords` ⊆ фразы Cerebro (или ручные при отсутствии Cerebro).
- Документ без `aggregates.xray` и без `aggregates.poe` → `gate0.level = none`, расчёты Критерия 1 только из `manualOverrides`.
- При загрузке из истории документ прогоняется через `migrate()`, затем `compute()` пересчитывает Results (Results хранятся для экспорта, но истина — пересчёт).

## Переходы состояния

`draft` (файлы/поля) → `computed` (нажата «Рассчитать» или изменён ползунок) → `ai_done` (получен и провалидирован AI) → при изменении входов возвращается в `computed`, `ai` сохраняется с пометкой «устарел» (`ai.staleSince`).
