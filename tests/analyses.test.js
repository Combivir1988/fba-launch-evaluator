import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { testDb } from "./helpers/db.js";
import { fixtureAnalysis } from "./helpers/fixture-analysis.js";
import { createAnalyses } from "../server/analyses.js";
import { splitDoc, joinDoc, metaFromCore, coreSignature } from "../shared/analysis.js";

let db, A, anna, ivan, boss;
const code = (c) => (e) => e.code === c;
before(async () => { db = await testDb(); A = createAnalyses(db); });
after(async () => { await db.close(); });
beforeEach(async () => { await db.reset(); anna = await db.makeUser({ login: "anna", name: "Анна" }); ivan = await db.makeUser({ login: "ivan", name: "Иван" }); boss = await db.makeUser({ login: "boss", name: "Босс", role: "admin" }); });

test("splitDoc/joinDoc: round-trip на реальных фикстурах, лёгкая часть ≤ 100 KB, сводка для списка", () => {
  const a = fixtureAnalysis();
  const { core, aggregates, meta } = splitDoc(a);
  assert.equal("aggregates" in core, false);
  assert.ok(aggregates.cerebro.keywords.length > 1000);
  assert.deepEqual(joinDoc(JSON.parse(JSON.stringify(core)), JSON.parse(JSON.stringify(aggregates))), JSON.parse(JSON.stringify(a)));
  const kb = JSON.stringify(core).length / 1024;
  assert.ok(kb < 100, `core ${kb.toFixed(0)} KB`);
  assert.deepEqual(meta.sources.sort(), ["cerebro", "poe", "xray"]);
  assert.equal(meta.niche, a.niche); assert.equal(meta.aiDone, false); assert.equal(typeof meta.c1, "number"); assert.ok(meta.verdict);
  assert.deepEqual(metaFromCore({}), { niche: "", coreKeyword: "", verdict: null, c1: null, score: null, sources: [], aiDone: false, patentsDone: false, configDone: false });
});

test("coreSignature не зависит от меток времени, но зависит от содержимого", () => {
  const { core } = splitDoc(fixtureAnalysis());
  const later = structuredClone(core); later.updatedAt = "2030-01-01T00:00:00Z"; later.results.computedAt = "2030-01-01T00:00:00Z";
  assert.equal(coreSignature(core), coreSignature(later));
  later.inputs.price = 19.99;
  assert.notEqual(coreSignature(core), coreSignature(later));
});

test("создание → чтение → список у другого пользователя с автором; размер хранения", async () => {
  const a = fixtureAnalysis(); const { core, aggregates } = splitDoc(a);
  const c = await A.saveCore({ id: a.id, core }, anna);
  assert.deepEqual([c.version, c.created], [1, true]);
  const g = await A.saveAggregates({ id: a.id, baseVersion: 1, aggregates }, anna);
  assert.equal(g.version, 2); assert.ok(g.bytes < 400_000, `gzip ${g.bytes}`);
  const got = await A.get(a.id);
  assert.deepEqual(joinDoc(got.core, got.aggregates), JSON.parse(JSON.stringify(a)));
  assert.equal(got.meta.createdBy.name, "Анна"); assert.equal(got.meta.version, 2);
  const list = await A.list({ userId: ivan.id });
  assert.equal(list.total, 1);
  const it = list.items[0];
  assert.equal(it.createdBy.name, "Анна"); assert.equal(it.niche, a.niche); assert.deepEqual(it.sources.sort(), ["cerebro", "poe", "xray"]);
  assert.equal(it.shares, 0); assert.equal("core" in it, false);
  await assert.rejects(A.saveCore({ id: a.id, core }, ivan), code("exists"));
});

test("другой пользователь сохраняет: автор прежний, «изменил» — новый", async () => {
  const { core } = splitDoc(fixtureAnalysis()); const id = core.id;
  await A.saveCore({ id, core }, anna);
  const r = await A.saveCore({ id, baseVersion: 1, core: { ...core, niche: "новое имя" } }, ivan);
  assert.equal(r.version, 2);
  const m = (await A.get(id)).meta;
  assert.equal(m.createdBy.name, "Анна"); assert.equal(m.updatedBy.name, "Иван");
  assert.equal((await A.list({ userId: anna.id })).items[0].niche, "новое имя");
});

test("конфликт версий: 409 с именем и временем; force перезаписывает; молчаливой перезаписи нет", async () => {
  const { core } = splitDoc(fixtureAnalysis()); const id = core.id;
  await A.saveCore({ id, core }, anna);
  await A.saveCore({ id, baseVersion: 1, core: { ...core, niche: "правка Анны" } }, anna);
  const e = await A.saveCore({ id, baseVersion: 1, core: { ...core, niche: "правка Ивана" } }, ivan).catch((x) => x);
  assert.equal(e.code, "conflict"); assert.equal(e.status, 409); assert.equal(e.extra.version, 2); assert.equal(e.extra.updatedBy.name, "Анна"); assert.ok(e.extra.updatedAt);
  assert.equal((await A.get(id)).core.niche, "правка Анны");
  await assert.rejects(A.saveAggregates({ id, baseVersion: 1, aggregates: { xray: {} } }, ivan), code("conflict"));
  const f = await A.saveCore({ id, baseVersion: 1, core: { ...core, niche: "правка Ивана" }, force: true }, ivan);
  assert.equal(f.version, 3); assert.equal((await A.get(id)).core.niche, "правка Ивана");
});

