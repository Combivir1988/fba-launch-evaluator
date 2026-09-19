# Tasks: Командная работа и публичные ссылки на дашборд (spec 002)

**Input**: `specs/002-team-accounts-sharing/` — plan.md (D1–D12), spec.md (US1–US4), research.md (R1–R12), data-model.md, contracts/api.md, contracts/share-snapshot.md, quickstart.md
**Tests**: обязательны (запрошены владельцем): `node:test` + PGlite, jsdom, Playwright-проба. Тест пишется перед реализацией модуля и должен сначала падать.
**Пути** — относительно `fba-launch-evaluator/`.

## Format: `[ID] [P?] [Story] Description`

- **[P]** — можно параллельно (разные файлы, нет зависимости от незавершённых задач)
- **[USn]** — история из spec.md; Setup, Foundational и Polish — без метки

## Phase 1: Setup

- [x] T001 `package.json`: добавить dependency `pg` ^8, devDependency `@electric-sql/pglite`; script `dev` → `MOCK_AI=1 ADMIN_LOGIN=admin ADMIN_PASSWORD=admin-dev-pass node --watch server/index.js`; `.gitignore` += `.data/`; `.env.example`: добавить `DATABASE_URL`, `ADMIN_LOGIN`, `ADMIN_PASSWORD`, `MAX_JOBS`, пометить `APP_PASSWORD` устаревшим; проверить, что `Dockerfile` ставит зависимости с `--omit=dev` (PGlite не попадает в образ)
- [x] T002 `server/db/index.js` — `connect(cfg)`: при `DATABASE_URL` → `pg.Pool` (`max 5`, `idleTimeoutMillis 30000`, `connectionTimeoutMillis 10000`, `pool.on("error")` в лог, замена `sslmode=require` → `verify-full`), иначе при `NODE_ENV≠production` → динамический `import("@electric-sql/pglite")` (`memory://` при `DB_MEMORY=1`, иначе `.data/pg`), в production без URL — ошибка «DATABASE_URL не задан»; единый интерфейс `{query(sql, params) → {rows}, tx(fn), close(), kind:"pg"|"pglite"}`; один повтор запроса при ошибке соединения (`ECONNRESET`, `57P01`); BYTEA всегда возвращать как `Buffer`
- [x] T003 `server/db/migrations/001_init.sql` — таблицы `users`, `sessions`, `analyses`, `shares`, `job_log` и индексы строго по data-model.md (CHECK на `role`, `mode`, `status`, `type`; `login` UNIQUE; `token` UNIQUE; FK с `ON DELETE CASCADE` для sessions)
- [x] T004 `server/db/migrate.js` — таблица `schema_migrations(name, applied_at)`, применение файлов `migrations/*.sql` по имени в транзакции, идемпотентно; вызов при старте сервера до `listen`
- [x] T005 [P] `tests/helpers/db.js` — `testDb()`: один PGlite `memory://` на тестовый файл, миграции, `reset()` (TRUNCATE всех таблиц), `makeUser({role})`; `tests/db.test.js` — миграции применяются дважды без ошибок, `tx` откатывается при исключении, BYTEA возвращается Buffer

## Phase 2: Foundational (блокирует все истории)

- [x] T006 [P] `tests/passwords.test.js` → `server/passwords.js`: `hashPassword`, `verifyPassword` (scrypt N=2^15, r=8, p=3, соль 16 B, ключ 64 B, `maxmem` 64 MB, формат `scrypt$15$8$3$salt$hash`, `timingSafeEqual`), очередь по одному вызову, `dummyVerify()` для неизвестного логина, `validateNewPassword` (≥ 10 символов, ≠ текущему); тесты: верный/неверный пароль, разные соли, битая строка хэша → false, параллельные вызовы выполняются последовательно
- [x] T007 [P] `tests/sessions.test.js` → `server/sessions.js`: `createSession(db, userId, ua)` → токен 32 B base64url, в БД SHA-256; `resolveSession` с кэшем 60 с и скользящим продлением не чаще раза в сутки; `destroySession`, `destroyUserSessions` (чистит и кэш); cookie `fba_sid` (HttpOnly, SameSite=Lax, Path=/, Max-Age 30 дней, `Secure` при production); middleware `attachUser`, `requireUser`, `requireAdmin`, `requirePasswordChanged`; `csrfGuard` (для POST/PUT/PATCH/DELETE: `Content-Type: application/json`, `X-Requested-With: fba`, `Origin`/`Referer` того же хоста → иначе `403 csrf`); очистка просроченных при старте и раз в сутки; тесты на каждый пункт, включая «отключённый пользователь теряет доступ ≤ 60 с»
- [x] T008 `server/claude.js` (`configFromEnv`): читать `DATABASE_URL`, `ADMIN_LOGIN`, `ADMIN_PASSWORD`, `MAX_JOBS` (по умолчанию 4); `server/index.js`: подключить БД и миграции при старте, `attachUser` + `csrfGuard` на `/api`, лимиты тела по роутам (100 KB по умолчанию; 12 MB — aggregates/import; 1 MB — analyze/patents), `503 storage_unavailable` при ошибке БД, `/api/health` += `storage` без обращения к БД, закрытие пула в graceful shutdown; `createApp({db})` принимает готовую БД для тестов
- [x] T009 [P] `public/js/api.js` — `api(method, path, body)`: `credentials: "same-origin"`, заголовки JSON + `X-Requested-With: fba`, разбор `{error, message}`, `401` → переход на `/login.html?next=…`, `403 password_change_required` → `/login.html#change`, `503 storage_unavailable` → событие `storage-down`; экспорт `ApiError`

