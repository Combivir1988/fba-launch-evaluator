// «Я уже в нише»: снятая галочка «Оценивать как новый вход» убирает свой бренд из барьерных метрик,
// но оставляет его выручку в размере рынка и показывает свои позиции отдельно.
import test from "node:test";
import assert from "node:assert/strict";
import { competition, ownPosition, ownListings } from "../shared/competition.js";
import { mergeThresholds } from "../shared/thresholds.js";

const asins = [
  { asin: "B001", brand: "MyBrand", asinRevenue: 300000, asinSales: 100, reviews: 900, rating: 4.7, price: 40 },
  { asin: "B002", brand: "MyBrand", asinRevenue: 100000, asinSales: 40, reviews: 500, rating: 4.6, price: 42 },
  { asin: "B003", brand: "Rival", asinRevenue: 200000, asinSales: 90, reviews: 400, rating: 4.4, price: 38 },
  { asin: "B004", brand: "Other", asinRevenue: 100000, asinSales: 50, reviews: 120, rating: 4.2, price: 35 },
];
const base = { xray: { asins }, poe: null, thresholds: mergeThresholds({}) };

test("свой бренд считается барьером, пока стоит галочка «новый вход»", () => {
  const c = competition({ ...base, inputs: { evaluateAsNewEntrant: true, myBrand: "MyBrand", checklist: {} } });
  assert.equal(c.incumbent, false);
  assert.equal(c.topBrand, "MyBrand"); assert.ok(Math.abs(c.topBrandShare - 4 / 7) < 1e-9);
  assert.equal(c.reviewBarrier.leaderReviews, 900);
  assert.ok(c.own, "свои позиции считаются всегда — их видно в отдельном блоке");
});

test("галочка снята: доли и планка отзывов — только по чужим, моя выручка остаётся частью рынка", () => {
  const c = competition({ ...base, inputs: { evaluateAsNewEntrant: false, myBrand: "mybrand", checklist: {} } });
  assert.equal(c.incumbent, true, "регистр названия не важен");
  assert.equal(c.topBrand, "Rival"); assert.ok(Math.abs(c.topBrandShare - 2 / 3) < 1e-9, "доли пересчитаны по чужим");
  assert.ok(Math.abs(c.top5Share - 1) < 1e-9, "чужие делят между собой всё");
  assert.equal(c.reviewBarrier.leaderReviews, 400, "планка — по чужим листингам");
  assert.equal(c.own.listings, 2); assert.equal(c.own.revenue, 400000); assert.equal(c.own.reviewsMax, 900);
  assert.ok(Math.abs(c.own.share - 4 / 7) < 1e-9, "моя доля — от всей ниши, из рынка выручка не выкидывается");
  assert.equal(c.own.priceMedian, 41);
});

test("свои листинги можно задать списком ASIN, без названия бренда; чужого бренда в нише нет — режим не включится", () => {
  const byAsin = competition({ ...base, inputs: { evaluateAsNewEntrant: false, myAsins: ["b001", "B002"], checklist: {} } });
  assert.equal(byAsin.incumbent, true); assert.equal(byAsin.topBrand, "Rival");
  const none = competition({ ...base, inputs: { evaluateAsNewEntrant: false, myBrand: "Unknown", checklist: {} } });
  assert.equal(none.incumbent, false); assert.equal(none.topBrand, "MyBrand");
  assert.equal(ownPosition(asins, { myBrand: "Unknown" }), null);
  assert.deepEqual(ownListings(asins, { myBrand: "MyBrand" }).brands, ["MyBrand"]);
});

test("исключённые бренды и свой бренд не мешают друг другу", () => {
  const c = competition({ ...base, inputs: { evaluateAsNewEntrant: false, myBrand: "MyBrand", excludedBrands: ["Other"], checklist: {} } });
  assert.equal(c.topBrand, "Rival"); assert.equal(c.brands.length, 1, "остался только чужой не исключённый бренд");
  assert.equal(c.own.listings, 2);
});
