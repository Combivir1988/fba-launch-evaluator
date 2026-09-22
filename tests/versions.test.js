// spec 009: история версий анализа и «последний анализ» в учётной записи.
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { testDb } from "./helpers/db.js";
import { startApp, JSON_H } from "./helpers/app.js";
import { createAnalyses, VERSION_COLLAPSE_MS, MAX_VERSIONS, MAX_WITH_AGG } from "../server/analyses.js";
import { createUsers } from "../server/users.js";
import { fixtureAnalysis } from "./helpers/fixture-analysis.js";
import { splitDoc } from "../shared/analysis.js";

let db, clock, A, ann, bob;
const MIN = 60_000;
before(async () => { db = await testDb(); });
after(async () => { await db.close(); });
beforeEach(async () => { await db.reset(); clock = Date.parse("2026-09-22T09:00:00Z"); A = createAnalyses(db, { now: () => clock }); ann = await db.makeUser({ name: "Ann" }); bob = await db.makeUser({ name: "Bob" }); });
const fresh = () => { const a = fixtureAnalysis(); a.id = randomUUID(); return splitDoc(a); };
const count = async (id) => (await db.query("SELECT count(*)::int n FROM analysis_versions WHERE analysis_id = $1", [id])).rows[0].n;

test("FR-003/SC-003: первое сохранение архивирует прежнее состояние; автосохранения того же автора 10 минут — одна запись; новый автор — новая запись", async () => {
  const { core, aggregates } = fresh(); const id = core.id;
  let v = (await A.saveCore({ id, core }, ann)).version; await A.saveAggregates({ id, baseVersion: v, aggregates }, ann); v++;
  assert.equal(await count(id), 1, "загрузка отчётов архивирует состояние до них (там были пустые отчёты)");
  for (let i = 0; i < 20; i++) { clock += 20_000; v = (await A.saveCore({ id, baseVersion: v, core: { ...core, niche: "Ann правит " + i } }, ann)).version; }
  assert.equal(await count(id), 1, "20 автосохранений Ann за 7 минут — новых записей нет: она продолжает свой сеанс");
  clock += VERSION_COLLAPSE_MS + 1000; v = (await A.saveCore({ id, baseVersion: v, core: { ...core, niche: "Ann позже" } }, ann)).version; assert.equal(await count(id), 2, "прошло больше 10 минут — новая запись");
  clock += 30_000; v = (await A.saveCore({ id, baseVersion: v, core: { ...core, niche: "Bob перезаписал" } }, bob)).version;
  const list = await A.listVersions(id); assert.equal(list.length, 3, "другой автор — новая запись сразу"); assert.equal(list[0].stateBy.name, "Ann"); assert.equal(list[0].niche, "Ann позже"); assert.equal(list[0].archivedBy, "Bob"); assert.equal(list[0].reason, "save");
  assert.ok(list[0].version < v); assert.equal(list[0].hasAggregates, false); assert.deepEqual([...list[0].sources].sort(), ["cerebro", "poe", "xray"]); assert.equal(list[0].c1, core.results.criterion1.okCount);
});

test("FR-004/FR-005/SC-002: замена отчётов хранит прежние отчёты; восстановление возвращает их и само архивирует текущее состояние", async () => {
  const { core, aggregates } = fresh(); const id = core.id; const origXray = aggregates.xray.asins.length;
  let v = (await A.saveCore({ id, core }, ann)).version; v = (await A.saveAggregates({ id, baseVersion: v, aggregates }, ann)).version;
  clock += 60 * MIN;
  // Bob «начинает новый анализ поверх»: меняет нишу и заменяет Xray
  v = (await A.saveCore({ id, baseVersion: v, core: { ...core, niche: "Чужая ниша", coreKeyword: "other" } }, bob)).version;
  const bobAgg = { ...aggregates, xray: { ...aggregates.xray, asins: aggregates.xray.asins.slice(0, 5) } };
  v = (await A.saveAggregates({ id, baseVersion: v, aggregates: bobAgg }, bob)).version;
  const list = await A.listVersions(id); assert.equal(list.length, 3);
  assert.equal(list[0].hasAggregates, true, "версия с прежними отчётами"); assert.equal(list[0].stateBy.name, "Bob", "состояние перед заменой отчётов уже было записано Bob (ниша)"); assert.equal(list[1].niche, core.niche); assert.equal(list[1].stateBy.name, "Ann");
  const before = await A.get(id); assert.equal(before.core.niche, "Чужая ниша"); assert.equal(before.aggregates.xray.asins.length, 5);
  const r = await A.restoreVersion(id, list[0].id, ann); // состояние Bob-с-нишей, но с отчётами Ann
  assert.equal(r.aggregatesRestored, true); assert.equal(r.aggregates.xray.asins.length, origXray); assert.equal(r.core.niche, "Чужая ниша"); assert.equal(r.meta.version, v + 1); assert.equal(r.core.id, id);
  clock += 1000; const r2 = await A.restoreVersion(id, list[1].id, ann); assert.equal(r2.aggregatesRestored, false); assert.equal(r2.core.niche, core.niche); assert.equal(r2.aggregates.xray.asins.length, origXray, "отчёты остались текущие (уже восстановленные)");
  const after = await A.listVersions(id); assert.equal(after.length, 5); assert.equal(after[0].reason, "restore"); assert.equal(after[0].niche, "Чужая ниша"); assert.equal(after[1].reason, "restore"); assert.equal(after[1].hasAggregates, true, "перед восстановлением отчётов текущие отчёты Bob сохранены");
  clock += 1000; const back = await A.restoreVersion(id, after[1].id, bob); assert.equal(back.aggregates.xray.asins.length, 5, "шаг обратим: отчёты Bob вернулись");
  await assert.rejects(A.restoreVersion(id, randomUUID(), ann), /Такой версии нет/); await assert.rejects(A.listVersions(randomUUID()), /не найден/);
});

