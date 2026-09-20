import { test } from "node:test";
import assert from "node:assert/strict";
import { parseSqp } from "../shared/parse-sqp.js";
import { cvrHint } from "../shared/cvr-hint.js";
import { compute } from "../shared/compute.js";
import { buildAiPayload } from "../shared/ai-payload.js";
import { fixtureAnalysis } from "./helpers/fixture-analysis.js";
import { resultsHash } from "./helpers/results-hash.js";

// Строки в формате Brand Analytics → Search Query Performance (ASIN view).
const row = (q, vol, clicks, clicksAsin, purchases, purchasesAsin) => ({ "Search Query": q, "Search Query Score": "1", "Search Query Volume": String(vol), "Impressions: Total Count": String(vol * 20),
  "Clicks: Total Count": String(clicks), "Clicks: ASIN Count": String(clicksAsin), "Cart Adds: Total Count": String(purchases * 2), "Purchases: Total Count": String(purchases), "Purchases: Purchase Rate %": ((purchases / vol) * 100).toFixed(2), "Purchases: ASIN Count": String(purchasesAsin) });
const SQP = parseSqp([
  row("urinal screen deodorizer", 14000, 5200, 400, 620, 68),
  row("urinal cakes", 7500, 2600, 90, 290, 9),
  row("urinal screen", 3300, 1300, 60, 170, 8),
  row("bathroom air freshener", 90000, 30000, 10, 1500, 0),
]);

test("parseSqp читает клики ASIN; purchaseRate (покупки / объём поиска) в подсказке не используется", () => {
  assert.equal(SQP.rows.find((r) => r.query === "urinal cakes").clicksAsin, 90);
  const h = cvrHint(SQP, { coreKeyword: "urinal screen deodorizer", clusterKeywords: ["urinal cakes", "urinal screen"] });
  assert.ok(h.market.cvr > 0.1, "клик→покупка ~12 %, а purchase rate в отчёте ~4 %");
});

test("по кластеру: рынок и свой ASIN взвешены по кликам, посторонние запросы не учитываются", () => {
  const h = cvrHint(SQP, { coreKeyword: "urinal screen deodorizer", clusterKeywords: ["Urinal Cakes", " urinal screen "] });
  assert.equal(h.scope, "cluster"); assert.equal(h.market.queries, 3);
  assert.equal(h.market.clicks, 5200 + 2600 + 1300); assert.equal(h.market.purchases, 620 + 290 + 170);
  assert.ok(Math.abs(h.market.cvr - 1080 / 9100) < 1e-12);
  assert.ok(Math.abs(h.mine.cvr - 85 / 550) < 1e-12); assert.equal(h.mine.smallSample, false); assert.equal(h.market.smallSample, false);
  assert.equal(h.suggestedFrom, "market"); assert.equal(h.suggested, 0.119); assert.equal(h.aboveRealistic, false); assert.equal(h.belowRealistic, false);
});

test("нет совпадений с кластером → по главному ключу → по всему отчёту; малая выборка помечается", () => {
  assert.equal(cvrHint(SQP, { coreKeyword: "urinal screen", clusterKeywords: [] }).scope, "core");
  const all = cvrHint(SQP, { coreKeyword: "toilet brush", clusterKeywords: ["toilet brush holder"] }); assert.equal(all.scope, "all"); assert.equal(all.market.queries, 4);
  const tiny = cvrHint(parseSqp([row("urinal screen deodorizer", 500, 120, 20, 30, 6)]), { coreKeyword: "urinal screen deodorizer" });
  assert.equal(tiny.market.smallSample, true); assert.equal(tiny.mine.smallSample, true); assert.equal(tiny.suggestedFrom, "market"); assert.equal(tiny.aboveRealistic, true, "25 % — выше реалистичного");
  const onlyMine = cvrHint(parseSqp([row("urinal screen deodorizer", 9000, 150, 80, 20, 12)]), { coreKeyword: "urinal screen deodorizer" });
  assert.equal(onlyMine.suggestedFrom, "mine", "рынка мало (150 кликов), своего достаточно");
  assert.equal(cvrHint(null, {}), null); assert.equal(cvrHint({ rows: [] }, {}), null);
  assert.equal(cvrHint(parseSqp([{ "Search Query": "x", "Search Query Volume": "100" }]), { coreKeyword: "x" }), null, "в отчёте нет кликов");
});

test("в расчёте: подсказка ничего не меняет сама, попадает в 2c и в AI-пейлоад; без SQP результаты прежние", () => {
  const a = fixtureAnalysis(); a.aggregates.sqp = SQP; a.inputs.clusterKeywords = ["urinal cakes", "urinal screen"];
  const base = fixtureAnalysis(); base.inputs.clusterKeywords = a.inputs.clusterKeywords; const R0 = compute(base), R = compute(a);
  assert.equal(R.cvrHint.suggested, 0.119); assert.equal(R.economics.gate2.atCvr.cvr, 0.10, "CVR в расчёте остался 10 %");
  assert.deepEqual(R.economics.gate2, R0.economics.gate2); assert.equal(R.verdict.ceiling, R0.verdict.ceiling);
  assert.match(R.economics.criterion2["2c"].note, /по SQP \(по запросам вашего кластера\) клик→покупка: рынок 11,9 %, ваш ASIN 15,5 %/);
  a.results = R; const p = buildAiPayload(a); assert.equal(p.cvrHint.market.cvr, 0.119); assert.equal(p.cvrHint.usedCvr, 0.10);
  assert.equal(R0.cvrHint, null); assert.equal(buildAiPayload({ ...base, results: R0 }).cvrHint, null);
  assert.equal(resultsHash(fixtureAnalysis().results), "c5e5835d0ca04abf", "контрольный отпечаток без SQP не изменился");
});
