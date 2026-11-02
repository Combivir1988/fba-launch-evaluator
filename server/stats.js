// Раздел «Статистика по всем анализам» (spec 018): хранилище пересчитанных итогов, догон и сборка ответа.
//
// Почему всё устроено именно так. В core.results лежит СНИМОК результата на момент расчёта; методика меняется,
// и снимки устаревают молча — на живых данных 2026-11-02 по снимкам выходило «Amazon — 68 % отказов», а после
// пересчёта текущим кодом 17 вердиктов меняются и Amazon падает до 17 %. Поэтому каждая цифра считается
// пересчётом (FR-007). Полный пересчёт 65 анализов стоит 18,4 с и 329 МБ при 0,5 ГБ на Railway Free — значит,
// на каждое открытие так нельзя. Развязка: пересчитанный итог одного анализа весит 1,7 КБ, поэтому кэшируется
// ИТОГ по анализу (0,33 МБ на 200), а сводка считается из итогов на лету (D1).
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import { joinDoc, migrate as migrateDoc } from "../shared/analysis.js";
import { analysisOutcome, hasData } from "../shared/stats-outcome.js";
import { summarize } from "../shared/stats-summary.js";
import { log } from "./log.js";

const SHARED = join(dirname(fileURLToPath(import.meta.url)), "..", "shared");

/** Версия методики: sha256 по содержимому всех shared/*.js. Правка расчёта САМА делает итоги устаревшими (D3, FR-026).
 *  Перебор намеренный: правка парсера тоже вызовет пересчёт. Ошибка в сторону «пересчитали лишний раз» стоит 18 с
 *  фоновой работы; ошибка в другую сторону — это ровно тот баг на 68 % против 17 %, против которого написана спека. */
export function computeMethodHash() {
  const h = createHash("sha256");
  for (const f of readdirSync(SHARED).filter((n) => n.endsWith(".js")).sort()) { h.update(f); h.update("\0"); h.update(readFileSync(join(SHARED, f))); }
  return h.digest("hex").slice(0, 12);
}
let cached = null;
/** Снимается один раз — при первом обращении — и дальше отдаётся из памяти: файлы в работающем процессе не меняются. */
export function methodHash() { return (cached ??= computeMethodHash()); }

const COLS = "analysis_id, version, method_hash, status, outcome, error, computed_at";

