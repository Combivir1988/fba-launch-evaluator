import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startApp } from "./helpers/app.js";
import { parsePoe } from "../shared/parse-poe.js";
import { newAnalysis } from "../shared/analysis.js";
import { compute } from "../shared/compute.js";
import { buildAiPayload } from "../shared/ai-payload.js";
import { readJson, POE } from "./helpers.js";

let T, base, h;
before(async () => {
  T = await startApp({ RATE_LIMIT_PER_HOUR: "5" });
  base = T.base;
  h = (await T.userWithSession({ login: "tester", name: "Тестер" })).headers;
});
after(async () => { await T.close(); });

test("health без авторизации", async () => {
  const r = await fetch(`${base}/api/health`);
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.ok, true); assert.equal(j.mock, true); assert.equal(j.storage, "pglite");
});

test("401 без сеанса; общий пароль X-App-Token больше не действует", async () => {
  assert.equal((await fetch(`${base}/api/auth/me`)).status, 401);
  assert.equal((await fetch(`${base}/api/auth/me`, { headers: { "x-app-token": "test-pass" } })).status, 401);
  assert.equal((await fetch(`${base}/api/auth/me`, { headers: h })).status, 200);
});

test("createApp без БД — понятная ошибка", async () => {
  const { createApp } = await import("../server/index.js");
  assert.throws(() => createApp({}), /нужна БД/);
});

test("статика: index.html и shared-модули отдаются", async () => {
  assert.equal((await fetch(`${base}/`)).status, 200);
  const r = await fetch(`${base}/shared/compute.js`);
  assert.equal(r.status, 200);
  assert.match(r.headers.get("content-type"), /javascript/);
});

test("analyze (MOCK) как задача: 202 jobId → SSE replay meta/thinking/done → GET /api/jobs/:id с результатом", async () => {
  const poe = parsePoe(readJson(POE));
  const a = newAnalysis({ niche: poe.meta.nicheTitle, coreKeyword: poe.meta.nicheTitle });
  a.aggregates = { poe };
  a.results = compute(a);
  const payload = buildAiPayload(a);
  const r = await fetch(`${base}/api/analyze`, { method: "POST", headers: h, body: JSON.stringify({ niche: a.niche, coreKeyword: a.coreKeyword, payload }) });
  assert.equal(r.status, 202);
  const { jobId } = await r.json(); assert.ok(jobId);
  const ev = await fetch(`${base}/api/jobs/${jobId}/events`, { headers: h });
  assert.equal(ev.status, 200); assert.match(ev.headers.get("content-type"), /text\/event-stream/);
  const text = await ev.text();
  const events = [...text.matchAll(/event: (\w+)\ndata: (.*)\n/g)].map((m) => [m[1], JSON.parse(m[2])]);
  const names = events.map((e) => e[0]);
  assert.ok(names.includes("meta") && names.includes("thinking") && names.includes("done") && names.at(-1) === "end", names.join(","));
  assert.ok(!names.includes("error") && !names.includes("job_error"));
  const done = events.find((e) => e[0] === "done")[1];
  assert.equal(done.verdict.verdict, a.results.verdict.ceiling);
  // replay после завершения — те же события (сценарий перезагрузки страницы)
  const again = await fetch(`${base}/api/jobs/${jobId}/events`, { headers: h }).then((x) => x.text());
  assert.ok(again.includes("event: done"));
  const st = await fetch(`${base}/api/jobs/${jobId}`, { headers: h }).then((x) => x.json());
  assert.equal(st.status, "done"); assert.equal(st.result.verdict.verdict, done.verdict.verdict);
  assert.equal((await fetch(`${base}/api/jobs/nope`, { headers: h })).status, 404);
  assert.equal((await fetch(`${base}/api/jobs/${jobId}/events`)).status, 401, "без сеанса нельзя");
  assert.equal((await fetch(`${base}/api/jobs/${jobId}/events?token=test-pass`)).status, 401, "токен в URL больше не принимается");
});

test("analyze: 400 без payload; лимит запросов 429", async () => {
  const r = await fetch(`${base}/api/analyze`, { method: "POST", headers: h, body: "{}" });
  assert.equal(r.status, 400);
  let last;
  for (let i = 0; i < 6; i++) last = await fetch(`${base}/api/analyze`, { method: "POST", headers: h, body: "{}" });
  assert.equal(last.status, 429);
});
