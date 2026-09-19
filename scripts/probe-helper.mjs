// Общее для UI-проб: сервер с БД в памяти (PGlite) и вход администратором через API (cookie попадает в контекст браузера).
import { spawn } from "node:child_process";

export const ADMIN = { login: "admin", temp: "admin-temp-pass-1", password: "admin-real-pass-1" };
const H = { "content-type": "application/json", "x-requested-with": "fba" };

export async function startServer(port, env = {}) {
  const srv = spawn(process.execPath, ["server/index.js"], { env: { ...process.env, PORT: String(port), MOCK_AI: "1", DB_MEMORY: "1", NODE_ENV: "development", DATABASE_URL: "", ADMIN_LOGIN: ADMIN.login, ADMIN_PASSWORD: ADMIN.temp, LOGIN_RATE_LIMIT: "1000", ...env }, stdio: ["ignore", "pipe", "pipe"] });
  let err = ""; srv.stderr.on("data", (d) => { err += d; });
  const base = `http://127.0.0.1:${port}`;
  const t0 = Date.now();
  for (;;) { // PGlite стартует ~5 с
    try { const r = await fetch(base + "/api/health"); if (r.ok) break; } catch {}
    if (Date.now() - t0 > 40000) { srv.kill(); throw new Error("сервер не поднялся: " + err.slice(-400)); }
    await new Promise((r) => setTimeout(r, 300));
  }
  return { srv, base };
}

/** Вход в контексте браузера. При временном пароле — сразу меняет его на постоянный. */
export async function loginContext(context, base, { login = ADMIN.login, temp = ADMIN.temp, password = ADMIN.password } = {}) {
  let r = await context.request.post(base + "/api/auth/login", { headers: H, data: { login, password } });
  if (r.status() === 401) r = await context.request.post(base + "/api/auth/login", { headers: H, data: { login, password: temp } });
  if (!r.ok()) throw new Error(`login ${login}: ${r.status()} ${await r.text()}`);
  const me = await r.json();
  if (me.mustChangePassword) { const c = await context.request.post(base + "/api/auth/password", { headers: H, data: { current: temp, next: password } }); if (!c.ok()) throw new Error("change password: " + c.status()); }
  return me.user;
}
