// Доступ к разделу «Статистика» (spec 018, US2).
// ВОРОТА SC-001: без права не достаётся НИ ОДНА цифра — проверяется не код ответа, а содержимое тела.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startApp } from "./helpers/app.js";

let T, boss, anna;
before(async () => {
  T = await startApp();
  boss = await T.userWithSession({ login: "boss", name: "Хозяин", role: "admin" });
  anna = await T.userWithSession({ login: "anna", name: "Анна" });
});
after(async () => { await T.close(); });

const patch = (id, body) => T.call("PATCH", `/api/users/${id}`, boss.headers, body);

test("ворота SC-001: без права — 403 и ни одного числа в теле (FR-001, FR-002)", async () => {
  const r = await T.call("GET", "/api/stats", anna.headers);
  assert.equal(r.status, 403);
  const text = await r.text();
  const body = JSON.parse(text);
  assert.equal(body.error, "no_stats_access");
  // ни счётчиков, ни долей, ни названий ниш — отказ не должен рассказывать, сколько чего есть
  assert.deepEqual(Object.keys(body).sort(), ["error", "message"]);
  assert.ok(!/\d/.test(text), `в теле отказа есть цифры: ${text}`);
  for (const k of ["n", "total", "summary", "rows", "freshness", "verdicts", "niche"]) assert.ok(!(k in body), `в отказе есть поле ${k}`);
});

test("право видно в своей учётной записи и раздаётся админом (FR-003)", async () => {
  let me = await (await T.call("GET", "/api/auth/me", anna.headers)).json();
  assert.equal(me.user.statsAccess, false);

  const r = await patch(anna.user.id, { statsAccess: true });
  assert.equal(r.status, 200);
  assert.equal((await r.json()).user.statsAccess, true);

  me = await (await T.call("GET", "/api/auth/me", anna.headers)).json();
  assert.equal(me.user.statsAccess, true);
  assert.equal((await T.call("GET", "/api/stats", anna.headers)).status, 200, "право выдано — раздел открылся (FR-006: обычный пользователь с правом)");
});

test("SC-008: снятие права закрывает раздел на следующем же запросе (FR-004)", async () => {
  await patch(anna.user.id, { statsAccess: true });
  assert.equal((await T.call("GET", "/api/stats", anna.headers)).status, 200);
  await patch(anna.user.id, { statsAccess: false });
  const r = await T.call("GET", "/api/stats", anna.headers);
  assert.equal(r.status, 403, "ждать истечения сеанса не нужно");
  assert.equal((await (await T.call("GET", "/api/auth/me", anna.headers)).json()).user.statsAccess, false);
});

test("админ имеет право по роли, без выданного флага", async () => {
  const list = await (await T.call("GET", "/api/users", boss.headers)).json();
  assert.equal(list.find((u) => u.login === "boss").statsAccess, false, "отдельный флаг админу не выдавали");
  assert.equal((await T.call("GET", "/api/stats", boss.headers)).status, 200, "и всё же раздел ему открыт");
  assert.equal((await (await T.call("GET", "/api/auth/me", boss.headers)).json()).user.statsAccess, true);
});

test("без сеанса — 401, а не 403: чужому не видно, существует ли раздел", async () => {
  assert.equal((await T.call("GET", "/api/stats", { "x-requested-with": "fba" })).status, 401);
});

test("право — не ключ настроек: пользователь не может выдать его себе сам", async () => {
  const r = await T.call("PATCH", "/api/auth/settings", anna.headers, { statsAccess: true });
  assert.equal(r.status, 200, "неизвестные ключи настроек просто отбрасываются");
  const me = await (await T.call("GET", "/api/auth/me", anna.headers)).json();
  assert.equal(me.user.statsAccess, false);
  assert.equal(me.user.settings.statsAccess, undefined);
  assert.equal((await T.call("GET", "/api/stats", anna.headers)).status, 403);
});
