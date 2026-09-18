import { test } from "node:test";
import assert from "node:assert/strict";
import { extractJson, openrouterStream, parseModelList } from "../server/openrouter.js";
import { configFromEnv, VERDICT_SCHEMA } from "../server/claude.js";
import { mockVerdict } from "../server/mock-verdict.js";

const payload = { rulesVerdict: { ceiling: "rework", decisiveGate: "Gate 0" }, criterion1: { okCount: 4, pass: false, redItems: ["1a"], items: {} }, gate0: { level: "poe_only" }, economics: { pending: true }, challenger: { gate4Discussed: false } };
const verdict = mockVerdict(payload);

/** Фейковый fetch: отдаёт SSE-поток OpenAI-совместимого формата. */
function sseResponse(chunks, { status = 200, model = "test/model", usage = { prompt_tokens: 1200, completion_tokens: 300, cost: 0.0042 } } = {}) {
  const lines = [": OPENROUTER PROCESSING\n"];
  chunks.forEach((c, i) => lines.push(`data: ${JSON.stringify({ id: "gen-1", model, choices: [{ delta: c, finish_reason: i === chunks.length - 1 ? "stop" : null }], ...(i === chunks.length - 1 ? { usage } : {}) })}\n\n`));
  lines.push("data: [DONE]\n");
  const body = new ReadableStream({ start(ctrl) { for (const l of lines) ctrl.enqueue(new TextEncoder().encode(l)); ctrl.close(); } });
  return new Response(body, { status, headers: { "content-type": "text/event-stream" } });
}
const cfg = (over = {}) => ({ ...configFromEnv({ OPENROUTER_API_KEY: "sk-or-test", OPENROUTER_MODEL: "test/model", OPENROUTER_MODELS: "test/model,other/model" }), ...over });
async function collect(gen) { const out = []; for await (const e of gen) out.push(e); return out; }

test("extractJson: чистый JSON, ```json``` и преамбула", () => {
  assert.deepEqual(extractJson('{"a":1}'), { a: 1 });
  assert.deepEqual(extractJson('Вот ответ:\n```json\n{"a":2}\n```'), { a: 2 });
  assert.deepEqual(extractJson('текст { "a": 3 } хвост'), { a: 3 });
  assert.equal(extractJson("нет json"), null);
});

test("parseModelList и выбор провайдера по env", () => {
  assert.deepEqual(parseModelList("a/b, c/d"), ["a/b", "c/d"]);
  assert.equal(configFromEnv({ OPENROUTER_API_KEY: "x" }).provider, "openrouter");
  assert.equal(configFromEnv({ ANTHROPIC_API_KEY: "y" }).provider, "anthropic");
  assert.equal(configFromEnv({ ANTHROPIC_API_KEY: "y", OPENROUTER_API_KEY: "x", AI_PROVIDER: "openrouter" }).provider, "openrouter");
  const c = configFromEnv({ OPENROUTER_API_KEY: "x", OPENROUTER_MODEL: "z/z", OPENROUTER_MODELS: "a/a" });
  assert.deepEqual(c.openrouterModels, ["z/z", "a/a"], "модель по умолчанию всегда в списке");
});

test("openrouter: стрим → meta/thinking/delta/done, usage с cost, json_schema с первого раза", async () => {
  const calls = [];
  const fetchImpl = async (url, init) => { calls.push(JSON.parse(init.body)); return sseResponse([{ reasoning: "думаю… " }, { content: JSON.stringify(verdict).slice(0, 40) }, { content: JSON.stringify(verdict).slice(40) }]); };
  const ev = await collect(openrouterStream({ payload, niche: "n", coreKeyword: "k", options: { model: "other/model" } }, cfg(), { fetchImpl }));
  const names = ev.map((e) => e.event);
  assert.deepEqual([...new Set(names)], ["meta", "thinking", "delta", "done"]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].model, "other/model", "модель из options, если она в списке");
  assert.equal(calls[0].response_format.type, "json_schema");
  assert.equal(calls[0].response_format.json_schema.strict, true);
  assert.ok(!JSON.stringify(calls[0].response_format).includes("minItems"), "minItems вырезан для strict-схемы");
  const done = ev.find((e) => e.event === "done").data;
  assert.equal(done.verdict.verdict, "rework");
  assert.equal(done.usage.cost, 0.0042);
  assert.equal(done.provider, "openrouter");
});

test("openrouter: каскад — 400 на response_format → json_object → text с извлечением JSON", async () => {
  let n = 0;
  const fetchImpl = async () => { n++; if (n === 1) return new Response(JSON.stringify({ error: { message: "response_format is not supported" } }), { status: 400 }); if (n === 2) return sseResponse([{ content: "не json совсем" }]); return sseResponse([{ content: "Вот:\n```json\n" + JSON.stringify(verdict) + "\n```" }]); };
  const ev = await collect(openrouterStream({ payload }, cfg(), { fetchImpl }));
  assert.equal(n, 3);
  const done = ev.find((e) => e.event === "done"); assert.ok(done, JSON.stringify(ev.at(-1)));
  assert.equal(ev.filter((e) => e.event === "meta").at(-1).data.mode, "text", "последний meta — режим, который дал результат");
});

test("openrouter: модель не из списка → модель по умолчанию; 402 → billing; 401 → auth", async () => {
  let body;
  const ev1 = await collect(openrouterStream({ payload, options: { model: "evil/expensive" } }, cfg(), { fetchImpl: async (u, i) => { body = JSON.parse(i.body); return new Response(JSON.stringify({ error: { message: "Insufficient credits" } }), { status: 402 }); } }));
  assert.equal(body.model, "test/model");
  assert.equal(ev1.at(-1).data.code, "billing");
  const ev2 = await collect(openrouterStream({ payload }, cfg(), { fetchImpl: async () => new Response("{}", { status: 401 }) }));
  assert.equal(ev2.at(-1).data.code, "auth");
  const ev3 = await collect(openrouterStream({ payload }, cfg({ openrouterKey: "" }), { fetchImpl: async () => { throw new Error("no"); } }));
  assert.equal(ev3.at(-1).data.code, "auth");
});

test("openrouter: усечённый ответ слабой модели нормализуется (done), а не-JSON на всех режимах → parse error", async () => {
  const ev = await collect(openrouterStream({ payload }, cfg(), { fetchImpl: async () => sseResponse([{ content: JSON.stringify({ verdict: "go", nextSteps: ["x"] }) }]) }));
  assert.equal(ev.at(-1).event, "done", JSON.stringify(ev.at(-1)));
  assert.equal(ev.at(-1).data.verdict.verdict, "go");
  assert.ok(Array.isArray(ev.at(-1).data.verdict.gates) && typeof ev.at(-1).data.verdict.summary === "string", "поля добраны нормализатором");
  const bad = await collect(openrouterStream({ payload }, cfg(), { fetchImpl: async () => sseResponse([{ content: "совсем не json" }]) }));
  assert.equal(bad.at(-1).event, "error"); assert.equal(bad.at(-1).data.code, "parse");
  assert.ok(VERDICT_SCHEMA.required.length >= 10);
});
