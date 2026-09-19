import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { startApp } from "./helpers/app.js";
import { fixtureAnalysis } from "./helpers/fixture-analysis.js";
import { splitDoc } from "../shared/analysis.js";

let T, anna, ivan, boss, doc;
before(async () => { T = await startApp({ PUBLIC_RATE_LIMIT: "1000", PUBLIC_URL: "https://app.example" }); });
after(async () => { await T.close(); });
beforeEach(async () => {
  await T.db.reset(); anna = await T.userWithSession({ login: "anna", name: "Анна" }); ivan = await T.userWithSession({ login: "ivan", name: "Иван" }); boss = await T.userWithSession({ login: "boss", name: "Босс", role: "admin" });
  doc = fixtureAnalysis(); const { core, aggregates } = splitDoc(doc);
  await T.call("PUT", `/api/analyses/${doc.id}`, anna.headers, { baseVersion: null, core }); await T.call("PUT", `/api/analyses/${doc.id}/aggregates`, anna.headers, { baseVersion: 1, aggregates });
});
const mk = async (who, body = {}) => (await (await T.call("POST", `/api/analyses/${doc.id}/shares`, who.headers, body)).json()).share;
const pubGet = (path) => fetch(T.base + "/api/public/shares/" + path.slice(3)); // без cookie и без заголовков — как посторонний

test("создать ссылку → посторонний без входа получает снимок; управление без входа закрыто", async () => {
  const r = await T.call("POST", `/api/analyses/${doc.id}/shares`, anna.headers, { mode: "full", expiresInDays: 30 });
  assert.equal(r.status, 201); const sh = (await r.json()).share;
  assert.match(sh.url, /^https:\/\/app\.example\/s\/[A-Za-z0-9_-]{43}$/);
  const p = await pubGet(sh.path); assert.equal(p.status, 200);
  assert.equal(p.headers.get("x-robots-tag"), "noindex, nofollow"); assert.equal(p.headers.get("cache-control"), "no-store"); assert.equal(p.headers.get("referrer-policy"), "no-referrer");
  const snap = (await p.json()).snapshot; assert.equal(snap.preparedBy, "Анна"); assert.equal(snap.analysis.niche, doc.niche); assert.ok(snap.analysis.results.economics);
  const page = await fetch(T.base + sh.path); assert.equal(page.status, 200); assert.match(page.headers.get("content-type"), /html/); assert.equal(page.headers.get("x-robots-tag"), "noindex, nofollow");
  for (const [m, path] of [["GET", "/api/shares"], ["GET", `/api/analyses/${doc.id}/shares`]]) assert.equal((await T.call(m, path)).status, 401);
  const robots = await (await fetch(T.base + "/robots.txt")).text(); assert.match(robots, /Disallow: \/s\//);
});

test("несуществующая, отозванная и истёкшая ссылки неразличимы: тот же код, тело и заголовки; оболочка страницы одинакова", async () => {
  const revoked = await mk(anna), expired = await mk(anna, { expiresInDays: 7 }), alive = await mk(anna);
  assert.equal((await T.call("DELETE", `/api/shares/${revoked.id}`, anna.headers)).status, 204);
  await T.db.query("UPDATE shares SET expires_at = now() - interval '1 minute' WHERE id = $1", [expired.id]);
  const answers = [];
  for (const path of [revoked.path, expired.path, "/s/" + "A".repeat(43), "/s/short"]) { const r = await pubGet(path); answers.push(JSON.stringify([r.status, await r.json(), r.headers.get("cache-control"), r.headers.get("x-robots-tag")])); }
  assert.equal(new Set(answers).size, 1, answers.join("\n")); assert.match(answers[0], /link_unavailable/); assert.match(answers[0], /^\[404/);
  const shells = await Promise.all([alive.path, revoked.path, "/s/" + "A".repeat(43)].map(async (p) => (await fetch(T.base + p)).text()));
  assert.equal(new Set(shells).size, 1, "HTML-оболочка не зависит от токена");
  assert.equal((await pubGet(alive.path)).status, 200);
});

test("снимок не меняется при правках; «Обновить ссылку» сохраняет адрес; удаление анализа гасит ссылку", async () => {
  const sh = await mk(anna);
  const { core } = splitDoc({ ...doc, niche: "переименован" });
  assert.equal((await T.call("PUT", `/api/analyses/${doc.id}`, anna.headers, { baseVersion: 2, core })).status, 200);
  assert.equal((await (await pubGet(sh.path)).json()).snapshot.analysis.niche, doc.niche);
  const list = await (await T.call("GET", `/api/analyses/${doc.id}/shares`, ivan.headers)).json(); assert.equal(list[0].stale, true);
  const ref = await T.call("POST", `/api/shares/${sh.id}/refresh`, anna.headers); assert.equal(ref.status, 200); assert.equal((await ref.json()).share.path, sh.path);
  assert.equal((await (await pubGet(sh.path)).json()).snapshot.analysis.niche, "переименован");
  assert.equal((await T.call("DELETE", `/api/analyses/${doc.id}`, anna.headers)).status, 204);
  assert.equal((await pubGet(sh.path)).status, 404);
});

test("режим без экономики: в ответе сервера нет закупочных значений", async () => {
  const sh = await mk(anna, { mode: "no_economics", expiresInDays: null });
  const text = await (await pubGet(sh.path)).text(); const snap = JSON.parse(text).snapshot;
  assert.equal(snap.mode, "no_economics"); assert.equal(snap.analysis.results.economics, undefined); assert.equal(snap.analysis.results.budget, undefined);
  const { aggregates, ...rest } = snap.analysis; const body = JSON.stringify(rest);
  for (const needle of ["4.37", "5.41", "18750", '"cogs"']) assert.equal(body.includes(needle), false, needle);
});

test("права и счётчик просмотров: посторонний участник не управляет; вошедшие не считаются", async () => {
  const olga = await T.userWithSession({ login: "olga", name: "Ольга" });
  const sh = await mk(ivan);
  assert.equal((await T.call("DELETE", `/api/shares/${sh.id}`, olga.headers)).status, 403);
  assert.equal((await T.call("POST", `/api/shares/${sh.id}/refresh`, olga.headers)).status, 403);
  await pubGet(sh.path); await pubGet(sh.path);
  await fetch(T.base + "/api/public/shares/" + sh.path.slice(3), { headers: { cookie: anna.headers.cookie } });
  await new Promise((r) => setTimeout(r, 150));
  const mine = await (await T.call("GET", "/api/shares", ivan.headers)).json(); assert.equal(mine.length, 1); assert.equal(mine[0].views, 1);
  assert.equal((await (await T.call("GET", "/api/shares", olga.headers)).json()).length, 0);
  assert.equal((await (await T.call("GET", "/api/shares", boss.headers)).json()).length, 1);
  assert.equal((await T.call("DELETE", `/api/shares/${sh.id}`, anna.headers)).status, 204, "автор анализа отзывает чужую ссылку");
  assert.equal((await (await T.call("GET", "/api/analyses", anna.headers)).json()).items[0].shares, 0);
  assert.equal((await (await T.call("POST", `/api/analyses/${doc.id}/shares`, anna.headers, { mode: "oops" })).json()).error, "bad_mode");
});

test("лимит обращений к публичным ссылкам", async () => {
  const L = await startApp({ PUBLIC_RATE_LIMIT: "3" });
  try { let last; for (let i = 0; i < 4; i++) last = await fetch(L.base + "/api/public/shares/" + "B".repeat(43)); assert.equal(last.status, 429); }
  finally { await L.close(); }
});
