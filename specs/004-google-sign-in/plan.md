# Implementation Plan: Вход и регистрация через Google

**Branch**: `main` | **Date**: 2026-09-20 | **Spec**: [spec.md](spec.md)

## Summary

OpenID Connect (authorization code + PKCE) поверх существующих учётных записей spec 002. Google только подтверждает личность; сеанс остаётся нашим (`fba_sid`). Регистрация — по приглашению: администратор задаёт почту, при первом входе к пользователю привязывается постоянный идентификатор Google (`sub`). Вход по паролю остаётся. Новых зависимостей нет.

## Technical Context

**Language/Version**: Node 22 + Express 5, vanilla JS · **Dependencies**: без новых (`node:crypto` для PKCE, состояния и проверки подписи RS256 по JWKS)
**Storage**: миграция `002_google_sign_in.sql` — `users.email` (UNIQUE по `lower(email)`), `users.google_sub` (UNIQUE); пользователь без пароля хранит в `password_hash` значение-заглушку `!` (не разбирается как scrypt → вход по паролю невозможен)
**Testing**: `node --test` + PGlite; Google подменяется `fetchImpl` (токен-эндпоинт и JWKS), ID-токены подписываются тестовой RSA-парой — полностью офлайн; Playwright-проба с локальным фальшивым провайдером не нужна: поток проверяется на уровне HTTP в `tests/google-auth-api.test.js`
**Constraints**: CSP без изменений (переход на Google — обычная навигация); `SameSite=Lax` пропускает cookie на возврате с Google (GET верхнего уровня); один экземпляр сервера (незавершённые входы — в памяти, TTL 10 мин)
**Проверено до кода (2026-09-20)**: авторизационный эндпоинт Google принимает оба адреса возврата с нашим Client ID, чужой адрес отклоняет (`redirect_uri_mismatch`); discovery: `authorization_endpoint` https://accounts.google.com/o/oauth2/v2/auth, `token_endpoint` https://oauth2.googleapis.com/token, `jwks_uri` https://www.googleapis.com/oauth2/v3/certs, `issuer` https://accounts.google.com

## Constitution Check

Шаблон конституции не заполнен; гейты планов 001–003: простота ✅ (один модуль `server/google-auth.js`, два роута), тестируемость ✅ (все сетевые вызовы через `fetchImpl`), без лишних абстракций ✅ (не «провайдеры входа», а конкретно Google), секреты ✅ (`GOOGLE_OAUTH_CLIENT_SECRET` только в env), наблюдаемость ✅ (лог входов без токенов).

## Ключевые решения

- **D1 — Код + PKCE + state + nonce.** `state` (32 B) хранится в памяти сервера с `nonce`, `code_verifier`, `next`, сроком 10 мин и дублируется в HttpOnly-cookie `fba_oauth`; на возврате сверяются параметр, cookie и запись в памяти, запись удаляется (одноразовость, защита от login-CSRF — US3-2).
- **D2 — Проверка ID-токена полностью:** подпись RS256 по JWKS Google (кэш 1 ч, перезагрузка при неизвестном `kid`), `iss` ∈ {`https://accounts.google.com`, `accounts.google.com`}, `aud` = наш Client ID, `exp` с допуском 60 с, `nonce`, `email_verified === true`. Спецификация OIDC позволяет не проверять подпись токена, полученного напрямую с токен-эндпоинта по TLS, но проверка дешёвая и закрывает ошибки конфигурации.
- **D3 — Сопоставление пользователя:** сначала по `google_sub`, затем по `lower(email)`; при первом совпадении по почте `sub` привязывается. Неприглашённая почта и отключённый пользователь → один и тот же отказ `google_not_invited` (FR-003).
- **D4 — Приглашение = запись в `users` без пароля.** Логин генерируется из почты (часть до `@`, с суффиксом при занятости) — поле `login` остаётся обязательным и уникальным, остальной код не меняется. Имя, если не задано, берётся из Google при первом входе.
- **D5 — Адрес возврата:** `PUBLIC_URL` + `/api/auth/google/callback`, если `PUBLIC_URL` задан (прод), иначе из запроса (локально `http://localhost:3000`). Должен совпадать с зарегистрированным в консоли Google символ в символ.
- **D6 — Возврат после входа** — только относительный путь внутри приложения (та же проверка, что в `login.js`).
- **D7 — Ошибки** возвращают на `/login.html?error=<код>`; коды: `google_not_invited`, `google_cancelled`, `google_failed`, `google_retry`. Тексты — на странице входа.
- **D8 — Кнопка показывается по `/api/health.googleLogin`** (публичный флаг, без секретов).

## Project Structure

```text
server/db/migrations/002_google_sign_in.sql   # НОВ
server/google-auth.js                          # НОВ: createGoogleAuth(cfg, {fetchImpl, now}) → { enabled, begin(), finish() }, verifyIdToken
server/users.js                                # ИЗМ: email, приглашение без пароля, findForGoogle(), hasPassword/method в выдаче
server/claude.js, server/index.js              # ИЗМ: конфиг, роуты /api/auth/google/start|callback, health.googleLogin
public/login.html, public/js/login.js          # ИЗМ: кнопка, сообщения об ошибках
public/index.html, public/js/app.js            # ИЗМ: «Пользователи» (почта, способ входа), «Настройки» без пароля, справка
tests/google-auth.test.js, tests/google-auth-api.test.js, tests/users.test.js (доп.)   # НОВ/ИЗМ
```

## Порядок

1. Миграция + `users.js` (почта, приглашение, сопоставление) с тестами. 2. `google-auth.js` с тестами проверки токена и состояния. 3. Роуты + HTTP-тесты потока. 4. Интерфейс + справка. 5. Переменные Railway, деплой при `running = 0`, проверка на проде (начало входа ведёт на Google с верными параметрами; полный вход проверяет владелец — он единственный, кто может пройти экран Google).
