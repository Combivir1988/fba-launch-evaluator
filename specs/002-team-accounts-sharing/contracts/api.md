# HTTP контракт сервера — изменения spec 002

Дополняет и частично заменяет `specs/001-fba-launch-evaluator/contracts/api.md`. Base — тот же origin.

## Общие правила

- **Аутентификация**: cookie `fba_sid` (HttpOnly, Secure, SameSite=Lax). Заголовок `X-App-Token` и параметр `?token=` удаляются. Без сеанса: `401 {"error":"unauthorized"}` — клиент показывает страницу входа.
- **Без сеанса доступны**: `GET /api/health`, `POST /api/auth/login`, `GET /s/:token`, `GET /api/public/shares/:token`, статика.
- **Изменяющие запросы** (POST/PUT/PATCH/DELETE): `Content-Type: application/json`, `X-Requested-With: fba`, `Origin` того же хоста; иначе `403 {"error":"csrf"}`.
- **Роли**: `403 {"error":"forbidden"}` при нехватке прав. `must_change_password=true` → все `/api/*`, кроме `auth/*`, отвечают `403 {"error":"password_change_required"}`.
- **БД недоступна**: `503 {"error":"storage_unavailable","message":"Хранилище недоступно — изменения не сохранены"}`; клиент держит работу во вкладке и предлагает экспорт JSON.
- Лимит тела: 100 KB по умолчанию; `PUT …/aggregates` и `POST /api/analyses/import` — 12 MB; `POST /api/analyze`, `/api/patents/scan` — 1 MB.
- Ошибки: `{"error":"<code>","message":"<по-русски>"}`.

## GET /api/health

Без изменений и **без обращения к БД**: `{ok, provider, model, models, mock, uptime, running}`. Добавляется `"storage":"pg"|"pglite"` (без проверки соединения).

## Аутентификация

| Метод | Путь | Тело → Ответ |
|---|---|---|
| POST | `/api/auth/login` | `{login, password}` → `200 {user}` + cookie; `401 {"error":"invalid_credentials"}` (одинаково для неверного пароля, неизвестного и отключённого логина); `429 {"error":"locked","retryAfter":сек}`; IP-лимит 10/10 мин |
| POST | `/api/auth/logout` | → `204`, сеанс удалён, cookie очищена |
| GET | `/api/auth/me` | → `200 {user, mustChangePassword}` |
| POST | `/api/auth/password` | `{current, next}` → `204`; `next` ≥ 10 символов и ≠ `current`; остальные сеансы пользователя удаляются |
| PATCH | `/api/auth/settings` | `{modelAi?, modelPatents?}` → `200 {settings}` |

`user` = `{id, login, name, role, settings}`.

## Пользователи (только admin)

| Метод | Путь | Тело → Ответ |
|---|---|---|
| GET | `/api/users` | → `[{id, login, name, role, active, mustChangePassword, lastLoginAt, createdAt, analyses, lockedUntil}]` |
| POST | `/api/users` | `{login, name, role, password}` → `201 {user}`; `409 {"error":"login_taken"}`; пароль временный → `mustChangePassword=true` |
| PATCH | `/api/users/:id` | `{name?, role?, active?}` → `200 {user}`; `409 {"error":"last_admin"}` при попытке оставить систему без активного админа; `active=false` удаляет сеансы |
| POST | `/api/users/:id/reset-password` | `{password}` → `204`; сеансы удаляются, `mustChangePassword=true`, блокировка снимается |

`GET /api/users/names` (любой вошедший) → `[{id, name}]` — для фильтра по автору.

## Анализы

