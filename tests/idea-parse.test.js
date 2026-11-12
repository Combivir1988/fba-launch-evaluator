// Spec 021: разбор ответов площадок на СОХРАНЁННЫХ образцах. В сеть тесты не ходят.
// Образцы сняты живыми запросами 2026-11-12, состав описан в contracts/sources.md.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  parseCompact, parseGrouped, parseRelativeAgeDays, parseViewCount,
  parseChannelPreview, parseVideoSearch, parseCrowdfundingFeed,
} from "../shared/idea-parse.js";

const fx = (name) => readFileSync(new URL("./fixtures/" + name, import.meta.url), "utf8");
const json = (name) => JSON.parse(fx(name));
const NOW = Date.parse("2026-11-12T12:00:00Z");

// ---------- числа и возраст ----------

test("сокращённые числа: суффиксы K / M / B", () => {
  assert.equal(parseCompact("4.09M"), 4_090_000);
  assert.equal(parseCompact("1.68M"), 1_680_000);
  assert.equal(parseCompact("812K"), 812_000);
  assert.equal(parseCompact("2"), 2);
  assert.equal(parseCompact("ерунда"), null);
});

test("разделители разрядов, включая НЕРАЗРЫВНЫЙ пробел", () => {
  assert.equal(parseGrouped("66,034"), 66_034);
  assert.equal(parseGrouped("31,238"), 31_238);
  // Это и есть тихая ловушка: разборщик, чистящий только запятые, вернул бы 31.
  assert.equal(parseGrouped("31 238"), 31_238, "неразрывный пробел");
  assert.equal(parseGrouped("31 238"), 31_238, "обычный пробел");
});

test("сокращённый возраст", () => {
  assert.equal(parseRelativeAgeDays("1d ago"), 1);
  assert.equal(parseRelativeAgeDays("11d ago"), 11);
  assert.equal(parseRelativeAgeDays("2w ago"), 14);
  assert.ok(Math.abs(parseRelativeAgeDays("20h ago") - 20 / 24) < 1e-9);
  assert.ok(Math.abs(parseRelativeAgeDays("3mo ago") - 91.32) < 1e-9);
  assert.equal(parseRelativeAgeDays("2 weeks ago"), 14, "полная форма тоже встречается");
  assert.equal(parseRelativeAgeDays("2 lata temu"), null, "чужой язык сюда не попадает — его ловит сторож");
});

test("«No views» — это отсутствие, а не ноль", () => {
  assert.equal(parseViewCount("31,238 views"), 31_238);
  assert.equal(parseViewCount("1 view"), 1, "единственное число");
  assert.equal(parseViewCount("No views"), null, "ноль означал бы «вещь никому не интересна»");
});

// ---------- T012: разбор образцов ----------

test("превью канала: 20 постов, абсолютные даты, сокращённые просмотры", () => {
  const r = parseChannelPreview(fx("idea-telegram.html"), { now: NOW });
  assert.equal(r.failCode, null);
  assert.equal(r.items.length, 20);
  assert.equal(r.dropped, 0);

  for (const it of r.items) {
    assert.ok(it.externalId, "опознаватель");
    assert.ok(it.url.startsWith("https://t.me/"), "ссылка");
    assert.ok(Number.isFinite(Date.parse(it.publishedAt)), "дата абсолютная и разбирается");
    assert.ok(it.value === null || it.value > 0, "просмотры — число или их нет");
  }
  assert.ok(r.items.some((i) => i.value > 1_000_000), "сокращение вида 1.68M разобрано");
});

test("страница поиска видео: 20 роликов, краткое описание берётся бесплатно", () => {
  const r = parseVideoSearch(json("idea-video-en.json"), { now: NOW });
  assert.equal(r.failCode, null);
  assert.equal(r.items.length, 20);

  for (const it of r.items) {
    assert.ok(it.externalId, "опознаватель");
    assert.ok(it.url.includes(it.externalId), "ссылка");
    assert.ok(it.title, "название");
  }
  const withViews = r.items.filter((i) => i.value !== null);
  assert.equal(r.items.length - withViews.length, 2, "замер: у двух роликов из двадцати просмотров нет");
  assert.ok(r.items.filter((i) => i.snippet).length >= 15, "описание есть у большинства");
  assert.ok(r.items.every((i) => i.publishedAt), "возраст разобран у всех");
});

test("лента краудфандинга: 12 проектов, суммы — только в приведённой валюте", () => {
  const r = parseCrowdfundingFeed(json("idea-crowdfunding.json"), { now: NOW });
  assert.equal(r.failCode, null);
  assert.equal(r.items.length, 12);

  assert.ok(r.currencies.length > 1, "замер: в одном ответе четыре разные валюты — это норма, а не исключение");
  for (const it of r.items) {
    assert.ok(it.externalId && it.url, "опознаватель и ссылка");
    assert.equal(typeof it.value, "number", "собрано — число из приведённого поля, а не строка");
    assert.ok(it.goal > 0, "цель есть");
    assert.ok(Number.isFinite(Date.parse(it.publishedAt)), "дата запуска разобрана из unix-секунд");
  }
  // Поле «собрано» в своей валюте и приведённое — разные числа; берётся именно приведённое.
  const mixed = r.items.find((i) => i.currency !== "USD");
  assert.notEqual(mixed.value, mixed.pledged, "иначе сравнивали бы гонконгские доллары с фунтами");
});

test("элемент без опознавателя или без ссылки отбрасывается и считается отдельно", () => {
  const d = json("idea-crowdfunding.json");
  d.projects[0] = { ...d.projects[0], urls: {} };
  d.projects[1] = { ...d.projects[1], id: null };
  const r = parseCrowdfundingFeed(d, { now: NOW });
  assert.equal(r.items.length, 10);
  assert.equal(r.dropped, 2);
});

// ---------- T013: СТОРОЖ ЯЗЫКА (D8) ----------

test("СТОРОЖ: ответ на чужом языке — отказ с названной причиной, а не пустота", () => {
  const r = parseVideoSearch(json("idea-video-other-locale.json"), { now: NOW });

  assert.equal(r.failCode, "wrong_language",
    "наивная версия вернула бы пустой список: честно по форме, неверно по сути — данные в ответе ЕСТЬ");
  assert.ok(/язык/i.test(r.failMessage), "причина названа человеческими словами");
  assert.equal(r.items.length, 0);

  // Данные там действительно есть — в этом весь смысл сторожа.
  const raw = JSON.stringify(json("idea-video-other-locale.json"));
  assert.ok(raw.includes("wyświetle"), "в образце двадцать роликов с просмотрами на чужом языке");
});

test("СТОРОЖ не срабатывает на английском образце", () => {
  const r = parseVideoSearch(json("idea-video-en.json"), { now: NOW });
  assert.equal(r.failCode, null);
});

test("разметка изменилась — тоже отказ с причиной, а не пустая выборка", () => {
  assert.equal(parseVideoSearch({ contents: {} }).failCode, "unparsed");
  assert.equal(parseChannelPreview("<html></html>").failCode, "unparsed");
  assert.equal(parseCrowdfundingFeed({}).failCode, "unparsed");
  for (const r of [parseVideoSearch({}), parseChannelPreview(""), parseCrowdfundingFeed({})]) {
    assert.ok(r.failMessage, "строки «не разобралось» без причины не бывает");
  }
});
