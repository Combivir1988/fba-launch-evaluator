// Хранилище итогов, догон и сборка ответа (spec 018).
// ВОРОТА SC-007: открытие раздела — операция только для чтения в отношении analyses.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { testDb } from "./helpers/db.js";
import { startApp } from "./helpers/app.js";
import { createAnalyses } from "../server/analyses.js";
import { createStats, computeMethodHash, methodHash } from "../server/stats.js";
import { fixtureAnalysis, emptyDraftAnalysis, brokenAnalysis } from "./helpers/fixture-analysis.js";
import { staleAnalysis } from "./helpers/fixture-stale-analysis.js";

let db, user, analyses;
before(async () => { db = await testDb(); user = await db.makeUser({ login: "stats" }); analyses = createAnalyses(db); });
after(async () => { await db.close(); });

const seed = async (doc) => { await analyses.importDoc(doc, user); return doc.id; };
const fresh = async () => { await db.reset(); user = await db.makeUser({ login: "stats" }); };

/** Отпечаток анализов: если открытие раздела что-то в них меняет, он сдвинется. */
async function fingerprint() {
  const a = (await db.query("SELECT md5(string_agg(id::text || version::text || updated_at::text, '|' ORDER BY id)) AS h FROM analyses")).rows[0].h;
  const v = (await db.query("SELECT count(*)::int AS n FROM analysis_versions")).rows[0].n;
  return a + "/" + v;
}

test("FR-026: признак версии методики устойчив и меняется от правки в shared/", () => {
  assert.equal(methodHash(), methodHash(), "значение не должно плавать между вызовами");
  assert.match(methodHash(), /^[0-9a-f]{12}$/);
  const before_ = computeMethodHash();
  const tmp = join(fileURLToPath(new URL("../shared/", import.meta.url)), "__probe-method-hash.js");
  writeFileSync(tmp, "// временный файл проверки\n");
  try { assert.notEqual(computeMethodHash(), before_, "правка расчёта обязана сама делать итоги устаревшими"); }
  finally { rmSync(tmp, { force: true }); }
  assert.equal(computeMethodHash(), before_, "после уборки значение вернулось — хэш считается по содержимому, а не по времени");
});

test("ворота SC-007: десять сборок статистики с полным пересчётом не меняют анализы (FR-009)", async () => {
  await fresh();
  for (let i = 0; i < 3; i++) await seed(fixtureAnalysis());
  const stats = createStats(db, { budget: 100 });
  const before_ = await fingerprint();
  for (let i = 0; i < 10; i++) await stats.get();
  assert.equal(await fingerprint(), before_, "анализы и их версии обязаны остаться байт в байт прежними");
  const n = (await db.query("SELECT count(*)::int AS n FROM analysis_outcome")).rows[0].n;
  assert.equal(n, 3, "итоги при этом посчитаны и сохранены — но в своей таблице");
});

test("SC-004: один устаревший анализ досчитывается в запросе и сразу виден", async () => {
  await fresh();
  const stats = createStats(db);
  assert.equal((await stats.get()).summary.n, 0, "анализов нет — пустое состояние, а не нули");
  await seed(fixtureAnalysis());
  const r = await stats.get();
  assert.equal(r.summary.n, 1);
  assert.equal(r.freshness.stale, 0);
  assert.equal(r.freshness.recomputing, false);
  assert.ok(r.freshness.computedAt, "видно, на какой момент посчитано (FR-027)");
});

test("FR-028: устарело больше бюджета — прежние цифры с пометкой, догон в фоне", async () => {
  await fresh();
  const stats = createStats(db, { budget: 5 });
  await seed(fixtureAnalysis());
  await stats.get(); // первый анализ посчитан
  for (let i = 0; i < 7; i++) await seed(fixtureAnalysis());

  const r = await stats.get();
  assert.equal(r.summary.n, 1, "отдаются ПРЕЖНИЕ цифры, а не пустой экран");
  assert.equal(r.freshness.stale, 7);
  assert.equal(r.freshness.recomputing, true);

  await new Promise((res) => setTimeout(res, 1500)); // догон
  const r2 = await stats.get();
  assert.equal(r2.summary.n, 8, "после догона цифры новые");
  assert.equal(r2.freshness.recomputing, false);
});

test("FR-030: два одновременных открытия дают один пересчёт", async () => {
  await fresh();
  for (let i = 0; i < 3; i++) await seed(fixtureAnalysis());
  let reads = 0;
  const spy = { ...db, query: (sql, p) => { if (/SELECT core, aggregates_gz/.test(sql)) reads++; return db.query(sql, p); } };
  const stats = createStats(spy, { budget: 100 });
  await Promise.all([stats.get(), stats.get(), stats.get()]);
  assert.equal(reads, 3, `пересчитано документов: ${reads} — должно быть по одному на анализ, а не по одному на вызов`);
});

