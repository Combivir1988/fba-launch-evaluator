import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../server/index.js";
import { configFromEnv } from "../server/claude.js";
import { parsePoe } from "../shared/parse-poe.js";
import { newAnalysis } from "../shared/analysis.js";
import { compute } from "../shared/compute.js";
import { buildAiPayload } from "../shared/ai-payload.js";
import { readJson, POE } from "./helpers.js";

let server, base;
before(async () => {
  const cfg = configFromEnv({ APP_PASSWORD: "test-pass", MOCK_AI: "1", RATE_LIMIT_PER_HOUR: "5" });
  server = createApp(cfg).listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

test("health без авторизации", async () => {
  const r = await fetch(`${base}/api/health`);
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.ok, true); assert.equal(j.mock, true);
});

test("401 без токена, 204 с токеном", async () => {
  assert.equal((await fetch(`${base}/api/auth/check`, { method: "POST" })).status, 401);
  assert.equal((await fetch(`${base}/api/auth/check`, { method: "POST", headers: { "x-app-token": "wrong" } })).status, 401);
  assert.equal((await fetch(`${base}/api/auth/check`, { method: "POST", headers: { "x-app-token": "test-pass" } })).status, 204);
});

test("503 когда APP_PASSWORD не задан", async () => {
  const s = createApp(configFromEnv({ MOCK_AI: "1" })).listen(0);
  await new Promise((r) => s.once("listening", r));
  const r = await fetch(`http://127.0.0.1:${s.address().port}/api/auth/check`, { method: "POST", headers: { "x-app-token": "x" } });
  assert.equal(r.status, 503);
  s.close();
});

test("статика: index.html и shared-модули отдаются", async () => {
  assert.equal((await fetch(`${base}/`)).status, 200);
  const r = await fetch(`${base}/shared/compute.js`);
  assert.equal(r.status, 200);
  assert.match(r.headers.get("content-type"), /javascript/);
});

test("analyze (MOCK): SSE с meta/thinking/done, вердикт валиден и не выше потолка", async () => {
  const poe = parsePoe(readJson(POE));
  const a = newAnalysis({ niche: poe.meta.nicheTitle, coreKeyword: poe.meta.nicheTitle });
  a.aggregates = { poe };
  a.results = compute(a);
  const payload = buildAiPayload(a);
  const r = await fetch(`${base}/api/analyze`, { method: "POST", headers: { "x-app-token": "test-pass", "content-type": "application/json" }, body: JSON.stringify({ niche: a.niche, coreKeyword: a.coreKeyword, payload }) });
  assert.equal(r.status, 200);
  assert.match(r.headers.get("content-type"), /text\/event-stream/);
  const text = await r.text();
  const events = [...text.matchAll(/event: (\w+)\ndata: (.*)\n/g)].map((m) => [m[1], JSON.parse(m[2])]);
  const names = events.map((e) => e[0]);
  assert.ok(names.includes("meta") && names.includes("thinking") && names.includes("done"), names.join(","));
  assert.ok(!names.includes("error"), "сигнал отмены не должен срабатывать, пока клиент подключён: " + JSON.stringify(events.find((e) => e[0] === "error")?.[1]));
  const done = events.find((e) => e[0] === "done")[1];
  assert.equal(done.verdict.verdict, a.results.verdict.ceiling);
  assert.ok(done.verdict.nextSteps.length >= 1 && done.verdict.nextSteps.length <= 3);
});

test("analyze: 400 без payload; лимит запросов 429", async () => {
  const h = { "x-app-token": "test-pass", "content-type": "application/json" };
  const r = await fetch(`${base}/api/analyze`, { method: "POST", headers: h, body: "{}" });
  assert.equal(r.status, 400);
  let last;
  for (let i = 0; i < 6; i++) last = await fetch(`${base}/api/analyze`, { method: "POST", headers: h, body: "{}" });
  assert.equal(last.status, 429);
});
