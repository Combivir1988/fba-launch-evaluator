# Data Model: Статистика по всем анализам

**Миграция**: `server/db/migrations/006_analyses_statistics.sql` (следующий свободный номер; применяется сама при старте).

## Изменение существующей таблицы

### `users` — право на раздел

```sql
ALTER TABLE users ADD COLUMN stats_access boolean NOT NULL DEFAULT false;
```

| Поле | Правило |
|---|---|
| `stats_access` | Выдаётся и снимается только админским маршрутом. **Не** в `settings jsonb` — см. D6 в [research.md](./research.md). По умолчанию `false`: новый человек раздела не видит. |

Право на раздел в коде: `role === "admin" || stats_access`. Роли не подчинено (FR-006) — обычный пользователь может иметь право, а админ имеет его всегда (допущение спеки).

## Новая таблица

### `analysis_outcome` — пересчитанный итог одного анализа

```sql
CREATE TABLE analysis_outcome (
  analysis_id  uuid PRIMARY KEY REFERENCES analyses(id) ON DELETE CASCADE,
  version      int NOT NULL,
  method_hash  text NOT NULL,
  status       text NOT NULL CHECK (status IN ('ok', 'empty', 'error')),
  outcome      jsonb,
  error        text,
  computed_at  timestamptz NOT NULL DEFAULT now(),
  CHECK ((status = 'ok') = (outcome IS NOT NULL))
);
```

| Поле | Смысл |
|---|---|
| `analysis_id` | Один итог на анализ. Пересчёт перезаписывает строку целиком (UPSERT), история итогов не ведётся — она не нужна никому и стоила бы места. |
| `version` | Значение `analyses.version` на момент расчёта. Разошлось — итог устарел. |
| `method_hash` | Версия методики (D3). Разошлась — итог устарел, даже если данные не менялись. **Это и есть FR-026.** |
| `status` | `ok` — посчитан; `empty` — в анализе нет ни одного отчёта, в статистику не входит (FR-010); `error` — пересчитать не удалось (FR-012). Все три состояния хранятся одинаково и не пересчитываются повторно до смены ключа (D8). |
| `outcome` | Компактный итог, ≈1,7 КБ (замер). `NULL` при `empty` и `error` — это закреплено ограничением в базе, а не договорённостью. |
| `error` | Причина неудачи, человеческим текстом, для показа числа и причины исключений. |

**Таблица не имеет отношения к правильности самих анализов.** Это производное хранилище: его можно удалить целиком, и следующее открытие раздела восстановит его из анализов. Обратное неверно — и именно поэтому пересчёт ничего не пишет в `analyses` (FR-009, SC-007).

### Правило устаревания — единственное

Итог свеж ⟺ строка есть **и** `outcome.version = analyses.version` **и** `outcome.method_hash = <текущий>`.

Покрывает все шесть путей из FR-025 без единого крючка в маршрутах, потому что `analyses.version` растёт на каждом из них (проверено, см. research.md).

### Запросы, которые нужны разделу

| Зачем | Запрос | Цена |
|---|---|---|
| Что в базе живого | `SELECT id, niche, version FROM analyses WHERE deleted_at IS NULL` | без `bytea`, дёшево |
| Что уже посчитано | `SELECT analysis_id, version, method_hash, status, outcome, error, computed_at FROM analysis_outcome` | ≈0,33 МБ при 200 анализах |
| Пересчитать один | `SELECT core, aggregates_gz, version FROM analyses WHERE id = $1` | один документ за раз (D5) |

Удалённые анализы не попадают в первый запрос, поэтому выпадают из статистики (FR-011), даже если их итог ещё лежит в таблице.

## Фигуры в памяти (не в базе)

### `Outcome` — что кладётся в `outcome jsonb`

Форма повторяет то, что уже отдаёт эталонный `1-recompute.mjs`:

```
{ verdict: { ceiling, decisiveGate, reasons[] },
  amazon:  { present, level, blocks } | null,
  c1:      { okCount, pass, red[], items: {1a..1h: status} },
  eco:     { pending, g1, g2 } | null,
  ch:      { active, pass, green, items: {1..8: {s, t}} } | null,
  budget:  { status, quick } | null,
  sc:      { total, band, weakest } | null,
  gate0:   level,
  stored:  { ceiling } | null }
```

`stored` — вердикт, **сохранённый в анализе**, положенный рядом исключительно ради FR-008: раздел показывает расхождение. На сами цифры статистики `stored` не влияет никогда; тест SC-003 это и проверяет.

### `Summary` — сводка

Не хранится. Считается из набора `Outcome` при каждом запросе (D1). Срезы — ровно те, что перечислены в FR-014…FR-024, и в каждом рядом с процентом лежит число и база (FR-013).

### `Freshness` — состояние расчёта

```
{ computedAt, total, counted, empty, failed, stale, recomputing, methodChanged }
```

`recomputing: true` означает «цифры прежние, идёт догон» (FR-028). `methodChanged` отличает устаревание по методике от устаревания по данным — чтобы человек понимал, почему пересчитывается всё сразу.
