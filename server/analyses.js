// Общая история анализов (spec 002, US2). Документ хранится двумя частями (research R2): `core` — JSONB, `aggregates` — gzip в BYTEA.
// Одновременные правки ловит оптимистичная блокировка по `version` (R6): молчаливой перезаписи нет.
import { gzipSync, gunzipSync } from "node:zlib";
import { randomUUID } from "node:crypto";
import { UserError } from "./users.js";
import { metaFromCore, SCHEMA_VERSION } from "../shared/analysis.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const isUuid = (v) => typeof v === "string" && UUID_RE.test(v);
const MAX_CORE = 1_000_000;       // символов JSON лёгкой части
const MAX_AGG_GZ = 3_000_000;     // байт сжатых агрегатов
const NOT_FOUND = () => new UserError("not_found", "Анализ не найден или удалён", 404);
// История версий (spec 009): сохранения одного автора схлопываются в пределах окна; на анализ — не больше MAX_VERSIONS записей, отчёты — у MAX_WITH_AGG последних.
export const VERSION_COLLAPSE_MS = 10 * 60 * 1000, MAX_VERSIONS = 30, MAX_WITH_AGG = 3;

const gz = (obj) => gzipSync(Buffer.from(JSON.stringify(obj ?? {}), "utf8"));
const ungz = (buf) => (buf ? JSON.parse(gunzipSync(buf).toString("utf8")) : {});

function checkCore(id, core) {
  if (!isUuid(id)) throw new UserError("bad_id", "Некорректный идентификатор анализа");
  if (!core || typeof core !== "object" || Array.isArray(core)) throw new UserError("bad_core", "Нет документа анализа");
  if ("aggregates" in core) throw new UserError("bad_core", "Агрегаты отчётов сохраняются отдельным запросом");
  if (Number(core.schemaVersion ?? 0) > SCHEMA_VERSION) throw new UserError("newer_schema", "Документ из более новой версии приложения — обновите страницу");
  const text = JSON.stringify({ ...core, id });
  if (text.length > MAX_CORE) throw new UserError("too_large", "Документ анализа слишком большой", 413);
  return text;
}

const rowMeta = (r) => ({ id: r.id, version: r.version, createdAt: r.created_at, updatedAt: r.updated_at,
  createdBy: { id: r.created_by, name: r.created_name ?? null }, updatedBy: { id: r.updated_by, name: r.updated_name ?? null } });

const SELECT_META = `a.id, a.version, a.created_at, a.updated_at, a.created_by, a.updated_by, cu.name AS created_name, uu.name AS updated_name`;
const JOIN_USERS = `JOIN users cu ON cu.id = a.created_by JOIN users uu ON uu.id = a.updated_by`;

