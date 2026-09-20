// spec 007: объединение нескольких ниш POE в один рынок.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mergePoe, upsertPoePart, poePartKey, mergedPoeNotes, MAX_POE_PARTS } from "../shared/merge-poe.js";
import { parsePoe } from "../shared/parse-poe.js";
import { poeClickConversion } from "../shared/cvr-hint.js";
import { compute } from "../shared/compute.js";
import { newAnalysis } from "../shared/analysis.js";
import { buildAiPayload } from "../shared/ai-payload.js";
import { buildSnapshot } from "../shared/share-snapshot.js";
import { resultsHash } from "./helpers/results-hash.js";
import { readJson, POE } from "./helpers.js";

const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`);
const sum = (xs) => xs.reduce((s, x) => s + (x ?? 0), 0);
const A = () => parsePoe(readJson(POE));
/** Вторая ниша того же рынка: часть товаров и запросов общая с первой, часть — своя; кликов вдвое меньше. */
function B({ sharedAsins = 10, sharedTerms = 4 } = {}) {
  const b = A(); b.meta = { ...b.meta, nicheId: "niche-b", nicheTitle: "urinal cake deodorizer", capturedAt: "2026-09-18T09:00:00.000Z" };
  b.asinMetrics = b.asinMetrics.slice(0, 30).map((a, i) => ({ ...a, asin: i < sharedAsins ? a.asin : "B0NEW" + String(i).padStart(5, "0"), clickCountT360: Math.round((a.clickCountT360 ?? 0) / 2) }));
  const s = sum(b.asinMetrics.map((a) => a.clickShareT360)); b.asinMetrics.forEach((a) => { a.clickShareT360 /= s; a.clickShareT90 = a.clickShareT360; });
  b.searchTermMetrics = b.searchTermMetrics.map((t, i) => ({ ...t, term: i < sharedTerms ? t.term : t.term + " cake" }));
  b.trends = b.trends.slice(10); // у второй ниши история короче
  return b;
}
/** Те же входы, что у контрольного отпечатка «только POE» (tests/price-band.test.js). */
const baselineHash = (poe) => { const a = newAnalysis({ niche: "u", coreKeyword: "urinal screen deodorizer" }); a.aggregates = { poe }; Object.assign(a.inputs, { price: 24.99, cogs: 4.37 }); return resultsHash(compute(a)); };
const analysisOf = (poe, parts) => { const a = newAnalysis({ id: "m", niche: "n", coreKeyword: "urinal screen deodorizer", createdAt: "2026-09-15T12:00:00.000Z" }); a.aggregates = parts ? { poe, poeParts: parts } : { poe }; Object.assign(a.inputs, { price: 24.99, cogs: 4.37, cpc: 1.27 }); a.results = compute(a); return a; };

test("FR-006/SC-004: одна ниша возвращается как есть — расчёты прежние", () => {
  const a = A(); assert.equal(mergePoe([a]), a); assert.equal(mergePoe([]), null); assert.equal(mergePoe(null), null); assert.equal(a.merged, undefined);
  assert.equal(baselineHash(mergePoe([a])), "baab2bb0a4b0603a"); assert.deepEqual(mergedPoeNotes(a), []);
});

test("SC-001/SC-002: товары и запросы без дублей, клики сложены, доли — от общих кликов (сверка ручным расчётом)", () => {
  const a = A(), b = B(), m = mergePoe([a, b]); const Wa = sum(a.asinMetrics.map((x) => x.clickCountT360)), Wb = sum(b.asinMetrics.map((x) => x.clickCountT360)), W = Wa + Wb;
  assert.equal(m.merged.count, 2); assert.equal(m.merged.weightBasis, "clicks"); near(m.merged.niches[0].weight, Wa / W); near(m.merged.niches[1].weight, Wb / W); assert.equal(m.merged.niches[0].primary, true);
  assert.equal(m.merged.overlapAsins, 10); assert.equal(m.asinMetrics.length, a.asinMetrics.length + 30 - 10); assert.equal(new Set(m.asinMetrics.map((x) => x.asin)).size, m.asinMetrics.length);
  assert.equal(sum(m.asinMetrics.map((x) => x.clickCountT360)), W, "клики объединённого рынка = сумма кликов ниш"); near(sum(m.asinMetrics.map((x) => x.clickShareT360)), 1, 1e-9);
  const shared = a.asinMetrics[0], inB = b.asinMetrics[0], got = m.asinMetrics.find((x) => x.asin === shared.asin);
  near(got.clickShareT360, (shared.clickShareT360 * Wa + inB.clickShareT360 * Wb) / W); assert.equal(got.clickCountT360, shared.clickCountT360 + inB.clickCountT360); assert.equal(got.niches, 2);
  const own = m.asinMetrics.find((x) => x.asin === "B0NEW00015"); near(own.clickShareT360, b.asinMetrics[15].clickShareT360 * Wb / W); assert.equal(own.niches, 1);
  for (let i = 1; i < m.asinMetrics.length; i++) assert.ok(m.asinMetrics[i - 1].clickShareT360 >= m.asinMetrics[i].clickShareT360, "отсортировано по доле");
  assert.equal(m.merged.overlapTerms, 4); assert.equal(m.searchTermMetrics.length, a.searchTermMetrics.length * 2 - 4); near(sum(m.searchTermMetrics.map((t) => t.clickShareT360)), 1, 1e-9);
  const t0 = m.searchTermMetrics.find((t) => t.term === a.searchTermMetrics[0].term); assert.equal(t0.svT360, a.searchTermMetrics[0].svT360, "объём поиска общего запроса — один раз, не сумма"); assert.equal(t0.niches, 2);
  const dup = sum(a.searchTermMetrics.slice(0, 4).map((t) => t.svT360)); assert.equal(m.nicheSummary.searchVolumeT360, a.nicheSummary.searchVolumeT360 * 2 - dup);
});

test("US2: счётные показатели сложены, средние взвешены, доли топ-брендов пересчитаны, тренды — по общим неделям", () => {
  const a = A(), b = B(), m = mergePoe([a, b]); const wa = m.merged.niches[0].weight, wb = m.merged.niches[1].weight; const la = a.launchPotential, lm = m.launchPotential;
  assert.equal(lm.newProductsLaunchedT360.current, la.newProductsLaunchedT360.current * 2); assert.equal(lm.successfulLaunchesT360.current, la.successfulLaunchesT360.current * 2); assert.equal(lm.brandCount.current, la.brandCount.current * 2);
  near(lm.avgReviewCount.current, la.avgReviewCount.current, 1e-6); near(lm.sponsoredProductsPercentage.current, la.sponsoredProductsPercentage.current * wa + la.sponsoredProductsPercentage.current * wb, 1e-9);
  const brands = new Map(); for (const x of m.asinMetrics) brands.set(x.brand, (brands.get(x.brand) || 0) + x.clickShareT360); const top5 = [...brands.values()].sort((x, y) => y - x).slice(0, 5).reduce((x, y) => x + y, 0);
  near(lm.top5BrandsClickShareT360.current, top5); assert.equal(lm.top5BrandsClickShareT360.qoq, null); assert.equal(lm.top5BrandsClickShareT360.recomputed, true); assert.ok(lm.top20ProductsClickShareT360.current <= 1);
  assert.equal(m.merged.trendsFrom, "common"); assert.equal(m.trends.length, b.trends.length, "только недели, которые есть в обеих нишах"); assert.equal(m.trends[0].date, b.trends[0].date);
  const wk = a.trends.find((t) => t.date === m.trends[0].date); assert.equal(m.trends[0].sv, wk.sv * 2); near(m.trends[0].price, wk.price, 1e-9);
  const season = (tr) => { const v = tr.map((t) => t.sv).filter((x) => x !== null).slice(-52); return (Math.max(...v) - Math.min(...v)) / Math.max(...v); }; near(season(m.trends), season(b.trends), 1e-9);
  const short = B(); short.trends = short.trends.slice(-5); const p = mergePoe([a, short]); assert.equal(p.merged.trendsFrom, "primary"); assert.equal(p.trends, a.trends); assert.match(mergedPoeNotes(p).map((n) => n.text).join(" "), /сезонность взята по самой крупной нише/);
  near(m.pdr.negative[0].pct, a.pdr.negative[0].pct, 1e-9); assert.ok(m.pdr.negative.length <= 10); assert.equal(m.insights, a.insights); assert.equal(m.meta.capturedAt, "2026-09-18T09:00:00.000Z"); assert.match(m.meta.nicheTitle, / \+ /);
  assert.equal(m.nicheSummary.minUnitsT360, a.nicheSummary.minUnitsT360 * 2); near(m.nicheSummary.avgPrice, a.nicheSummary.avgPrice, 1e-9);
});

test("веса ниш: нет кликов по товарам — по объёму поиска, нет и его — равные; это названо в пометках", () => {
  const a = A(), b = B(); b.asinMetrics.forEach((x) => { x.clickCountT360 = null; }); const m = mergePoe([a, b]);
  assert.equal(m.merged.weightBasis, "searchVolume"); near(m.merged.niches[0].weight, 0.5); assert.match(mergedPoeNotes(m).at(-1).text, /по объёму поиска/);
  a.nicheSummary.searchVolumeT360 = null; assert.equal(mergePoe([a, b]).merged.weightBasis, "equal");
});

test("FR-001/FR-005: добавить, обновить, удалить нишу; не больше восьми; удаление возвращает исходный результат (SC-003)", () => {
  const a = A(), b = B(); let r = upsertPoePart([], a); assert.equal(r.action, "added"); r = upsertPoePart(r.parts, b); assert.equal(r.action, "added"); assert.equal(r.parts.length, 2);
  const b2 = B({ sharedAsins: 5 }); r = upsertPoePart(r.parts, b2); assert.equal(r.action, "updated"); assert.equal(r.parts.length, 2); assert.equal(r.parts[1], b2); assert.equal(poePartKey(b2), "niche-b");
  const noId = A(); noId.meta = { ...noId.meta, nicheId: null, nicheTitle: "  Some   Niche " }; assert.equal(poePartKey(noId), "some niche");
  const many = Array.from({ length: MAX_POE_PARTS }, (_, i) => { const p = A(); p.meta = { ...p.meta, nicheId: "n" + i }; return p; }); assert.throws(() => upsertPoePart(many, b), /не больше 8 ниш/);
  const back = mergePoe(r.parts.filter((p) => poePartKey(p) !== "niche-b")); assert.equal(back, a); assert.equal(baselineHash(back), "baab2bb0a4b0603a");
});

test("в расчёте: конверсия клика, новички и цена по кликам считаются по общему рынку; пометки, AI и снимок ссылки", () => {
  const a = A(), b = B(), m = mergePoe([a, b]); const single = analysisOf(a), both = analysisOf(m, [a, b]);
  const c = poeClickConversion(m); assert.ok(c && c.cvr > c.searchConv && c.cvr < 1); assert.equal(c.asins, m.asinMetrics.length); assert.ok(Math.abs(c.clickShareCovered - 1) < 0.02);
  assert.equal(both.results.entry.cohort.population, m.asinMetrics.length); assert.ok(both.results.entry.cohort.population > single.results.entry.cohort.population);
  assert.ok(both.results.clickPrice.n > single.results.clickPrice.n); assert.equal(both.results.gate0.poe, true);
  const ids = both.results.dataNotes.map((n) => n.id); for (const id of ["merged", "mergedOverlap", "mergedApprox", "mergedTrends"]) assert.ok(ids.includes(id), id); assert.equal(single.results.dataNotes.some((n) => n.id === "merged"), false);
  assert.match(both.results.dataNotes.find((n) => n.id === "merged").text, /POE объединён из 2 ниш: «urinal screen deodorizer» — 67 товаров, \d+ % кликов; «urinal cake deodorizer» — 30 товаров/);
  const p = buildAiPayload(both); assert.equal(p.poe.mergedFrom.niches.length, 2); assert.equal(p.poe.mergedFrom.sharedProducts, 10); assert.equal(buildAiPayload(single).poe.mergedFrom, null);
  const snap = buildSnapshot(both, { mode: "full" }); assert.equal(snap.analysis.aggregates.poeParts, undefined, "ниши по отдельности в ссылку не попадают"); assert.equal(snap.analysis.aggregates.poe.merged.count, 2); assert.ok(both.aggregates.poeParts, "исходный анализ не тронут");
  const t0 = performance.now(); mergePoe([a, b, B(), B(), B()].map((p, i) => ({ ...p, meta: { ...p.meta, nicheId: "x" + i } }))); assert.ok(performance.now() - t0 < 1000, "SC-005: пять ниш быстрее секунды");
});
