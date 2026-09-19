# Data Model: Ценовой диапазон анализа (spec 003)

Схема БД и API не меняются: новые поля живут внутри документа анализа (`core`).

## Входные данные — `analysis.inputs`

| Поле | Тип | Правила |
|---|---|---|
| `priceMin` | number \| null | нижняя граница, $; `null` — открыто снизу; ≥ 0 |
| `priceMax` | number \| null | верхняя граница, $; `null` — открыто сверху; ≥ `priceMin` |

Обе `null` → диапазон не задан (по умолчанию и для всех старых анализов). Границы включительные.

## Результаты — `analysis.results.priceBand`

| Поле | Тип | Смысл |
|---|---|---|
| `active` | boolean | диапазон задан и корректен |
| `valid` | boolean | `false` при `min > max`, отрицательных или нечисловых значениях; тогда `active=false` |
| `error` | string \| null | текст для пользователя при `valid=false` |
| `min`, `max` | number \| null | применённые границы |
| `source` | `"xray"` \| `"poe"` \| null | откуда взяты цены листингов |
| `totalCount`, `inCount`, `noPrice` | number | листингов всего / в диапазоне / без цены |
| `revenueAll`, `revenueBand`, `revenueShare` | number \| null | выручка ниши, выручка коридора, доля (для POE — доли кликов вместо выручки, поле `weightLabel`) |
| `sample` | `"ok"` \| `"small"` \| `"insufficient"` \| null | уровень выборки по порогам `thresholds.priceBand` |
| `whole` | object \| null | показатели всей ниши для сравнения: `{ topBrand, topBrandShare, top5Share, priceMedian, reviewsAvg, reviewsMedian }` |
| `myPriceOutside` | boolean | цена товара менеджера вне диапазона |

## Изменения в существующих результатах

- `criterion1.items["1a"]`: значение и статус — по всей нише; добавляются `bandValue`, `bandShare` при активном диапазоне.
- `criterion1.items["1b" | "1d" | "1e" | "1f"]`: добавляется `inBand: true` при активном диапазоне (для пометки в интерфейсе); при `sample="insufficient"` — статус `na`, `note` с объяснением.
- `priceSegments.segments[]`: добавляется `selected: boolean` — сегмент пересекается с диапазоном.
- `competition`, `challenger`, `scorecard`: структура прежняя, данные — по диапазону.

## Пороги — `thresholds.priceBand`

| Поле | По умолчанию | Смысл |
|---|---|---|
| `smallSample` | 15 | меньше — предупреждение «малая выборка» |
| `minSample` | 5 | меньше — конкурентные показатели диапазона не считаются |

## AI-пейлоад

`payload.priceBand` = сводка без служебных полей; `payload.competitorsTop` — по диапазону; `payload.wholeNiche` = `priceBand.whole` + выручка ниши.
