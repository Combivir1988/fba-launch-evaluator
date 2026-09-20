import { test } from "node:test";
import assert from "node:assert/strict";
import { parseSqp } from "../shared/parse-sqp.js";
import { parsePoe } from "../shared/parse-poe.js";
import { cvrHint, poeClickConversion } from "../shared/cvr-hint.js";
import { compute } from "../shared/compute.js";
import { buildAiPayload } from "../shared/ai-payload.js";
import { fixtureAnalysis } from "./helpers/fixture-analysis.js";
import { resultsHash } from "./helpers/results-hash.js";
import { readJson, POE } from "./helpers.js";

// Строки в формате Brand Analytics → Search Query Performance (ASIN view).
const row = (q, vol, clicks, clicksAsin, purchases, purchasesAsin) => ({ "Search Query": q, "Search Query Score": "1", "Search Query Volume": String(vol), "Impressions: Total Count": String(vol * 20),
  "Clicks: Total Count": String(clicks), "Clicks: ASIN Count": String(clicksAsin), "Cart Adds: Total Count": String(purchases * 2), "Purchases: Total Count": String(purchases), "Purchases: Purchase Rate %": ((purchases / vol) * 100).toFixed(2), "Purchases: ASIN Count": String(purchasesAsin) });
const SQP = parseSqp([
  row("urinal screen deodorizer", 14000, 5200, 400, 620, 68),
  row("urinal cakes", 7500, 2600, 90, 290, 9),
  row("urinal screen", 3300, 1300, 60, 170, 8),
  row("bathroom air freshener", 90000, 30000, 10, 1500, 0),
]);
const poeFixture = () => parsePoe(readJson(POE));

test("POE: конверсия клика ниши = покупки по запросам ÷ клики по товарам ниши; сверка с ручным расчётом", () => {
  const poe = poeFixture(); const c = poeClickConversion(poe);
  const nicheClicks = poe.asinMetrics.reduce((s, a) => s + (a.clickCountT360 ?? 0), 0);
  let purchases = 0, clicks = 0, searches = 0; for (const t of poe.searchTermMetrics) { purchases += t.svT360 * t.convT360; clicks += t.clickShareT360 * nicheClicks; searches += t.svT360; }
  assert.ok(Math.abs(c.cvr - purchases / clicks) < 1e-12); assert.ok(Math.abs(c.searchConv - purchases / searches) < 1e-12);
  assert.ok(c.cvr > c.searchConv, "конверсия клика выше конверсии поиска: кликают не после каждого поиска");
  assert.ok(c.cvr > 0.02 && c.cvr < 0.6, `значение в разумных пределах: ${(c.cvr * 100).toFixed(1)} %`);
  assert.equal(c.queries, poe.searchTermMetrics.length); assert.ok(Math.abs(c.clickShareCovered - 1) < 0.02, "клик-доли запросов в сумме дают 1"); assert.equal(c.smallSample, false);
});

test("POE: пустые поля не подменяются, неполные данные не дают подсказки", () => {
  const poe = poeFixture();
  const holes = { ...poe, searchTermMetrics: poe.searchTermMetrics.map((t, i) => (i % 2 ? { ...t, convT360: null } : t)) };
  const c = poeClickConversion(holes); assert.ok(c.queries < c.queriesTotal, "запросы без конверсии исключены, а не посчитаны нулём"); assert.ok(c.cvr > 0);
  assert.equal(poeClickConversion({ ...poe, asinMetrics: poe.asinMetrics.map((a) => ({ ...a, clickCountT360: null })) }), null, "нет кликов по товарам");
  assert.equal(poeClickConversion({ ...poe, searchTermMetrics: [] }), null); assert.equal(poeClickConversion(null), null);
  const broken = { ...poe, asinMetrics: [{ clickCountT360: 10 }] }; assert.equal(poeClickConversion(broken), null, "кликов меньше покупок — самопроверка не пройдена, подсказки нет");
  assert.equal(poeClickConversion({ ...poe, asinMetrics: poe.asinMetrics.slice(0, 1).map((a) => ({ ...a, clickCountT360: 600 })) })?.smallSample ?? true, true);
});

