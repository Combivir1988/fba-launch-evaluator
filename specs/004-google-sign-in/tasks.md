# Tasks: Вход и регистрация через Google (spec 004)

**Input**: spec.md (US1–US3), plan.md (D1–D8). **Tests**: обязательны, тест перед реализацией. Пути — относительно `fba-launch-evaluator/`.

## Phase 1: Setup

- [x] T001 `server/db/migrations/002_google_sign_in.sql`: `ALTER TABLE users ADD COLUMN email text`, `ADD COLUMN google_sub text UNIQUE`, `CREATE UNIQUE INDEX users_email_lower_idx ON users (lower(email)) WHERE email IS NOT NULL`; `tests/db.test.js` — миграция применяется, индекс не даёт завести вторую почту в другом регистре
- [x] T002 `server/claude.js` (`configFromEnv`): `googleClientId`, `googleClientSecret` из `GOOGLE_OAUTH_CLIENT_ID` / `GOOGLE_OAUTH_CLIENT_SECRET`; `.env.example`, `README.md`

## Phase 2: US2 — приглашения и способы входа (фундамент для US1)

- [x] T003 [US2] `tests/users.test.js` → `server/users.js`: `createUser` принимает `email` и необязательный `password` (без пароля — требуется почта, `password_hash='!'`, `must_change_password=false`, логин из почты с суффиксом при занятости); `updateUser` принимает `email` (нормализация, `409 email_taken`, пустая строка снимает почту); выдача пользователя содержит `email`, `hasPassword`, `googleLinked`; `authenticate` для пользователя без пароля → обычный `invalid_credentials`; `changePassword` без пароля → `no_password`; `findForGoogle({sub, email, name})` — по `sub`, затем по почте с привязкой `sub` и заполнением пустого имени; неприглашённая почта и отключённый пользователь → `google_not_invited`

## Phase 3: US1 + US3 — вход через Google

- [x] T004 [US3] `tests/google-auth.test.js` → `server/google-auth.js`: `begin({redirectUri, next})` → `{url, state}` (параметры: `client_id`, `redirect_uri`, `response_type=code`, `scope=openid email profile`, `state`, `nonce`, `code_challenge` S256, `prompt=select_account`); `finish({code, state, cookieState, redirectUri})` — сверка state с cookie и памятью, одноразовость, TTL 10 мин, обмен кода с `code_verifier` и `client_secret`, `verifyIdToken` (RS256 по JWKS с кэшем и перезагрузкой при неизвестном `kid`, `iss`, `aud`, `exp`, `nonce`, `email_verified`); тесты на каждый отказ: чужая подпись, чужой `aud`, просрочен, неверный `nonce`, неподтверждённая почта, повтор state, чужой браузер, истёкший state, ошибка токен-эндпоинта; `safeNext()` — только путь внутри приложения
- [x] T005 [US1] `server/index.js`: `GET /api/auth/google/start` (cookie `fba_oauth`, 302 на Google; `404`, если вход не настроен), `GET /api/auth/google/callback` (успех → сеанс + 302 на `next`; отказ → 302 на `/login.html?error=…`; cookie `fba_oauth` очищается в любом случае), `/api/health.googleLogin`; лог входов без кодов и токенов
- [x] T006 [US1] `tests/google-auth-api.test.js`: полный поток по HTTP с фальшивым Google (`fetchImpl`): приглашённый входит и получает `fba_sid`; неприглашённый и отключённый → `google_not_invited`, пользователь не создан; отмена на стороне Google → `google_cancelled`; подмена state → `google_retry`; `next=//evil.example` → `/`; второй вход того же `sub` после смены почты в Google; вход по паролю не сломан
- [x] T007 [P] [US1] `public/login.html` + `public/js/login.js` + `public/css/app.css`: кнопка «Войти через Google» по `health.googleLogin`, разделитель «или», тексты ошибок по кодам из D7, сохранение `next`
- [x] T008 [US2] `public/index.html` + `public/js/app.js`: форма добавления — почта и способ входа («только Google» скрывает поле пароля); таблица — почта и способ входа; кнопка «Почта» у пользователя; «Настройки» пользователя без пароля — пояснение вместо формы; предупреждение, если у единственного администратора нет пароля
- [x] T009 [P] Справка в `public/index.html`: вход через Google, приглашение по почте, запасной пароль, режим Testing в консоли Google

## Phase 4: Выпуск

- [x] T010 `npm test` + пробы 7, 9, 10; переменные Railway `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET` (без автодеплоя) → деплой при `health.running = 0` → проверка на проде: `health.googleLogin = true`, `/api/auth/google/start` ведёт на Google с верными `client_id`, `redirect_uri`, `code_challenge`, cookie `fba_oauth` с флагами HttpOnly/Secure/Lax; почта владельца привязывается к его администратору; память проекта и `CLAUDE.md`

**Итого**: 10 задач. Полный вход через экран Google проверяет владелец: автоматизировать его нельзя, а подмена Google в тестах покрывает всю нашу часть потока.
