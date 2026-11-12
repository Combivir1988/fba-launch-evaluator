// Spec 021 — суточный обход: сутки не обходятся дважды, перезапуск не удваивает расход,
// потолок останавливает обход и помечает несобранное несобранным.
//
// Правило «одни сутки — один обход» держит ПЕРВИЧНЫЙ КЛЮЧ (source_id, run_date), а не проверка
// в коде. Поэтому тесты бьют по базе, а не по ветке в функции.
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { testDb } from "./helpers/db.js";
import { createIdeasStore } from "../server/ideas-store.js";
import { createIdeas } from "../server/ideas.js";

const fx = (n) => readFileSync(new URL("./fixtures/" + n, import.meta.url), "utf8");
const VIDEO_BODY = `<script>var ytInitialData = ${fx("idea-video-en.json")};</script>`;

let db, store, calls;
/** Каждый ответ идёт «через обход защиты» и стоит один кредит — так виден двойной расход. */
const fetchImpl = async (url) => {
  calls.push(String(url));
  if (String(url).includes("api.scrapfly.io")) {
    return { ok: true, status: 200, json: async () => ({ context: { cost: { total: 1 } }, result: { status_code: 200, content: VIDEO_BODY } }) };
  }
  return { ok: false, status: 403, text: async () => "нет" }; // прямой запрос отклонён — пойдём в обход
};
const make = () => createIdeas(db, store, { cfg: { scrapflyKey: "k" }, fetchImpl });

before(async () => { db = await testDb(); store = createIdeasStore(db); });
after(async () => { await db.close(); });
beforeEach(async () => {
  await db.query("DELETE FROM idea_run"); await db.query("DELETE FROM idea_candidate");
  await db.query("DELETE FROM idea_item"); await db.query("DELETE FROM idea_spend");
  await db.query("DELETE FROM idea_source");
  calls = [];
});

const addSource = (title, handle = "тема") => store.createSource({ platform: "video", handle, title });

test("повторный обход в те же сутки невозможен — и расход не вырос", async () => {
  await addSource("Раздел");
  const ideas = make();

  await ideas.sweepAll();
  const after1 = { calls: calls.length, spent: await store.spentOn() };
  assert.ok(after1.spent > 0, "первый обход что-то стоил");

  await ideas.sweepAll();                       // второе открытие раздела в те же сутки
  assert.equal(calls.length, after1.calls, "к площадке не ходили повторно");
  assert.equal(await store.spentOn(), after1.spent, "расход не вырос");
});

test("перезапуск посреди обхода: сутки не потеряны и расход не удвоился", async () => {
  const s = await addSource("Раздел");
  // Сутки застолблены, но обход не закончен — ровно то, что остаётся после перезапуска контейнера.
  assert.equal(await store.claimRun(s.id, store.today()), true);

  const ideas = make();                          // новый процесс: память пуста, состояние — в базе
  await ideas.sweepAll();

  assert.equal(calls.length, 0, "сутки уже застолблены — к площадке не идём");
  assert.equal(await store.spentOn(), 0, "и денег не тратим");
  const run = await store.runFor(s.id, store.today());
  assert.ok(run, "строка суток на месте — день не потерян");
});

test("потолок расхода останавливает обход, а несобранное помечается НЕСОБРАННЫМ, а не пустым", async () => {
  await addSource("Первый", "a"); await addSource("Второй", "b"); await addSource("Третий", "c");
  // Потолок 2: хватит на два источника, третий обязан остановиться.
  const ideas = createIdeas(db, store, { cfg: { scrapflyKey: "k" }, fetchImpl, getCap: async () => 2 });

  const out = await ideas.sweepAll();
  assert.equal(out.stoppedByCap, true);

  const d = await ideas.get();
  const stopped = d.sources.filter((s) => s.lastRun?.failCode === "cap_reached");
  assert.equal(stopped.length, 1, "остановлен ровно один");
  assert.equal(stopped[0].lastRun.seen, null, "«не смотрели» — это не «обработано 0»");
  assert.ok(/потолок/i.test(stopped[0].lastRun.failMessage), "причина названа: " + stopped[0].lastRun.failMessage);
  assert.equal(d.complete, false);
  assert.ok(d.sources.some((s) => s.state === "collected"), "собранное сохранено, а не откачено");
});

test("после N отказов подряд раздел приостанавливается системой — и причина у этого есть", async () => {
  const s = await addSource("Падучий");
  const bad = async () => ({ ok: false, status: 500, text: async () => "" });
  const ideas = createIdeas(db, store, { cfg: {}, fetchImpl: bad });

  const th = ideas.thresholds.ideas.failsBeforePause;
  for (let i = 0; i < th; i++) {
    await db.query("DELETE FROM idea_run");      // следующие сутки
    await ideas.sweepAll();
  }
  const row = await store.getSource(s.id);
  assert.equal(row.active, false, "раздел приостановлен");
  assert.ok(row.paused_reason, "приостановка СИСТЕМОЙ отличается от приостановки человеком тем, что у неё есть причина");

  // Человек запускает заново — причина снимается, счётчик обнуляется.
  const back = await store.setSourceActive(s.id, true);
  assert.equal(back.active, true);
  assert.equal(back.paused_reason, null);
  assert.equal(back.fails_in_row, 0);
});

test("уборка: элементы старше срока удаляются, кандидаты остаются", async () => {
  const s = await addSource("Раздел");
  const ideas = make();
  await ideas.sweepAll();

  const keep = ideas.thresholds.ideas.keepItemDays;
  const before = (await db.query("SELECT count(*)::int AS n FROM idea_item")).rows[0].n;
  assert.ok(before > 0, "непрошедшие элементы сохранены — чтобы подвинуть порог и сразу увидеть результат");

  // Состариваем всё на день больше срока хранения.
  await db.query("UPDATE idea_item SET run_date = current_date - ($1::integer + 1)", [keep]);
  const removed = await store.cleanupItems(keep);
  assert.equal(removed, before, "чужие тексты не хранятся дольше необходимого");
  assert.ok((await db.query("SELECT count(*)::int AS n FROM idea_candidate")).rows[0].n > 0, "а кандидаты остаются");
});

test("повторное появление поднимает счётчик суток, а не создаёт вторую запись", async () => {
  const s = await addSource("Раздел");
  const ideas = make();
  await ideas.sweepAll();
  const first = (await db.query("SELECT count(*)::int AS n FROM idea_candidate")).rows[0].n;
  assert.ok(first > 0);

  // Следующие сутки, тот же ответ площадки.
  await db.query("UPDATE idea_run SET run_date = current_date - 1");
  await db.query("UPDATE idea_candidate SET first_seen_on = current_date - 1, last_seen_on = current_date - 1");
  await ideas.sweepAll();

  assert.equal((await db.query("SELECT count(*)::int AS n FROM idea_candidate")).rows[0].n, first, "вторых строк не появилось");
  const held = (await db.query("SELECT max(days_held)::int AS d FROM idea_candidate")).rows[0].d;
  assert.equal(held, 2, "держится вторые сутки");
});
