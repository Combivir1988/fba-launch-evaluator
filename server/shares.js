// Публичные ссылки на снимок дашборда (spec 002, US3; research R7, R8). Снимок неизменяем до явного «Обновить ссылку».
// Для постороннего несуществующая, отозванная, истёкшая ссылка и ссылка удалённого анализа неразличимы: getPublic → null.
import { gzipSync, gunzipSync } from "node:zlib";
import { randomBytes, randomUUID } from "node:crypto";
import { UserError } from "./users.js";
import { isUuid } from "./analyses.js";
import { joinDoc } from "../shared/analysis.js";
import { buildSnapshot, findEconomicsLeaks } from "../shared/share-snapshot.js";

const DAY = 24 * 60 * 60 * 1000;
const VIEW_WINDOW = 30 * 60 * 1000;
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
const NOT_FOUND = () => new UserError("not_found", "Ссылка не найдена", 404);
const SELECT = `s.id, s.token, s.analysis_id, s.created_by, s.mode, s.snapshot_at, s.snapshot_version, s.expires_at, s.revoked_at, s.views, s.last_viewed_at, s.created_at,
  su.name AS share_author, a.created_by AS analysis_author, a.version AS analysis_version, a.niche, a.deleted_at`;
const FROM = `FROM shares s JOIN users su ON su.id = s.created_by JOIN analyses a ON a.id = s.analysis_id`;