**Checkpoint**: сервер стартует с PGlite, старые 60 тестов зелёные (авторизация пока прежняя).

## Phase 3: US1 — Вход под своей учётной записью (P1) 🎯 MVP

**Goal**: личные логины, роли, админ управляет людьми, `APP_PASSWORD` исчезает. **Independent test**: quickstart «US1», шаги 1–5. История в браузере продолжает работать как раньше.

- [x] T010 [P] [US1] `tests/users.test.js` → `server/users.js`: `createUser` (логин в нижнем регистре, 3–40 `[a-z0-9._-]`, `409 login_taken`, `must_change_password=true`), `updateUser` (имя/роль/active; запрет оставить систему без активного админа → `last_admin`, проверка в транзакции; `active=false` удаляет сеансы), `resetPassword` (сеансы удаляются, блокировка снимается), `authenticate` (5 неудач подряд → `locked_until` +15 мин; неизвестный и отключённый логин → `dummyVerify` и та же ошибка `invalid_credentials`; успех сбрасывает счётчик, пишет `last_login_at`), `changePassword`, `updateSettings`, `bootstrapAdmin(db, cfg)` (создаёт админа из env, только если нет активного админа), `listUsers` с числом анализов, `listNames`
- [x] T011 [US1] `server/index.js`: роуты `POST /api/auth/login` (IP-лимит 10/10 мин, структурный лог без пароля), `POST /api/auth/logout`, `GET /api/auth/me`, `POST /api/auth/password`, `PATCH /api/auth/settings`, `GET/POST /api/users`, `PATCH /api/users/:id`, `POST /api/users/:id/reset-password`, `GET /api/users/names` — по contracts/api.md; удалить `POST /api/auth/check`, `X-App-Token`, `?token=`; из `server/auth.js` убрать `tokenMatches`/`authMiddleware` (остаётся `rateLimiter`); `bootstrapAdmin` при старте
- [x] T012 [US1] `tests/server.test.js`: переписать на cookie-сеансы (хелпер `login()` возвращает cookie); добавить `tests/auth-api.test.js`: вход/выход, `401` без cookie, `403 csrf` без заголовка, `403 password_change_required` до смены пароля, блокировка после 5 неудач, одинаковый ответ для неизвестного логина, права admin/user на `/api/users`, `last_admin`, отключение пользователя закрывает его сеанс
- [x] T013 [P] [US1] `public/login.html` + `public/js/login.js` + стили в `public/css/app.css`: форма входа, сообщения об ошибках и блокировке (с оставшимся временем), режим принудительной смены пароля (`#change`), переход на `next`; без inline-скриптов (CSP)
- [x] T014 [US1] `public/js/app.js` + `public/index.html`: убрать оверлей пароля и `fba_token`; при старте `GET /api/auth/me` → `S.user`; имя пользователя и «Выйти» в шапке; все вызовы сервера через `api.js`; «Настройки»: смена пароля, модели AI читаются/пишутся в аккаунт (`PATCH /api/auth/settings`) с одноразовым копированием из `fba_model`/`fba_model_patents`
- [x] T015 [US1] `public/js/ai.js`: `EventSource` без `?token=` (cookie), `startJob`/`waitJob` через `api.js`, `401` → страница входа
- [x] T016 [US1] Раздел «Пользователи» в «Настройках» (только admin) в `public/index.html` + `public/js/app.js`: таблица (логин, имя, роль, статус, последний вход, число анализов), создание с временным паролем (генератор 14 символов + «скопировать»), смена роли, отключение/включение, сброс пароля, сообщение при `last_admin`
- [x] T017 [US1] `scripts/ui-probe7.mjs` (часть 1): вход админом → смена пароля → создание пользователя → вход вторым контекстом → раздел «Пользователи» недоступен; обновить `ui-probe3…6` на вход по cookie

