// spec 017, этап 3: оценка листинга числом — покрытие, лимиты, пустые повторы, запрещённые обещания.
import { test } from "node:test";
import assert from "node:assert/strict";
import { scoreListing, listingBans, bytesOf } from "../shared/listing-score.js";
import { mergeThresholds } from "../shared/thresholds.js";

const TH = mergeThresholds();
const k = (phrase, weight, over = {}) => ({ phrase, weight, ...over });
const listing = (over = {}) => ({ title: "", highlights: "", bullets: [], description: "", backendTerms: "", ...over });

test("покрытие считается и в штуках, и в весе: один большой ключ важнее трёх мелких", () => {
  const keywords = [k("dog bowl", 9000), k("slow feeder", 500), k("elevated stand", 500)];
  const r = scoreListing({ listing: listing({ title: "Stainless Dog Bowls", bullets: ["slow feeder insert"] }), keywords, th: TH });
  assert.equal(r.coverage.count, 2);
  assert.equal(r.coverage.total, 3);
  assert.equal(Math.round(r.coverage.weightShare * 100), 95, "9500 из 10000 веса");
  const missed = r.coverage.items.find((i) => i.phrase === "elevated stand");
  assert.equal(missed.covered, false);
  assert.deepEqual(missed.missing, ["elevated", "stand"]);
  assert.equal(r.coverage.items[0].inTitle, true, "видно, что ключ стоит именно в тайтле");
});

test("лимиты: знаки для тайтла и highlights, БАЙТЫ для backend terms", () => {
  const long = "x".repeat(80);
  const r = scoreListing({ listing: listing({ title: long, highlights: "ok", bullets: ["b1"], backendTerms: "я".repeat(130) }), keywords: [], th: TH });
  const title = r.limits.find((l) => l.field === "Тайтл");
  assert.deepEqual([title.used, title.max, title.ok, title.unit], [80, 75, false, "знаков"]);
  const back = r.limits.find((l) => l.field === "Backend search terms");
  assert.equal(back.unit, "байт");
  assert.equal(back.used, 260, "кириллица — два байта на знак");
  assert.equal(back.ok, false);
  assert.equal(bytesOf("abc"), 3);
  assert.equal(r.ok, false);
  const good = scoreListing({ listing: listing({ title: "короткий", bullets: ["b"], backendTerms: "abc" }), keywords: [], th: TH });
  assert.equal(good.ok, true);
  assert.equal(good.limits.filter((l) => l.field.startsWith("Буллеты")).length, 1, "лимит проверяется у каждого буллета");
});

test("повторы: слова backend, которые уже стоят в тайтле и буллетах, тратят байты впустую", () => {
  const r = scoreListing({ listing: listing({ title: "Stainless Dog Bowl", bullets: ["slow feeder"], backendTerms: "dog puppy feeder gift" }), keywords: [], th: TH });
  assert.deepEqual(r.repeats, ["dog", "feeder"]);
});

test("запреты из патентов и регуляторики: обещание не проходит", () => {
  const bans = listingBans({
    patents: { items: [{ number: "US123", risk: "high", claimed: "Magnetic quick release locking mechanism" }, { number: "US999", risk: "low", claimed: "Simple plastic ring" }] },
    regulatory: { triggers: [{ kind: "claim", agency: "EPA", title: "Обещание дезинфекции", words: ["disinfect", "kills bacteria"] }, { kind: "type", agency: "CPSC", title: "Детский товар", words: ["toddler"] }] },
  });
  assert.equal(bans.length, 3, "патент с низким риском и триггер «тип товара» запретами не считаются");
  assert.equal(bans.filter((b) => /EPA/.test(b.why)).length, 2, "запрещаем обещания, а не тип товара");
  const bad = scoreListing({ listing: listing({ title: "Bowl with magnetic quick release locking mechanism" }), keywords: [], bans, th: TH });
  assert.equal(bad.bans.length, 1);
  assert.match(bad.bans[0].why, /US123/);
  assert.equal(bad.ok, false);
  const claim = scoreListing({ listing: listing({ bullets: ["Disinfect your kitchen in seconds"] }), keywords: [], bans, th: TH });
  assert.equal(claim.bans.length, 1, "обещание дезинфекции поймано по одному слову");
  const good = scoreListing({ listing: listing({ title: "Bowl with screw-on ring for toddler room" }), keywords: [], bans, th: TH });
  assert.deepEqual(good.bans, [], "«тип товара» текст не запрещает");
});

test("пустой листинг: ноль покрытия, но расчёт не падает", () => {
  const r = scoreListing({ listing: listing(), keywords: [k("dog bowl", 100)], th: TH });
  assert.equal(r.coverage.count, 0);
  assert.equal(r.coverage.weightShare, 0);
  assert.equal(r.ok, true, "пустые поля в лимиты укладываются — виновата не длина, а покрытие");
});