export function createShares(db, analyses, opts = {}) {
  const now = () => (opts.now ? opts.now() : Date.now());
  const seen = new Map(); // token|ip → время последнего засчитанного просмотра

  const state = (r) => (r.revoked_at || r.deleted_at ? "revoked" : r.expires_at && new Date(r.expires_at).getTime() <= now() ? "expired" : "active");
  const pub = (r) => ({ id: r.id, analysisId: r.analysis_id, niche: r.niche, path: "/s/" + r.token, url: (opts.publicUrl || "") + "/s/" + r.token, mode: r.mode, state: state(r),
    createdBy: { id: r.created_by, name: r.share_author }, createdAt: r.created_at, snapshotAt: r.snapshot_at, stale: r.analysis_version > r.snapshot_version,
    expiresAt: r.expires_at, views: r.views, lastViewedAt: r.last_viewed_at });

  /** Снимок из сохранённого анализа. Для режима без экономики — самопроверка: при утечке значения ссылка не создаётся. */
  async function snapshotOf(analysisId, mode) {
    const g = await analyses.get(analysisId); // 404, если анализ удалён
    const doc = joinDoc(g.core, g.aggregates);
    if (!doc.results) throw new UserError("not_computed", "В анализе ещё нет результатов — загрузите файлы или заполните данные", 409);
    const snap = buildSnapshot(doc, { mode, preparedBy: g.meta.createdBy.name, snapshotAt: new Date(now()).toISOString(), analysisUpdatedAt: g.meta.updatedAt });
    if (mode === "no_economics") { const leaks = findEconomicsLeaks(snap, doc); if (leaks.length) throw new UserError("redaction_failed", "Не удалось надёжно скрыть экономику — ссылка не создана. Сообщите администратору.", 500, { fields: leaks.slice(0, 5).map((l) => l.path) }); }
    return { buf: gzipSync(Buffer.from(JSON.stringify(snap), "utf8")), version: g.meta.version };
  }

  async function create({ analysisId, mode = "full", expiresInDays = 30 }, user) {
    if (!isUuid(analysisId)) throw new UserError("not_found", "Анализ не найден", 404);
    if (mode !== "full" && mode !== "no_economics") throw new UserError("bad_mode", "Режим ссылки: full или no_economics");
    if (![7, 30, null].includes(expiresInDays)) throw new UserError("bad_expiry", "Срок действия: 7 дней, 30 дней или без срока");
    const { buf, version } = await snapshotOf(analysisId, mode);
    const id = randomUUID(), token = randomBytes(32).toString("base64url");
    await db.query("INSERT INTO shares (id, token, analysis_id, created_by, mode, snapshot_gz, snapshot_at, snapshot_version, expires_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)",
      [id, token, analysisId, user.id, mode, buf, new Date(now()), version, expiresInDays === null ? null : new Date(now() + expiresInDays * DAY)]);
    return get(id);
  }

  async function row(id) { if (!isUuid(id)) throw NOT_FOUND(); const r = (await db.query(`SELECT ${SELECT} ${FROM} WHERE s.id = $1`, [id])).rows[0]; if (!r) throw NOT_FOUND(); return r; }
  const get = async (id) => pub(await row(id));
  /** Управлять ссылкой могут автор анализа, автор ссылки и администратор (FR-026). */
  function ensureCanManage(r, user) { if (user.role !== "admin" && user.id !== r.created_by && user.id !== r.analysis_author) throw new UserError("forbidden", "Управлять ссылкой может автор анализа, автор ссылки или администратор", 403); }

  async function refresh(id, user) {
    const r = await row(id); ensureCanManage(r, user);
    if (state(r) !== "active") throw new UserError("not_active", "Ссылка отозвана или истекла — создайте новую", 409);
    const { buf, version } = await snapshotOf(r.analysis_id, r.mode);
    await db.query("UPDATE shares SET snapshot_gz = $2, snapshot_at = $3, snapshot_version = $4 WHERE id = $1", [id, buf, new Date(now()), version]);
    return get(id);
  }
  async function revoke(id, user) {
    const r = await row(id); ensureCanManage(r, user);
    if (!r.revoked_at) await db.query("UPDATE shares SET revoked_at = $2, revoked_by = $3 WHERE id = $1", [id, new Date(now()), user.id]);
    for (const k of seen.keys()) if (k.startsWith(r.token + "|")) seen.delete(k);
  }
  const listForAnalysis = async (analysisId) => (isUuid(analysisId) ? (await db.query(`SELECT ${SELECT} ${FROM} WHERE s.analysis_id = $1 ORDER BY s.created_at DESC`, [analysisId])).rows.map(pub) : []);
  /** Администратор видит все ссылки команды, пользователь — свои и ссылки на свои анализы. */
  async function listAll(user) {
    const rows = user.role === "admin" ? (await db.query(`SELECT ${SELECT} ${FROM} WHERE a.deleted_at IS NULL ORDER BY s.created_at DESC LIMIT 500`)).rows
      : (await db.query(`SELECT ${SELECT} ${FROM} WHERE a.deleted_at IS NULL AND (s.created_by = $1 OR a.created_by = $1) ORDER BY s.created_at DESC LIMIT 500`, [user.id])).rows;
    return rows.map(pub);
  }

  /** Публичное чтение: снимок или null (не существует / отозвана / истекла / анализ удалён — для постороннего одно и то же). */
  async function getPublic(token) {
    const probe = typeof token === "string" && TOKEN_RE.test(token) ? token : "-".repeat(43); // запрос в БД выполняется всегда — время ответа не выдаёт формат токена
    const r = (await db.query(`SELECT s.snapshot_gz, s.expires_at, s.revoked_at, a.deleted_at FROM shares s JOIN analyses a ON a.id = s.analysis_id WHERE s.token = $1`, [probe])).rows[0];
    if (!r || r.revoked_at || r.deleted_at || (r.expires_at && new Date(r.expires_at).getTime() <= now())) return null;
    return JSON.parse(gunzipSync(r.snapshot_gz).toString("utf8"));
  }
  /** Просмотр засчитывается не чаще раза в 30 минут с одного адреса; просмотры вошедших участников команды не считаются. */
  async function countView(token, ip, hasSession) {
    if (hasSession) return false;
    const key = token + "|" + (ip || "?"); const last = seen.get(key) || 0;
    if (now() - last < VIEW_WINDOW) return false;
    seen.set(key, now()); if (seen.size > 20000) for (const [k, t] of seen) if (now() - t >= VIEW_WINDOW) seen.delete(k);
    await db.query("UPDATE shares SET views = views + 1, last_viewed_at = $2 WHERE token = $1", [token, new Date(now())]);
    return true;
  }

  return { create, get, refresh, revoke, listForAnalysis, listAll, getPublic, countView };
}