test("SQP: рынок и свой ASIN взвешены по кликам; «Purchase rate» не используется; отбор запросов по кластеру", () => {
  assert.equal(SQP.rows.find((r) => r.query === "urinal cakes").clicksAsin, 90);
  const h = cvrHint({ sqp: SQP }, { coreKeyword: "urinal screen deodorizer", clusterKeywords: ["Urinal Cakes", " urinal screen "] });
  assert.equal(h.source, "sqp"); assert.equal(h.scope, "cluster"); assert.equal(h.market.queries, 3); assert.equal(h.niche, null);
  assert.ok(Math.abs(h.market.cvr - 1080 / 9100) < 1e-12, "покупки ÷ клики, а не purchase rate (~4 %)"); assert.ok(Math.abs(h.mine.cvr - 85 / 550) < 1e-12);
  assert.equal(h.suggestedFrom, "market"); assert.equal(h.suggested, 0.119);
  assert.equal(cvrHint({ sqp: SQP }, { coreKeyword: "urinal screen", clusterKeywords: [] }).scope, "core");
  assert.equal(cvrHint({ sqp: SQP }, { coreKeyword: "toilet brush" }).scope, "all");
});

test("приоритет для нового листинга: рынок SQP → конверсия клика ниши POE → свой ASIN; малая выборка уступает", () => {
  const poe = poeFixture();
  const both = cvrHint({ sqp: SQP, poe }, { coreKeyword: "urinal screen deodorizer" }); assert.equal(both.source, "sqp+poe"); assert.equal(both.suggestedFrom, "market"); assert.ok(both.niche && both.market);
  const only = cvrHint({ poe }, { coreKeyword: "x" }); assert.equal(only.source, "poe"); assert.equal(only.suggestedFrom, "niche"); assert.equal(only.scope, null); assert.equal(only.market, null);
  const tinySqp = parseSqp([row("urinal screen deodorizer", 500, 120, 20, 30, 6)]);
  assert.equal(cvrHint({ sqp: tinySqp, poe }, { coreKeyword: "urinal screen deodorizer" }).suggestedFrom, "niche", "в SQP мало кликов — берём POE");
  assert.equal(cvrHint({ sqp: tinySqp }, { coreKeyword: "urinal screen deodorizer" }).aboveRealistic, true);
  assert.equal(cvrHint({}, {}), null); assert.equal(cvrHint({ sqp: { rows: [] }, poe: null }, {}), null);
});

test("в расчёте: подсказка ничего не меняет сама, уходит в AI-пейлоад; контрольный отпечаток результатов прежний", () => {
  const a = fixtureAnalysis(); const R = a.results;
  assert.equal(R.cvrHint.source, "poe"); assert.match(R.cvrHint.note, /^по данным: конверсия клика ниши по POE \d+,\d %$/);
  assert.equal(R.economics.gate2.atCvr.cvr, 0.10, "CVR в расчёте остался 10 %"); assert.doesNotMatch(R.economics.criterion2["2c"].note, /по данным/, "экономика подсказкой не изменяется");
  const withSqp = fixtureAnalysis(); withSqp.aggregates.sqp = SQP; withSqp.inputs.clusterKeywords = ["urinal cakes", "urinal screen"]; const R2 = compute(withSqp);
  assert.match(R2.cvrHint.note, /по POE .*; SQP по запросам вашего кластера: рынок 11,9 %, ваш ASIN 15,5 %/); assert.deepEqual(R2.economics.gate2, compute(Object.assign(fixtureAnalysis(), { inputs: withSqp.inputs })).economics.gate2);
  const p = buildAiPayload(a); assert.equal(p.cvrHint.usedCvr, 0.10); assert.ok(p.cvrHint.nicheClickCvr.cvr > 0); assert.equal(p.cvrHint.market, null);
  assert.equal(resultsHash(R), "c5e5835d0ca04abf", "расчёты не изменились");
});
