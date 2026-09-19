import { test } from "node:test";
import assert from "node:assert/strict";
import { fixtureAnalysis } from "./helpers/fixture-analysis.js";
import { resultsHash } from "./helpers/results-hash.js";
import { normalizeBand, inBand, bandLabel, applyPriceBand } from "../shared/price-band.js";
import { compute } from "../shared/compute.js";
import { newAnalysis, migrate } from "../shared/analysis.js";
import { mergeThresholds } from "../shared/thresholds.js";
import { parsePoe } from "../shared/parse-poe.js";
import { readJson, POE } from "./helpers.js";

const withBand = (min, max, extra = {}) => { const a = fixtureAnalysis({ inputs: { priceMin: min, priceMax: max, ...extra } }); return a; };
const sum = (xs) => xs.reduce((s, x) => s + (x ?? 0), 0);

test("normalizeBand: пустой, открытый, некорректный", () => {
  assert.deepEqual(normalizeBand({}), { active: false, valid: true, error: null, min: null, max: null });
  assert.deepEqual(normalizeBand({ priceMin: null, priceMax: "" }), { active: false, valid: true, error: null, min: null, max: null });
  assert.deepEqual(normalizeBand({ priceMin: 20, priceMax: 30 }), { active: true, valid: true, error: null, min: 20, max: 30 });
  assert.deepEqual(normalizeBand({ priceMin: "19,5" }), { active: true, valid: true, error: null, min: 19.5, max: null });
  assert.equal(normalizeBand({ priceMax: 30 }).active, true);
  const bad = normalizeBand({ priceMin: 30, priceMax: 20 }); assert.equal(bad.active, false); assert.equal(bad.valid, false); assert.match(bad.error, /больше верхней/);
  assert.equal(normalizeBand({ priceMin: -5 }).valid, false);
  assert.equal(bandLabel({ active: true, min: 20, max: 30 }), "$20–$30"); assert.equal(bandLabel({ active: true, min: 19.5, max: null }), "от $19.50"); assert.equal(bandLabel({ active: true, min: null, max: 30 }), "до $30");
});

test("inBand: границы включительные, листинг без цены не входит", () => {
  const b = { active: true, min: 20, max: 30 };
  assert.equal(inBand(20, b), true); assert.equal(inBand(30, b), true); assert.equal(inBand(19.99, b), false); assert.equal(inBand(30.01, b), false);
  assert.equal(inBand(null, b), false); assert.equal(inBand(undefined, b), false);
  assert.equal(inBand(5, { active: true, min: null, max: 30 }), true); assert.equal(inBand(500, { active: true, min: 20, max: null }), true);
  assert.equal(inBand(null, { active: false }), true, "без диапазона ничего не отсекается");
});

test("applyPriceBand: счётчики, выручка и доля, исходные данные не мутируются", () => {
  const a = fixtureAnalysis(); const before = JSON.stringify(a.aggregates.xray.asins);
  const p = { xray: a.aggregates.xray, poe: a.aggregates.poe, inputs: { priceMin: 20, priceMax: 60, price: 25 }, thresholds: mergeThresholds() };
  const { view, summary } = applyPriceBand(p);
  const all = a.aggregates.xray.asins, kept = all.filter((x) => typeof x.price === "number" && x.price >= 20 && x.price <= 60);
  assert.ok(kept.length > 5 && kept.length < all.length, `в фикстуре ${kept.length} из ${all.length}`);
  assert.equal(summary.active, true); assert.equal(summary.source, "xray"); assert.equal(summary.label, "$20–$60");
  assert.equal(summary.totalCount, all.length); assert.equal(summary.inCount, kept.length); assert.equal(summary.noPrice, all.filter((x) => typeof x.price !== "number").length);
  assert.equal(summary.revenueBand, sum(kept.map((x) => x.asinRevenue))); assert.equal(summary.revenueAll, sum(all.map((x) => x.asinRevenue)));
  assert.ok(Math.abs(summary.revenueShare - summary.revenueBand / summary.revenueAll) < 1e-12);
  assert.deepEqual(view.xray.asins.map((x) => x.asin), kept.map((x) => x.asin));
  assert.ok(view.poe.asinMetrics.every((x) => x.price >= 20 && x.price <= 60));
  assert.equal(view.poe.searchTermMetrics, a.aggregates.poe.searchTermMetrics, "запросы POE — те же, вся ниша");
  assert.equal(JSON.stringify(a.aggregates.xray.asins), before, "исходный отчёт не изменён");
  const off = applyPriceBand({ ...p, inputs: {} }); assert.equal(off.view.xray, p.xray); assert.equal(off.view.poe, p.poe); assert.equal(off.summary.active, false);
});

