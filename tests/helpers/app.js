// Тестовый сервер: PGlite в памяти + createApp. Быстрый хэшер паролей (scrypt проверяется отдельно в passwords/users тестах).
import { createApp } from "../../server/index.js";
import { configFromEnv } from "../../server/claude.js";
import { testDb } from "./db.js";

export const fakeHasher = { hashPassword: async (p) => "fake:" + p, verifyPassword: async (p, h) => h === "fake:" + p, dummyVerify: async () => false };
export const JSON_H = { "content-type": "application/json", "x-requested-with": "fba" };

export async function startApp(env = {}, deps = {}) {
  const db = await testDb();
  const cfg = configFromEnv({ MOCK_AI: "1", DB_MEMORY: "1", LOGIN_RATE_LIMIT: "1000", ...env });
  const app = createApp(cfg, { db, usersOpts: { hasher: fakeHasher }, ...deps });
  const server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const users = app.locals.users;

  /** Создаёт пользователя (пароль уже «сменён») и возвращает заголовки с cookie сеанса. */
  async function userWithSession({ login, name = login, role = "user", password = "test-password-1" } = {}) {
    const u = await users.createUser({ login, name, role, password });
    await db.query("UPDATE users SET must_change_password = false WHERE id = $1", [u.id]);
    return { user: u, headers: await login_(login, password), password };
  }
  async function login_(login, password) {
    const r = await fetch(`${base}/api/auth/login`, { method: "POST", headers: JSON_H, body: JSON.stringify({ login, password }) });
    if (r.status !== 200) throw new Error(`login ${login}: ${r.status} ${await r.text()}`);
    const cookie = r.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
    return { ...JSON_H, cookie };
  }
  const call = (method, path, headers, body) => fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  return { base, db, app, users, userWithSession, login: login_, call, close: async () => { server.close(); await db.close(); } };
}
