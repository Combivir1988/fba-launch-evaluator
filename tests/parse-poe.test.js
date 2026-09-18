import { test } from "node:test";
import assert from "node:assert/strict";
import { parsePoe, isPoeJson, poeRevenueProxy, htmlToText } from "../shared/parse-poe.js";
import { readJson, POE } from "./helpers.js";

const raw = readJson(POE);

test("POE: распознавание и числа", () => {
  assert.equal(isPoeJson(raw), true);
  const p = parsePoe(raw);
  assert.equal(p.meta.nicheTitle, "urinal screen deodorizer");
  assert.equal(p.nicheSummary.searchVolumeT360, 432911);
  assert.equal(p.nicheSummary.avgPrice, 31.5719699104);
  assert.equal(p.launchPotential.productCount.current, 67);
  assert.equal(p.launchPotential.productCount.yoy, 43);
  assert.equal(p.launchPotential.successfulLaunchesT360.current, 9);
  assert.equal(p.launchPotential.newProductsLaunchedT360.current, 24);
  assert.equal(p.asinMetrics.length, 67);
  assert.ok(p.asinMetrics[0].clickShareT360 >= p.asinMetrics[1].clickShareT360);
  assert.equal(p.searchTermMetrics[0].term, "urinal screen deodorizer");
  assert.equal(p.searchTermMetrics[0].svT360, 173188);
  assert.equal(p.trends.length, 104);
  assert.equal(p.trends[0].date, "2024-09-22");
  assert.equal(p.pdr.negative[0].topic, "Smell");
  assert.equal(p.pdr.negative[0].pct, 48.67);
  assert.equal(Object.keys(p.insights).length, 6);
  assert.ok(p.insights.market.startsWith("Urinal Screen Deodorizer Niche Analysis"));
  assert.ok(!/<[a-z]/.test(p.insights.market), "HTML снят");
});

test("POE: прокси выручки", () => {
  const p = parsePoe(raw);
  const r = poeRevenueProxy(p);
  // (50000+60000)/2 × 31.57 / 12 ≈ 144 700
  assert.ok(Math.abs(r.monthly - 144705) < 100, String(r.monthly));
});

test("htmlToText", () => {
  assert.equal(htmlToText("<h2>A</h2><p>B &amp; C</p>"), "A\nB & C");
});

test("POE: дубли ASIN в asinMetrics учитываются один раз", () => {
  const dup = JSON.parse(JSON.stringify(raw));
  dup.data.niche.asinMetrics = [...dup.data.niche.asinMetrics, dup.data.niche.asinMetrics[0], dup.data.niche.asinMetrics[1]];
  const p = parsePoe(dup);
  assert.equal(p.asinMetrics.length, 67);
});
