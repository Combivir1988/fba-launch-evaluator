# FBA Launch Evaluator

Веб-версия скилла `fba-launch-evaluator`: оценка ниши/товара для запуска на Amazon FBA — **Go / Go условно / Доработка / No-Go**. Русский интерфейс, интерактивный дашборд с графиками и ползунками, AI-синтез через Claude, история анализов, скачивание дашборда.

## Что делает

1. **Вход**: название ниши + главный ключ, файлы Helium 10 **Xray** CSV и **Cerebro** CSV, опционально **POE JSON** (экспорт Product Opportunity Explorer расширением POE Analyzer) и **SQP** CSV. Файлы разбираются в браузере и не уходят на сервер. Учитываются ловушки экспортов: BOM, «69,95», «6 892» (неразрывный пробел), дубли ASIN, иерархия вариаций, `>100,000`, `N/A`.
2. **Детерминированные расчёты** (мгновенно, локально):
   - Критерий 1 (1a–1h) с порогом 6 из 8 — источники Xray/Cerebro, прокси POE (явно помечены), ручной ввод;
   - Gate 1 (маржа/профит) и Gate 2 (стресс-тест рекламы по CVR 8/10/12/15 %), ROI, Критерий 2 (2a–2k — только из чисел менеджера);
   - бюджет первой закупки (урок 08) и четыре стоп-вопроса (урок 07);
   - распределение трафика по ключам (урок 09), концентрация кликов POE (урок 11);
   - критерии 3–8 против доминирующего игрока (обязательные 6 и 8), 5-осевой scorecard, сверка источников;
   - «потолок» вердикта по правилам.
3. **AI-анализ** через **OpenRouter** (любая модель: Gemini, GPT, Claude, DeepSeek, Grok… — выбор в интерфейсе) или напрямую Claude API (`AI_PROVIDER=anthropic`): модель получает компактный агрегат (не файлы) и возвращает JSON по схеме — вердикт, решающий гейт, обоснование, гипотезы дифференциации из отзывов, рекомендации, шаги. Вердикт AI **не может быть мягче правил**: при конфликте понижается с пометкой.
4. **Патентный скан (критерий 8 / Gate 4)**: AI формирует запросы к Google Patents по типу товара и вашей ключевой фиче, читает независимые claims найденных US-патентов и заявок, оценивает пересечение с ТЗ, предлагает design-around и следующие шаги. Результат — предварительный скрининг (критерий 8 = 🟡 допущение; 🟢 подтверждает человек/поверенный). Design patents ищутся только по названию. Источник: `patents.google.com` (XHR поиска и карточек), без ключей.
5. **Дашборд**: KPI, таблица-гейт Критерия 1, живая экономика (ползунки), бюджет, конкуренты, ценовые сегменты, сезонность, структура ниши, тональность отзывов, критерии 3–8, scorecard, чеклист рисков, AI-блок. Тёмная/светлая тема, мобильная вёрстка.
6. **История** в браузере (IndexedDB) + экспорт/импорт JSON; **скачивание** автономного HTML (офлайн, графики внутри) и JSON.

## Запуск локально

```bash
npm install
cp .env.example .env      # OPENROUTER_API_KEY (или ANTHROPIC_API_KEY), APP_PASSWORD
npm test                  # ~50 тестов на реальных фикстурах
npm start                 # http://localhost:3000
```

Без ключа AI: `MOCK_AI=1 APP_PASSWORD=dev npm start` (или `npm run dev`) — AI вернёт демонстрационный вердикт.

## Деплой (бесплатно)

**Render Free** (рекомендуется): New → Blueprint → этот репозиторий (`render.yaml`), задать `OPENROUTER_API_KEY` и `APP_PASSWORD`. Сервер засыпает после 15 мин простоя — первый запрос до ~60 с.

**Railway**: Deploy from GitHub — подхватит `Dockerfile` / `railway.json` (после пробного кредита тариф платный).

**Hugging Face Spaces**: Space типа Docker, переменные в Settings → Secrets; порт берётся из `PORT` (7860).

## Переменные окружения

| Переменная | Назначение | По умолчанию |
|---|---|---|
| `AI_PROVIDER` | `openrouter` \| `anthropic` | `openrouter`, если задан `OPENROUTER_API_KEY` |
| `OPENROUTER_API_KEY` | ключ OpenRouter (только сервер) | — |
| `OPENROUTER_MODEL` / `OPENROUTER_MODELS` | модель по умолчанию / список для выбора в UI | `google/gemini-3.8-flash` / см. `.env.example` |
| `OPENROUTER_REASONING` | запрашивать reasoning у модели | `0` |
| `ANTHROPIC_API_KEY` | ключ Claude напрямую (при `AI_PROVIDER=anthropic`) | — |
| `APP_PASSWORD` | общий пароль доступа к `/api/*` | — (без него 503) |
| `CLAUDE_MODEL` | модель | `claude-opus-5` |
| `CLAUDE_EFFORT` | `low\|medium\|high\|xhigh\|max` | `high` |
| `CLAUDE_FALLBACKS` | серверные fallbacks при refusal (beta) | `1` |
| `MOCK_AI` | демонстрационный вердикт без Claude | `0` |
| `RATE_LIMIT_PER_HOUR` | лимит `/api/analyze` на IP | `20` |
| `PORT` | порт | `3000` |

Стоимость одного AI-анализа (≈ 6–10k входных + 2–3k выходных токенов): `google/gemini-3.8-flash` ≈ $0.02, `openai/gpt-5.6-sol` ≈ $0.05, `anthropic/claude-sonnet-5` ≈ $0.05, `anthropic/claude-opus-5` ≈ $0.10; модели `:free` на OpenRouter — $0 (с лимитами частоты). Структурированный вывод: каскад json_schema → json_object → извлечение JSON из текста, ответ всегда валидируется по схеме.

## Структура

- `shared/` — расчётное ядро (ESM, общий код для браузера и тестов): парсеры, критерий 1, экономика, бюджет, трафик, конкуренция, критерии 3–8, scorecard, правила вердикта, сборка AI-payload.
- `server/` — Express: статика, авторизация, rate-limit, `POST /api/analyze` (SSE-стрим OpenRouter/Claude, structured outputs), `POST /api/patents/scan` (SSE: запросы → Google Patents → оценка claims).
- `public/` — SPA без сборки: `js/app.js` (состояние), `js/render.js` (дашборд, инлайнится в экспорт), `js/history.js` (IndexedDB), `vendor/` (Chart.js, PapaParse).
- `tests/` — `node --test` на фикстурах (`tests/fixtures/`).
- `specs/001-fba-launch-evaluator/` — spec / plan / research / data-model / contracts / tasks.

## Безопасность

Ключи AI-провайдеров никогда не попадают в браузер. Все `/api/*` кроме `/api/health` требуют заголовок `X-App-Token` = `APP_PASSWORD` (сравнение в постоянное время), лимит 20 запросов/час на IP, тело ≤ 1 МБ, CSP без inline-скриптов, логи без содержимого запросов.
