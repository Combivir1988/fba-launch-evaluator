import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { startApp, JSON_H } from "./helpers/app.js";

let T;
before(async () => { T = await startApp(); });
after(async () => { await T.close(); });
beforeEach(async () => { await T.db.reset(); });

const body = async (r) => { const t = await r.text(); try { return JSON.parse(t); } catch { return t; } };

test("вход: cookie HttpOnly+SameSite=Lax, /me, выход закрывает сеанс", async () => {
  await T.users.createUser({ login: "anna", name: "Анна", password: "temp-password-1" });
  const r = await T.call("POST", "/api/auth/login", JSON_H, { login: "Anna", password: "temp-password-1" });
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.user.login, "anna"); assert.equal(j.mustChangePassword, true); assert.equal("password_hash" in j.user, false);
  const setCookie = r.headers.getSetCookie()[0];
  assert.match(setCookie, /^fba_sid=[A-Za-z0-9_-]{43};/); assert.match(setCookie, /HttpOnly/i); assert.match(setCookie, /SameSite=Lax/i); assert.match(setCookie, /Max-Age=2592000/);
  const h = { ...JSON_H, cookie: setCookie.split(";")[0] };
  assert.equal((await T.call("GET", "/api/auth/me", h)).status, 200);
  assert.equal((await T.call("POST", "/api/auth/logout", h)).status, 204);
  assert.equal((await T.call("GET", "/api/auth/me", h)).status, 401);
});

test("без cookie — 401 на всё, кроме health и login; неизвестный метод API — 404 JSON", async () => {
  assert.equal((await T.call("GET", "/api/health")).status, 200);
  for (const [m, p] of [["GET", "/api/auth/me"], ["GET", "/api/users"], ["GET", "/api/users/names"], ["GET", "/api/jobs/x"], ["GET", "/api/jobs/x/events"]]) assert.equal((await T.call(m, p)).status, 401, p);
  assert.equal((await T.call("POST", "/api/analyze", JSON_H, {})).status, 401);
  const a = await T.userWithSession({ login: "anna" });
  const r = await T.call("GET", "/api/nope", a.headers); assert.equal(r.status, 404); assert.equal((await r.json()).error, "not_found");
});

test("одинаковый ответ для неверного пароля, неизвестного и отключённого логина", async () => {
  const u = await T.users.createUser({ login: "anna", name: "Анна", password: "temp-password-1" });
  const off = await T.users.createUser({ login: "off", name: "Выкл", password: "temp-password-1" });
  await T.users.updateUser(off.id, { active: false });
  const out = [];
  for (const [login, password] of [["anna", "wrong-password-1"], ["ghost", "temp-password-1"], ["off", "temp-password-1"]]) {
    const r = await T.call("POST", "/api/auth/login", JSON_H, { login, password });
    out.push([r.status, await r.json(), r.headers.getSetCookie().length]);
  }
  for (const o of out) assert.deepEqual(o, [401, { error: "invalid_credentials", message: "Неверный логин или пароль" }, 0]);
  assert.ok(u.id);
});

test("блокировка после 5 неудач: 429 locked + Retry-After", async () => {
  await T.users.createUser({ login: "anna", name: "Анна", password: "temp-password-1" });
  for (let i = 0; i < 5; i++) assert.equal((await T.call("POST", "/api/auth/login", JSON_H, { login: "anna", password: "bad-password-xx" })).status, 401);
  const r = await T.call("POST", "/api/auth/login", JSON_H, { login: "anna", password: "temp-password-1" });
  assert.equal(r.status, 429); const j = await r.json();
  assert.equal(j.error, "locked"); assert.ok(j.retryAfter > 800); assert.equal(r.headers.get("retry-after"), String(j.retryAfter));
});

test("CSRF: изменяющий запрос без X-Requested-With или с чужого origin → 403", async () => {
  const a = await T.userWithSession({ login: "anna" });
  const noHeader = { "content-type": "application/json", cookie: a.headers.cookie };
  assert.equal((await body(await T.call("PATCH", "/api/auth/settings", noHeader, { modelAi: "x/y" }))).error, "csrf");
  assert.equal((await body(await T.call("PATCH", "/api/auth/settings", { ...a.headers, origin: "https://evil.example" }, { modelAi: "x/y" }))).error, "csrf");
  const ok = await T.call("PATCH", "/api/auth/settings", { ...a.headers, origin: T.base }, { modelAi: "x/y" });
  assert.equal(ok.status, 200); assert.deepEqual((await ok.json()).settings, { modelAi: "x/y" });
  assert.deepEqual((await (await T.call("GET", "/api/auth/me", a.headers)).json()).user.settings, { modelAi: "x/y" });
});