test("копия: новый id, автор — текущий пользователь, оригинал не тронут", async () => {
  const a = fixtureAnalysis(); const { core, aggregates } = splitDoc(a);
  await A.saveCore({ id: a.id, core }, anna);
  const c = await A.copy({ core, aggregates }, ivan);
  assert.notEqual(c.id, a.id);
  const got = await A.get(c.id);
  assert.equal(got.meta.createdBy.name, "Иван"); assert.equal(got.core.id, c.id); assert.match(got.core.niche, /\(копия\)$/);
  assert.ok(got.aggregates.cerebro.keywords.length > 1000);
  assert.equal((await A.list({ userId: anna.id })).total, 2);
});

test("фильтр «мои», поиск по нише, ключу и автору; экранирование % и _", async () => {
  const mk = async (niche, kw, user) => { const core = { ...splitDoc(fixtureAnalysis()).core, id: randomUUID(), niche, coreKeyword: kw }; await A.saveCore({ id: core.id, core }, user); };
  await mk("bike tube", "inner tube 26", anna); await mk("urinal screen", "urinal deodorizer", ivan); await mk("100%_cotton", "towel", ivan);
  assert.equal((await A.list({ userId: anna.id, mine: true })).total, 1);
  assert.equal((await A.list({ userId: ivan.id, mine: true })).total, 2);
  assert.equal((await A.list({ userId: anna.id, q: "URINAL" })).total, 1);
  assert.equal((await A.list({ userId: anna.id, q: "inner" })).items[0].niche, "bike tube");
  assert.equal((await A.list({ userId: anna.id, q: "иван" })).total, 2);
  assert.equal((await A.list({ userId: anna.id, q: "%" })).total, 1);
  assert.equal((await A.list({ userId: anna.id, q: "_" })).total, 1);
  assert.equal((await A.list({ userId: anna.id, limit: 2 })).items.length, 2);
});

test("удаление: автор и админ могут, чужой — нет; удалённый не виден и не сохраняется", async () => {
  const { core } = splitDoc(fixtureAnalysis()); const id = core.id;
  await A.saveCore({ id, core }, anna);
  await assert.rejects(A.remove(id, ivan), code("forbidden"));
  await A.remove(id, boss);
  await assert.rejects(A.get(id), code("not_found"));
  assert.equal((await A.list({ userId: anna.id })).total, 0);
  await assert.rejects(A.saveCore({ id, baseVersion: 1, core }, anna), code("not_found"));
  await assert.rejects(A.remove(id, anna), code("not_found"));
});

test("импорт идемпотентен: второй раз ничего не меняет, авторство — импортировавшего, даты сохраняются", async () => {
  const a = fixtureAnalysis(); a.createdAt = "2026-08-01T10:00:00.000Z"; a.updatedAt = "2026-08-02T10:00:00.000Z";
  assert.deepEqual(await A.importDoc(a, anna), { id: a.id, imported: true });
  assert.deepEqual(await A.importDoc({ ...a, niche: "другая" }, ivan), { id: a.id, imported: false });
  const got = await A.get(a.id);
  assert.equal(got.meta.createdBy.name, "Анна"); assert.equal(got.core.niche, a.niche);
  assert.equal(new Date(got.meta.createdAt).toISOString(), a.createdAt); assert.equal(new Date(got.meta.updatedAt).toISOString(), a.updatedAt);
  assert.ok(got.aggregates.poe);
  assert.equal((await A.list({ userId: anna.id })).total, 1);
});

test("проверки входа: id, aggregates внутри core, новая схема, размер", async () => {
  const { core } = splitDoc(fixtureAnalysis());
  await assert.rejects(A.saveCore({ id: "not-a-uuid", core }, anna), code("bad_id"));
  await assert.rejects(A.saveCore({ id: core.id, core: { ...core, aggregates: {} } }, anna), code("bad_core"));
  await assert.rejects(A.saveCore({ id: core.id, core: null }, anna), code("bad_core"));
  await assert.rejects(A.saveCore({ id: core.id, core: { ...core, schemaVersion: 99 } }, anna), code("newer_schema"));
  await assert.rejects(A.saveCore({ id: core.id, core: { ...core, junk: "x".repeat(1_100_000) } }, anna), code("too_large"));
  await assert.rejects(A.get("nope"), code("not_found"));
  await assert.rejects(A.importDoc(null, anna), code("bad_core"));
});

test("patchResult: точечно пишет ai/patents, не затирая правки; версия растёт", async () => {
  const { core } = splitDoc(fixtureAnalysis()); const id = core.id;
  await A.saveCore({ id, core }, anna);
  await A.saveCore({ id, baseVersion: 1, core: { ...core, niche: "свежая правка" } }, anna);
  const v = await A.patchResult(id, "ai", { verdict: "no_go", summary: "тест" }, ivan.id);
  assert.equal(v, 3);
  const got = await A.get(id);
  assert.equal(got.core.niche, "свежая правка"); assert.equal(got.core.ai.verdict, "no_go"); assert.equal(got.meta.updatedBy.name, "Иван");
  const it = (await A.list({ userId: anna.id })).items[0]; assert.equal(it.aiDone, true); assert.equal(it.verdict, "no_go");
  assert.equal(await A.patchResult(id, "patents", { status: "clear" }, anna.id), 4);
  assert.equal((await A.list({ userId: anna.id })).items[0].patentsDone, true);
  assert.equal(await A.patchResult(randomUUID(), "ai", {}, anna.id), null);
});
