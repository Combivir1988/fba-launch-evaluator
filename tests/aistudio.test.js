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
  const run = async (status, bodyText) => (await collect(openrouterStream({ payload, niche: "n", coreKeyword: "k", options: { model: "aistudio/gemini-3.5-flash-lite" } }, cfg(), { fetchImpl: async () => new Response(bodyText, { status }) }))).at(-1).data;
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
