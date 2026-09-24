// Google AI Studio как дополнительный источник моделей: префикс "aistudio/" → запрос напрямую в Google своим ключом.
import { test } from "node:test";
import assert from "node:assert/strict";
import { openrouterStream, openrouterJson, endpointFor, GOOGLE_AI_URL, OPENROUTER_URL } from "../server/openrouter.js";
import { configFromEnv } from "../server/claude.js";
import { mockVerdict } from "../server/mock-verdict.js";

const payload = { rulesVerdict: { ceiling: "rework", decisiveGate: "Gate 0" }, criterion1: { okCount: 4, pass: false, redItems: ["1a"], items: {} }, gate0: { level: "poe_only" }, economics: { pending: true }, challenger: { gate4Discussed: false } };
const verdict = mockVerdict(payload);
const sse = (text, model = "gemini-3.5-flash-lite") => {
  const lines = [`data: ${JSON.stringify({ id: "g-1", model, choices: [{ delta: { content: text }, finish_reason: "stop" }] })}\n\n`, "data: [DONE]\n"];
  return new Response(new ReadableStream({ start(c) { for (const l of lines) c.enqueue(new TextEncoder().encode(l)); c.close(); } }), { status: 200 });
};
const cfg = (env = {}) => configFromEnv({ OPENROUTER_API_KEY: "sk-or-test", GOOGLE_AI_STUDIO_KEY: "g-key", OPENROUTER_MODEL: "aistudio/gemini-3.5-flash-lite", OPENROUTER_MODELS: "aistudio/gemini-3.5-flash-lite,nvidia/x:free", ...env });
const collect = async (gen) => { const out = []; for await (const e of gen) out.push(e); return out; };

test("endpointFor: aistudio/ → Google со своим ключом и без префикса; остальное → OpenRouter", () => {
  const g = endpointFor("aistudio/gemini-3.5-flash-lite", cfg());
  assert.equal(g.url, GOOGLE_AI_URL); assert.equal(g.model, "gemini-3.5-flash-lite"); assert.equal(g.headers.Authorization, "Bearer g-key"); assert.equal(g.google, true);
  assert.equal("HTTP-Referer" in g.headers, false, "в Google не уходит ничего лишнего");
  const o = endpointFor("nvidia/x:free", cfg());
  assert.equal(o.url, OPENROUTER_URL); assert.equal(o.model, "nvidia/x:free"); assert.equal(o.headers.Authorization, "Bearer sk-or-test"); assert.equal(o.google, false);
  assert.match(endpointFor("aistudio/x", cfg({ GOOGLE_AI_STUDIO_KEY: "" })).error.message, /GOOGLE_AI_STUDIO_KEY/);
  assert.match(endpointFor("nvidia/x:free", cfg({ OPENROUTER_API_KEY: "" })).error.message, /OPENROUTER_API_KEY/);
  assert.equal(endpointFor("aistudio/x", cfg({ OPENROUTER_API_KEY: "" })).error, undefined, "ключ OpenRouter для моделей Google не нужен");
});

test("стрим через Google: адрес, ключ, имя модели, без usage и без шага json_schema; результат валиден", async () => {
  const calls = [];
  const fetchImpl = async (url, init) => { calls.push({ url, auth: init.headers.Authorization, body: JSON.parse(init.body) }); return sse("<thought>думаю</thought>\n" + JSON.stringify(verdict)); };
  const ev = await collect(openrouterStream({ payload, niche: "n", coreKeyword: "k", options: { model: "aistudio/gemini-3.5-flash-lite" } }, cfg(), { fetchImpl }));
  assert.equal(calls.length, 1, "один запрос — без потерянного на strict-схему");
  assert.equal(calls[0].url, GOOGLE_AI_URL); assert.equal(calls[0].auth, "Bearer g-key"); assert.equal(calls[0].body.model, "gemini-3.5-flash-lite");
  assert.equal("usage" in calls[0].body, false); assert.equal("reasoning" in calls[0].body, false); assert.deepEqual(calls[0].body.response_format, { type: "json_object" });
  const meta = ev.find((e) => e.event === "meta").data; assert.equal(meta.provider, "google-ai-studio"); assert.equal(meta.model, "aistudio/gemini-3.5-flash-lite"); assert.equal(meta.mode, "json_object");
  const done = ev.find((e) => e.event === "done"); assert.ok(done, JSON.stringify(ev.at(-1))); assert.equal(done.data.verdict.verdict, verdict.verdict);
});

