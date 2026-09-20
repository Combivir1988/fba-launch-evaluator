// Учётные записи (spec 002, US1): создание, роли, отключение, вход с блокировкой, первый администратор из env.
import { randomUUID } from "node:crypto";
import * as realHasher from "./passwords.js";
import { validateNewPassword } from "./passwords.js";

export class UserError extends Error {
  constructor(code, message, status = 400, extra = {}) { super(message); this.code = code; this.status = status; this.extra = extra; Object.assign(this, extra); }
}

const LOGIN_RE = /^[a-z0-9._-]{3,40}$/;
export const MAX_FAILED = 5;
export const LOCK_MS = 15 * 60 * 1000;
const ROLES = new Set(["admin", "user"]);
const INVALID = () => new UserError("invalid_credentials", "Неверный логин или пароль", 401);

export const NO_PASSWORD = "!"; // вход только через Google: значение не разбирается как scrypt-хэш
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
/** "" | null | undefined → null; иначе нижний регистр без пробелов. Некорректная почта → UserError. */
export function normEmail(email) {
  if (email === null || email === undefined) return null;
  const e = String(email).trim().toLowerCase(); if (!e) return null;
  if (e.length > 200 || !EMAIL_RE.test(e)) throw new UserError("bad_email", "Некорректный адрес почты");
  return e;
}
const localPart = (email) => email.split("@")[0];
const pub = (r) => ({ id: r.id, login: r.login, name: r.name, role: r.role, active: r.active, mustChangePassword: r.must_change_password, settings: r.settings || {},
  email: r.email || null, hasPassword: r.password_hash !== NO_PASSWORD, googleLinked: Boolean(r.google_sub),
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

  const isUnique = (e, what) => e.code === "23505" && String(e.constraint || e.message || "").includes(what);
  /** Логин из почты: часть до @, только допустимые символы, уникальный (anna, anna2, anna3…). */
  async function loginFromEmail(email) {
    let base = localPart(email).replace(/[^a-z0-9._-]/g, "").slice(0, 36); if (base.length < 3) base = (base + "user").slice(0, 36);
    for (let i = 1; i < 500; i++) { const cand = i === 1 ? base : base + i; if (!(await db.query("SELECT 1 FROM users WHERE login = $1", [cand])).rows.length) return cand; }
    return base + randomUUID().slice(0, 6);
  }

  /** Два способа: с паролем (как раньше, почта необязательна) и приглашение только по почте — вход через Google, пароль не создаётся. */
  async function createUser({ login, name, role = "user", password, email }) {
    email = normEmail(email);
    const invite = password === undefined || password === null || password === "";
    if (invite && !email) throw new UserError("bad_password", "Задайте временный пароль или почту для входа через Google");
    login = normLogin(login); if (!login && email) login = await loginFromEmail(email);
    if ((name === undefined || name === null || !String(name).trim()) && email) name = localPart(email); // при первом входе заменится именем из Google
    checkFields({ login, name, role });
    let hash = NO_PASSWORD;
    if (!invite) { const bad = validateNewPassword(password); if (bad) throw new UserError("bad_password", bad); hash = await H.hashPassword(password); }
    try {
      const r = (await db.query("INSERT INTO users (id, login, name, role, password_hash, must_change_password, email) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *", [randomUUID(), login, name.trim(), role, hash, !invite, email])).rows[0];
      return pub(r);
    } catch (e) {
      if (isUnique(e, "email")) throw new UserError("email_taken", "Эта почта уже назначена другому пользователю", 409);
      if (e.code === "23505") throw new UserError("login_taken", "Такой логин уже занят", 409);
      throw e;
    }
  }

  /** Изменение имени, роли, активности. Нельзя оставить систему без активного администратора (FR-009). */
  async function updateUser(id, patch = {}) {
    const { name, role, active } = patch; checkFields({ name, role });
    const setEmail = "email" in patch; const email = setEmail ? normEmail(patch.email) : undefined;
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
      if (setEmail && !email && cur.password_hash === NO_PASSWORD) throw new UserError("email_required", "У пользователя нет пароля — без почты он не сможет войти. Сначала задайте пароль", 409);
      return (await t.query("UPDATE users SET name = $2, role = $3, active = $4, email = $5 WHERE id = $1 RETURNING *", [id, next.name, next.role, next.active, setEmail ? email : cur.email])).rows[0];
    }).catch((e) => { if (isUnique(e, "email")) throw new UserError("email_taken", "Эта почта уже назначена другому пользователю", 409); throw e; });
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
    if (u.password_hash === NO_PASSWORD) throw new UserError("no_password", "Вы входите через Google — пароля у учётной записи нет. При необходимости его задаст администратор", 409);
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

  /** Вход через Google (spec 004): только приглашённые. Сначала по постоянному идентификатору аккаунта, затем по почте (и тогда привязываем sub).
   *  Неприглашённая почта и отключённый пользователь дают один и тот же отказ — чужому не видно, заведена ли учётная запись. */
  async function findForGoogle({ sub, email, name }) {
    const denied = () => new UserError("google_not_invited", "Этой почты нет в списке приглашённых", 403);
    if (!sub) throw denied();
    let u = (await db.query("SELECT * FROM users WHERE google_sub = $1", [String(sub)])).rows[0];
    if (!u) {
      const e = normEmail(email); if (!e) throw denied();
      u = (await db.query("SELECT * FROM users WHERE lower(email) = $1", [e])).rows[0];
      if (!u || !u.active) throw denied();
      if (u.google_sub && u.google_sub !== String(sub)) throw denied(); // почта приглашена, но уже привязана к другому аккаунту Google
      const autoName = u.name === localPart(e) && name && String(name).trim();
      u = (await db.query("UPDATE users SET google_sub = $2, name = $3 WHERE id = $1 RETURNING *", [u.id, String(sub), autoName ? String(name).trim().slice(0, 80) : u.name])).rows[0];
    }
    if (!u.active) throw denied();
    u = (await db.query("UPDATE users SET last_login_at = $2, failed_logins = 0 WHERE id = $1 RETURNING *", [u.id, new Date(now())])).rows[0];
    return pub(u);
  }

  const listUsers = async () => (await db.query(
    `SELECT u.*, (SELECT count(*) FROM analyses a WHERE a.created_by = u.id AND a.deleted_at IS NULL) AS analyses FROM users u ORDER BY u.active DESC, u.name`)).rows.map(pub);
  const listNames = async () => (await db.query("SELECT id, name FROM users ORDER BY name")).rows;

  return { createUser, updateUser, resetPassword, authenticate, changePassword, updateSettings, bootstrapAdmin, listUsers, listNames, findForGoogle };
}
