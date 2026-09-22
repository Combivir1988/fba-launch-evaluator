# Data Model: этап 2 — конфигурация продукта (spec 010)

Всё хранится внутри документа анализа (spec 002): лёгкая часть — в `core.config`, кэш страниц — в `aggregates.listings`. Новых таблиц и миграций нет.

## `core.config`

```jsonc
{
  "scope": { "asins": ["B0…", …], "excluded": 3, "capped": false, "builtAt": "2026-09-22T10:00:00Z" },
  "schema": {
    "fields": [
      { "id": "connection_type", "name": "Тип подключения", "type": "choice", "unit": null,
        "options": ["Bluetooth", "проводное", "автономное"], "hint": "как считывается удар / связь с приложением" },
      { "id": "target_zones", "name": "Количество ударных зон", "type": "number", "unit": "шт", "options": [], "hint": "" }
    ],
    "proposedAt": "…", "model": "aistudio/gemini-3.5-flash-lite", "editedAt": "…" | null
  },
  "table": {
    "rows": {
      "B0…": { "status": "ok" | "failed" | "pending",
               "values": { "connection_type": { "value": "Bluetooth", "source": "bullets" },
                           "target_zones":    { "value": 9, "source": "specs" },
                           "material":        { "value": null, "source": null, "raw": "PU + EVA" } } }
    },
    "extractedAt": "…", "model": "…", "cost": 2870,
    "coverage": { "connection_type": 0.82, "target_zones": 0.61 },
    "failed": ["B0…"]
  },
  "tz": {
    "title": "ТЗ производителю: настенная боксёрская машина",
    "summary": "…",
    "rows": [ { "section": "конструкция", "param": "Ударные зоны", "requirement": "9 зон с подсветкой", "rationale": "9 зон — 58 % выручки ниши", "priority": "must", "source": "поле «Количество ударных зон»", "unverified": false } ],
    "openQuestions": ["…"],
    "generatedAt": "…", "model": "…", "editedAt": "…" | null
  }
}
```

- `source` значения: `title` | `bullets` | `specs` | `aplus` | `manual` | `null` («нет данных»).
- `value`: строка из `options` для `choice`, число для `number`, строка для `text`, `null` — нет данных.
- `raw` — что модель увидела, но что не легло в список (менеджеру для ручного решения).
- Ручная правка клетки: `source: "manual"`; повторное извлечение такие клетки не трогает.

## `aggregates.listings[asin]`

```jsonc
{ "asin": "B0…", "fetchedAt": "2026-09-22T10:01:00Z", "cost": 29,
  "title": "…", "brand": "…", "bullets": ["…"], "specs": [{ "k": "Material", "v": "PU leather" }],
  "aplus": "…" | "", "price": 99.99, "rating": 4.5, "ratingCount": 1234,
  "variants": ["Black", "Red"], "imageCount": 9, "category": "Sports & Outdoors" }
```

Ошибка загрузки хранится как `{ "asin", "fetchedAt", "error": { "code": "asp" | "http_5xx" | "timeout" | "credits", "message": "…" } }` и считается устаревшей сразу (повторная попытка при следующем запуске).

## `results.config` (считается в `compute()`, не хранится как источник)

```jsonc
{ "whole": { "asins": 61, "withRevenue": 58, "fields": [ {
      "id": "connection_type", "name": "Тип подключения", "type": "choice",
      "values": [ { "value": "Bluetooth", "revenue": 812000, "share": 0.584, "count": 27, "listingShare": 0.443, "avgPrice": 104.2, "premium": true } ],
      "noData": { "revenue": 120000, "share": 0.086, "count": 9 },
      "dominant": { "value": "Bluetooth", "share": 0.584 }, "coverage": 0.85 } ],
    "totalRevenue": 1390000 },
  "band": { …то же по листингам ценового диапазона… } | null }
```

Инвариант: `sum(values.share) + noData.share = 1` (с точностью округления) для каждого поля.

## Пороги (`thresholds.config`)

| ключ | по умолчанию | смысл |
|---|---|---|
| `topForSchema` | 15 | сколько листингов (по выручке) читает AI, предлагая схему |
| `maxAsins` | 150 | предел страниц за один запуск извлечения |
| `cacheDays` | 30 | свежесть страницы в кэше |
| `batchSize` | 6 | листингов на один вызов AI при извлечении |
| `numericDistinctMax` | 12 | число различных значений, до которого числовое поле показывается как дискретное |