test("модель OpenRouter по-прежнему идёт в OpenRouter со strict-схемой", async () => {
  const calls = [];
  const fetchImpl = async (url, init) => { calls.push({ url, body: JSON.parse(init.body) }); return sse(JSON.stringify(verdict), "nvidia/x:free"); };
  await collect(openrouterStream({ payload, niche: "n", coreKeyword: "k", options: { model: "nvidia/x:free" } }, cfg(), { fetchImpl }));
  assert.equal(calls[0].url, OPENROUTER_URL); assert.equal(calls[0].body.response_format.type, "json_schema"); assert.deepEqual(calls[0].body.usage, { include: true });
});

test("понятные сообщения Google: 429 — лимит, 503 — перегрузка, 403 — ключ; без ключа — ошибка без запроса", async () => {
  const run = async (status, bodyText) => (await collect(openrouterStream({ payload, niche: "n", coreKeyword: "k", options: { model: "aistudio/gemini-3.5-flash-lite" } }, { ...cfg(), aiRetryWaitsMs: [] }, { fetchImpl: async () => new Response(bodyText, { status }) }))).at(-1).data;
  const e429 = await run(429, "{}"); assert.equal(e429.code, "rate_limited"); assert.match(e429.message, /Google AI Studio: исчерпан бесплатный лимит/); assert.equal(e429.retryable, true);
  const e503 = await run(503, JSON.stringify([{ error: { code: 503, message: "high demand" } }])); assert.equal(e503.code, "upstream"); assert.match(e503.message, /перегружена/);
  assert.equal((await run(403, "{}")).code, "auth");
  let called = false;
  const noKey = (await collect(openrouterStream({ payload, niche: "n", coreKeyword: "k", options: { model: "aistudio/gemini-3.5-flash-lite" } }, cfg({ GOOGLE_AI_STUDIO_KEY: "" }), { fetchImpl: async () => { called = true; return sse("{}"); } }))).at(-1).data;
  assert.equal(noKey.code, "auth"); assert.equal(called, false);
});

