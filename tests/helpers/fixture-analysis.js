// Полный документ анализа из реальных фикстур (Xray + Cerebro + POE) — для тестов хранения и снимков.
import { randomUUID } from "node:crypto";
import { parseXray } from "../../shared/parse-xray.js";
import { parseCerebro } from "../../shared/parse-cerebro.js";
import { parsePoe } from "../../shared/parse-poe.js";
import { newAnalysis } from "../../shared/analysis.js";
import { compute } from "../../shared/compute.js";
import { readCsv, readJson, XRAY, CEREBRO, POE } from "../helpers.js";

let cache = null;
export function fixtureAnalysis(overrides = {}) {
  if (!cache) {
    const xray = parseXray(readCsv(XRAY));
    const cerebro = parseCerebro(readCsv(CEREBRO), { coreKeyword: "bike tube", brands: xray.asins.map((a) => a.brand) });
    cache = { xray, cerebro, poe: parsePoe(readJson(POE)) };
  }
  const a = newAnalysis({ id: randomUUID(), niche: "urinal screen deodorizer", coreKeyword: "urinal screen deodorizer" });
  a.aggregates = structuredClone(cache);
  a.sources = { xray: { fileName: XRAY }, cerebro: { fileName: CEREBRO }, poe: { fileName: POE }, sqp: null };
  Object.assign(a.inputs, { price: 24.99, cogs: 4.37, shippingPerUnit: 1.13, fbaFee: 5.41, cpc: 1.27, budget: 18750 }, overrides.inputs || {});
  a.results = compute(a);
  return a;
}