/** db — подключённая БД; budget — сколько устаревших анализов досчитывать прямо в запросе (D4). */
export function createStats(db, { budget = 5, hash = methodHash, failCooldownMs = 30_000 } = {}) {
  let running = null;  // одно обещание на процесс: второй вызов ждёт первый, а не запускает свой (FR-030)
  let lastFail = null; // последняя неудача догона: без неё «идёт пересчёт» висело бы вечно (FR-029)

  const live = async () => (await db.query("SELECT id, niche, version FROM analyses WHERE deleted_at IS NULL")).rows;
  const stored = async () => new Map((await db.query(`SELECT ${COLS} FROM analysis_outcome`)).rows.map((r) => [r.analysis_id, r]));

  /** Итог свеж ⟺ строка есть И version совпал И method_hash совпал. Одно правило вместо шести крючков в маршрутах (D2). */
  const isStale = (a, o, h) => !o || o.version !== a.version || o.method_hash !== h;
  const staleList = (rows, map, h) => rows.filter((a) => isStale(a, map.get(a.id), h));

  /** Пересчёт ОДНОГО анализа: документ берётся, считается и отпускается. Все 65 сразу — это те самые 329 МБ (D5). */
  async function recomputeOne(id, h = hash()) {
    const r = (await db.query("SELECT core, aggregates_gz, version FROM analyses WHERE id = $1 AND deleted_at IS NULL", [id])).rows[0];
    if (!r) return null; // удалён, пока считали — в статистику он всё равно не попадёт (FR-011)
    let status = "ok", outcome = null, error = null;
    try {
      let agg = {};
      try { agg = r.aggregates_gz ? JSON.parse(gunzipSync(r.aggregates_gz).toString("utf8")) : {}; }
      catch (e) { throw new Error("отчёты не распаковались: " + (e?.message || e)); }
      const doc = migrateDoc(joinDoc(r.core, agg));
      if (!hasData(doc)) status = "empty"; // пустой черновик — это не «ниша не прошла» (FR-010)
      else outcome = analysisOutcome(doc);
    } catch (e) {
      // Неудачу ЗАПОМИНАЕМ (D8): иначе один битый анализ стоил бы 283 мс на каждом открытии раздела навсегда.
      status = "error"; outcome = null; error = String(e?.message || e).slice(0, 500);
    }
    await db.query(
      `INSERT INTO analysis_outcome (${COLS}) VALUES ($1,$2,$3,$4,$5::jsonb,$6, now())
       ON CONFLICT (analysis_id) DO UPDATE SET version = $2, method_hash = $3, status = $4, outcome = $5::jsonb, error = $6, computed_at = now()`,
      [id, r.version, h, status, outcome ? JSON.stringify(outcome) : null, error]);
    return { status, error };
  }

  async function catchUp(rows) {
    const h = hash(); const t0 = Date.now(); let bad = 0;
    for (const a of rows) { const r = await recomputeOne(a.id, h); if (r?.status === "error") bad++; }
    log("info", "stats recomputed", { count: rows.length, failed: bad, ms: Date.now() - t0 });
  }

  /** Единственный замок: и досчёт в запросе, и фоновый догон идут через него (FR-030). */
  function run(rows) {
    if (!running) running = catchUp(rows).then(() => { lastFail = null; }, (e) => {
      lastFail = { at: Date.now(), message: String(e?.message || e).slice(0, 300) };
      log("warn", "stats recompute failed", { message: lastFail.message });
    }).finally(() => { running = null; });
    return running;
  }

  /** Ответ раздела целиком — по contracts/stats-api.md. Ничего не пишет в analyses (FR-009, SC-007). */
  async function get() {
    const h = hash();
    let rows = await live();
    let map = await stored();
    let stale = staleList(rows, map, h);
    // Устаревание по методике отличаем от устаревания по данным: иначе человек не поймёт, почему пересчитывается всё сразу.
    const methodChanged = stale.some((a) => { const o = map.get(a.id); return o && o.method_hash !== h; });

    // Пересчёт, который только что упал, не перезапускаем сразу: иначе битая база стоила бы попытки на каждое
    // открытие, а человек видел бы вечное «идёт пересчёт» вместо честного «пересчёт не прошёл» (FR-029).
    const cooling = lastFail && Date.now() - lastFail.at < failCooldownMs;
    if (stale.length && !cooling) {
      if (stale.length <= budget && !running) { await run(stale); map = await stored(); stale = staleList(rows, map, h); }
      else run(stale); // прежние цифры отдаём сразу, догон идёт в фоне (FR-028)
    }

    const items = [], freshness = { computedAt: null, total: rows.length, counted: 0, empty: 0, failed: 0, failures: [],
      stale: stale.length, recomputing: Boolean(running), methodChanged, recomputeError: running ? null : lastFail?.message || null };
    for (const a of rows) {
      const o = map.get(a.id); if (!o) continue;
      if (o.computed_at && (!freshness.computedAt || o.computed_at > freshness.computedAt)) freshness.computedAt = o.computed_at;
      if (o.status === "ok") { freshness.counted++; items.push({ id: a.id, niche: a.niche, outcome: o.outcome }); }
      else if (o.status === "empty") freshness.empty++;
      else { freshness.failed++; if (freshness.failures.length < 10) freshness.failures.push({ niche: a.niche, error: o.error }); }
    }
    const { summary, rows: list, mismatch } = summarize(items);
    return { freshness, mismatch, summary, rows: list };
  }

  return { get, recomputeOne, staleList, live, stored, methodHash: hash };
}