test("openrouterJson (патентный скан) тоже маршрутизируется в Google", async () => {
  const calls = []; const schema = { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"], additionalProperties: false };
  const fetchImpl = async (url, init) => { calls.push({ url, body: JSON.parse(init.body) }); return new Response(JSON.stringify({ choices: [{ message: { content: '{"ok":true}' } }] }), { status: 200 }); };
  const out = await openrouterJson({ cfg: cfg(), model: "aistudio/gemini-3.5-flash-lite", system: "s", user: "u", schema, fetchImpl });
  assert.deepEqual(out, { ok: true }); assert.equal(calls.length, 1); assert.equal(calls[0].url, GOOGLE_AI_URL); assert.equal(calls[0].body.model, "gemini-3.5-flash-lite"); assert.equal(calls[0].body.response_format.type, "json_object");
});

test("перегрузка бесплатного уровня: повтор того же запроса, затем переход на другую бесплатную модель Google", async () => {
  const c = { ...cfg({ OPENROUTER_MODELS: "aistudio/gemini-3.5-flash-lite,aistudio/gemini-3.5-flash,nvidia/x:free" }), aiRetryWaitsMs: [0, 0] };
  const busy = () => new Response(JSON.stringify([{ error: { code: 503, message: "high demand" } }]), { status: 503 });
  // 1. первая попытка 503 → повтор → ответ
  const seen = []; let n = 0;
  const flaky = async (url, init) => { seen.push(JSON.parse(init.body).model); return ++n === 1 ? busy() : sse(JSON.stringify(verdict)); };
  const ev = await collect(openrouterStream({ payload, niche: "n", coreKeyword: "k", options: { model: "aistudio/gemini-3.5-flash-lite" } }, c, { fetchImpl: flaky }));
  assert.equal(ev.at(-1).event, "done", JSON.stringify(ev.at(-1)).slice(0, 200));
  assert.deepEqual(seen, ["gemini-3.5-flash-lite", "gemini-3.5-flash-lite"], "повтор той же модели, без смены");
  assert.ok(ev.some((e) => e.event === "thinking" && /Повтор через/.test(e.data.text)), "человеку видно, что идёт повтор");

  // 2. модель перегружена всегда → запасная бесплатная модель того же ключа
  const models = [];
  const fallback = async (url, init) => { const m = JSON.parse(init.body).model; models.push(m); return m === "gemini-3.5-flash-lite" ? busy() : sse(JSON.stringify(verdict), "gemini-3.5-flash"); };
  const ev2 = await collect(openrouterStream({ payload, niche: "n", coreKeyword: "k", options: { model: "aistudio/gemini-3.5-flash-lite" } }, c, { fetchImpl: fallback }));
  const done = ev2.at(-1); assert.equal(done.event, "done"); assert.equal(done.data.model, "aistudio/gemini-3.5-flash", "ответила запасная модель, и это видно в результате");
  assert.ok(models.filter((m) => m === "gemini-3.5-flash-lite").length >= 3, "сначала исчерпали повторы основной модели");
  assert.ok(ev2.some((e) => e.event === "thinking" && /перехожу на aistudio\/gemini-3\.5-flash/.test(e.data.text)), "переход объяснён");

  // 3. платные модели OpenRouter в запасные не берём (деньги), ошибка ключа не повторяется
  const c2 = { ...cfg({ OPENROUTER_MODELS: "aistudio/gemini-3.5-flash-lite,google/gemini-3.8-flash" }), aiRetryWaitsMs: [0] };
  const tried = [];
  const dead = async (url, init) => { tried.push(JSON.parse(init.body).model); return busy(); };
  const ev3 = await collect(openrouterStream({ payload, niche: "n", coreKeyword: "k", options: { model: "aistudio/gemini-3.5-flash-lite" } }, c2, { fetchImpl: dead }));
  assert.equal(ev3.at(-1).event, "error"); assert.match(ev3.at(-1).data.message, /перегружена/);
  assert.deepEqual([...new Set(tried)], ["gemini-3.5-flash-lite"], "на платную модель не переключаемся");
  const auth = await collect(openrouterStream({ payload, niche: "n", coreKeyword: "k", options: { model: "aistudio/gemini-3.5-flash-lite" } }, c, { fetchImpl: async () => new Response("{}", { status: 403 }) }));
  assert.equal(auth.at(-1).data.code, "auth"); assert.equal(auth.filter((e) => e.event === "thinking").length, 0, "неверный ключ не повторяем и модель не меняем");
});

test("openrouterJson: перегруженная модель уступает место запасной бесплатной; ошибка ключа не переключает", async () => {
  const c = cfg({ OPENROUTER_MODELS: "aistudio/gemini-3.5-flash-lite,aistudio/gemini-3.5-flash" });
  const body = (o) => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(o) } }] }), { status: 200, headers: { "content-type": "application/json" } });
  const models = [];
  const impl = async (url, init) => { const m = JSON.parse(init.body).model; models.push(m); return m === "gemini-3.5-flash-lite" ? new Response("[{\"error\":{\"code\":503,\"message\":\"high demand\"}}]", { status: 503 }) : body(verdict); };
  const got = await openrouterJson({ cfg: c, model: "aistudio/gemini-3.5-flash-lite", system: "s", user: "u", schema: c.schema, fetchImpl: impl });
  assert.equal(got.verdict, verdict.verdict); assert.ok(models.includes("gemini-3.5-flash"), "ответила запасная модель: " + models.join(", "));
  const models2 = [];
  const auth = async (url, init) => { models2.push(JSON.parse(init.body).model); return new Response("{}", { status: 403 }); };
  await assert.rejects(() => openrouterJson({ cfg: c, model: "aistudio/gemini-3.5-flash-lite", system: "s", user: "u", schema: c.schema, fetchImpl: auth }), (e) => e.code === "auth");
  assert.deepEqual([...new Set(models2)], ["gemini-3.5-flash-lite"], "с неверным ключом другие модели не пробуем");
});
