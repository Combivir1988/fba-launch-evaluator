// Доступ к разделу «Идеи» (spec 021, US1/US5). Образец — доступ к статистике из spec 018, дословно.
//
// ВОРОТА SC-011a: без права не достаётся НИ ОДНА цифра раздела. Проверяется СОДЕРЖИМОЕ тела,
// а не код ответа: 403 с лентой в теле — это провал, который по коду выглядит успехом.
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

test("ВОРОТА SC-011a: без права — отказ, и в теле нет ни одной цифры раздела", async () => {
  const r = await T.call("GET", "/api/ideas", anna.headers);
  assert.equal(r.status, 403);

  const text = await r.text();
  const body = JSON.parse(text);
  assert.equal(body.error, "no_ideas_access");
  assert.deepEqual(Object.keys(body).sort(), ["error", "message"],
    "тело отказа — РОВНО {error, message}");
  assert.ok(!/\d/.test(text), `в теле отказа есть цифры: ${text}`);
  for (const k of ["feed", "sources", "counters", "spend", "thresholds", "notCollected"]) {
    assert.ok(!(k in body), `в отказе есть поле ${k}`);
  }
});

test("ВОРОТА SC-011a: закрыты все пути раздела, а не только лента", async () => {
  for (const [method, path, body] of [
    ["GET", "/api/ideas", null],
    ["GET", "/api/ideas/dismissed", null],
    ["POST", "/api/ideas/sources", { platform: "video", handle: "x", title: "x" }],
    ["POST", "/api/ideas/sweep", null],
    ["POST", "/api/ideas/candidates/00000000-0000-0000-0000-000000000000/decision", { decision: "kept" }],
  ]) {
    const r = body ? await T.call(method, path, anna.headers, body) : await T.call(method, path, anna.headers);
    assert.equal(r.status, 403, `${method} ${path} отдал ${r.status}`);
    const t = await r.text();
    assert.ok(!/\d/.test(t), `${method} ${path}: в теле отказа есть цифры`);
  }
});

test("право видно в своей учётной записи и раздаётся админом поимённо", async () => {
  let me = await (await T.call("GET", "/api/auth/me", anna.headers)).json();
  assert.equal(me.user.ideasAccess, false);
  assert.equal(me.user.statsAccess, false, "права двух разделов независимы");

  const r = await patch(anna.user.id, { ideasAccess: true });
  assert.equal(r.status, 200);
  assert.equal((await r.json()).user.ideasAccess, true);

  me = await (await T.call("GET", "/api/auth/me", anna.headers)).json();
  assert.equal(me.user.ideasAccess, true);
  assert.equal(me.user.statsAccess, false, "выдача одного права не открывает другое");
  assert.equal((await T.call("GET", "/api/ideas", anna.headers)).status, 200);
});

test("снятие права закрывает раздел на следующем же запросе, а не после перезахода", async () => {
  await patch(anna.user.id, { ideasAccess: true });
  assert.equal((await T.call("GET", "/api/ideas", anna.headers)).status, 200);

  await patch(anna.user.id, { ideasAccess: false });
  const r = await T.call("GET", "/api/ideas", anna.headers);
  assert.equal(r.status, 403, "тем же самым ключом сеанса");
  assert.ok(!/\d/.test(await r.text()));
});

test("администратору раздел открыт по роли, а выданный флаг у него не поднимается", async () => {
  assert.equal((await T.call("GET", "/api/ideas", boss.headers)).status, 200);

  const me = await (await T.call("GET", "/api/auth/me", boss.headers)).json();
  assert.equal(me.user.ideasAccess, true, "в своей учётной записи это ВЫЧИСЛЕННОЕ право");

  const list = await (await T.call("GET", "/api/users", boss.headers)).json();
  const row = list.find((u) => u.login === "boss");
  assert.equal(row.ideasAccess, false,
    "а в списке пользователей — ВЫДАННЫЙ флаг: админ должен видеть, кому он его дал. Разница намеренная");
});

test("тип права проверяется: строку вместо признака не принимаем", async () => {
  const r = await patch(anna.user.id, { ideasAccess: "да" });
  assert.equal(r.status, 400);
  assert.equal((await r.json()).error, "bad_ideas_access");
});