export function createAnalyses(db, { now = () => Date.now() } = {}) {
  /** Архивировать текущее состояние строки ПЕРЕД перезаписью (внутри транзакции t). withAgg — сохранение меняет отчёты, прежние отчёты кладутся в версию. */
  async function archive(t, id, { withAgg = false, reason = "save", force = false, baseVersion = null }, user) {
    const old = (await t.query(`SELECT version, core, updated_by, updated_at${withAgg ? ", aggregates_gz" : ""} FROM analyses WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`, [id])).rows[0];
    if (!old) return null;
    if (!force && baseVersion !== null && old.version !== Number(baseVersion)) return { conflict: true }; // устаревшая версия — ничего не архивируем
    const last = (await t.query("SELECT state_by, archived_by, archived_at FROM analysis_versions WHERE analysis_id = $1 ORDER BY archived_at DESC, version DESC LIMIT 1", [id])).rows[0];
    // тот же человек продолжает править то, что сам и архивировал, — состояние «до его правок» уже в истории
    const sameSession = last && last.archived_by === user?.id && last.state_by === old.updated_by && now() - new Date(last.archived_at).getTime() < VERSION_COLLAPSE_MS && !withAgg;
    if (!force && sameSession) return old;
    await t.query(`INSERT INTO analysis_versions (id, analysis_id, version, core, aggregates_gz, state_at, state_by, archived_at, archived_by, reason) VALUES ($1,$2,$3,$4::jsonb,$5,$6,$7,$8,$9,$10)`,
      [randomUUID(), id, old.version, JSON.stringify(old.core), withAgg ? old.aggregates_gz : null, old.updated_at, old.updated_by, new Date(now()), user?.id || null, reason]);
    // ограничение хранения: лишние версии удаляются, у старых версий с отчётами отчёты обнуляются
    await t.query(`DELETE FROM analysis_versions WHERE analysis_id = $1 AND id NOT IN (SELECT id FROM analysis_versions WHERE analysis_id = $1 ORDER BY archived_at DESC, version DESC LIMIT ${MAX_VERSIONS})`, [id]);
    await t.query(`UPDATE analysis_versions SET aggregates_gz = NULL WHERE analysis_id = $1 AND aggregates_gz IS NOT NULL AND id NOT IN (SELECT id FROM analysis_versions WHERE analysis_id = $1 AND aggregates_gz IS NOT NULL ORDER BY archived_at DESC, version DESC LIMIT ${MAX_WITH_AGG})`, [id]);
    return old;
  }

  const metaCols = (core) => { const m = metaFromCore(core); return [m.niche, m.coreKeyword, m.verdict, m.c1 === null ? null : Math.round(m.c1), m.score, m.sources, m.aiDone, m.patentsDone]; };

  /** Список без документов. mine — только автора userId; q — поиск по нише, ключу и имени автора. */
  async function list({ userId, mine = false, q = "", limit = 200, offset = 0 } = {}) {
    const where = ["a.deleted_at IS NULL"]; const params = [];
    if (mine) { params.push(userId); where.push(`a.created_by = $${params.length}`); }
    const needle = String(q || "").trim().slice(0, 100);
    if (needle) { params.push("%" + needle.replace(/[\\%_]/g, (c) => "\\" + c) + "%"); const i = params.length; where.push(`(a.niche ILIKE $${i} OR a.core_keyword ILIKE $${i} OR cu.name ILIKE $${i})`); }
    const w = where.join(" AND ");
    const total = (await db.query(`SELECT count(*)::int AS n FROM analyses a ${JOIN_USERS} WHERE ${w}`, params)).rows[0].n;
    const lim = Math.min(Math.max(Number(limit) || 200, 1), 500), off = Math.max(Number(offset) || 0, 0);
    const rows = (await db.query(
      `SELECT ${SELECT_META}, a.niche, a.core_keyword, a.verdict, a.c1_score, a.score, a.sources, a.ai_done, a.patents_done,
              (SELECT count(*)::int FROM shares s WHERE s.analysis_id = a.id AND s.revoked_at IS NULL AND (s.expires_at IS NULL OR s.expires_at > now())) AS shares
         FROM analyses a ${JOIN_USERS} WHERE ${w} ORDER BY a.updated_at DESC LIMIT ${lim} OFFSET ${off}`, params)).rows;
    return { total, items: rows.map((r) => ({ ...rowMeta(r), niche: r.niche, coreKeyword: r.core_keyword, verdict: r.verdict, c1: r.c1_score, score: r.score === null ? null : Number(r.score),
      sources: r.sources || [], aiDone: r.ai_done, patentsDone: r.patents_done, shares: r.shares, runningJobs: [] })) };
  }

  async function get(id) {
    if (!isUuid(id)) throw NOT_FOUND();
    const r = (await db.query(`SELECT ${SELECT_META}, a.core, a.aggregates_gz FROM analyses a ${JOIN_USERS} WHERE a.id = $1 AND a.deleted_at IS NULL`, [id])).rows[0];
    if (!r) throw NOT_FOUND();
    return { meta: rowMeta(r), core: r.core, aggregates: ungz(r.aggregates_gz) };
  }
  async function getMeta(id) {
    const r = (await db.query(`SELECT ${SELECT_META} FROM analyses a ${JOIN_USERS} WHERE a.id = $1 AND a.deleted_at IS NULL`, [id])).rows[0];
    return r ? rowMeta(r) : null;
  }
  async function conflict(id) {
    const m = await getMeta(id); if (!m) throw NOT_FOUND();
    return new UserError("conflict", `Анализ изменил ${m.updatedBy.name || "другой пользователь"} — ваши правки не сохранены автоматически`, 409, { version: m.version, updatedBy: m.updatedBy, updatedAt: m.updatedAt });
  }

  /** Создание (baseVersion = null) или сохранение лёгкой части. force — осознанная перезапись после конфликта. */
  async function saveCore({ id, baseVersion = null, core, force = false }, user) {
    const text = checkCore(id, core); const cols = metaCols(core);
    if (baseVersion === null || baseVersion === undefined) {
      try {
        const r = (await db.query(
          `INSERT INTO analyses (id, core, niche, core_keyword, verdict, c1_score, score, sources, ai_done, patents_done, created_by, updated_by)
           VALUES ($1,$2::jsonb,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11) RETURNING version, updated_at`, [id, text, ...cols, user.id])).rows[0];
        return { version: r.version, updatedAt: r.updated_at, created: true };
      } catch (e) { if (e.code === "23505") throw new UserError("exists", "Анализ с таким идентификатором уже есть в истории", 409); throw e; }
    }
    const r = await db.tx(async (t) => {
      const old = await archive(t, id, { force, baseVersion }, user); if (!old || old.conflict) return null;
      return (await t.query(
        `UPDATE analyses SET core = $2::jsonb, niche = $3, core_keyword = $4, verdict = $5, c1_score = $6, score = $7, sources = $8, ai_done = $9, patents_done = $10,
                updated_by = $11, updated_at = now(), version = version + 1 WHERE id = $1 RETURNING version, updated_at`, [id, text, ...cols, user.id])).rows[0];
    });
    if (!r) throw await conflict(id);
    return { version: r.version, updatedAt: r.updated_at, created: false };
  }

  async function saveAggregates({ id, baseVersion, aggregates, force = false }, user) {
    if (!isUuid(id)) throw NOT_FOUND();
    if (!aggregates || typeof aggregates !== "object" || Array.isArray(aggregates)) throw new UserError("bad_aggregates", "Нет данных отчётов");
    const buf = gz(aggregates);
    if (buf.length > MAX_AGG_GZ) throw new UserError("too_large", "Отчёты слишком большие для хранения — уменьшите выгрузку Cerebro", 413);
    const r = await db.tx(async (t) => {
      const old = await archive(t, id, { withAgg: true, force, baseVersion }, user); if (!old || old.conflict) return null;
      return (await t.query(`UPDATE analyses SET aggregates_gz = $2, updated_by = $3, updated_at = now(), version = version + 1 WHERE id = $1 RETURNING version, updated_at`, [id, buf, user.id])).rows[0];
    });
    if (!r) throw await conflict(id);
    return { version: r.version, updatedAt: r.updated_at, bytes: buf.length };
  }

  /** «Сохранить как копию»: новый id, автор — текущий пользователь. */
  async function copy({ core, aggregates }, user) {
    const id = randomUUID(); const now = new Date().toISOString();
    const next = { ...core, id, createdAt: now, updatedAt: now, niche: core?.niche ? `${core.niche} (копия)` : core?.niche };
    const text = checkCore(id, next);
    const buf = aggregates && Object.keys(aggregates).length ? gz(aggregates) : null;
    if (buf && buf.length > MAX_AGG_GZ) throw new UserError("too_large", "Отчёты слишком большие для хранения", 413);
    const r = (await db.query(
      `INSERT INTO analyses (id, core, aggregates_gz, niche, core_keyword, verdict, c1_score, score, sources, ai_done, patents_done, created_by, updated_by)
       VALUES ($1,$2::jsonb,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$12) RETURNING version`, [id, text, buf, ...metaCols(next), user.id])).rows[0];
    return { id, version: r.version };
  }

  /** Удалить может автор или администратор. Мягкое удаление: ссылки анализа перестают работать (FR-029). */
  async function remove(id, user) {
    const m = isUuid(id) ? await getMeta(id) : null; if (!m) throw NOT_FOUND();
    if (m.createdBy.id !== user.id && user.role !== "admin") throw new UserError("forbidden", "Удалить анализ может его автор или администратор", 403);
    await db.query("UPDATE analyses SET deleted_at = now() WHERE id = $1", [id]);
  }

  /** Перенос из локальной истории или импорт JSON: повтор с тем же id ничего не меняет (FR-017, SC-010). */
  async function importDoc(analysis, user) {
    if (!analysis || typeof analysis !== "object") throw new UserError("bad_core", "Нет документа анализа");
    const { aggregates, ...core } = analysis; const id = core.id;
    const text = checkCore(id, core);
    const buf = aggregates && Object.keys(aggregates).length ? gz(aggregates) : null;
    if (buf && buf.length > MAX_AGG_GZ) throw new UserError("too_large", "Отчёты слишком большие для хранения", 413);
    const date = (v) => { const d = new Date(v); return Number.isNaN(d.getTime()) || d.getTime() > Date.now() ? new Date() : d; };
    const r = (await db.query(
      `INSERT INTO analyses (id, core, aggregates_gz, niche, core_keyword, verdict, c1_score, score, sources, ai_done, patents_done, created_by, updated_by, created_at, updated_at)
       VALUES ($1,$2::jsonb,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$12,$13,$14) ON CONFLICT (id) DO NOTHING RETURNING id`,
      [id, text, buf, ...metaCols(core), user.id, date(core.createdAt), date(core.updatedAt)])).rows[0];
    return { id, imported: Boolean(r) };
  }

  /** Точечная запись результата фоновой задачи (US4): не затирает остальной документ. key: "ai" | "patents". */
  async function patchResult(id, key, value, userId) {
    if (!["ai", "patents"].includes(key)) throw new Error("patchResult: неизвестный ключ " + key);
    const flag = key === "ai" ? "ai_done" : "patents_done";
    const r = (await db.query(
      `UPDATE analyses SET core = jsonb_set(core, $2::text[], $3::jsonb, true), ${flag} = true, verdict = CASE WHEN $4::text IS NULL THEN verdict ELSE $4::text END,
              updated_by = $5, updated_at = now(), version = version + 1 WHERE id = $1 AND deleted_at IS NULL RETURNING version`,
      [id, [key], JSON.stringify(value), key === "ai" ? value?.verdict ?? null : null, userId])).rows[0];
    return r ? r.version : null;
  }

  /** История версий анализа — без документов. */
  async function listVersions(id) {
    if (!isUuid(id) || !(await getMeta(id))) throw NOT_FOUND();
    const rows = (await db.query(`SELECT v.id, v.version, v.state_at, v.archived_at, v.reason, v.aggregates_gz IS NOT NULL AS has_agg, su.name AS state_name, v.state_by, au.name AS archived_name,
        v.core->>'niche' AS niche, v.core->'ai'->>'verdict' AS ai_verdict, v.core->'results'->'verdict'->>'ceiling' AS rules_verdict, (v.core->'results'->'criterion1'->>'okCount')::int AS c1, v.core->'sources' AS sources
      FROM analysis_versions v LEFT JOIN users su ON su.id = v.state_by LEFT JOIN users au ON au.id = v.archived_by WHERE v.analysis_id = $1 ORDER BY v.archived_at DESC, v.version DESC`, [id])).rows;
    return rows.map((r) => ({ id: r.id, version: r.version, stateAt: r.state_at, stateBy: { id: r.state_by, name: r.state_name }, archivedAt: r.archived_at, archivedBy: r.archived_name, reason: r.reason, hasAggregates: r.has_agg,
      niche: r.niche || "", verdict: r.ai_verdict || r.rules_verdict || null, c1: r.c1, sources: Object.entries(r.sources || {}).filter(([, v]) => v).map(([k]) => k) }));
  }
  /** Восстановить версию: текущее состояние сначала уходит в историю (шаг обратим). Отчёты возвращаются, только если они были сохранены с версией. → как get(). */
  async function restoreVersion(id, versionId, user) {
    if (!isUuid(id) || !isUuid(versionId)) throw NOT_FOUND();
    const v = (await db.query("SELECT core, aggregates_gz FROM analysis_versions WHERE id = $1 AND analysis_id = $2", [versionId, id])).rows[0];
    if (!v) throw new UserError("not_found", "Такой версии нет", 404);
    const core = { ...v.core, id, updatedAt: new Date(now()).toISOString() }; const text = checkCore(id, core); const cols = metaCols(core);
    const ok = await db.tx(async (t) => {
      const old = await archive(t, id, { withAgg: Boolean(v.aggregates_gz), reason: "restore", force: true }, user); if (!old) return false;
      await t.query(`UPDATE analyses SET core = $2::jsonb, niche = $3, core_keyword = $4, verdict = $5, c1_score = $6, score = $7, sources = $8, ai_done = $9, patents_done = $10, updated_by = $11, updated_at = now(), version = version + 1,
          aggregates_gz = COALESCE($12, aggregates_gz) WHERE id = $1`, [id, text, ...cols, user.id, v.aggregates_gz]);
      return true;
    });
    if (!ok) throw NOT_FOUND();
    return { ...(await get(id)), aggregatesRestored: Boolean(v.aggregates_gz) };
  }

  return { list, get, getMeta, saveCore, saveAggregates, copy, remove, importDoc, patchResult, listVersions, restoreVersion };
}