**Checkpoint / выпуск шага 1**: `npm test` зелёный; на Railway выставить `DATABASE_URL`, `ADMIN_LOGIN`, `ADMIN_PASSWORD`, деплой при `running=0`; владелец входит админом и заводит людей.

## Phase 4: US2 — Общая история анализов с автором (P1)

**Goal**: анализы на сервере, виден автор и последний изменивший, конфликт версий, перенос локальной истории. **Independent test**: quickstart «US2», шаги 1–5.

- [x] T018 [P] [US2] `tests/analysis-split.test.js` → `shared/analysis.js`: `splitDoc(analysis) → {core, aggregates, meta}` (meta: niche, coreKeyword, verdict, c1, score, sources, aiDone, patentsDone), `joinDoc(core, aggregates)`; round-trip на реальных фикстурах даёт идентичный документ; `core` ≤ 100 KB
- [x] T019 [P] [US2] `tests/analyses.test.js` → `server/analyses.js`: `list({mine, q, limit, offset})` без чтения документов, с именами автора/изменившего, числом активных ссылок; `get` (gunzip aggregates); `saveCore({id, baseVersion, core, meta, force}, user)` — создание при `baseVersion=null` (`409 exists`), `UPDATE … WHERE version=$base`, иначе `conflict {version, updatedBy, updatedAt}`; `saveAggregates` (gzip, та же версия); `copy`; `remove` (автор или admin, мягкое удаление); `importDoc` (`ON CONFLICT (id) DO NOTHING` → `imported:false`); `patchResult(id, key, value, userId)` — точечный `jsonb_set` + `version+1` (для US4); валидация UUID, `schemaVersion`, размеров, запрет `aggregates` внутри `core`
- [x] T020 [US2] `server/index.js`: роуты `GET /api/analyses`, `GET/PUT/DELETE /api/analyses/:id`, `PUT /api/analyses/:id/aggregates`, `POST /api/analyses/:id/copy`, `POST /api/analyses/import` по contracts/api.md; `tests/analyses-api.test.js`: создание → список у другого пользователя с автором, конфликт 409 с именем, `force`, копия, удаление чужого → 403, импорт дважды → один анализ, тело > лимита → 413
- [x] T021 [US2] `public/js/history.js`: серверная реализация `list/get/put/delete/importMany` поверх `api.js` с прежними сигнатурами; чтение старой IndexedDB оставить только в `localHistory.readAll()`
- [x] T022 [US2] `public/js/app.js`: хранить `S.baseVersion`; автосохранение: `core` — debounce 2 с, `aggregates` — только после изменения файлов/кластера Cerebro (флаг `S.aggDirty`); убрать особый режим `fromHistory` (автосохранение работает всегда, версии защищают от перезаписи); `flushSave()` перед запуском задач и перед «Поделиться»; индикатор «сохранено / сохраняю / не сохранено» в шапке; при `storage-down` — работа продолжается, подсказка про экспорт JSON
- [x] T023 [US2] Диалог конфликта в `public/index.html` + `public/js/app.js`: «Анализ изменил <имя> в <время>» → «Сохранить как копию» (`/copy`), «Перезаписать» (`force` с актуальной версией), «Открыть свежую версию»
- [x] T024 [US2] Вкладка «История» в `public/js/app.js` + `public/index.html`: колонки «Автор», «Изменил», фильтр «мои / все», поиск по нише/ключу/автору, значки AI/патенты/есть ссылка/идёт задача, кнопка «Удалить» только для автора и admin; шапка дашборда: «автор · изменил · когда» (`public/js/render.js`, только не-static режим)
- [x] T025 [US2] Перенос локальной истории: при входе, если в IndexedDB есть анализы и нет флага `fba_migrated` → предложение; последовательный `POST /api/analyses/import` с прогрессом, итог «+N новых, M уже были»; кнопка «Перенести локальную историю» в «Настройках»; локальная база не удаляется
- [x] T026 [US2] `scripts/ui-probe7.mjs` (часть 2): пользователь А сохраняет анализ из фикстур → пользователь Б видит его с автором → оба правят → у Б диалог конфликта → копия; F5 сохраняет состояние

**Checkpoint / выпуск шага 2**: владелец переносит свою локальную историю; проверка заполнения БД.

## Phase 5: US3 — Поделиться дашбордом по ссылке (P1)

