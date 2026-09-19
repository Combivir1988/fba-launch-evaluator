import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { testDb } from "./helpers/db.js";
import { createSessions, csrfGuard, hashToken, readCookie, COOKIE, SESSION_TTL_MS } from "../server/sessions.js";

let db, clock, S;
const DAY = 86400000;
before(async () => { db = await testDb(); });
after(async () => { await db.close(); });
beforeEach(async () => { await db.reset(); clock = Date.parse("2026-09-19T10:00:00Z"); S = createSessions(db, { now: () => clock, production: true }); });

const fakeRes = () => { const r = { cookies: [], cleared: [], statusCode: 200, body: null, cookie(n, v, o) { r.cookies.push({ n, v, o }); }, clearCookie(n, o) { r.cleared.push({ n, o }); }, status(c) { r.statusCode = c; return r; }, json(b) { r.body = b; return r; } }; return r; };
const fakeReq = (o = {}) => { const h = Object.fromEntries(Object.entries(o.headers || {}).map(([k, v]) => [k.toLowerCase(), v])); return { method: o.method || "GET", headers: h, get: (n) => h[n.toLowerCase()] }; };

test("создание: в БД только SHA-256, токен 32 B base64url", async () => {
  const u = await db.makeUser();
  const token = await S.createSession(u.id, "UA");
  assert.match(token, /^[A-Za-z0-9_-]{43}$/);
  const row = (await db.query("SELECT token_hash, ua FROM sessions")).rows[0];
  assert.equal(row.token_hash, hashToken(token));
  assert.notEqual(row.token_hash, token);
  const s = await S.resolveSession(token);
  assert.equal(s.user.login, u.login); assert.equal(s.user.role, "user"); assert.equal(s.renewed, false);
  assert.equal("password_hash" in s.user, false);
});

test("неизвестный, пустой и слишком длинный токен → null", async () => {
  assert.equal(await S.resolveSession("nope"), null);
  assert.equal(await S.resolveSession(""), null);
  assert.equal(await S.resolveSession("x".repeat(500)), null);
});

test("истечение срока и скользящее продление не чаще раза в сутки", async () => {
  const u = await db.makeUser();
  const token = await S.createSession(u.id);
  clock += 2 * DAY;
  const s = await S.resolveSession(token);
  assert.equal(s.renewed, true);
  const exp = new Date((await db.query("SELECT expires_at FROM sessions")).rows[0].expires_at).getTime();
  assert.equal(exp, clock + SESSION_TTL_MS);
  clock += 61_000;
  assert.equal((await S.resolveSession(token)).renewed, false);
  clock += SESSION_TTL_MS + DAY;
  assert.equal(await S.resolveSession(token), null);
});

test("отключённый пользователь теряет доступ не позже чем через 60 с (кэш)", async () => {
  const u = await db.makeUser();
  const token = await S.createSession(u.id);
  assert.ok(await S.resolveSession(token));
  await db.query("UPDATE users SET active = false WHERE id = $1", [u.id]);
  clock += 30_000; assert.ok(await S.resolveSession(token), "в пределах кэша ещё пускает");
  clock += 31_000; assert.equal(await S.resolveSession(token), null);
});

test("destroyUserSessions чистит и БД, и кэш; exceptToken сохраняет текущий", async () => {
  const u = await db.makeUser();
  const a = await S.createSession(u.id), b = await S.createSession(u.id);
  await S.resolveSession(a); await S.resolveSession(b);
  await S.destroyUserSessions(u.id, a);
  assert.ok(await S.resolveSession(a));
  assert.equal(await S.resolveSession(b), null);
  await S.destroySession(a);
  assert.equal(await S.resolveSession(a), null);
  assert.equal((await db.query("SELECT count(*)::int AS n FROM sessions")).rows[0].n, 0);
});

test("purgeExpired удаляет только просроченные", async () => {
  const u = await db.makeUser();
  await S.createSession(u.id);
  clock += SESSION_TTL_MS + 1000;
  await S.createSession(u.id);
  await S.purgeExpired();
  assert.equal((await db.query("SELECT count(*)::int AS n FROM sessions")).rows[0].n, 1);
});

test("cookie: HttpOnly, Secure в production, SameSite=Lax; readCookie", () => {
  const res = fakeRes(); S.setCookie(res, "tok");
  assert.deepEqual(res.cookies[0], { n: COOKIE, v: "tok", o: { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: SESSION_TTL_MS } });
  const dev = createSessions(db, {}); const r2 = fakeRes(); dev.setCookie(r2, "t"); assert.equal(r2.cookies[0].o.secure, false);
  assert.equal(readCookie({ headers: { cookie: "a=1; fba_sid=abc%2Bd; b=2" } }), "abc+d");
  assert.equal(readCookie({ headers: {} }), "");
});

test("attachUser + requireUser/requireAdmin/requirePasswordChanged", async () => {
  const u = await db.makeUser({ mustChange: true });
  const token = await S.createSession(u.id);
  const req = fakeReq({ headers: { cookie: `${COOKIE}=${token}` } });
  await new Promise((ok) => S.attachUser(req, fakeRes(), ok));
  assert.equal(req.user.id, u.id);
  let res = fakeRes(); S.requireAdmin(req, res, () => assert.fail("не админ")); assert.equal(res.statusCode, 403);
  res = fakeRes(); S.requirePasswordChanged(req, res, () => assert.fail("нужна смена")); assert.equal(res.body.error, "password_change_required");
  const anon = fakeReq(); await new Promise((ok) => S.attachUser(anon, fakeRes(), ok));
  res = fakeRes(); S.requireUser(anon, res, () => assert.fail("аноним")); assert.equal(res.statusCode, 401);
});

test("csrfGuard", () => {
  const run = (o) => { const res = fakeRes(); let passed = false; csrfGuard(fakeReq(o), res, () => { passed = true; }); return passed ? "ok" : res.body.error; };
  assert.equal(run({ method: "GET" }), "ok");
  assert.equal(run({ method: "POST", headers: { "content-type": "application/json", "content-length": "2" } }), "csrf");
  assert.equal(run({ method: "POST", headers: { "x-requested-with": "fba", "content-type": "text/plain", "content-length": "2" } }), "csrf");
  assert.equal(run({ method: "POST", headers: { "x-requested-with": "fba", "content-type": "application/json; charset=utf-8", "content-length": "2", host: "app.example", origin: "https://evil.example" } }), "csrf");
  assert.equal(run({ method: "POST", headers: { "x-requested-with": "fba", "content-type": "application/json", "content-length": "2", host: "app.example", origin: "https://app.example" } }), "ok");
  assert.equal(run({ method: "DELETE", headers: { "x-requested-with": "FBA", host: "app.example" } }), "ok");
});