test("SC-002 совместимость: без диапазона результаты те же, что до появления фильтра", () => {
  assert.equal(resultsHash(fixtureAnalysis().results), "c5e5835d0ca04abf");
  const poeOnly = newAnalysis({ niche: "u", coreKeyword: "urinal screen deodorizer" }); poeOnly.aggregates = { poe: parsePoe(readJson(POE)) }; Object.assign(poeOnly.inputs, { price: 24.99, cogs: 4.37 });
  assert.equal(resultsHash(compute(poeOnly)), "70d98ba4bdd7f192");
  assert.equal(resultsHash(compute(newAnalysis({ niche: "e" }))), "47b1f0d226c7d485");
  const bad = withBand(60, 20); assert.equal(resultsHash(bad.results), "c5e5835d0ca04abf", "некорректный диапазон не применяется");
  assert.equal(bad.results.priceBand.valid, false); assert.equal(bad.results.priceBand.active, false);
  const old = migrate({ schemaVersion: 1, id: "x", niche: "старый", inputs: { cogs: 3 } }); assert.equal(old.inputs.priceMin, null); assert.equal(old.inputs.priceMax, null);
});

test("SC-003: конкуренция в диапазоне совпадает с ручным расчётом по листингам отчёта", () => {
  const a = withBand(20, 60); const R = a.results; const asins = a.aggregates.xray.asins.filter((x) => typeof x.price === "number" && x.price >= 20 && x.price <= 60);
  const byBrand = new Map(); for (const x of asins) byBrand.set(x.brand, (byBrand.get(x.brand) || 0) + (x.asinRevenue ?? 0));
  const total = sum([...byBrand.values()]); const sorted = [...byBrand.entries()].sort((p, q) => q[1] - p[1]);
  assert.equal(R.competition.topBrand, sorted[0][0]);
  assert.ok(Math.abs(R.competition.topBrandShare - sorted[0][1] / total) < 1e-9);
  assert.ok(Math.abs(R.competition.top5Share - sum(sorted.slice(0, 5).map((e) => e[1])) / total) < 1e-9);
  assert.ok(R.competition.brands.every((b) => asins.some((x) => x.brand === b.brand)), "в брендах только бренды из диапазона");
  const c = R.criterion1.items;
  assert.equal(c["1e"].value, R.competition.topBrandShare); assert.equal(c["1e"].inBand, true); assert.equal(c["1b"].inBand, true); assert.ok(c["1b"].value >= 20 && c["1b"].value <= 60, "медиана цены — внутри диапазона");
});

test("что НЕ меняется: спрос, уровень данных, сегменты цен, статус выручки 1a", () => {
  const base = fixtureAnalysis().results, R = withBand(20, 60).results;
  assert.deepEqual(R.traffic, base.traffic); assert.deepEqual(R.gate0, base.gate0);
  for (const k of ["1c", "1g", "1h"]) assert.deepEqual(R.criterion1.items[k], base.criterion1.items[k], k);
  assert.equal(R.criterion1.items["1a"].value, base.criterion1.items["1a"].value); assert.equal(R.criterion1.items["1a"].status, base.criterion1.items["1a"].status);
  assert.equal(R.criterion1.items["1a"].bandValue, R.priceBand.revenueBand); assert.ok(R.criterion1.items["1a"].bandShare > 0 && R.criterion1.items["1a"].bandShare < 1);
  assert.equal(R.budget.quickScreen.revenue500k.status, base.budget.quickScreen.revenue500k.status);
  const strip = (ps) => ps.segments.map(({ selected, ...s }) => s); assert.deepEqual(strip(R.priceSegments), strip(base.priceSegments));
  assert.ok(R.priceSegments.segments.some((s) => s.selected)); assert.ok(base.priceSegments.segments.every((s) => s.selected === false));
  assert.notDeepEqual(R.competition.brands, base.competition.brands, "а конкуренция — изменилась");
});

