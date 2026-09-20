// Сеансы (research R4, R5): непрозрачный токен в HttpOnly-cookie, в БД — только SHA-256. Кэш проверки 60 с:
// БД (Neon) не будится на каждый запрос, а отключение пользователя действует не позже чем через минуту (FR-008).
import { createHash, randomBytes } from "node:crypto";
import { isStorageError } from "./db/index.js";

export const COOKIE = "fba_sid";
const DAY = 24 * 60 * 60 * 1000;
export const SESSION_TTL_MS = 30 * DAY;
const CACHE_MS = 60 * 1000;

export const hashToken = (token) => createHash("sha256").update(String(token)).digest("hex");

export function readCookie(req, name = COOKIE) {
  const raw = req.headers?.cookie || "";
  for (const part of raw.split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) { try { return decodeURIComponent(part.slice(i + 1).trim()); } catch { return ""; } }
  }
  return "";
}

const publicUser = (r) => ({ id: r.id, login: r.login, name: r.name, role: r.role, settings: r.settings || {}, mustChangePassword: r.must_change_password });

export function createSessions(db, cfg = {}) {
  const cache = new Map(); // tokenHash → { user, at }
  const now = () => (cfg.now ? cfg.now() : Date.now());
  const secure = Boolean(cfg.production);

  async function createSession(userId, ua = "") {
    const token = randomBytes(32).toString("base64url");
    // Все метки времени — из одного источника (now()), а не из DEFAULT now() базы: иначе расчёт «последней активности» зависит от расхождения часов.
    await db.query("INSERT INTO sessions (token_hash, user_id, created_at, last_seen_at, expires_at, ua) VALUES ($1, $2, $3, $3, $4, $5)", [hashToken(token), userId, new Date(now()), new Date(now() + SESSION_TTL_MS), String(ua).slice(0, 200)]);
    return token;
  }

  /** → { user, renewed } | null. renewed=true — срок продлён (не чаще раза в сутки), cookie стоит переустановить. */
  async function resolveSession(token) {
    if (!token || typeof token !== "string" || token.length > 100) return null;
    const th = hashToken(token);
    const hit = cache.get(th);
    if (hit && now() - hit.at < CACHE_MS) return { user: hit.user, renewed: false };
    const r = (await db.query(
      `SELECT s.expires_at, s.last_seen_at, u.id, u.login, u.name, u.role, u.active, u.settings, u.must_change_password
         FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = $1`, [th])).rows[0];
    if (!r || !r.active || new Date(r.expires_at).getTime() <= now()) { cache.delete(th); return null; }
    let renewed = false;
    if (now() - new Date(r.last_seen_at).getTime() > DAY) {
      await db.query("UPDATE sessions SET last_seen_at = $2, expires_at = $3 WHERE token_hash = $1", [th, new Date(now()), new Date(now() + SESSION_TTL_MS)]);
      renewed = true;
    }
    const user = publicUser(r);
    cache.set(th, { user, at: now() });
    if (cache.size > 2000) for (const [k, v] of cache) if (now() - v.at >= CACHE_MS) cache.delete(k);
    return { user, renewed };
  }

  async function destroySession(token) {
    if (!token) return;
    const th = hashToken(token); cache.delete(th);
    await db.query("DELETE FROM sessions WHERE token_hash = $1", [th]);
  }
  /** Все сеансы пользователя (отключение, сброс и смена пароля). exceptToken — оставить текущий. */
  async function destroyUserSessions(userId, exceptToken = null) {
    const keep = exceptToken ? hashToken(exceptToken) : "";
    for (const [k, v] of cache) if (v.user.id === userId && k !== keep) cache.delete(k);
    await db.query("DELETE FROM sessions WHERE user_id = $1 AND token_hash <> $2", [userId, keep]);
  }
  /** После изменения имени/роли/настроек — чтобы кэш не отдавал старые данные. */
  function forgetUser(userId) { for (const [k, v] of cache) if (v.user.id === userId) cache.delete(k); }
  const purgeExpired = () => db.query("DELETE FROM sessions WHERE expires_at < $1", [new Date(now())]);

  function setCookie(res, token) {
    res.cookie(COOKIE, token, { httpOnly: true, secure, sameSite: "lax", path: "/", maxAge: SESSION_TTL_MS });
  }
  function clearCookie(res) { res.clearCookie(COOKIE, { httpOnly: true, secure, sameSite: "lax", path: "/" }); }

  /** Кладёт req.user (или null). Ошибка хранилища → 503, а не «не авторизован». */
  async function attachUser(req, res, next) {
    req.user = null; req.sessionToken = "";
    const token = readCookie(req);
    if (!token) return next();
    try {
      const s = await resolveSession(token);
      if (s) { req.user = s.user; req.sessionToken = token; if (s.renewed) setCookie(res, token); }
      next();
    } catch (e) {
      if (isStorageError(e)) return res.status(503).json({ error: "storage_unavailable", message: "Хранилище недоступно — повторите через несколько секунд" });
      next(e);
    }
  }
  const requireUser = (req, res, next) => (req.user ? next() : res.status(401).json({ error: "unauthorized", message: "Требуется вход" }));
  const requireAdmin = (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: "unauthorized", message: "Требуется вход" });
    if (req.user.role !== "admin") return res.status(403).json({ error: "forbidden", message: "Доступно только администратору" });
    next();
  };
  const requirePasswordChanged = (req, res, next) => (req.user?.mustChangePassword
    ? res.status(403).json({ error: "password_change_required", message: "Сначала смените временный пароль" }) : next());

  return { createSession, resolveSession, destroySession, destroyUserSessions, forgetUser, purgeExpired, setCookie, clearCookie, attachUser, requireUser, requireAdmin, requirePasswordChanged };
}

/** CSRF (research R5): изменяющие запросы — только JSON, с заголовком X-Requested-With: fba и с того же origin. */
export function csrfGuard(req, res, next) {
  if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") return next();
  const deny = (why) => res.status(403).json({ error: "csrf", message: "Запрос отклонён: " + why });
  if ((req.get("x-requested-with") || "").toLowerCase() !== "fba") return deny("нет заголовка X-Requested-With");
  const hasBody = Number(req.get("content-length") || 0) > 0 || Boolean(req.get("transfer-encoding"));
  if (hasBody && !/^application\/json\b/i.test(req.get("content-type") || "")) return deny("ожидается application/json");
  const origin = req.get("origin") || req.get("referer");
  if (origin) {
    let host = ""; try { host = new URL(origin).host; } catch {}
    if (host !== req.get("host")) return deny("чужой origin");
  }
  next();
}
