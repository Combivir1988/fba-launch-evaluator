import { test } from "node:test";
import assert from "node:assert/strict";
import { parseXray } from "../shared/parse-xray.js";
import { parseCerebro, suggestCluster } from "../shared/parse-cerebro.js";
import { parsePoe } from "../shared/parse-poe.js";
import { newAnalysis } from "../shared/analysis.js";
import { compute } from "../shared/compute.js";
import { buildAiPayload } from "../shared/ai-payload.js";
import { readCsv, readJson, XRAY, CEREBRO, POE } from "./helpers.js";

test("AI payload: компактный (≤ 60k символов ≈ 15k токенов), без сырых строк, с гейтами", () => {
  const xray = parseXray(readCsv(XRAY));
  const core = "sound deadening mat";
  const cerebro = parseCerebro(readCsv(CEREBRO), { coreKeyword: core, brands: xray.asins.map((a) => a.brand) });
  const a = newAnalysis({ niche: "car sound deadening mat", coreKeyword: core });
  a.aggregates = { xray, cerebro, poe: parsePoe(readJson(POE)) };
  a.inputs.clusterKeywords = suggestCluster(cerebro.keywords, { coreKeyword: core });
  Object.assign(a.inputs, { price: 45, cogs: 12, fbaFee: 8, cpc: 1.1 });
  a.results = compute(a);
  const p = buildAiPayload(a);
  const s = JSON.stringify(p);
  assert.ok(s.length < 60000, `payload ${s.length} символов`);
  assert.equal(p.topAsins.length, 20);
  assert.equal(p.poe.terms.length, 14);
  assert.equal(p.poe.reviews.negative.length, 10);
  assert.ok(p.criterion1.items["1a"].status);
  assert.equal(p.economics.pending, undefined);
  assert.ok(p.rulesVerdict.ceiling);
  assert.ok(!s.includes("Display Order"), "сырых полей Xray нет");
});

// ---------- spec 003: ценовой диапазон ----------
import { fixtureAnalysis as fxBand } from "./helpers/fixture-analysis.js";
import { mockVerdict as mockBand } from "../server/mock-verdict.js";

test("ценовой диапазон в AI-пейлоаде: сводка, показатели всей ниши, топ конкурентов только из диапазона", () => {
  const a = fxBand({ inputs: { priceMin: 20, priceMax: 60 } }); const p = buildAiPayload(a);
  assert.equal(p.priceBand.label, "$20–$60"); assert.equal(p.priceBand.listingsInBand, a.results.priceBand.inCount); assert.equal(p.priceBand.sample, a.results.priceBand.sample);
  assert.match(p.priceBand.note, /ТОЛЬКО по листингам этого ценового диапазона/);
  assert.equal(p.wholeNiche.topBrandShare, Math.round(a.results.priceBand.whole.topBrandShare * 1000) / 1000); assert.ok(p.wholeNiche.revenue > p.priceBand.revenueBand);
  assert.ok(p.topAsins.length > 0 && p.topAsins.every((x) => x.price >= 20 && x.price <= 60), "в топе только листинги диапазона");
  assert.match(mockBand(p).summary, /в ценовом диапазоне \$20–\$60/);
  const off = buildAiPayload(fxBand()); assert.equal(off.priceBand, null); assert.equal(off.wholeNiche, null); assert.ok(off.topAsins.some((x) => x.price > 60 || x.price < 20));
});