test("сводка диапазона: показатели всей ниши для сравнения, цена товара вне диапазона", () => {
  const base = fixtureAnalysis().results; const R = withBand(20, 60, { price: 75 }).results; const pb = R.priceBand;
  assert.equal(pb.whole.topBrandShare, base.competition.topBrandShare); assert.equal(pb.whole.top5Share, base.competition.top5Share);
  assert.equal(pb.whole.priceMedian, base.criterion1.items["1b"].value); assert.equal(pb.whole.revenue, base.criterion1.items["1a"].value);
  assert.equal(pb.myPriceOutside, true); assert.equal(withBand(20, 60, { price: 25 }).results.priceBand.myPriceOutside, false);
  assert.equal(fixtureAnalysis().results.priceBand.active, false);
});

test("выборка: малая → предупреждение, недостаточная → конкурентные показатели «нет данных», дашборд считается", () => {
  const prices = fixtureAnalysis().aggregates.xray.asins.map((x) => x.price).filter((v) => typeof v === "number").sort((a, b) => a - b);
  const small = withBand(prices[0], prices[9]).results; // ~10 самых дешёвых
  assert.equal(small.priceBand.sample, "small"); assert.ok(small.priceBand.inCount >= 5 && small.priceBand.inCount < 15); assert.ok(small.competition.topBrand);
  const none = withBand(100000, null).results;
  assert.equal(none.priceBand.sample, "insufficient"); assert.equal(none.priceBand.inCount, 0); assert.equal(none.competition.source === "xray" && none.competition.brands.length > 0, false);
  for (const k of ["1b", "1d", "1e", "1f"]) { assert.equal(none.criterion1.items[k].status, "na", k); assert.match(none.criterion1.items[k].note, /меньше 5 листингов/); }
  assert.equal(none.criterion1.items["1a"].status, fixtureAnalysis().results.criterion1.items["1a"].status); assert.ok(none.verdict.ceiling); assert.ok(none.scorecard);
  const custom = fixtureAnalysis({ inputs: { priceMin: prices[0], priceMax: prices[9] } }); custom.thresholds = { priceBand: { smallSample: 5, minSample: 2 } };
  assert.equal(compute(custom).priceBand.sample, "ok", "пороги выборки настраиваются");
});

test("только POE: фильтр по ценам листингов POE, доли кликов нормируются на диапазон", () => {
  const poe = parsePoe(readJson(POE)); const prices = poe.asinMetrics.map((x) => x.price).filter((v) => typeof v === "number").sort((a, b) => a - b);
  const lo = prices[Math.floor(prices.length * 0.2)], hi = prices[Math.floor(prices.length * 0.8)];
  const a = newAnalysis({ niche: "u", coreKeyword: "urinal screen deodorizer" }); a.aggregates = { poe }; Object.assign(a.inputs, { priceMin: lo, priceMax: hi });
  const R = compute(a); const pb = R.priceBand;
  assert.equal(pb.source, "poe"); assert.equal(pb.weightLabel, "clicks"); assert.ok(pb.inCount > 5 && pb.inCount < pb.totalCount);
  assert.ok(Math.abs(R.competition.brands.reduce((s, b) => s + b.share, 0) - 1) < 1e-6, "доли брендов в диапазоне в сумме дают 100 %");
  assert.ok(R.criterion1.items["1b"].value >= lo && R.criterion1.items["1b"].value <= hi);
  const base = newAnalysis({ niche: "u", coreKeyword: "urinal screen deodorizer" }); base.aggregates = { poe }; const B = compute(base);
  assert.deepEqual(R.traffic, B.traffic); assert.deepEqual(R.criterion1.items["1h"], B.criterion1.items["1h"]); assert.equal(R.criterion1.items["1a"].value, B.criterion1.items["1a"].value);
});
