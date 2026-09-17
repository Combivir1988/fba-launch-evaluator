# HTTP контракт сервера

Base: тот же origin, что и статика. Все `/api/*` кроме `/api/health` требуют заголовок `X-App-Token: <APP_PASSWORD>`; иначе `401 {"error":"unauthorized"}`. Если `APP_PASSWORD` не задан на сервере — `503 {"error":"app_password_not_configured"}` (защита от случайного открытого деплоя).

## GET /api/health

`200 {"ok":true,"model":"claude-opus-5","mock":false,"uptime":123}` — без авторизации (для health-check хостинга).

## POST /api/auth/check

Тело пустое. `204` если токен верный, `401` иначе. Используется экраном входа.

## POST /api/analyze — SSE

Схема ответа AI: `shared/ai-verdict.schema.json` (источник истины; копия — `contracts/ai-verdict.schema.json`). Перед отправкой в API из схемы вырезаются `minItems`/`maxItems`/`$schema`/`title` (не поддерживаются structured outputs), локальная валидация — `shared/validate-verdict.js` по полной схеме.


Request `Content-Type: application/json`, ≤ 1 МБ:

```json
{
  "niche": "urinal screen deodorizer",
  "coreKeyword": "urinal screen deodorizer",
  "locale": "ru",
  "payload": { /* результат shared/ai-payload.js: gate0, criterion1, economics, budget, traffic, competition(top 20), challenger, scorecard, verdict(ceiling), reconciliation, poe: {summary, terms top 20, reviews neg/pos 10, insights text}, inputsSummary */ },
  "options": { "effort": "high" }
}
```

Response `Content-Type: text/event-stream`, события:

| event | data | Когда |
|---|---|---|
| `meta` | `{"model":"claude-opus-5","requestId":"..."}` | сразу после старта запроса к Claude |
| `thinking` | `{"text":"..."}` | дельты сводки размышлений (если модель отдаёт) |
| `delta` | `{"chars":1234}` | прогресс генерации JSON (длина накопленного текста), сам текст не шлётся |
| `done` | `{"verdict": AIVerdict, "usage": {"input":..,"output":..,"cacheRead":..,"cacheWrite":..}, "durationMs":..}` | финал; `verdict` уже провалидирован схемой; согласование с правилами делает клиент (у него полный Results) |
| `error` | `{"code":"rate_limited"|"auth"|"bad_request"|"upstream"|"parse"|"refusal","message":"...","retryable":true}` | ошибка; соединение закрывается |

Ограничения: 20 запросов/час на IP (`429 {"error":"rate_limited","retryAfter":..}`), таймаут upstream 180 с. Заголовки ответа: `Cache-Control: no-cache`, `X-Accel-Buffering: no`.

`MOCK_AI=1` — сервер не ходит в Claude, отдаёт детерминированный `AIVerdict` из `server/mock-verdict.js` с задержкой 300 мс и парой `thinking`-событий (для e2e и демо без ключа).

## Переменные окружения

| Переменная | Обязательна | По умолчанию | Назначение |
|---|---|---|---|
| `ANTHROPIC_API_KEY` | да (кроме MOCK) | — | ключ Claude |
| `APP_PASSWORD` | да | — | общий пароль доступа |
| `CLAUDE_MODEL` | нет | `claude-opus-5` | модель |
| `CLAUDE_EFFORT` | нет | `high` | `low|medium|high|xhigh|max` |
| `CLAUDE_FALLBACKS` | нет | `1` | серверные fallbacks при refusal |
| `MOCK_AI` | нет | `0` | мок-режим |
| `PORT` | нет | `3000` | порт (HF Spaces задаёт 7860) |
| `RATE_LIMIT_PER_HOUR` | нет | `20` | лимит `/api/analyze` |