| Метод | Путь | Описание |
|---|---|---|
| GET | `/api/analyses?mine=1&q=&limit=&offset=` | список без документов: `{items:[{id, niche, coreKeyword, verdict, c1, score, sources, aiDone, patentsDone, createdBy:{id,name}, updatedBy:{id,name}, createdAt, updatedAt, version, shares:N, runningJobs:[type]}], total}`; сортировка по `updatedAt DESC` |
| GET | `/api/analyses/:id` | `200 {meta, core, aggregates}` (сервер распаковывает gzip); `404` |
| PUT | `/api/analyses/:id` | создать или сохранить `core`: `{baseVersion:number\|null, core, meta:{niche, coreKeyword, verdict, c1, score, sources, aiDone, patentsDone}, force?:boolean}` → `200 {version, updatedAt}`; `baseVersion=null` — создание (`409 exists`, если id занят); конфликт → `409 {"error":"conflict","version","updatedBy":{id,name},"updatedAt"}`; `force=true` с актуальной `baseVersion` = осознанная перезапись |
| PUT | `/api/analyses/:id/aggregates` | `{baseVersion, aggregates}` (≤ 12 MB) → `200 {version}`; те же правила конфликта |
| POST | `/api/analyses/:id/copy` | `{core, aggregates?}` → `201 {id, version}` — «сохранить как копию», автор — текущий пользователь |
| DELETE | `/api/analyses/:id` | автор или admin → `204`; ссылки анализа перестают работать |
| POST | `/api/analyses/import` | `{analysis}` (полный документ версии 001, ≤ 12 MB) → `201 {id, imported:true}` или `200 {id, imported:false}` если id уже есть (идемпотентно) |
| GET | `/api/analyses/:id/jobs` | идущие задачи по анализу: `[{jobId, type, startedBy:{id,name}, startedAt}]` |

Сервер проверяет: `id` — UUID; `core.schemaVersion` ≤ поддерживаемой; размеры; `aggregates` в `core` не принимаются.

## Публичные ссылки

| Метод | Путь | Описание |
|---|---|---|
| POST | `/api/analyses/:id/shares` | `{mode:"full"\|"no_economics", expiresInDays:7\|30\|null}` → `201 {share}`; снимок строится сервером из сохранённого анализа |
| GET | `/api/analyses/:id/shares` | → `[{share}]` анализа (активные и завершённые) |
| GET | `/api/shares?mine=1` | все ссылки команды (admin) или свои |
| POST | `/api/shares/:shareId/refresh` | пересобрать снимок из текущего состояния, адрес прежний → `200 {share}`; автор анализа, автор ссылки, admin |
| DELETE | `/api/shares/:shareId` | отозвать → `204`; те же права |

`share` = `{id, url, mode, state:"active"|"expired"|"revoked", createdBy:{id,name}, createdAt, snapshotAt, stale:boolean, expiresAt, views, lastViewedAt}`; `stale=true`, если анализ менялся после снимка.

### Публичная часть (без сеанса)

- `GET /s/:token` → всегда `200` и одна и та же `share.html` (оболочка, без данных). Заголовки: `X-Robots-Tag: noindex, nofollow`, `Referrer-Policy: no-referrer`, `Cache-Control: no-store`.
- `GET /api/public/shares/:token` → `200 {snapshot}` (см. `share-snapshot.md`) либо единый `404 {"error":"link_unavailable"}` для несуществующей, отозванной, истёкшей ссылки и удалённого анализа. Время ответа не зависит от причины. Лимит 60 запросов/10 мин на IP → `429`. Засчитывает просмотр (правила — research R7).
- Публичная страница обращается только к этому эндпоинту и к статике (`/css`, `/vendor`, `/js/render.js`, `/js/share.js`).

## Задачи (изменения)

- `POST /api/analyze`, `POST /api/patents/scan`: в тело добавляется обязательный `analysisId`; анализ должен существовать на сервере (`404 analysis_not_saved` иначе). Ответ `202 {jobId}` как раньше.
- Отказы по лимитам: `429 {"error":"user_limit"|"analysis_limit"|"global_limit","message","running":[{type, niche, startedBy, startedAt}]}`.
- `GET /api/jobs/:id/events` — SSE без `?token=` (cookie). Событие `done` дополняется `analysisVersion` — новой версией анализа после записи результата сервером. Остальные события (`meta`, `thinking`, `delta`, `stage`, `job_error`, `end`) без изменений. Доступ к задаче — любой вошедший пользователь (анализы общие).
- `DELETE /api/jobs/:id` — запустивший или admin.

## Журнал задач

| Метод | Путь | Описание |
|---|---|---|
| GET | `/api/joblog?from=&to=&userId=&limit=` | admin — все записи, user — только свои: `{items:[{id, user:{id,name}, type, niche, analysisId, model, status, errorCode, startedAt, durationMs}], summary:[{user, count, done, errors, totalMs}]}` |
| GET | `/api/admin/storage` | admin: `{bytes, limitBytes, analyses, shares, pct}` — заполнение БД |
