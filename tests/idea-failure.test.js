// Spec 021 — ВОРОТА SC-002: отказ источника нигде не выглядит пустотой.
//
// Пишется ДО сборки ленты и обязан падать на наивной версии, где несобранный источник просто
// не добавляет строк. Это самый вероятный способ сделать «как бы работающую» ленту, которая
// молча врёт: ноль читается как «спроса нет», а это противоположный вывод.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { testDb } from "./helpers/db.js";
import { createIdeasStore } from "../server/ideas-store.js";
import { createIdeas } from "../server/ideas.js";

const fx = (n) => readFileSync(new URL("./fixtures/" + n, import.meta.url), "utf8");

/** Ответы подставляются по адресу: одна площадка отвечает, другая отказывает. */
function fakeFetch(plan) {
  return async (url) => {
    const hit = Object.entries(plan).find(([frag]) => String(url).includes(frag));
    const r = hit?.[1];
    if (!r) return { ok: false, status: 500, text: async () => "нет плана" };
    if (r.status && r.status >= 400) return { ok: false, status: r.status, text: async () => r.body ?? "" };
    return { ok: true, status: 200, text: async () => r.body, json: async () => JSON.parse(r.body) };
  };
}

let db, store, ideas;
before(async () => {
  db = await testDb();
  store = createIdeasStore(db);
  await store.createSource({ platform: "channel", handle: "telegram", title: "Канал про гаджеты" });
  await store.createSource({ platform: "video", handle: "bike chain cleaner", title: "Чистка цепи" });
  await store.createSource({ platform: "crowdfunding", handle: "16", title: "Технологии" });
});
after(async () => { await db.close(); });

test("ВОРОТА SC-002: отказавший источник НАЗВАН, а его счётчики не становятся нулями", async () => {
  // Две площадки отвечают, третья отклоняет запрос. Прямой запрос и обход защиты оба неудачны.
  ideas = createIdeas(db, store, {
    cfg: { scrapflyKey: null },
    fetchImpl: fakeFetch({
      "t.me/s/": { body: fx("idea-telegram.html") },
      "youtube.com/results": { body: `<script>var ytInitialData = ${fx("idea-video-en.json")};</script>` },
      "kickstarter.com": { status: 403, body: "Just a moment..." },
    }),
  });
  await ideas.sweepAll();
  const d = await ideas.get();

  // 1. Остальные два показаны полностью.
  const ok = d.sources.filter((s) => s.state === "collected");
  assert.equal(ok.length, 2, "две площадки собраны");
  for (const s of ok) assert.ok(Number.isFinite(s.lastRun.seen), s.title + ": счётчик есть");

  // 2. Лента НАЗЫВАЕТ, какого источника не хватает и почему.
  assert.equal(d.complete, false, "обход неполный, и раздел это знает");
  assert.equal(d.notCollected.length, 1);
  const missing = d.notCollected[0];
  assert.equal(missing.title, "Технологии");
  assert.ok(missing.reason && missing.reason.length > 3, "причина названа человеческими словами: " + missing.reason);

  // 3. Ни один счётчик отказавшего источника не стал нулём — это РАЗНЫЕ состояния.
  const failed = d.sources.find((s) => s.title === "Технологии");
  assert.equal(failed.state, "failed");
  assert.equal(failed.lastRun.status, "failed");
  assert.equal(failed.lastRun.seen, null, "«не собрано» — это не «обработано 0»");
  assert.equal(failed.lastRun.passed, null, "«не смогли посмотреть» — это не «ничего не прошло»");
  assert.ok(failed.lastRun.failCode, "у неудачи ВСЕГДА есть код");
  assert.ok(failed.lastRun.failMessage, "и человеческое объяснение");
});

test("база не позволяет записать неудачу без причины — правило держит она, а не договорённость", async () => {
  const s = (await store.listSources())[0];
  await assert.rejects(
    () => db.query(
      `INSERT INTO idea_run (source_id, run_date, status) VALUES ($1, '2020-01-01', 'failed')`, [s.id]),
    /ck_run_fail_has_reason|constraint/i,
    "строка «неудача без причины» выглядела бы в ленте пустотой");
});

test("общие счётчики складываются ТОЛЬКО по собранным, а не считают несобранное нулём", async () => {
  const d = await ideas.get();
  const collected = d.sources.filter((s) => s.lastRun?.status === "ok");
  const manual = collected.reduce((a, s) => a + s.lastRun.seen, 0);
  assert.equal(d.counters.seen, manual, "сумма по собранным");
  assert.equal(d.counters.collected, 2);
  assert.equal(d.counters.sources, 3, "и видно, что собраны не все");
});

test("когда не собран НИ ОДИН источник, счётчики отсутствуют, а не равны нулю", async () => {
  const db2 = await testDb();
  const st2 = createIdeasStore(db2);
  await st2.createSource({ platform: "video", handle: "x", title: "Только этот" });
  const i2 = createIdeas(db2, st2, { cfg: {}, fetchImpl: fakeFetch({ "youtube.com": { status: 503 } }) });
  await i2.sweepAll();
  const d = await i2.get();

  assert.equal(d.counters.seen, null, "ноль здесь означал бы «посмотрели и не нашли»");
  assert.equal(d.counters.passed, null);
  assert.equal(d.complete, false);
  assert.equal(d.feed.length, 0);
  assert.equal(d.notCollected.length, 1, "и сказано, чего именно не хватает");
  await db2.close();
});
