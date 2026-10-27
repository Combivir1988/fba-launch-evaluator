// spec 017, этап 3: матрица покрытия ключей по листингам конкурентов.
import { test } from "node:test";
import assert from "node:assert/strict";
import { coverage, tokens } from "../shared/listing-coverage.js";
import { mergeThresholds } from "../shared/thresholds.js";

const TH = mergeThresholds();
const page = (asin, { title = "", bullets = [], specs = [], fetchedAt = "2026-10-01T00:00:00Z" } = {}) => ({ asin, title, bullets, specs, fetchedAt });
const k = (phrase, weight = 1000, over = {}) => ({ phrase, weight, ...over });

test("слова, а не фразы: порядок не важен, регистр и множественное число не мешают", () => {
  const t = tokens("Stainless Steel Dog Bowls, 2-Pack");
  assert.ok(t.has("stainless") && t.has("steel") && t.has("dog"));
  assert.ok(t.has("bowl"), "bowls приводится к bowl");
  assert.equal(t.has("the"), false, "стоп-слова не считаем");

  const r = coverage({ keywords: [k("dog bowl stainless")], listings: { A: page("A", { title: "Stainless Steel Dog Bowls for Large Dogs" }) }, th: TH });
  assert.equal(r.items[0].inTitle, 1, "ключ найден, хотя слова в другом порядке");
});

test("поля считаются отдельно: тайтл, буллеты, характеристики", () => {
  const listings = {
    A: page("A", { title: "dog bowl", bullets: ["slow feeder design"], specs: [{ k: "Material", v: "stainless steel" }] }),
    B: page("B", { title: "cat tree", bullets: ["dog bowl included"], specs: [] }),
    C: page("C", { title: "pet mat", bullets: [], specs: [{ k: "Type", v: "dog bowl" }] }),
  };
  const r = coverage({ keywords: [k("dog bowl"), k("stainless steel")], listings, th: TH });
  const [bowl, steel] = r.items;
  assert.deepEqual([bowl.inTitle, bowl.inBullets, bowl.inSpecs], [1, 1, 1]);
  assert.deepEqual([steel.inTitle, steel.inBullets, steel.inSpecs], [0, 0, 1]);
  assert.equal(r.listings, 3);
  assert.equal(r.fetchedAt, "2026-10-01T00:00:00Z");
});

test("«обязательное» и «белое пятно» считаются по доле тайтлов", () => {
  const titles = ["dog bowl a", "dog bowl b", "dog bowl c", "dog bowl d", "something else"];
  const listings = Object.fromEntries(titles.map((t, i) => ["A" + i, page("A" + i, { title: t })]));
  const r = coverage({ keywords: [k("dog bowl", 5000), k("elevated stand", 9000)], listings, th: TH });
  assert.equal(r.items[0].mustHave, true, "4 из 5 тайтлов — без этого не найдут");
  assert.equal(r.items[0].whiteSpace, false);
  assert.equal(r.items[1].whiteSpace, true, "объём выше медианы, в тайтлах нет ни у кого");
  assert.equal(r.items[1].mustHave, false);
});

test("own необязателен: без своей страницы нет ни колонок, ни пометок (FR-008)", () => {
  const listings = { A: page("A", { title: "dog bowl stainless" }) };
  const without = coverage({ keywords: [k("dog bowl")], listings, th: TH });
  assert.equal(without.own, null);
  assert.equal(without.items[0].own, null);

  const mine = page("MY", { title: "plastic dog dish", bullets: ["dog bowl for puppies"] });
  const withOwn = coverage({ keywords: [k("dog bowl"), k("stainless steel")], listings, own: mine, th: TH });
  assert.deepEqual(withOwn.own, { asin: "MY", fetchedAt: "2026-10-01T00:00:00Z" });
  assert.deepEqual(withOwn.items[0].own, { inTitle: false, inBullets: true, inSpecs: false });
  assert.deepEqual(withOwn.items[1].own, { inTitle: false, inBullets: false, inSpecs: false });
});

test("SC-008: аудит ничего не меняет в общей матрице", () => {
  const listings = { A: page("A", { title: "dog bowl stainless steel" }), B: page("B", { title: "dog bowl plastic" }) };
  const keywords = [k("dog bowl", 5000), k("stainless steel", 3000)];
  const without = coverage({ keywords, listings, th: TH });
  const withOwn = coverage({ keywords, listings, own: page("MY", { title: "my own dog bowl" }), th: TH });
  const strip = (r) => r.items.map(({ own, ...rest }) => rest);
  assert.deepEqual(strip(withOwn), strip(without), "колонки конкурентов, mustHave и whiteSpace не зависят от аудита");
  assert.equal(withOwn.listings, without.listings, "своя страница не попадает в число конкурентов");
});

test("страницы с ошибкой и пустые в расчёт не идут", () => {
  const r = coverage({ keywords: [k("dog bowl")], listings: { A: page("A", { title: "dog bowl" }), B: { asin: "B", error: { code: "asp" } }, C: page("C") }, th: TH });
  assert.equal(r.listings, 1);
  assert.equal(r.items[0].titleShare, 1);
});
