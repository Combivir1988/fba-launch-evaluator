// Spec 021: хранилище радара. Только чтение и запись — решения о том, что считать кандидатом,
// принимает чистое ядро в shared/idea-ranking.js.
//
// Два правила держит БАЗА, а не этот файл:
//  • первичный ключ (source_id, run_date) — повторный обход в те же сутки невозможен,
//    и перезапуск посреди обхода не удваивает расход;
//  • ck_run_fail_has_reason — строки «неудача без причины» не бывает, а именно она
//    выглядела бы в ленте пустотой.
import { randomUUID } from "node:crypto";

const today = (now = new Date()) => now.toISOString().slice(0, 10);

const SOURCE_COLS = "id, platform, handle, title, market, active, paused_reason, threshold_mult, fails_in_row, created_by, created_at";
// Столбцы date приводятся к тексту ЗДЕСЬ, а не разбираются потом: драйвер отдаёт их объектом Date,
// и сравнение со строкой «сегодня» всегда ложно — молча, без единого признака ошибки.
const RUN_COLS = `source_id, run_date::text AS run_date, status, fail_code, fail_message,
  seen_count, passed_count, no_metric, background, spent, via, started_at, finished_at`;
const CAND_COLS = `id, source_id, platform, market, external_id, title, url, snippet, published_at,
  first_seen_on::text AS first_seen_on, last_seen_on::text AS last_seen_on, days_held,
  metric, background, ratio, platforms, decision, decided_by, decided_at, analysis_id`;
const CAND_COLS_C = `c.id, c.source_id, c.platform, c.market, c.external_id, c.title, c.url, c.snippet, c.published_at,
  c.first_seen_on::text AS first_seen_on, c.last_seen_on::text AS last_seen_on, c.days_held,
  c.metric, c.background, c.ratio, c.platforms, c.decision, c.decided_by, c.decided_at, c.analysis_id`;

