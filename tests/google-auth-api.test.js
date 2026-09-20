// Полный поток входа через Google по HTTP (spec 004). Google подменён: tests/helpers/fake-google.js.
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { startApp, JSON_H } from "./helpers/app.js";
import { fakeGoogle, CLIENT_ID } from "./helpers/fake-google.js";

let T, G;
before(async () => { G = fakeGoogle(); T = await startApp({ GOOGLE_OAUTH_CLIENT_ID: CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET: "secret" }, { googleOpts: { fetchImpl: G.fetchImpl } }); });
after(async () => { await T.close(); });
beforeEach(async () => { await T.db.reset(); });

const get = (path, headers = {}) => fetch(T.base + path, { redirect: "manual", headers });
const cookieOf = (r, name) => (r.headers.getSetCookie().find((c) => c.startsWith(name + "=")) || "");
/** Начало входа: → { state, nonce, oauthCookie, location } */
async function start(next) {
  const r = await get("/api/auth/google/start" + (next ? "?next=" + encodeURIComponent(next) : "")); assert.equal(r.status, 302);
  const loc = new URL(r.headers.get("location")); const c = cookieOf(r, "fba_oauth");
  return { state: loc.searchParams.get("state"), nonce: loc.searchParams.get("nonce"), oauthCookie: c.split(";")[0], rawCookie: c, location: loc };
}
const finish = (s, code, extra = "") => get(`/api/auth/google/callback?state=${encodeURIComponent(s.state)}&code=${encodeURIComponent(code)}${extra}`, { cookie: s.oauthCookie });

test("health показывает, что вход через Google настроен; начало входа: верный адрес возврата и защищённая cookie", async () => {
  assert.equal((await (await get("/api/health")).json()).googleLogin, true);
  const s = await start("/?tab=history");
  assert.equal(s.location.origin, "https://accounts.google.com"); assert.equal(s.location.searchParams.get("client_id"), CLIENT_ID);
  assert.equal(s.location.searchParams.get("redirect_uri"), T.base + "/api/auth/google/callback"); assert.equal(s.location.searchParams.get("code_challenge_method"), "S256");
  assert.match(s.rawCookie, /HttpOnly/i); assert.match(s.rawCookie, /SameSite=Lax/i); assert.match(s.rawCookie, /Path=\/api\/auth\/google/); assert.match(s.rawCookie, /Max-Age=600/);
  assert.equal(s.location.toString().includes("secret"), false);
});

test("приглашённый входит: сеанс fba_sid, возврат на next, имя из Google; в приложении он обычный пользователь", async () => {
  await T.users.createUser({ email: "anna@gmail.com", role: "user" });
  const s = await start("/?tab=history");
  const r = await finish(s, G.issueCode({ nonce: s.nonce, sub: "g-111", email: "Anna@Gmail.com", name: "Анна Коваль" }));
  assert.equal(r.status, 302); assert.equal(r.headers.get("location"), "/?tab=history");
  const sid = cookieOf(r, "fba_sid"); assert.match(sid, /^fba_sid=[A-Za-z0-9_-]{43};/); assert.match(sid, /HttpOnly/i);
  assert.match(cookieOf(r, "fba_oauth"), /fba_oauth=;/, "одноразовая cookie входа очищена");
  const me = await (await get("/api/auth/me", { cookie: sid.split(";")[0] })).json();
  assert.equal(me.user.name, "Анна Коваль"); assert.equal(me.user.role, "user"); assert.equal(me.mustChangePassword, false);
  assert.equal((await get("/api/analyses", { cookie: sid.split(";")[0] })).status, 200);
  assert.equal((await get("/api/users", { cookie: sid.split(";")[0] })).status, 403, "роль берётся из приглашения, не из Google");
});