test("временный пароль: до смены доступны только /api/auth/*; после смены — всё", async () => {
  await T.users.createUser({ login: "anna", name: "Анна", password: "temp-password-1" });
  const h = await T.login("anna", "temp-password-1");
  assert.equal((await body(await T.call("GET", "/api/users/names", h))).error, "password_change_required");
  assert.equal((await body(await T.call("POST", "/api/analyze", h, { payload: {} }))).error, "password_change_required");
  assert.equal((await body(await T.call("POST", "/api/auth/password", h, { current: "nope-nope-nope", next: "brand-new-pass-1" }))).error, "wrong_password");
  assert.equal((await body(await T.call("POST", "/api/auth/password", h, { current: "temp-password-1", next: "short" }))).error, "bad_password");
  assert.equal((await T.call("POST", "/api/auth/password", h, { current: "temp-password-1", next: "brand-new-pass-1" })).status, 204);
  assert.equal((await T.call("GET", "/api/users/names", h)).status, 200, "текущий сеанс сохраняется");
  assert.equal((await T.call("POST", "/api/auth/login", JSON_H, { login: "anna", password: "temp-password-1" })).status, 401);
});

test("права: пользователь не видит управление людьми; админ создаёт, меняет, сбрасывает", async () => {
  const adm = await T.userWithSession({ login: "boss", name: "Босс", role: "admin" });
  const usr = await T.userWithSession({ login: "anna", name: "Анна" });
  for (const [m, p, b] of [["GET", "/api/users"], ["POST", "/api/users", { login: "x1x", name: "X", password: "temp-password-1" }], ["PATCH", `/api/users/${adm.user.id}`, { role: "user" }], ["POST", `/api/users/${adm.user.id}/reset-password`, { password: "temp-password-2" }]])
    assert.equal((await T.call(m, p, usr.headers, b)).status, 403, `${m} ${p}`);
  const created = await T.call("POST", "/api/users", adm.headers, { login: "Ivan", name: "Иван", role: "user", password: "temp-password-1" });
  assert.equal(created.status, 201); const ivan = (await created.json()).user; assert.equal(ivan.login, "ivan"); assert.equal(ivan.mustChangePassword, true);
  assert.equal((await body(await T.call("POST", "/api/users", adm.headers, { login: "ivan", name: "Дубль", password: "temp-password-1" }))).error, "login_taken");
  const list = await (await T.call("GET", "/api/users", adm.headers)).json();
  assert.deepEqual(list.map((u) => u.login).sort(), ["anna", "boss", "ivan"]); assert.ok(list.every((u) => !("password_hash" in u)));
  assert.equal((await (await T.call("PATCH", `/api/users/${ivan.id}`, adm.headers, { role: "admin" })).json()).user.role, "admin");
  assert.equal((await T.call("POST", `/api/users/${ivan.id}/reset-password`, adm.headers, { password: "temp-password-9" })).status, 204);
  assert.equal((await T.call("POST", "/api/auth/login", JSON_H, { login: "ivan", password: "temp-password-9" })).status, 200);
  assert.equal((await T.call("PATCH", "/api/users/00000000-0000-4000-8000-000000000000", adm.headers, { name: "X" })).status, 404);
});

test("последнего администратора нельзя отключить или понизить", async () => {
  const adm = await T.userWithSession({ login: "boss", role: "admin" });
  for (const patch of [{ active: false }, { role: "user" }]) {
    const r = await T.call("PATCH", `/api/users/${adm.user.id}`, adm.headers, patch);
    assert.equal(r.status, 409); assert.equal((await r.json()).error, "last_admin");
  }
});

test("отключение пользователя закрывает его сеанс сразу", async () => {
  const adm = await T.userWithSession({ login: "boss", role: "admin" });
  const usr = await T.userWithSession({ login: "anna" });
  assert.equal((await T.call("GET", "/api/auth/me", usr.headers)).status, 200);
  assert.equal((await T.call("PATCH", `/api/users/${usr.user.id}`, adm.headers, { active: false })).status, 200);
  assert.equal((await T.call("GET", "/api/auth/me", usr.headers)).status, 401);
});

test("тело больше лимита → 413; битый JSON → 400", async () => {
  const a = await T.userWithSession({ login: "anna" });
  const big = await fetch(T.base + "/api/auth/settings", { method: "PATCH", headers: a.headers, body: JSON.stringify({ modelAi: "x".repeat(150_000) }) });
  assert.equal(big.status, 413);
  const bad = await fetch(T.base + "/api/auth/settings", { method: "PATCH", headers: a.headers, body: "{oops" });
  assert.equal(bad.status, 400); assert.equal((await bad.json()).error, "bad_json");
});
