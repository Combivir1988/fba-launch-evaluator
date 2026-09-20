import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { testDb } from "./helpers/db.js";
import { fixtureAnalysis } from "./helpers/fixture-analysis.js";
import { createAnalyses } from "../server/analyses.js";
import { createShares } from "../server/shares.js";
import { splitDoc } from "../shared/analysis.js";

let db, A, SH, clock, anna, ivan, olga, boss, doc;
const DAY = 86400000; const code = (c) => (e) => e.code === c;
before(async () => { db = await testDb(); });
after(async () => { await db.close(); });
beforeEach(async () => {
  await db.reset(); clock = Date.parse("2026-09-19T10:00:00Z");
  A = createAnalyses(db); SH = createShares(db, A, { now: () => clock, publicUrl: "https://app.example" });
  anna = await db.makeUser({ login: "anna", name: "Анна" }); ivan = await db.makeUser({ login: "ivan", name: "Иван" }); olga = await db.makeUser({ login: "olga", name: "Ольга" }); boss = await db.makeUser({ login: "boss", name: "Босс", role: "admin" });
  doc = fixtureAnalysis(); const { core, aggregates } = splitDoc(doc);
  await A.saveCore({ id: doc.id, core }, anna); await A.saveAggregates({ id: doc.id, baseVersion: 1, aggregates }, anna);
});

test("создание: неугадываемый адрес, срок по умолчанию 30 дней, «подготовил» — автор анализа", async () => {
  const s = await SH.create({ analysisId: doc.id }, ivan);
  assert.match(s.path, /^\/s\/[A-Za-z0-9_-]{43}$/); assert.equal(s.url, "https://app.example" + s.path);
  assert.equal(s.mode, "full"); assert.equal(s.state, "active"); assert.equal(s.stale, false); assert.equal(s.views, 0);
  assert.equal(s.createdBy.name, "Иван"); assert.equal(new Date(s.expiresAt).getTime(), clock + 30 * DAY);
  const snap = await SH.getPublic(s.path.slice(3));
  assert.equal(snap.preparedBy, "Анна"); assert.equal(snap.analysis.niche, doc.niche); assert.equal(snap.analysis.aggregates.cerebro.keywords, undefined);
  const other = await SH.create({ analysisId: doc.id, expiresInDays: null }, ivan);
  assert.notEqual(other.path, s.path); assert.equal(other.expiresAt, null);
  assert.equal((await A.list({ userId: anna.id })).items[0].shares, 2);
});

test("снимок неизменяем до «Обновить ссылку»; адрес при обновлении сохраняется", async () => {
  const s = await SH.create({ analysisId: doc.id }, anna); const token = s.path.slice(3);
  const { core } = splitDoc({ ...doc, niche: "новое название" });
  await A.saveCore({ id: doc.id, baseVersion: 2, core }, anna);
  assert.equal((await SH.getPublic(token)).analysis.niche, doc.niche, "получатель видит прежний снимок");
  assert.equal((await SH.get(s.id)).stale, true);
  clock += 3600_000;
  const r = await SH.refresh(s.id, anna);
  assert.equal(r.path, s.path); assert.equal(r.stale, false); assert.ok(new Date(r.snapshotAt).getTime() > new Date(s.snapshotAt).getTime());
  assert.equal((await SH.getPublic(token)).analysis.niche, "новое название");
});

test("режим без закупочной экономики: данных нет в снимке", async () => {
  const s = await SH.create({ analysisId: doc.id, mode: "no_economics", expiresInDays: 7 }, anna);
  const snap = await SH.getPublic(s.path.slice(3));
  assert.equal(snap.mode, "no_economics"); assert.deepEqual(snap.hidden, ["economics", "budget", "cashflow"]);
  assert.equal(snap.analysis.results.economics, undefined); assert.equal("cogs" in snap.analysis.inputs, false);
  const { aggregates, ...rest } = snap.analysis; assert.equal(JSON.stringify(rest).includes("4.37"), false);
});

test("истёкшая, отозванная, несуществующая ссылка и удалённый анализ — одинаково null", async () => {
  const a = await SH.create({ analysisId: doc.id, expiresInDays: 7 }, anna), b = await SH.create({ analysisId: doc.id, expiresInDays: null }, anna);
  assert.ok(await SH.getPublic(a.path.slice(3)));
  clock += 7 * DAY + 1000;
  assert.equal(await SH.getPublic(a.path.slice(3)), null); assert.equal((await SH.get(a.id)).state, "expired");
  await SH.revoke(b.id, anna);
  assert.equal(await SH.getPublic(b.path.slice(3)), null); assert.equal((await SH.get(b.id)).state, "revoked");
  for (const bad of ["x".repeat(43), "", null, "short", "../etc", randomUUID()]) assert.equal(await SH.getPublic(bad), null);
  const c = await SH.create({ analysisId: doc.id, expiresInDays: null }, anna);
  await A.remove(doc.id, anna);
  assert.equal(await SH.getPublic(c.path.slice(3)), null, "удаление анализа гасит ссылки (FR-029)");
  await assert.rejects(SH.refresh(a.id, anna), code("not_active"));
});

test("права: автор анализа, автор ссылки, админ — да; посторонний — нет", async () => {
  const s = await SH.create({ analysisId: doc.id }, ivan); // Иван — автор ссылки, Анна — автор анализа
  await assert.rejects(SH.revoke(s.id, olga), code("forbidden")); await assert.rejects(SH.refresh(s.id, olga), code("forbidden"));
  await SH.refresh(s.id, anna); await SH.refresh(s.id, ivan); await SH.refresh(s.id, boss);
  await SH.revoke(s.id, boss); assert.equal((await SH.get(s.id)).state, "revoked");
  await assert.rejects(SH.revoke(randomUUID(), boss), code("not_found")); await assert.rejects(SH.get("nope"), code("not_found"));
});

test("просмотры: раз в 30 минут с адреса, вошедшие не считаются", async () => {
  const s = await SH.create({ analysisId: doc.id }, anna); const t = s.path.slice(3);
  assert.equal(await SH.countView(t, "1.1.1.1", false), true); assert.equal(await SH.countView(t, "1.1.1.1", false), false);
  assert.equal(await SH.countView(t, "2.2.2.2", false), true); assert.equal(await SH.countView(t, "3.3.3.3", true), false);
  clock += 31 * 60_000; assert.equal(await SH.countView(t, "1.1.1.1", false), true);
  const g = await SH.get(s.id); assert.equal(g.views, 3); assert.ok(g.lastViewedAt);
});

test("списки и проверки входа", async () => {
  await SH.create({ analysisId: doc.id }, ivan); await SH.create({ analysisId: doc.id, mode: "no_economics" }, anna);
  assert.equal((await SH.listForAnalysis(doc.id)).length, 2);
  assert.equal((await SH.listAll(boss)).length, 2); assert.equal((await SH.listAll(anna)).length, 2, "автор анализа видит все ссылки на него");
  assert.equal((await SH.listAll(ivan)).length, 1); assert.equal((await SH.listAll(olga)).length, 0);
  await assert.rejects(SH.create({ analysisId: doc.id, mode: "secret" }, anna), code("bad_mode"));
  await assert.rejects(SH.create({ analysisId: doc.id, expiresInDays: 365 }, anna), code("bad_expiry"));
  await assert.rejects(SH.create({ analysisId: randomUUID() }, anna), code("not_found"));
  const empty = randomUUID(); await A.saveCore({ id: empty, core: { id: empty, niche: "пусто", schemaVersion: 1 } }, anna);
  await assert.rejects(SH.create({ analysisId: empty }, anna), code("not_computed"));
});