test("неприглашённая почта и отключённый пользователь: одинаковый отказ, сеанса нет, учётная запись не создаётся", async () => {
  const off = await T.users.createUser({ email: "off@gmail.com" }); await T.users.updateUser(off.id, { active: false });
  const out = [];
  for (const email of ["stranger@gmail.com", "off@gmail.com"]) { const s = await start(); const r = await finish(s, G.issueCode({ nonce: s.nonce, email })); out.push([r.status, r.headers.get("location"), cookieOf(r, "fba_sid")]); }
  for (const o of out) assert.deepEqual(o, [302, "/login.html?error=google_not_invited", ""]);
  assert.equal((await T.db.query("SELECT count(*)::int AS n FROM users")).rows[0].n, 1);
});

test("подмена и повтор: чужой браузер, повторная ссылка возврата, подделанная подпись, отмена у Google", async () => {
  await T.users.createUser({ sub: "g-anna", email: "anna@gmail.com" });
  const s = await start(); const code = G.issueCode({ nonce: s.nonce, sub: "g-anna", email: "anna@gmail.com" });
  const noCookie = await get(`/api/auth/google/callback?state=${s.state}&code=${code}`); assert.equal(noCookie.headers.get("location"), "/login.html?error=google_retry", "ссылку возврата открыли в другом браузере");
  const ok = await finish(s, G.issueCode({ nonce: s.nonce, sub: "g-anna", email: "anna@gmail.com" })); assert.equal(ok.headers.get("location"), "/", "чужая попытка без cookie не срывает вход настоящего пользователя");
  const again = await finish(s, G.issueCode({ nonce: s.nonce, sub: "g-anna", email: "anna@gmail.com" })); assert.equal(again.headers.get("location"), "/login.html?error=google_retry", "после успешного входа ссылка возврата больше не работает");
  const s2 = await start(); assert.equal((await finish(s2, G.issueCode({ nonce: s2.nonce, sub: "g-anna", email: "anna@gmail.com" }, { foreignKey: true }))).headers.get("location"), "/login.html?error=google_failed");
  const s3 = await start(); const cancelled = await get(`/api/auth/google/callback?state=${s3.state}&error=access_denied`, { cookie: s3.oauthCookie }); assert.equal(cancelled.headers.get("location"), "/login.html?error=google_cancelled");
  const sOther = await start(); assert.equal((await finish(sOther, G.issueCode({ nonce: sOther.nonce, sub: "g-чужой", email: "anna@gmail.com" }))).headers.get("location"), "/login.html?error=google_not_invited", "почта уже привязана к другому аккаунту Google");
  const s4 = await start(); assert.equal((await finish(s4, G.issueCode({ nonce: s4.nonce, sub: "g-anna", email: "anna@gmail.com" }))).headers.get("location"), "/", "после всех отказов обычный вход работает");
});

test("возврат только внутрь приложения; смена почты в Google не ломает вход; пароль работает как раньше", async () => {
  await T.users.createUser({ email: "anna@gmail.com" });
  const s = await start("//evil.example/steal"); assert.equal((await finish(s, G.issueCode({ nonce: s.nonce, sub: "g-7", email: "anna@gmail.com" }))).headers.get("location"), "/");
  const s2 = await start("https://evil.example"); assert.equal((await finish(s2, G.issueCode({ nonce: s2.nonce, sub: "g-7", email: "anna.renamed@gmail.com" }))).headers.get("location"), "/", "опознан по sub после смены адреса");
  await T.users.createUser({ login: "petro", name: "Петро", password: "temp-password-1" });
  assert.equal((await T.call("POST", "/api/auth/login", JSON_H, { login: "petro", password: "temp-password-1" })).status, 200);
  assert.equal((await T.call("POST", "/api/auth/login", JSON_H, { login: "anna", password: "!" })).status, 401, "у приглашённого через Google пароля нет");
});

test("вход через Google не настроен: кнопки нет, start отвечает 404", async () => {
  const P = await startApp();
  try { assert.equal((await (await fetch(P.base + "/api/health")).json()).googleLogin, false); assert.equal((await fetch(P.base + "/api/auth/google/start", { redirect: "manual" })).status, 404); }
  finally { await P.close(); }
});