test("FR-029: упавший догон оставляет прежние цифры и НЕ оставляет вечного «считаем»", async () => {
  await fresh();
  const stats0 = createStats(db, { budget: 100 });
  await seed(fixtureAnalysis()); await stats0.get();
  for (let i = 0; i < 7; i++) await seed(fixtureAnalysis());

  const broken = { ...db, query: (sql, p) => (/SELECT core, aggregates_gz/.test(sql) ? Promise.reject(new Error("база отвалилась")) : db.query(sql, p)) };
  const stats = createStats(broken, { budget: 5 });
  const r = await stats.get();
  assert.equal(r.summary.n, 1);
  assert.equal(r.freshness.recomputing, true);

  await new Promise((res) => setTimeout(res, 200));
  const r2 = await stats.get();
  assert.equal(r2.freshness.recomputing, false, "пересчёт не прошёл — это видно, а не висит «считаем» навсегда");
  assert.ok(r2.freshness.recomputeError, "причина неудачи названа");
  assert.ok(r2.freshness.stale > 0);
  assert.equal(r2.summary.n, 1, "цифры прежние");
});

test("FR-012 и FR-010: битый анализ исключается с причиной, пустой черновик не считается ни там, ни там", async () => {
  await fresh();
  await seed(fixtureAnalysis());
  await seed(emptyDraftAnalysis());
  await seed(brokenAnalysis());
  let reads = 0;
  const spy = { ...db, query: (sql, p) => { if (/SELECT core, aggregates_gz/.test(sql)) reads++; return db.query(sql, p); } };
  const stats = createStats(spy, { budget: 100 });

  const r = await stats.get();
  assert.equal(r.freshness.total, 3);
  assert.equal(r.summary.n, 1, "в статистике только тот анализ, который посчитался");
  assert.equal(r.freshness.empty, 1);
  assert.equal(r.freshness.failed, 1);
  assert.ok(r.freshness.failures[0]?.error, "причина исключения названа (SC-010)");

  const after_ = reads;
  await stats.get();
  assert.equal(reads, after_, "неудача запомнена (D8): битый анализ не пересчитывается заново на каждом открытии");
});

test("FR-011: удалённый анализ выпадает из статистики, даже если его итог ещё лежит в таблице", async () => {
  await fresh();
  const id = await seed(fixtureAnalysis());
  const stats = createStats(db, { budget: 100 });
  assert.equal((await stats.get()).summary.n, 1);
  await db.query("UPDATE analyses SET deleted_at = now() WHERE id = $1", [id]);
  const r = await stats.get();
  assert.equal(r.summary.n, 0);
  assert.equal(r.freshness.total, 0);
});

test("FR-008: расхождение сохранённого и пересчитанного видно и не влияет на цифры", async () => {
  await fresh();
  await seed(staleAnalysis());
  const r = await createStats(db, { budget: 100 }).get();
  assert.equal(r.mismatch.count, 1);
  assert.equal(r.rows[0].verdict, "Доработка", "цифра — из пересчёта");
  assert.equal(r.rows[0].was, "No-Go", "а прежний вердикт просто показан рядом");
});

// Те же ворота, но через HTTP: между функциями и маршрутом стоит ещё и приложение, и пройти их надо обоими путями.
test("ворота SC-007 через HTTP: десять GET /api/stats не меняют анализы", async () => {
  const T = await startApp();
  try {
    const boss = await T.userWithSession({ login: "boss", name: "Хозяин", role: "admin" });
    const analyses = createAnalyses(T.db);
    for (let i = 0; i < 3; i++) await analyses.importDoc(fixtureAnalysis(), boss.user);
    const fp = async () => (await T.db.query("SELECT md5(string_agg(id::text || version::text || updated_at::text, '|' ORDER BY id)) AS h FROM analyses")).rows[0].h
      + "/" + (await T.db.query("SELECT count(*)::int AS n FROM analysis_versions")).rows[0].n;
    const before_ = await fp();
    for (let i = 0; i < 10; i++) assert.equal((await T.call("GET", "/api/stats", boss.headers)).status, 200);
    assert.equal(await fp(), before_, "открытие раздела — операция только для чтения в отношении analyses (FR-009)");

    const r = await (await T.call("GET", "/api/stats", boss.headers)).json();
    assert.equal(r.summary.n, 3);
    assert.ok(r.freshness && r.mismatch && Array.isArray(r.rows), "ответ по контракту contracts/stats-api.md");
    for (const row of r.rows) for (const k of ["author", "createdBy", "updatedBy"]) assert.ok(!(k in row), "автора в строках нет (FR-023)");
  } finally { await T.close(); }
});