**Goal**: кнопка «Поделиться» → `/s/:token` без регистрации, снимок только для чтения, срок, отзыв, просмотры, режим без закупочной экономики. **Independent test**: quickstart «US3», шаги 1–6.

- [x] T027 [P] [US3] `tests/share-snapshot.test.js` → `shared/share-snapshot.js`: `buildSnapshot(analysis, {mode, preparedBy, snapshotAt})` по contracts/share-snapshot.md — общий режим (без `cerebro.keywords`, без внутренних id, ≤ 250 KB raw); режим `no_economics` (удаление входов и результатов экономики/бюджета, комментарии критериев 2 и 6, стоп-вопросы, фильтр предложений AI по лексике, страховочный поиск значений с удалением поля и счётчиком `redactions`); тесты на фикстурах + `server/mock-verdict.js`: ни одно значение COGS/маржи/прибыли/ROI/бюджета не встречается в JSON снимка (SC-006), полный режим отличается от документа только оговорённым
- [x] T028 [P] [US3] `tests/shares.test.js` → `server/shares.js`: `create` (токен 32 B base64url, снимок gzip, `expiresInDays` 7/30/null, по умолчанию 30), `refresh` (тот же токен, новый снимок и `snapshot_version`), `revoke`, `listForAnalysis`, `listAll/mine`, `getPublic(token)` → снимок или `null` для несуществующей/отозванной/истёкшей/удалённого анализа, `countView(token, ip, hasSession)` (не чаще раза в 30 мин с IP, не считать вошедших); права: автор анализа, автор ссылки, admin; вычисляемые `state` и `stale`
- [x] T029 [US3] `server/index.js`: роуты `POST/GET /api/analyses/:id/shares`, `GET /api/shares`, `POST /api/shares/:id/refresh`, `DELETE /api/shares/:id`; публичные `GET /s/:token` (всегда одна `share.html`) и `GET /api/public/shares/:token` (единый `404 link_unavailable`, лимит 60/10 мин на IP, без сеанса) с заголовками `X-Robots-Tag`, `Referrer-Policy: no-referrer`, `Cache-Control: no-store`; `public/robots.txt` (`Disallow: /s/`); `tests/shares-api.test.js`: доступ без cookie, неразличимость трёх причин 404 (тело и заголовки), отзыв действует сразу, удаление анализа гасит ссылки, права, счётчик просмотров
- [x] T030 [US3] `public/js/render.js`: поддержка `opts.hidden` (не рисовать секции `economics`, `budget` и экономические поля в `hero`, `overview`, `quick`, `conclusion`), шапка снимка «Подготовил … · снимок от … · только чтение» и пометка «закупочная экономика скрыта автором»; в static-режиме разделы без данных показывают «не выполнялось»; `tests/render.test.js`: оба режима рисуются в jsdom без ошибок и без `button[data-action]`, `input`, `select`
- [x] T031 [US3] `public/share.html` + `public/js/share.js`: загрузка снимка, рендер `FBARender.render(el, analysis, {static:true, hidden})`, переключатель темы, «Скачать HTML» (вынести сборку автономного HTML из `public/js/export.js` в переиспользуемую функцию, принимающую документ и опции), единый экран «Ссылка недействительна…», `<meta name="robots">`, `<meta name="referrer">`, вёрстка от 360 px; `tests/share-page.test.js` (jsdom)
- [x] T032 [US3] Диалог «Поделиться» в `public/index.html` + `public/js/app.js`: кнопка в строке истории и в открытом анализе; выбор режима и срока; `flushSave()` → создание → копирование в буфер; список ссылок анализа (автор, дата, срок, режим, просмотры, последний просмотр, «анализ изменён после снимка»), действия «Копировать», «Обновить ссылку», «Отозвать»; для admin — общий список ссылок в «Настройках»
- [x] T033 [US3] `scripts/ui-probe7.mjs` (часть 3): «Поделиться» → новый контекст браузера без cookie открывает `/s/…` → графики отрисованы (подсчёт пикселей, как в `ui-probe.mjs`), нет элементов управления, мобильная ширина 360 px → режим `no_economics`: поиск значений в `page.content()` и в скачанном HTML → отзыв → единый экран; случайный токен → тот же экран

**Checkpoint / выпуск шага 3**: владелец отправляет первую ссылку.

## Phase 6: US4 — Параллельная работа и учёт AI-задач (P2)

**Goal**: лимиты, результат пишет сервер, подхват задачи с любого устройства, журнал. **Independent test**: quickstart «US4», шаги 1–5.

