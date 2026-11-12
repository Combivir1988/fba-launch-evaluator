// Spec 021 — рынок раздела: США и Европа.
//
// Замеры 2026-11-12, и площадки ведут себя ПО-РАЗНОМУ. Тест закрепляет именно это,
// а не «рынок где-то учитывается»:
//   краудфандинг — область РАБОТАЕТ: США 183 проекта, Европа 100, пересечение с общей лентой 5 и 2 из 12;
//   видео — область почти ничего не меняет (18-19 из 20 роликов те же при английском запросе),
//           разницу даёт ЯЗЫК запроса: немецкий дал 17 своих из 20, польский 20 из 23;
//   канал — области нет вовсе.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { testDb } from "./helpers/db.js";
import { createIdeasStore } from "../server/ideas-store.js";
import * as video from "../server/sources/video.js";
import * as crowdfunding from "../server/sources/crowdfunding.js";
import * as channels from "../server/sources/channels.js";

let db, store;
before(async () => { db = await testDb(); store = createIdeasStore(db); });
after(async () => { await db.close(); });

test("краудфандинг: рынок меняет САМ ЗАПРОС — это разные пулы проектов", () => {
  const us = crowdfunding.buildUrl("16", { market: "US" });
  const eu = crowdfunding.buildUrl("16", { market: "EU" });
  assert.notEqual(us, eu);
  assert.ok(us.includes("woe_id=" + crowdfunding.WOE.US));
  assert.ok(eu.includes("woe_id=" + crowdfunding.WOE.EU));
  assert.notEqual(crowdfunding.WOE.US, crowdfunding.WOE.EU);
});

test("видео: рынок меняет область, но ЯЗЫК ОТВЕТА остаётся английским при любом рынке", () => {
  for (const m of ["US", "EU"]) {
    const u = video.buildUrl("bike chain cleaner", { market: m });
    assert.ok(u.includes("hl=en"), `${m}: ловушку D8 закрывает hl, а не область`);
    assert.ok(u.includes("sp=" + video.MONTH_FILTER), `${m}: фильтр по дате на месте при любом рынке`);
  }
  assert.notEqual(video.buildUrl("x", { market: "US" }), video.buildUrl("x", { market: "EU" }));
});

test("видео: настоящий рычаг — фраза, а не рынок; она попадает в запрос как есть", () => {
  const de = video.buildUrl("Fahrradkette reinigen", { market: "EU" });
  assert.ok(de.includes(encodeURIComponent("Fahrradkette reinigen")));
  assert.ok(de.includes("hl=en"), "запрос на другом языке — числа всё равно читаются по-английски");
});

test("канал: рынка у площадки нет, и адрес от него не зависит", () => {
  assert.equal(channels.hasMarket, false);
  assert.equal(channels.buildUrl("telegram"), channels.buildUrl("telegram"));
});

test("США и Европа — ДВА раздела с одним и тем же запросом, а не дубль", async () => {
  const a = await store.createSource({ platform: "video", handle: "bike chain cleaner", title: "Цепь · США", market: "US" });
  const b = await store.createSource({ platform: "video", handle: "bike chain cleaner", title: "Цепь · Европа", market: "EU" });
  assert.notEqual(a.id, b.id);
  assert.equal(a.market, "US");
  assert.equal(b.market, "EU");

  // Каждый ищется по своему рынку — предупреждение о совпадении не срабатывает между рынками.
  assert.equal((await store.findSource("video", "bike chain cleaner", "US")).id, a.id);
  assert.equal((await store.findSource("video", "bike chain cleaner", "EU")).id, b.id);

  // А вот тот же запрос на том же рынке — именно дубль, и база его не пускает.
  await assert.rejects(
    () => store.createSource({ platform: "video", handle: "bike chain cleaner", title: "Ещё раз", market: "US" }),
    /uq_idea_source|unique|duplicate/i,
    "один и тот же раздел на одном рынке дважды — это двойной расход");
});

test("у каждого рынка СВОЙ фон: складывать их в один было бы ошибкой ворот SC-003", async () => {
  const [us] = (await store.listSources()).filter((s) => s.market === "US");
  const [eu] = (await store.listSources()).filter((s) => s.market === "EU");
  // Разные разделы — значит разные строки обхода и разные фоны, по построению.
  assert.notEqual(us.id, eu.id);
  assert.equal(await store.claimRun(us.id, "2026-11-12"), true);
  assert.equal(await store.claimRun(eu.id, "2026-11-12"), true, "рынки обходятся независимо друг от друга");
});
