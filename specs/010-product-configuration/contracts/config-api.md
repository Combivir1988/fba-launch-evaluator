# Контракт API: этап 2 (spec 010)

Все маршруты — для вошедших пользователей (cookie сеанса + `X-Requested-With`), под общим лимитом задач (20/ч на пользователя). Без `SCRAPFLY_API_KEY` (и не в MOCK) маршруты запуска задач отвечают `400 { error: "bad_request", message: "Scrapfly не настроен" }`.

## `GET /api/health`

Добавляется поле `scrapfly: boolean` — настроен ли ключ (сам ключ никогда не отдаётся).

## `POST /api/config/schema` → `202 { jobId }`

Тело: `{ niche, coreKeyword, asins: [{ asin, title, brand, price, asinRevenue }], listings: { [asin]: listing }, options: { model } }` — клиент передаёт область (уже отсортированную, ≤ `topForSchema`) и то, что у него есть в кэше.
Задача `config_schema`: события `stage { stage: "fetch", done, total, text, cost }` → `stage { stage: "ai", text }` → `done { schema, listings, cost }`, где `listings` — только **новые** загруженные страницы (клиент сливает их в `aggregates.listings`).

## `POST /api/config/extract` → `202 { jobId }`

Тело: `{ niche, schema, asins: [{ asin, title, brand, price, asinRevenue }], listings: { [asin]: listing }, manual: { [asin]: { [fieldId]: value } }, options: { model } }` — `asins` ≤ `maxAsins`, `listings` — свежий кэш клиента (старше `cacheDays` клиент не присылает).
Задача `config_extract`: `stage fetch i/N` (только недостающие) → `stage ai i/M` (пачки) → `done { table, listings, cost }`. Ошибка ключа/кредитов — `job_error { code: "credits" | "auth", message, retryable: false }`; загруженное до ошибки не пропадает: перед `job_error` приходит `stage { stage: "partial", listings }`.

## `POST /api/config/tz` → `202 { jobId }`

Тело: `{ niche, coreKeyword, payload, options: { model } }`, где `payload` — результат `buildTzPayload(analysis)` (клиент строит из документа, как для AI-вердикта).
Задача `config_tz`: `stage ai` → `done { tz }` (`tz.rows[].unverified` проставлен сервером).

## `POST /api/tz/docx` → `200 application/vnd.openxmlformats-officedocument.wordprocessingml.document`

Тело (≤ 1 MB): `{ tz, meta: { niche, coreKeyword, preparedBy, date } }`. Ответ — файл, `Content-Disposition: attachment; filename="TZ-<slug>-<YYYY-MM-DD>.docx"`. Строится из присланного (возможно, правленного и ещё не сохранённого) ТЗ — сервер ничего не читает из базы.

## События задач (общие, `GET /api/jobs/:id/events`)

Как у AI-анализа и патентного скана: `meta`, `stage`, `done`, `job_error`, `end`; replay по `Last-Event-ID`; результат хранится 1 час.
