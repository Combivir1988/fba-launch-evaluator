# Data Model: Командная работа и публичные ссылки (spec 002)

PostgreSQL, одна схема `public`, миграция `001_init.sql`. Все времена — `timestamptz` (UTC). Идентификаторы — UUID (анализы — клиентские UUID, как в версии 001).

## users — учётные записи

| Поле | Тип | Правила |
|---|---|---|
| `id` | uuid PK | |
| `login` | text UNIQUE | хранится в нижнем регистре; 3–40 символов `[a-z0-9._-]` |
| `name` | text | отображаемое имя, 1–80 символов |
| `role` | text | `admin` \| `user` |
| `active` | boolean | по умолчанию `true` |
| `password_hash` | text | `scrypt$15$8$3$salt$hash` (R3) |
| `must_change_password` | boolean | `true` после создания и сброса (FR-004) |
| `failed_logins` | int | сбрасывается при успешном входе |
| `locked_until` | timestamptz NULL | +15 мин после 5 неудач подряд (FR-007) |
| `settings` | jsonb | `{modelAi, modelPatents}` (FR-034) |
| `created_at`, `last_login_at` | timestamptz | |

Инварианты: пароль ≥ 10 символов; нельзя отключить, понизить или удалить последнего активного администратора (FR-009) — проверка в той же транзакции; пользователи не удаляются физически (сохраняется авторство), только `active=false`.

## sessions — сеансы

| Поле | Тип | Правила |
|---|---|---|
| `token_hash` | text PK | SHA-256 от токена cookie (R4) |
| `user_id` | uuid FK → users | `ON DELETE CASCADE` |
| `created_at`, `last_seen_at`, `expires_at` | timestamptz | срок 30 дней, скользящее продление не чаще раза в сутки |
| `ua` | text | сокращённый User-Agent, для справки |

Удаляются: при выходе; все сеансы пользователя — при отключении, сбросе и смене пароля; просроченные — при старте и раз в сутки.

## analyses — общая история

| Поле | Тип | Правила |
|---|---|---|
| `id` | uuid PK | клиентский UUID документа |
| `niche`, `core_keyword` | text | для списка и поиска |
| `verdict` | text NULL | итоговый вердикт (правила или AI) |
| `c1_score` | int NULL, `score` numeric NULL | Критерий 1 из 8, scorecard % |
| `sources` | text[] | `xray`, `cerebro`, `poe`, `sqp` |
| `ai_done`, `patents_done` | boolean | значки в списке |
| `core` | jsonb | документ без `aggregates` (inputs, thresholds, sources, results, ai, patents, schemaVersion, methodologyVersion) |
| `aggregates_gz` | bytea NULL | gzip(JSON `aggregates`), до ~1 MB |
| `version` | int | стартует с 1, +1 при каждой записи (R6) |
| `created_by`, `updated_by` | uuid FK → users | автор и последний изменивший (FR-012) |
| `created_at`, `updated_at` | timestamptz | |
| `deleted_at` | timestamptz NULL | мягкое удаление; очищается физически через 30 дней |

Индексы: `(updated_at DESC) WHERE deleted_at IS NULL`; `(created_by)`; поиск — `ILIKE` по `niche`, `core_keyword` и имени автора (до 2 000 строк индекс не нужен).

Правила: читать и сохранять может любой активный пользователь (FR-014); удалять — автор или админ; удаление делает недействительными все ссылки анализа (FR-029); импорт с существующим `id` ничего не меняет (FR-017).

Переходы версии: `create (v=1)` → `save core` / `save aggregates` / `job result` (каждое: `v → v+1`, при несовпадении базовой версии — 409).

## shares — публичные ссылки

| Поле | Тип | Правила |
|---|---|---|
| `id` | uuid PK | |
| `token` | text UNIQUE | 43 символа base64url, 256 бит (R7) |
| `analysis_id` | uuid FK → analyses | |
| `created_by` | uuid FK → users | автор ссылки |
| `mode` | text | `full` \| `no_economics` (FR-024) |
| `snapshot_gz` | bytea | gzip(JSON снимка), см. contracts/share-snapshot.md |
| `snapshot_at` | timestamptz | момент снимка; меняется действием «Обновить ссылку» (FR-023) |
| `snapshot_version` | int | версия анализа, с которой сделан снимок → признак «анализ изменился после снимка» |
| `expires_at` | timestamptz NULL | NULL = без срока; по умолчанию +30 дней |
| `revoked_at` | timestamptz NULL, `revoked_by` uuid NULL | |
| `views` | int, `last_viewed_at` timestamptz NULL | FR-027 |
| `created_at` | timestamptz | |

Состояние (вычисляемое): `active` → `expired` (по времени) | `revoked` (действием) | `orphaned` (анализ удалён). Для посетителя три последних и «не существует» неразличимы. Отозвать может автор анализа, автор ссылки, админ (FR-026). Режим ссылки после создания не меняется — для другого режима создаётся новая ссылка.

## job_log — журнал AI-задач

| Поле | Тип | Правила |
|---|---|---|
| `id` | uuid PK | совпадает с `jobId` задачи в памяти |
| `user_id` | uuid FK → users | кто запустил |
| `analysis_id` | uuid NULL | без FK — запись переживает удаление анализа |
| `niche` | text | копия на момент запуска |
| `type` | text | `analyze` \| `patents` |
| `model` | text | фактическая модель |
| `status` | text | `running` → `done` \| `error` \| `cancelled` \| `interrupted` |
| `error_code` | text NULL | без текста ответа модели |
| `started_at`, `finished_at` | timestamptz | длительность вычисляется |

Индекс `(started_at DESC)`, `(user_id, started_at DESC)`. При старте процесса все `running` → `interrupted`. Админ видит всё и сводку по людям за период; пользователь — только свои записи (FR-033).

## Связи

```text
users 1—N sessions
users 1—N analyses (created_by, updated_by)
analyses 1—N shares
users 1—N shares (created_by)
users 1—N job_log;  analyses 1—N job_log (без FK)
```

## Клиентское состояние

- `localStorage`: `fba_last` (последний открытый анализ), `fba_job:<type>:<analysisId>` (подхват задачи), `fba_side`, тема, `fba_migrated`. Удаляются `fba_token`, `fba_model`, `fba_model_patents` (после копирования в аккаунт).
- IndexedDB версии 001 — только чтение для переноса; после переноса не удаляется.
- В памяти вкладки: текущий анализ + `baseVersion`; флаг «не сохранено» при недоступной БД, экспорт JSON остаётся рабочим.
