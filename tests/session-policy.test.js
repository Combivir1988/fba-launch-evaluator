// spec 008: правила сеансов — выход при бездействии и максимальная длительность; задаёт администратор, проверяет сервер.
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { testDb } from "./helpers/db.js";
import { startApp, JSON_H } from "./helpers/app.js";
import { createSessions, hashToken } from "../server/sessions.js";
import { createAppSettings, normalizeSessionPolicy, IDLE_OPTIONS, MAX_DAYS_OPTIONS } from "../server/app-settings.js";

let db, clock, settings, S;
const MIN = 60_000, DAY = 86_400_000;
before(async () => { db = await testDb(); });
after(async () => { await db.close(); });
beforeEach(async () => { await db.reset(); clock = Date.parse("2026-09-21T10:00:00Z"); settings = createAppSettings(db, { now: () => clock }); S = createSessions(db, { now: () => clock, production: true, getPolicy: settings.getSessionPolicy }); });
const seenAt = async (token) => new Date((await db.query("SELECT last_seen_at FROM sessions WHERE token_hash = $1", [hashToken(token)])).rows[0]?.last_seen_at).getTime();
const exists = async (token) => (await db.query("SELECT 1 FROM sessions WHERE token_hash = $1", [hashToken(token)])).rows.length === 1;

test("настройки: по умолчанию правил нет; сохраняются только значения из списков; видно, кто и когда менял", async () => {
  assert.deepEqual(await settings.getSessionPolicy(), { idleMinutes: 0, maxDays: 0 });
  const admin = await db.makeUser({ role: "admin", name: "Админ" });
  const info = await settings.setSessionPolicy({ idleMinutes: 30, maxDays: 7 }, admin.id);
  assert.deepEqual(info.policy, { idleMinutes: 30, maxDays: 7 }); assert.equal(info.updatedBy, "Админ"); assert.equal(info.updatedAt, new Date(clock).toISOString()); assert.deepEqual(info.options, { idleMinutes: IDLE_OPTIONS, maxDays: MAX_DAYS_OPTIONS });
  assert.deepEqual(await createAppSettings(db).getSessionPolicy(), { idleMinutes: 30, maxDays: 7 }, "значение в базе, а не только в памяти");
  await assert.rejects(settings.setSessionPolicy({ idleMinutes: 7, maxDays: 7 }), /Время бездействия/); await assert.rejects(settings.setSessionPolicy({ idleMinutes: 30, maxDays: 365 }), /длительность сеанса/); await assert.rejects(settings.setSessionPolicy(null), /Время бездействия/);
  assert.deepEqual(normalizeSessionPolicy({ idleMinutes: "60", maxDays: 99 }), { idleMinutes: 60, maxDays: 0 }); assert.deepEqual(normalizeSessionPolicy(undefined), { idleMinutes: 0, maxDays: 0 });
  assert.deepEqual((await settings.setSessionPolicy({ idleMinutes: 0, maxDays: 0 }, admin.id)).policy, { idleMinutes: 0, maxDays: 0 }, "правила можно выключить");
});

test("SC-001: выход при бездействии — активность продлевает, пауза дольше правила завершает сеанс на сервере, причина названа", async () => {
  const u = await db.makeUser(); await settings.setSessionPolicy({ idleMinutes: 30, maxDays: 0 }, u.id); const token = await S.createSession(u.id);
  for (let i = 0; i < 9; i++) { clock += 10 * MIN; assert.ok(await S.resolveSession(token), `запрос на ${(i + 1) * 10}-й минуте`); } // 90 минут работы с запросами каждые 10 минут
  assert.equal(await seenAt(token), clock, "последняя активность записана в базу");
  clock += 29 * MIN; assert.ok(await S.resolveSession(token), "29 минут тишины — сеанс жив");
  clock += 30 * MIN + 1000; assert.equal(await S.resolveSession(token), null); assert.equal(S.endedReason(token), "idle"); assert.equal(await exists(token), false, "сеанс удалён из базы");
  assert.equal(await S.resolveSession(token), null, "повторная попытка тем же токеном не оживляет сеанс"); assert.equal(S.endedReason("другой"), null);
});

test("активность последней минуты живёт в памяти: в базу пишется не чаще раза в минуту, но бездействие считается от последнего запроса", async () => {
  const u = await db.makeUser(); await settings.setSessionPolicy({ idleMinutes: 15, maxDays: 0 }, u.id); const token = await S.createSession(u.id);
  clock += 2 * MIN; await S.resolveSession(token); const first = await seenAt(token); assert.equal(first, clock);
  clock += 20_000; await S.resolveSession(token); clock += 20_000; await S.resolveSession(token); assert.equal(await seenAt(token), first, "два запроса за 40 с — без записи в базу");
  clock += 30_000; await S.resolveSession(token); assert.equal(await seenAt(token), clock, "прошла минута — запись");
  clock += 14 * MIN; assert.ok(await S.resolveSession(token)); clock += 16 * MIN; assert.equal(await S.resolveSession(token), null);
  const fresh = createSessions(db, { now: () => clock, getPolicy: settings.getSessionPolicy }); const t2 = await fresh.createSession(u.id); clock += 16 * MIN; // другой процесс (после перезапуска сервера) — решает запись в базе
  assert.equal(await createSessions(db, { now: () => clock, getPolicy: settings.getSessionPolicy }).resolveSession(t2), null);
});

