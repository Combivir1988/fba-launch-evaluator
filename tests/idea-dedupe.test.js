// Spec 021, US3 — склейка одной вещи с разных площадок (D10).
//
// Правило консервативное НАМЕРЕННО: ложная склейка ПРЯЧЕТ одну из двух вещей, и человек не узнает,
// что она была. Дубль он просто отмахнёт. Поэтому все сомнительные случаи обязаны остаться разными.
import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeTitle, normalizeUrl, sameThing, groupCandidates } from "../shared/idea-dedupe.js";

const it = (title, url, platform = "video", ratio = 3) => ({ title, url, platform, ratio });

test("цифры в названии НЕ выбрасываются: 11 speed и 12 speed — разные вещи", () => {
  const a = it("Bike chain 11 speed", "https://a.invalid/1");
  const b = it("Bike chain 12 speed", "https://b.invalid/2");
  assert.equal(sameThing(a, b), false, "именно цифра их и различает");
  assert.equal(groupCandidates([a, b]).length, 2);
});

test("похожесть не используется: почти совпавшее название не склеивается", () => {
  const pairs = [
    ["Portable espresso maker", "Portable espresso maker pro"],
    ["Складной стол для кемпинга", "Складной стол для кемпинга XL"],
    ["Chain cleaner", "Chain cleaner kit"],
  ];
  for (const [x, y] of pairs) {
    assert.equal(sameThing(it(x, "https://a.invalid/x"), it(y, "https://b.invalid/y")), false, `${x} ≠ ${y}`);
  }
});

test("склеивает ПОЛНОЕ совпадение названия с точностью до оформления", () => {
  const a = it("Co-Print Quadro: 4-Toolhead Printer", "https://a.invalid/1", "crowdfunding");
  const b = it("co print quadro 4 toolhead printer", "https://b.invalid/2", "video");
  assert.equal(normalizeTitle(a.title), normalizeTitle(b.title));
  assert.equal(sameThing(a, b), true);

  const g = groupCandidates([a, b]);
  assert.equal(g.length, 1, "одна вещь");
  assert.deepEqual(g[0].platforms.sort(), ["crowdfunding", "video"], "и видно, где она найдена");
});

test("слишком короткое название не склеивается ни с чем", () => {
  const a = it("Набор", "https://a.invalid/1"), b = it("набор", "https://b.invalid/2");
  assert.equal(sameThing(a, b), false, "«набор» совпадёт с «набор» у чего угодно");
});

test("ссылка: метки источника отбрасываются, опознаватель — НИКОГДА", () => {
  // У видео опознаватель живёт в строке запроса. Выбросив её, мы склеили бы все ролики площадки разом.
  const v1 = "https://www.youtube.com/watch?v=AAA111";
  const v2 = "https://www.youtube.com/watch?v=BBB222";
  assert.notEqual(normalizeUrl(v1), normalizeUrl(v2), "это РАЗНЫЕ ролики");
  assert.equal(sameThing(it("Ролик один", v1), it("Ролик два", v2)), false);

  // А метки источника — это одна и та же ссылка.
  assert.equal(normalizeUrl("https://www.example.invalid/a/?utm_source=x&utm_medium=y"),
    normalizeUrl("https://example.invalid/a"));
  assert.equal(sameThing(it("Один", v1 + "&utm_source=tg"), it("Другой", v1)), true);
});

test("битая ссылка не роняет сравнение и не склеивает всё подряд", () => {
  const a = it("Что-то одно", "не ссылка вовсе"), b = it("Что-то другое", "тоже не ссылка");
  assert.doesNotThrow(() => sameThing(a, b));
  assert.equal(sameThing(a, b), false);
});

test("в группе остаётся наибольшее отношение, а не сумма", () => {
  const a = { ...it("Одна и та же вещь целиком", "https://a.invalid/1", "video"), ratio: 4 };
  const b = { ...it("одна и та же вещь целиком", "https://b.invalid/2", "crowdfunding"), ratio: 9 };
  const g = groupCandidates([a, b]);
  assert.equal(g.length, 1);
  assert.equal(g[0].ratio, 9, "отношения к РАЗНЫМ фонам не складываются");
  assert.equal(g[0].alsoOn.length, 1, "вторая находка не теряется — она показана рядом");
});

test("ничего лишнего: разные вещи остаются разными группами", () => {
  const items = [
    it("Первая вещь с длинным названием", "https://a.invalid/1"),
    it("Вторая вещь с длинным названием", "https://b.invalid/2"),
    it("Третья вещь с длинным названием", "https://c.invalid/3"),
  ];
  assert.equal(groupCandidates(items).length, 3);
});
