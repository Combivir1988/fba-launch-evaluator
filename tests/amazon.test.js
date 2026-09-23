// spec 012: Amazon как продавец — детекция по листингам вида, область (ниша / диапазон), режимы порога, ручной ответ, вердикт, отпечатки.
import test from "node:test";
import assert from "node:assert/strict";
import { newAnalysis } from "../shared/analysis.js";
import { compute } from "../shared/compute.js";
import { amazonPresence, isAmazonSeller } from "../shared/amazon.js";
import { thresholdOverrides } from "../shared/thresholds.js";
import { fixtureAnalysis } from "./helpers/fixture-analysis.js";
import { resultsHash } from "./helpers/results-hash.js";

const asin = (i) => "B0" + String(i).padStart(8, "0");
function xrayWithAmazon() {
  const asins = Array.from({ length: 12 }, (_, i) => ({ asin: asin(i + 1), title: "t" + i, brand: "Br" + (i % 4), price: 20 + i * 10, asinRevenue: (12 - i) * 5000, asinSales: 100, reviews: 200, rating: 4.4, seller: i === 7 ? "Amazon.com" : "Seller" + i, fulfillment: i === 9 ? "Amazon" : "FBA" }));
  return { asins, flags: { rowsTotal: 12, hasAsinSales: true, duplicatesDropped: 0, amazonSells: true }, columns: {} };
}
const withXray = (over = {}) => { const a = newAnalysis({ niche: "x", coreKeyword: "x" }); a.aggregates.xray = xrayWithAmazon(); Object.assign(a.inputs, { price: 30, cogs: 5, cpc: 1 }, over.inputs || {}); a.thresholds = over.thresholds || {}; a.results = compute(a); return a; };

test("isAmazonSeller: Seller или Fulfillment = Amazon / Amazon.com", () => {
  assert.equal(isAmazonSeller({ seller: "Amazon.com" }), true); assert.equal(isAmazonSeller({ seller: "x", fulfillment: "Amazon" }), true); assert.equal(isAmazonSeller({ seller: "AmazonBasics Store" }), false); assert.equal(isAmazonSeller({}), false);
});

test("по умолчанию: Amazon в нише → No-Go, решающий «Amazon в нише», чип-факты (2 листинга, доля выручки)", () => {
  const a = withXray(); const R = a.results;
  assert.deepEqual(R.competition.amazonAsins, [asin(8), asin(10)]); assert.ok(R.competition.amazonRevenueShare > 0 && R.competition.amazonRevenueShare < 0.2);
  assert.equal(R.amazon.mode, "block"); assert.equal(R.amazon.scope, "niche"); assert.equal(R.amazon.present, true); assert.equal(R.amazon.blocks, true); assert.equal(R.amazon.count, 2);
  assert.equal(R.verdict.ceiling, "no_go"); assert.equal(R.verdict.decisiveGate, "Amazon в нише"); assert.match(R.verdict.reasons[0], /Amazon продаёт сам \(по всей нише: 2 листинга, \d+ % выручки\)/);
  assert.equal(R.criterion1.items["1e"].status, "fail", "1e по-прежнему НЕ OK");
});

test("режим «учитывать в общей картине»: вердикт по остальным гейтам, 1e и scorecard как раньше", () => {
  const a = withXray({ thresholds: { amazon: { mode: "consider" } } }); const R = a.results;
  assert.equal(R.amazon.blocks, false); assert.notEqual(R.verdict.decisiveGate, "Amazon в нише"); assert.equal(R.competition.amazonSells, true); assert.equal(R.criterion1.items["1e"].status, "fail");
});

test("область «мой ценовой диапазон»: Amazon вне коридора не блокирует, внутри — блокирует; без диапазона — вся ниша с пометкой", () => {
  const out = withXray({ thresholds: { amazon: { scope: "band" } }, inputs: { priceMin: 20, priceMax: 60 } }); // Amazon: цены 90 и 110
  assert.equal(out.results.amazon.scope, "band"); assert.equal(out.results.amazon.present, false); assert.equal(out.results.amazon.presentNiche, true); assert.equal(out.results.amazon.blocks, false); assert.equal(out.results.competition.amazonSells, false, "1e в диапазоне без Amazon");
  const inn = withXray({ thresholds: { amazon: { scope: "band" } }, inputs: { priceMin: 80, priceMax: 120 } }); assert.equal(inn.results.amazon.present, true); assert.equal(inn.results.amazon.blocks, true); assert.match(inn.results.amazon.scopeLabel, /в ценовом диапазоне \$80–\$120/);
  const nob = withXray({ thresholds: { amazon: { scope: "band" } } }); assert.equal(nob.results.amazon.scope, "niche"); assert.match(nob.results.amazon.note, /диапазон не задан/); assert.equal(nob.results.amazon.blocks, true);
});

test("ручной ответ чеклиста главнее автоопределения", () => {
  const no = withXray({ inputs: { checklist: { amazonSells: "no" } } }); assert.equal(no.results.amazon.present, false); assert.equal(no.results.amazon.blocks, false); assert.equal(no.results.amazon.source, "user");
  const a = newAnalysis({ niche: "y" }); a.aggregates.xray = { ...xrayWithAmazon(), asins: xrayWithAmazon().asins.map((x) => ({ ...x, seller: "s", fulfillment: "FBA" })) }; a.inputs.checklist.amazonSells = "yes"; a.results = compute(a);
  assert.equal(a.results.amazon.present, true); assert.equal(a.results.amazon.count, 0); assert.equal(a.results.verdict.ceiling, "no_go"); assert.match(a.results.verdict.reasons[0], /Amazon продаёт сам \(по всей нише\)/);
});

test("amazonPresence: без Xray — не найден; пороги-строки проходят в наборы", () => {
  const p = amazonPresence({ whole: { amazonSells: false, amazonAsins: [] }, th: {} }); assert.equal(p.present, false); assert.equal(p.blocks, false); assert.equal(p.mode, "block");
  assert.deepEqual(thresholdOverrides({ amazon: { mode: "consider", scope: "niche", junk: "x" } }), { amazon: { mode: "consider" } });
});

test("отпечатки прежних расчётов не меняются (вердикт в отпечаток не входит; в фикстуре Amazon есть — и это блокирует)", () => {
  const a = fixtureAnalysis(); assert.equal(typeof a.results.amazon.present, "boolean"); assert.equal(resultsHash(a.results), "1d212554e8f27864");
  if (a.results.amazon.present) { assert.equal(a.results.verdict.ceiling, "no_go"); assert.equal(a.results.verdict.decisiveGate, "Amazon в нише"); assert.ok(a.results.competition.amazonAsins.length > 0); }
});
