// Реальный POE (urinal screen deodorizer) + синтетический Xray поверх тех же ASIN: в фикстурах проекта Xray и POE — из разных ниш,
// а «продажи на 1 % кликов» и когорта новичков требуют пересечения. Продажи назначаются детерминированно: ≈ 40 шт/мес на 1 % кликов с разбросом ±35 %.
import { parsePoe } from "../../shared/parse-poe.js";
import { newAnalysis } from "../../shared/analysis.js";
import { compute } from "../../shared/compute.js";
import { readJson, POE } from "../helpers.js";

export const PER_1PCT = 40;
export function entryFixture({ inputs = {}, mutateXray = null, withXray = true } = {}) {
  const poe = parsePoe(readJson(POE));
  const asins = poe.asinMetrics.map((p, i) => {
    const share = p.clickShareT90 ?? p.clickShareT360 ?? 0, wobble = 0.65 + ((i * 37) % 71) / 100; // 0,65…1,35
    const sales = Math.round(share * 100 * PER_1PCT * wobble);
    return { asin: p.asin, parentAsin: p.asin, isVariation: false, title: p.title, brand: p.brand, price: p.price, asinSales: sales, asinRevenue: sales * (p.price ?? 0), reviews: p.reviews === null ? null : Math.round(p.reviews * 1.6),
      rating: p.rating, creationDate: p.launchDate ? String(p.launchDate).slice(0, 10) : null, url: "https://www.amazon.com/dp/" + p.asin, seller: "", fulfillment: "FBA" };
  });
  const xray = { asins, flags: { rowsTotal: asins.length, hasAsinSales: true, duplicatesDropped: 0, amazonSells: false }, columns: {} };
  if (mutateXray) mutateXray(xray, poe);
  const a = newAnalysis({ id: "entry-fixture", niche: "urinal screen deodorizer", coreKeyword: "urinal screen deodorizer", createdAt: "2026-09-15T12:00:00.000Z" });
  a.aggregates = withXray ? { xray, poe } : { poe };
  Object.assign(a.inputs, { price: 24.99, cogs: 4.37, shippingPerUnit: 1.13, fbaFee: 5.41, cpc: 1.27, budget: 18750, unitsPerDay: 10 }, inputs);
  a.results = compute(a);
  return a;
}