export function createIdeasStore(db) {
  // ---------- разделы ----------

  const listSources = async () => (await db.query(`SELECT ${SOURCE_COLS} FROM idea_source ORDER BY created_at`)).rows;
  const getSource = async (id) => (await db.query(`SELECT ${SOURCE_COLS} FROM idea_source WHERE id = $1`, [id])).rows[0] || null;

  /** Совпадение (platform, handle) ловится индексом: молча создать второй раздел за двойной расход нельзя. */
  const findSource = async (platform, handle, market = "US") =>
    (await db.query(`SELECT ${SOURCE_COLS} FROM idea_source WHERE platform = $1 AND handle = $2 AND market = $3`, [platform, handle, market])).rows[0] || null;

  async function createSource({ platform, handle, title, market = "US", thresholdMult = null, createdBy = null }) {
    const id = randomUUID();
    const r = await db.query(
      `INSERT INTO idea_source (id, platform, handle, title, market, threshold_mult, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING ${SOURCE_COLS}`,
      [id, platform, handle, title, market, thresholdMult, createdBy]);
    return r.rows[0];
  }

  const setSourceActive = async (id, active) =>
    (await db.query(`UPDATE idea_source SET active = $2, paused_reason = NULL, fails_in_row = 0
                     WHERE id = $1 RETURNING ${SOURCE_COLS}`, [id, active])).rows[0] || null;

  const setSourceThreshold = async (id, mult) =>
    (await db.query(`UPDATE idea_source SET threshold_mult = $2 WHERE id = $1 RETURNING ${SOURCE_COLS}`, [id, mult])).rows[0] || null;

  const deleteSource = async (id) => { await db.query("DELETE FROM idea_source WHERE id = $1", [id]); };

  /** Приостановка СИСТЕМОЙ: у неё есть причина, и человек видит разницу с собственной приостановкой. */
  const pauseSource = async (id, reason) =>
    (await db.query(`UPDATE idea_source SET active = false, paused_reason = $2 WHERE id = $1 RETURNING ${SOURCE_COLS}`, [id, reason])).rows[0] || null;

  const bumpFails = async (id) =>
    (await db.query("UPDATE idea_source SET fails_in_row = fails_in_row + 1 WHERE id = $1 RETURNING fails_in_row", [id])).rows[0]?.fails_in_row ?? 0;

  const resetFails = async (id) => { await db.query("UPDATE idea_source SET fails_in_row = 0 WHERE id = $1", [id]); };

  // ---------- обходы ----------

  const runFor = async (sourceId, date) =>
    (await db.query(`SELECT ${RUN_COLS} FROM idea_run WHERE source_id = $1 AND run_date = $2`, [sourceId, date])).rows[0] || null;

  const runsOn = async (date) => (await db.query(`SELECT ${RUN_COLS} FROM idea_run WHERE run_date = $1`, [date])).rows;

  const lastRuns = async () => (await db.query(
    `SELECT DISTINCT ON (source_id) ${RUN_COLS} FROM idea_run ORDER BY source_id, run_date DESC`)).rows;

  /**
   * Застолбить сутки ДО запроса к площадке. Вернёт false, если эти сутки уже застолблены —
   * это и есть защита от двойного расхода, и держит её первичный ключ, а не проверка в коде.
   */
  async function claimRun(sourceId, date = today()) {
    const r = await db.query(
      `INSERT INTO idea_run (source_id, run_date, status) VALUES ($1, $2, 'skipped')
       ON CONFLICT (source_id, run_date) DO NOTHING RETURNING source_id`, [sourceId, date]);
    return r.rows.length > 0;
  }

  /** Удачный обход. */
  const finishRun = async (sourceId, date, { seen, passed, noMetric, background, spent, via }) =>
    (await db.query(
      `UPDATE idea_run SET status = 'ok', fail_code = NULL, fail_message = NULL,
         seen_count = $3, passed_count = $4, no_metric = $5, background = $6, spent = $7, via = $8, finished_at = now()
       WHERE source_id = $1 AND run_date = $2 RETURNING ${RUN_COLS}`,
      [sourceId, date, seen, passed, noMetric, background ? JSON.stringify(background) : null, spent, via])).rows[0];

  /** Неудача. Причина обязательна — её требует база, и это не формальность: без причины строка
   *  выглядела бы в ленте пустотой, то есть «ничего не нашлось» вместо «мы не смогли посмотреть». */
  const failRun = async (sourceId, date, { code, message, spent = 0, via = null }) =>
    (await db.query(
      `UPDATE idea_run SET status = 'failed', fail_code = $3, fail_message = $4, spent = $5, via = $6, finished_at = now()
       WHERE source_id = $1 AND run_date = $2 RETURNING ${RUN_COLS}`,
      [sourceId, date, code, message, spent, via])).rows[0];

  // ---------- элементы, не прошедшие отбор ----------

  async function saveItems(sourceId, date, items) {
    for (const it of items) {
      await db.query(
        `INSERT INTO idea_item (id, source_id, run_date, external_id, title, url, published_at, metric, raw)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (source_id, run_date, external_id) DO NOTHING`,
        [randomUUID(), sourceId, date, it.externalId, it.title ?? null, it.url ?? null,
          it.publishedAt ?? null, it.metric ?? null, JSON.stringify(it.raw ?? {})]);
    }
  }

  const itemsFor = async (sourceId, date) =>
    (await db.query("SELECT * FROM idea_item WHERE source_id = $1 AND run_date = $2", [sourceId, date])).rows;

  /** Чужие тексты не хранятся дольше необходимого. */
  const cleanupItems = async (keepDays) =>
    (await db.query("DELETE FROM idea_item WHERE run_date < (current_date - $1::integer)", [keepDays])).rowCount ?? 0;

  // ---------- кандидаты ----------

  /** Повторное появление поднимает last_seen_on и days_held, а не создаёт вторую строку. */
  async function upsertCandidate(sourceId, date, c) {
    const r = await db.query(
      `INSERT INTO idea_candidate
         (id, source_id, platform, market, external_id, title, url, snippet, published_at,
          first_seen_on, last_seen_on, days_held, metric, background, ratio, platforms)
       VALUES ($1, $2, $3, $14, $4, $5, $6, $7, $8, $9, $9, 1, $10, $11, $12, $13)
       ON CONFLICT (source_id, external_id) DO UPDATE SET
         last_seen_on = EXCLUDED.last_seen_on,
         days_held = CASE WHEN idea_candidate.last_seen_on < EXCLUDED.last_seen_on
                          THEN idea_candidate.days_held + 1 ELSE idea_candidate.days_held END,
         metric = EXCLUDED.metric, background = EXCLUDED.background, ratio = EXCLUDED.ratio
       RETURNING ${CAND_COLS}`,
      [randomUUID(), sourceId, c.platform, c.externalId, c.title, c.url, c.snippet ?? null,
        c.publishedAt ?? null, date, c.metric, c.background, c.ratio, [c.platform], c.market ?? "US"]);
    return r.rows[0];
  }

  /** Лента. Отклонённые не удаляются — иначе следующий обход вернул бы их как новое. */
  const feed = async ({ sinceDays = 7, decision = null } = {}) => (await db.query(
    `SELECT ${CAND_COLS_C}, s.title AS source_title, s.handle AS source_handle
       FROM idea_candidate c LEFT JOIN idea_source s ON s.id = c.source_id
      WHERE c.last_seen_on >= (current_date - $1::integer)
        AND ($2::text IS NULL OR c.decision = $2)
      ORDER BY c.last_seen_on DESC, c.ratio DESC`, [sinceDays, decision])).rows;

  const dismissed = async () => (await db.query(
    `SELECT ${CAND_COLS_C}, s.title AS source_title FROM idea_candidate c LEFT JOIN idea_source s ON s.id = c.source_id
      WHERE c.decision = 'dismissed' ORDER BY c.decided_at DESC NULLS LAST`)).rows;

  const decide = async (id, decision, userId) =>
    (await db.query(
      `UPDATE idea_candidate SET decision = $2, decided_by = $3, decided_at = now() WHERE id = $1 RETURNING ${CAND_COLS}`,
      [id, decision, userId])).rows[0] || null;

  const linkAnalysis = async (id, analysisId) =>
    (await db.query(`UPDATE idea_candidate SET analysis_id = $2 WHERE id = $1 RETURNING ${CAND_COLS}`, [id, analysisId])).rows[0] || null;

  const candidateById = async (id) => (await db.query(`SELECT ${CAND_COLS} FROM idea_candidate WHERE id = $1`, [id])).rows[0] || null;

  // ---------- расход ----------

  /** Потолок проверяется ДО запуска очередного обхода и дешёвым запросом, а не сложением всех обходов дня. */
  const spentOn = async (date = today()) =>
    Number((await db.query("SELECT spent FROM idea_spend WHERE spend_date = $1", [date])).rows[0]?.spent ?? 0);

  const addSpend = async (amount, date = today()) => Number((await db.query(
    `INSERT INTO idea_spend (spend_date, spent) VALUES ($1, $2)
     ON CONFLICT (spend_date) DO UPDATE SET spent = idea_spend.spent + EXCLUDED.spent RETURNING spent`,
    [date, amount])).rows[0].spent);

  return {
    today,
    listSources, getSource, findSource, createSource, setSourceActive, setSourceThreshold,
    deleteSource, pauseSource, bumpFails, resetFails,
    runFor, runsOn, lastRuns, claimRun, finishRun, failRun,
    saveItems, itemsFor, cleanupItems,
    upsertCandidate, feed, dismissed, decide, linkAnalysis, candidateById,
    spentOn, addSpend,
  };
}