test("US3: максимальная длительность — сеанс завершается даже при непрерывной активности", async () => {
  const u = await db.makeUser(); await settings.setSessionPolicy({ idleMinutes: 0, maxDays: 1 }, u.id); const token = await S.createSession(u.id);
  for (let h = 1; h <= 23; h++) { clock += 60 * MIN; assert.ok(await S.resolveSession(token), `час ${h}`); }
  clock += 61 * MIN; assert.equal(await S.resolveSession(token), null); assert.equal(S.endedReason(token), "max"); assert.equal(await exists(token), false);
});

test("FR-002: правило действует на уже открытые сеансы сразу после изменения; FR-007: без правил — прежнее поведение", async () => {
  const u = await db.makeUser(); const token = await S.createSession(u.id); const created = clock;
  clock += 5 * 60 * MIN; assert.ok(await S.resolveSession(token), "правил нет — 5 часов тишины не мешают"); assert.equal(await seenAt(token), created, "и лишних записей в базу нет");
  clock += 20 * DAY; const r = await S.resolveSession(token); assert.ok(r && r.renewed, "сеанс 30 дней продлевается активностью, как раньше");
  clock += 3 * 60 * MIN; await settings.setSessionPolicy({ idleMinutes: 120, maxDays: 0 }, u.id);
  assert.equal(await S.resolveSession(token), null, "администратор включил правило — сеанс с тремя часами тишины закрыт"); assert.equal(S.endedReason(token), "idle");
});

test("API: правила видит и меняет только администратор; /me отдаёт правило приложению; 401 после бездействия называет причину", async () => {
  const t = await startApp();
  try {
    const admin = await t.userWithSession({ login: "boss", role: "admin" }), user = await t.userWithSession({ login: "ann" });
    assert.equal((await t.call("GET", "/api/admin/session-policy", JSON_H)).status, 401); assert.equal((await t.call("GET", "/api/admin/session-policy", user.headers)).status, 403); assert.equal((await t.call("PUT", "/api/admin/session-policy", user.headers, { idleMinutes: 15, maxDays: 0 })).status, 403);
    let r = await t.call("GET", "/api/admin/session-policy", admin.headers); assert.equal(r.status, 200); let j = await r.json(); assert.deepEqual(j.policy, { idleMinutes: 0, maxDays: 0 }); assert.equal(j.updatedAt, null);
    r = await t.call("PUT", "/api/admin/session-policy", admin.headers, { idleMinutes: 45, maxDays: 0 }); assert.equal(r.status, 400); assert.equal((await r.json()).error, "invalid");
    r = await t.call("PUT", "/api/admin/session-policy", { ...admin.headers, "x-requested-with": "" }, { idleMinutes: 60, maxDays: 0 }); assert.equal(r.status, 403, "защита от CSRF действует и здесь");
    r = await t.call("PUT", "/api/admin/session-policy", admin.headers, { idleMinutes: 60, maxDays: 7 }); assert.equal(r.status, 200); j = await r.json(); assert.deepEqual(j.policy, { idleMinutes: 60, maxDays: 7 }); assert.equal(j.updatedBy, "boss");
    const me = await (await t.call("GET", "/api/auth/me", user.headers)).json(); assert.deepEqual(me.sessionPolicy, { idleMinutes: 60, maxDays: 7 }); assert.equal(me.user.login, "ann");
    // новый сеанс, «последняя активность» которого в базе — два часа назад (как после сна компьютера или перезапуска сервера)
    const late = await t.login("ann", user.password); const tokenHash = hashToken(decodeURIComponent(late.cookie.split("fba_sid=")[1].split(";")[0]));
    await t.db.query("UPDATE sessions SET last_seen_at = now() - interval '2 hours' WHERE token_hash = $1", [tokenHash]);
    r = await t.call("GET", "/api/analyses", late); assert.equal(r.status, 401); j = await r.json(); assert.equal(j.reason, "idle"); assert.match(j.message, /из-за бездействия/);
    const old = await t.login("ann", user.password); const oldHash = hashToken(decodeURIComponent(old.cookie.split("fba_sid=")[1].split(";")[0]));
    await t.db.query("UPDATE sessions SET created_at = now() - interval '8 days', last_seen_at = now() WHERE token_hash = $1", [oldHash]);
    r = await t.call("GET", "/api/auth/me", old); assert.equal(r.status, 401); assert.equal((await r.json()).reason, "max");
    assert.equal((await t.call("GET", "/api/analyses", user.headers)).status, 200, "активный сеанс того же пользователя продолжает работать");
    assert.equal((await t.call("GET", "/api/auth/me", JSON_H)).status, 401); assert.equal((await (await t.call("GET", "/api/auth/me", JSON_H)).json()).reason, undefined, "без cookie причины нет");
  } finally { await t.close(); }
});