test("FR-006: не больше 30 версий, отчёты только у трёх последних; удаление анализа уносит историю", async () => {
  const { core, aggregates } = fresh(); const id = core.id;
  let v = (await A.saveCore({ id, core }, ann)).version;
  for (let i = 0; i < 40; i++) { clock += 11 * MIN; const who = i % 2 ? ann : bob; v = (await A.saveAggregates({ id, baseVersion: v, aggregates: { ...aggregates, tag: i } }, who)).version; }
  assert.equal(await count(id), MAX_VERSIONS); const withAgg = (await db.query("SELECT count(*)::int n FROM analysis_versions WHERE analysis_id = $1 AND aggregates_gz IS NOT NULL", [id])).rows[0].n; assert.equal(withAgg, MAX_WITH_AGG);
  const list = await A.listVersions(id); assert.ok(list.slice(0, 3).every((x) => x.hasAggregates) && list.slice(3).every((x) => !x.hasAggregates));
  await A.remove(id, ann); await db.query("DELETE FROM analyses WHERE id = $1", [id]); assert.equal(await count(id), 0);
});

test("patchResult (AI) версий не создаёт; конфликт версий при сохранении — как раньше", async () => {
  const { core } = fresh(); const id = core.id; const v = (await A.saveCore({ id, core }, ann)).version;
  await A.patchResult(id, "ai", { verdict: "go" }, ann.id); assert.equal(await count(id), 0);
  await assert.rejects(A.saveCore({ id, baseVersion: v, core: { ...core, niche: "устаревшая версия" } }, bob), /изменил/); assert.equal(await count(id), 0, "неудачное сохранение ничего не архивирует");
});

test("FR-001: lastAnalysisId хранится в настройках учётной записи; API версий и восстановления", async () => {
  const t = await startApp();
  try {
    const a = await t.userWithSession({ login: "ann" }), b = await t.userWithSession({ login: "bob" });
    const { core, aggregates } = fresh(); const id = core.id;
    let r = await t.call("PUT", `/api/analyses/${id}`, a.headers, { core }); assert.equal(r.status, 200); let v = (await r.json()).version;
    r = await t.call("PUT", `/api/analyses/${id}/aggregates`, a.headers, { baseVersion: v, aggregates }); v = (await r.json()).version;
    r = await t.call("PATCH", "/api/auth/settings", a.headers, { lastAnalysisId: id }); assert.equal(r.status, 200); assert.equal((await r.json()).settings.lastAnalysisId, id);
    assert.equal((await t.call("PATCH", "/api/auth/settings", a.headers, { lastAnalysisId: "not-a-uuid" })).status, 400);
    const meA = await (await t.call("GET", "/api/auth/me", a.headers)).json(), meB = await (await t.call("GET", "/api/auth/me", b.headers)).json();
    assert.equal(meA.user.settings.lastAnalysisId, id); assert.equal(meB.user.settings.lastAnalysisId, undefined, "у другого пользователя своего последнего анализа нет");
    r = await t.call("PATCH", "/api/auth/settings", a.headers, { lastAnalysisId: null }); assert.equal((await r.json()).settings.lastAnalysisId, null);
    r = await t.call("PUT", `/api/analyses/${id}`, b.headers, { baseVersion: v, core: { ...core, niche: "Bob" } }); assert.equal(r.status, 200);
    r = await t.call("GET", `/api/analyses/${id}/versions`, b.headers); assert.equal(r.status, 200); const { items } = await r.json(); assert.equal(items.length, 2); assert.equal(items[0].stateBy.name, "ann");
    assert.equal((await t.call("GET", `/api/analyses/${id}/versions`, JSON_H)).status, 401);
    r = await t.call("POST", `/api/analyses/${id}/versions/${items[0].id}/restore`, a.headers); assert.equal(r.status, 200); const rest = await r.json(); assert.equal(rest.core.niche, core.niche); assert.equal(rest.meta.updatedBy.name, "ann"); assert.ok(rest.aggregates.xray);
    assert.equal((await t.call("POST", `/api/analyses/${id}/versions/${randomUUID()}/restore`, a.headers)).status, 404);
  } finally { await t.close(); }
});
