# Quickstart: FBA Launch Evaluator

## Локально

```bash
cd fba-launch-evaluator
npm install
cp .env.example .env        # заполнить ANTHROPIC_API_KEY, APP_PASSWORD
npm test                    # node --test на фикстурах
npm start                   # http://localhost:3000
```

Без ключа Claude: `MOCK_AI=1 APP_PASSWORD=dev npm start` — AI-блок вернёт демонстрационный вердикт.

## Проверка сценариев спеки

1. Открыть приложение, ввести пароль (`APP_PASSWORD`).
2. Ниша: `car sound deadening mat`; загрузить `tests/fixtures/Helium_10_Xray_2026-08-21.csv` и `US_AMAZON_cerebro__2026-08-21.csv` → «Рассчитать». Проверить: Niche Revenue, медиана цены (≥100 отзывов), Top Brand Share (KILMAT), Критерий 1 «X/8».
3. Загрузить `tests/fixtures/POE_urinal_screen_deodorizer_2026-09-15.json` в новом анализе без Xray → 1a/1c помечены «прокси POE», график сезонности по 104 неделям, отзывы (Smell 48.7 % негатива).
4. Экономика: цена 23.90 / COGS 6.5 / CPC 1.2 / CVR 10 % → Gate 2 NO-GO; цена 42.99 / COGS 13.9 → PASS (кейс Jitsu). Двигать ползунок CVR — график и статус меняются мгновенно.
5. «AI-анализ» → стрим прогресса → вердикт; при MOCK — демонстрационный. Проверить флаг «скорректирован правилами», если правила понизили вердикт.
6. Обновить страницу → анализ в «Истории»; открыть, «Скачать HTML» — открыть файл офлайн; «Экспорт истории» → удалить всё → «Импорт» → список восстановлен.

## Деплой на Render (Free)

1. Репозиторий на GitHub (приватный подойдёт).
2. Render → New → Blueprint → выбрать репо (`render.yaml` подхватится) или Web Service → Docker.
3. Env: `ANTHROPIC_API_KEY`, `APP_PASSWORD` (обязательно), при желании `CLAUDE_MODEL`, `CLAUDE_EFFORT`.
4. После деплоя: `GET https://<app>.onrender.com/api/health` → `{"ok":true}`. Первый запрос после простоя — до 60 с (холодный старт Free-плана).

## Railway / Hugging Face Spaces

- Railway: New Project → Deploy from GitHub → определяется `Dockerfile`/`railway.json`; переменные те же. (Тариф Railway после пробного кредита платный.)
- HF Spaces: Space type **Docker**, скопировать репо; в Settings → Variables/Secrets задать `ANTHROPIC_API_KEY`, `APP_PASSWORD`; порт 7860 берётся из `PORT`.
