// Учётные записи (spec 002, US1): создание, роли, отключение, вход с блокировкой, первый администратор из env.
import { randomUUID } from "node:crypto";
import * as realHasher from "./passwords.js";
import { validateNewPassword } from "./passwords.js";

export class UserError extends Error {
  constructor(code, message, status = 400, extra = {}) { super(message); this.code = code; this.status = status; Object.assign(this, extra); }
}

const LOGIN_RE = /^[a-z0-9._-]{3,40}$/;
export const MAX_FAILED = 5;
export const LOCK_MS = 15 * 60 * 1000;
const ROLES = new Set(["admin", "user"]);
const INVALID = () => new UserError("invalid_credentials", "Неверный логин или пароль", 401);

const pub = (r) => ({ id: r.id, login: r.login, name: r.name, role: r.role, active: r.active, mustChangePassword: r.must_change_password, settings: r.settings || {},
  lastLoginAt: r.last_login_at || null, createdAt: r.created_at || null, lockedUntil: r.locked_until || null, ...(r.analyses !== undefined ? { analyses: Number(r.analyses) } : {}) });

export function normLogin(login) { return String(login ?? "").trim().toLowerCase(); }

export function createUsers(db, sessions, opts = {}) {
  const H = opts.hasher || realHasher;
  const now = () => (opts.now ? opts.now() : Date.now());
  const ghost = new Map(); // неудачи для несуществующих логинов — чтобы блокировка не выдавала, существует ли логин (FR-007)

  function checkFields({ login, name, role }) {
    if (login !== undefined && !LOGIN_RE.test(login)) throw new UserError("bad_login", "Логин: 3–40 символов, латиница в нижнем регистре, цифры, точка, дефис, подчёркивание");
    if (name !== undefined && (typeof name !== "string" || !name.trim() || name.trim().length > 80)) throw new UserError("bad_name", "Имя: от 1 до 80 символов");
    if (role !== undefined && !ROLES.has(role)) throw new UserError("bad_role", "Роль: admin или user");
  }

  async function createUser({ login, name, role = "user", password }) {
    login = normLogin(login); checkFields({ login, name, role });
    const bad = validateNewPassword(password); if (bad) throw new UserError("bad_password", bad);
    const hash = await H.hashPassword(password);
    try {
      const r = (await db.query("INSERT INTO users (id, login, name, role, password_hash, must_change_password) VALUES ($1,$2,$3,$4,$5,true) RETURNING *", [randomUUID(), login, name.trim(), role, hash])).rows[0];
      return pub(r);
    } catch (e) { if (e.code === "23505") throw new UserError("login_taken", "Такой логин уже занят", 409); throw e; }
  }

  /** Изменение имени, роли, активности. Нельзя оставить систему без активного администратора (FR-009). */
  async function updateUser(id, patch = {}) {
    const { name, role, active } = patch; checkFields({ name, role });
    if (active !== undefined && typeof active !== "boolean") throw new UserError("bad_active", "active: true или false");
    const out = await db.tx(async (t) => {
      const cur = (await t.query("SELECT * FROM users WHERE id = $1 FOR UPDATE", [id])).rows[0];
      if (!cur) throw new UserError("not_found", "Пользователь не найден", 404);
      const next = { name: name !== undefined ? name.trim() : cur.name, role: role ?? cur.role, active: active ?? cur.active };
      const losesAdmin = cur.role === "admin" && cur.active && (next.role !== "admin" || !next.active);
      if (losesAdmin) {
        const others = (await t.query("SELECT count(*)::int AS n FROM users WHERE role = 'admin' AND active AND id <> $1", [id])).rows[0].n;
        if (others === 0) throw new UserError("last_admin", "Нужен хотя бы один активный администратор", 409);
      }
      return (await t.query("UPDATE users SET name = $2, role = $3, active = $4 WHERE id = $1 RETURNING *", [id, next.name, next.role, next.active])).rows[0];
    });
    if (active === false) await sessions.destroyUserSessions(id); else sessions.forgetUser(id);
    return pub(out);
  }

  async function resetPassword(id, password) {
    const bad = validateNewPassword(password); if (bad) throw new UserError("bad_password", bad);
    const hash = await H.hashPassword(password);
    const r = (await db.query("UPDATE users SET password_hash = $2, must_change_password = true, failed_logins = 0, locked_until = NULL WHERE id = $1 RETURNING id", [id, hash])).rows[0];
    if (!r) throw new UserError("not_found", "Пользователь не найден", 404);
    await sessions.destroyUserSessions(id);
  }

  const locked = (until) => new UserError("locked", "Слишком много неудачных попыток. Вход временно заблокирован", 429, { retryAfter: Math.max(1, Math.ceil((until - now()) / 1000)) });

  /** Успех → публичный пользователь. Любая неудача выглядит одинаково: invalid_credentials либо locked. */
  async function authenticate(login, password) {
    login = normLogin(login);
    if (typeof password !== "string" || !login || login.length > 40 || password.length > 200) { await H.dummyVerify(); throw INVALID(); }
    const u = (await db.query("SELECT * FROM users WHERE login = $1", [login])).rows[0];
    if (!u) {
      const g = ghost.get(login) || { n: 0, until: 0 };
      if (g.until > now()) throw locked(g.until);
      await H.dummyVerify();
      g.n += 1; if (g.n >= MAX_FAILED) { g.n = 0; g.until = now() + LOCK_MS; }
      ghost.set(login, g); if (ghost.size > 5000) ghost.delete(ghost.keys().next().value);
      throw INVALID();
    }
    const until = u.locked_until ? new Date(u.locked_until).getTime() : 0;
    if (until > now()) throw locked(until);
    const ok = await H.verifyPassword(password, u.password_hash);
    if (!ok || !u.active) {
      if (!ok) {
        const n = u.failed_logins + 1;
        if (n >= MAX_FAILED) await db.query("UPDATE users SET failed_logins = 0, locked_until = $2 WHERE id = $1", [u.id, new Date(now() + LOCK_MS)]);
        else await db.query("UPDATE users SET failed_logins = $2 WHERE id = $1", [u.id, n]);
      }
      throw INVALID();
    }
    const r = (await db.query("UPDATE users SET failed_logins = 0, locked_until = NULL, last_login_at = $2 WHERE id = $1 RETURNING *", [u.id, new Date(now())])).rows[0];
    return pub(r);
  }

  /** Смена своего пароля: остальные сеансы закрываются, текущий (keepToken) остаётся. */
  async function changePassword(userId, current, next, keepToken = null) {
    const u = (await db.query("SELECT * FROM users WHERE id = $1 AND active", [userId])).rows[0];
    if (!u) throw new UserError("not_found", "Пользователь не найден", 404);
    if (typeof current !== "string" || !(await H.verifyPassword(current, u.password_hash))) throw new UserError("wrong_password", "Текущий пароль введён неверно", 403);
    const bad = validateNewPassword(next, current); if (bad) throw new UserError("bad_password", bad);
    await db.query("UPDATE users SET password_hash = $2, must_change_password = false WHERE id = $1", [userId, await H.hashPassword(next)]);
    await sessions.destroyUserSessions(userId, keepToken); sessions.forgetUser(userId);
  }

  async function updateSettings(userId, patch = {}) {
    const clean = {};
    for (const k of ["modelAi", "modelPatents"]) if (patch[k] !== undefined) { if (typeof patch[k] !== "string" || patch[k].length > 120) throw new UserError("bad_settings", `Недопустимое значение ${k}`); clean[k] = patch[k]; }
    const r = (await db.query("UPDATE users SET settings = settings || $2::jsonb WHERE id = $1 RETURNING settings", [userId, JSON.stringify(clean)])).rows[0];
    if (!r) throw new UserError("not_found", "Пользователь не найден", 404);
    sessions.forgetUser(userId);
    return r.settings;
  }

  /** Первый администратор из env: создаётся, только если активного администратора нет (он же — способ восстановить доступ, D7). */
  async function bootstrapAdmin({ adminLogin, adminPassword } = {}) {
    const n = (await db.query("SELECT count(*)::int AS n FROM users WHERE role = 'admin' AND active")).rows[0].n;
    if (n > 0) return { created: false, reason: "exists" };
    if (!adminLogin || !adminPassword) return { created: false, reason: "no_env" };
    const login = normLogin(adminLogin);
    const existing = (await db.query("SELECT id FROM users WHERE login = $1", [login])).rows[0];
    if (existing) {
      const bad = validateNewPassword(adminPassword); if (bad) throw new UserError("bad_password", "ADMIN_PASSWORD: " + bad);
      await db.query("UPDATE users SET role = 'admin', active = true, password_hash = $2, must_change_password = true, failed_logins = 0, locked_until = NULL WHERE id = $1", [existing.id, await H.hashPassword(adminPassword)]);
      await sessions.destroyUserSessions(existing.id);
      return { created: true, restored: true, login };
    }
    await createUser({ login, name: "Администратор", role: "admin", password: adminPassword });
    return { created: true, restored: false, login };
  }

  const listUsers = async () => (await db.query(
    `SELECT u.*, (SELECT count(*) FROM analyses a WHERE a.created_by = u.id AND a.deleted_at IS NULL) AS analyses FROM users u ORDER BY u.active DESC, u.name`)).rows.map(pub);
  const listNames = async () => (await db.query("SELECT id, name FROM users ORDER BY name")).rows;

  return { createUser, updateUser, resetPassword, authenticate, changePassword, updateSettings, bootstrapAdmin, listUsers, listNames };
}
