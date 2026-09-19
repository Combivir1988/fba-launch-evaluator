import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { startApp, JSON_H } from "./helpers/app.js";
import { fixtureAnalysis } from "./helpers/fixture-analysis.js";
import { splitDoc, joinDoc } from "../shared/analysis.js";

let T, anna, ivan, boss;
before(async () => { T = await startApp(); });
after(async () => { await T.close(); });
beforeEach(async () => { await T.db.reset(); anna = await T.userWithSession({ login: "anna", name: "Анна" }); ivan = await T.userWithSession({ login: "ivan", name: "Иван" }); boss = await T.userWithSession({ login: "boss", name: "Босс", role: "admin" }); });
const j = (r) => r.json();

test("без сеанса — 401 на всю историю", async () => {
  for (const [m, p] of [["GET", "/api/analyses"], ["GET", "/api/analyses/x"], ["DELETE", "/api/analyses/x"]]) assert.equal((await T.call(m, p, JSON_H)).status, 401, p);
  assert.equal((await T.call("DELETE", "/api/analyses/x")).status, 403, "без CSRF-заголовка запрос отклоняется ещё раньше");
});

test("А сохраняет (core + aggregates) → Б видит в списке с автором и открывает тот же документ", async () => {
  const a = fixtureAnalysis(); const { core, aggregates } = splitDoc(a);
  const c = await T.call("PUT", `/api/analyses/${a.id}`, anna.headers, { baseVersion: null, core });
  assert.equal(c.status, 200); assert.equal((await j(c)).version, 1);
  const g = await T.call("PUT", `/api/analyses/${a.id}/aggregates`, anna.headers, { baseVersion: 1, aggregates });
  assert.equal(g.status, 200); assert.equal((await j(g)).version, 2);
  const list = await j(await T.call("GET", "/api/analyses", ivan.headers));
  assert.equal(list.total, 1); assert.equal(list.items[0].createdBy.name, "Анна"); assert.equal(list.items[0].updatedBy.name, "Анна");
  const got = await j(await T.call("GET", `/api/analyses/${a.id}`, ivan.headers));
  assert.deepEqual(joinDoc(got.core, got.aggregates), JSON.parse(JSON.stringify(a)));
  assert.equal(got.meta.version, 2);
  assert.equal((await j(await T.call("GET", "/api/analyses?mine=1", ivan.headers))).total, 0);
  assert.equal((await j(await T.call("GET", "/api/analyses?q=" + encodeURIComponent("анна"), ivan.headers))).total, 1);
});

test("конфликт: 409 с именем изменившего; force; копия", async () => {
  const { core, aggregates } = splitDoc(fixtureAnalysis()); const id = core.id;
  await T.call("PUT", `/api/analyses/${id}`, anna.headers, { baseVersion: null, core });
  await T.call("PUT", `/api/analyses/${id}`, anna.headers, { baseVersion: 1, core: { ...core, niche: "Анна" } });
  const r = await T.call("PUT", `/api/analyses/${id}`, ivan.headers, { baseVersion: 1, core: { ...core, niche: "Иван" } });
  assert.equal(r.status, 409); const e = await j(r);
  assert.equal(e.error, "conflict"); assert.equal(e.version, 2); assert.equal(e.updatedBy.name, "Анна"); assert.ok(e.updatedAt); assert.match(e.message, /Анна/);
  const cp = await T.call("POST", `/api/analyses/${id}/copy`, ivan.headers, { core: { ...core, niche: "Иван" }, aggregates });
  assert.equal(cp.status, 201); const copy = await j(cp); assert.notEqual(copy.id, id);
  assert.equal((await j(await T.call("GET", `/api/analyses/${copy.id}`, ivan.headers))).meta.createdBy.name, "Иван");
  const f = await T.call("PUT", `/api/analyses/${id}`, ivan.headers, { baseVersion: 2, force: true, core: { ...core, niche: "Иван" } });
  assert.equal(f.status, 200); assert.equal((await j(f)).version, 3);
  assert.equal((await j(await T.call("PUT", `/api/analyses/${id}`, anna.headers, { baseVersion: null, core }))).error, "exists");
});

test("удаление: чужой 403, автор 204, потом 404; админ может удалить любой", async () => {
  const mk = async (who) => { const { core } = splitDoc(fixtureAnalysis()); await T.call("PUT", `/api/analyses/${core.id}`, who.headers, { baseVersion: null, core }); return core.id; };
  const id1 = await mk(anna), id2 = await mk(anna);
  assert.equal((await T.call("DELETE", `/api/analyses/${id1}`, ivan.headers)).status, 403);
  assert.equal((await T.call("DELETE", `/api/analyses/${id1}`, anna.headers)).status, 204);
  assert.equal((await T.call("GET", `/api/analyses/${id1}`, anna.headers)).status, 404);
  assert.equal((await T.call("DELETE", `/api/analyses/${id2}`, boss.headers)).status, 204);
  assert.equal((await j(await T.call("GET", "/api/analyses", anna.headers))).total, 0);
});

test("импорт дважды → один анализ (201, затем 200 imported:false)", async () => {
  const a = fixtureAnalysis();
  const r1 = await T.call("POST", "/api/analyses/import", anna.headers, { analysis: a }); assert.equal(r1.status, 201); assert.equal((await j(r1)).imported, true);
  const r2 = await T.call("POST", "/api/analyses/import", ivan.headers, { analysis: a }); assert.equal(r2.status, 200); assert.equal((await j(r2)).imported, false);
  const list = await j(await T.call("GET", "/api/analyses", boss.headers));
  assert.equal(list.total, 1); assert.equal(list.items[0].createdBy.name, "Анна");
});

test("лимиты тела: core > 1 MB → 413; некорректный id → 400; aggregates внутри core → 400", async () => {
  const { core } = splitDoc(fixtureAnalysis());
  assert.equal((await T.call("PUT", `/api/analyses/${core.id}`, anna.headers, { baseVersion: null, core: { ...core, junk: "x".repeat(1_200_000) } })).status, 413);
  assert.equal((await j(await T.call("PUT", "/api/analyses/not-a-uuid", anna.headers, { baseVersion: null, core }))).error, "bad_id");
  assert.equal((await j(await T.call("PUT", `/api/analyses/${core.id}`, anna.headers, { baseVersion: null, core: { ...core, aggregates: {} } }))).error, "bad_core");
});