- [ ] T034 [P] [US4] `tests/joblimits.test.js` → `server/jobs.js`: `meta {userId, userName, analysisId, niche}`; `checkLimits(type, meta, maxJobs)` → `user_limit` | `analysis_limit` | `global_limit` со списком идущих задач; `findRunning({analysisId})`; отмена — запустивший или admin
- [ ] T035 [P] [US4] `tests/joblog.test.js` → `server/joblog.js`: `start(job)`, `finish(jobId, status, errorCode, model)`, `markInterrupted()` при старте процесса, `list({from, to, userId, limit}, viewer)` (user видит только свои) + `summary` по людям
- [ ] T036 [US4] `server/index.js`: `POST /api/analyze` и `/api/patents/scan` требуют `analysisId` существующего анализа (`404 analysis_not_saved`), проверяют лимиты (`429` с причиной и `running`), пишут журнал; по завершении сервер сам сохраняет результат через `analyses.patchResult` (для AI — после `reconcile` из `shared/verdict-rules.js` по `results` сохранённого `core`) и добавляет `analysisVersion` в событие `done`; роуты `GET /api/analyses/:id/jobs`, `GET /api/joblog`, `GET /api/admin/storage`; `tests/jobs-api.test.js`: два пользователя параллельно (mock), личный и общий лимит, результат в БД при отсутствии подписчиков SSE, журнал, подхват по анализу
- [ ] T037 [US4] `public/js/ai.js` + `public/js/app.js`: передавать `analysisId`, `flushSave()` перед запуском, принимать `analysisVersion` как новую `baseVersion` (без ложного конфликта), убрать клиентский `persistJobResult`; при открытии анализа опрашивать `/api/analyses/:id/jobs` и подключаться к идущей задаче, показывать «запустил <имя>»; понятные сообщения для трёх видов лимита
- [ ] T038 [US4] Раздел «Журнал задач» в «Настройках» (`public/index.html` + `public/js/app.js`): период, таблица (пользователь, тип, ниша, модель, длительность, итог), сводка по людям для admin; индикатор заполнения хранилища для admin (предупреждение с 80 %)

## Phase 7: Polish & выпуск

- [ ] T039 [P] Вкладка «Справка» в `public/index.html`: разделы «Учётные записи», «Общая история и одновременная работа», «Поделиться», «Лимиты и журнал задач»; убрать упоминания общего пароля
- [ ] T040 [P] Документация: `README.md` (запуск, переменные, Neon), `specs/002-team-accounts-sharing/quickstart.md` — сверить с фактом; в `specs/001-fba-launch-evaluator/contracts/api.md` пометить заменённые разделы ссылкой на контракт 002
- [ ] T041 Безопасность — финальная проверка: `grep` по репозиторию на приватные имена и секреты; CSP для `login.html` и `share.html`; cookie-флаги на проде; логи не содержат паролей, токенов сеансов и токенов ссылок; `/api/health` не будит БД (проверить по метрикам Neon)
- [ ] T042 Полный прогон: `npm test`, `node scripts/ui-probe7.mjs`, все сценарии quickstart на проде; RAM процесса по метрикам Railway < 300 MB после часа работы с двумя пользователями
- [ ] T043 Выпуск: удалить `APP_PASSWORD` из переменных Railway; обновить память проекта и строку в корневом `CLAUDE.md`; отметить задачи выполненными

## Dependencies

- Phase 1 → Phase 2 → US1 → US2 → US3; US4 зависит от US2 (запись результата в серверный анализ), от US3 не зависит.
- Внутри истории: тест-задача модуля → реализация → роуты → интерфейс → проба.
- T008 зависит от T002–T004; T011 — от T006, T007, T010; T020 — от T019; T029 — от T027, T028; T036 — от T019, T034, T035.

## Parallel examples

- Phase 2: T006 ‖ T007 ‖ T009.
- US1: T010 ‖ T013; затем T011 → T012; T014 → T015 → T016.
- US2: T018 ‖ T019; US3: T027 ‖ T028; US4: T034 ‖ T035; Polish: T039 ‖ T040.

## Implementation strategy

- **MVP = Phase 1–3 (US1)**: выпускается сразу, история временно остаётся в браузере; база уже создана (Neon, проверено 2026-09-19).
- Далее по одному шагу с выпуском после каждого: US2 → US3 → US4 → Polish. Каждый выпуск — по правилу `health.running = 0`.
- Прежние 60 тестов должны оставаться зелёными после каждой фазы.

**Итого**: 43 задачи — Setup 5, Foundational 4, US1 8, US2 9, US3 7, US4 5, Polish 5.
