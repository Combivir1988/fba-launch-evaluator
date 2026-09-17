// Компактный агрегат для Claude: только то, что нужно для синтеза (≈ 6–10k токенов), без сырых файлов.
import { round } from "./num.js";

const r2 = (v) => round(v, 2), r3 = (v) => round(v, 3);

export function buildAiPayload(analysis) {
  const R = analysis.results; if (!R) throw new Error("Сначала рассчитайте дашборд");
  const agg = analysis.aggregates || {}; const inp = analysis.inputs || {};
  const c1 = Object.fromEntries(Object.entries(R.criterion1.items).map(([k, i]) => [k, { value: i.pct ? r3(i.value) : r2(i.value), unit: i.unit, status: i.status, source: i.source, threshold: i.threshold, note: i.note }]));
  const eco = R.economics;
  const payload = {
    niche: analysis.niche, coreKeyword: analysis.coreKeyword, marketplace: analysis.marketplace,
    evaluateAsNewEntrant: inp.evaluateAsNewEntrant !== false, myBrand: inp.myBrand || null, myAsins: inp.myAsins || [],
    gate0: R.gate0,
    criterion1: { items: c1, okCount: R.criterion1.okCount, pass: R.criterion1.pass, redItems: R.criterion1.redItems, proxyCount: R.criterion1.proxyCount },
    economics: eco.pending ? { pending: true, note: "COGS не введён — Критерий 2 пуст, экономика = прикидка" } : {
      price: r2(eco.price), cogs: r2(eco.cogs), gate1: { status: eco.gate1.status, net0: r2(eco.gate1.net0), margin0: r3(eco.gate1.margin0), roi: r3(eco.roi) },
      gate2: { status: eco.gate2.status, cpc: r2(eco.gate2.cpc), ppcShare: eco.gate2.ppcShare, byCvr: eco.gate2.byCvr.map((x) => ({ cvr: x.cvr, net: r2(x.net) })), breakEvenCvr: r3(eco.breakEvenCvr) },
      marginNoAds: r3(eco.marginNoAds), marginWithAds: r3(eco.marginWithAds), cheapSegment: eco.cheapSegment, roiHint: eco.roiHint,
      criterion2: Object.fromEntries(Object.entries(eco.criterion2).map(([k, v]) => [k, { status: v.status, value: r2(v.value) }])), criterion2Summary: eco.criterion2Summary && { okCount: eco.criterion2Summary.okCount, mandatoryOk: eco.criterion2Summary.mandatoryOk, pass: eco.criterion2Summary.pass },
    },
    budget: { status: R.budget.status, need: r2(R.budget.need), budget: R.budget.budget, batchCost: r2(R.budget.batchCost), leadDays: R.budget.leadDays, quickScreen: Object.fromEntries(Object.entries(R.budget.quickScreen).map(([k, v]) => [k, v.status])) },
    traffic: { source: R.traffic.source, svCore: r2(R.traffic.svCore), adjSv: r2(R.traffic.adjSv), top2Share: r3(R.traffic.top2Share), relevantCount: R.traffic.relevantCount, groups: R.traffic.groups, status: R.traffic.status,
      topKeywords: R.traffic.cluster.slice(0, 15).map((k) => ({ phrase: k.phrase, sv: k.sv, bid: k.bid, competing: k.competingProducts })), poeConcentration: R.traffic.poeConcentration },
    competition: { source: R.competition.source, topBrand: R.competition.topBrand, topBrandShare: r3(R.competition.topBrandShare), top5Share: r3(R.competition.top5Share), top20Share: r3(R.competition.top20Share),
      dominant: R.competition.dominant, amazonSells: R.competition.amazonSells, reviewBarrier: { ...R.competition.reviewBarrier, avg: r2(R.competition.reviewBarrier.avg) }, playersOver100: R.competition.playersOver100, brandsOver10pct: R.competition.brandsOver10pct,
      topBrands: R.competition.brands.slice(0, 10).map((b) => ({ brand: b.brand, share: r3(b.share), asins: b.asins, reviewsMax: b.reviewsMax, rating: r2(b.rating), priceMedian: r2(b.priceMedian) })),
      contaminationCandidates: R.competition.contaminationCandidates.slice(0, 8), priceSegments: R.priceSegments },
    topAsins: topAsins(agg, inp),
    challenger: { active: R.challenger.active, greenCount: R.challenger.greenCount, mandatoryOk: R.challenger.mandatoryOk, pass: R.challenger.pass, gate4Discussed: R.challenger.gate4Discussed,
      items: Object.fromEntries(Object.entries(R.challenger.items).map(([k, v]) => [k, { title: v.title, status: v.status, kind: v.kind, note: v.note }])) },
    scorecard: { total: r2(R.scorecard.total), band: R.scorecard.band, weakest: R.scorecard.weakest, axes: Object.fromEntries(Object.entries(R.scorecard.axes).map(([k, a]) => [k, { score: r2(a.score), note: a.note }])) },
    rulesVerdict: R.verdict,
    reconciliation: R.reconciliation.map((x) => ({ metric: x.metric, a: { ...x.a, value: r2(x.a.value) }, b: { ...x.b, value: r2(x.b.value) }, deltaPct: r3(x.deltaPct), level: x.level })),
    checklist: inp.checklist, challengerUser: inp.challenger, canDifferentiate: inp.canDifferentiate,
    poe: agg.poe ? {
      summary: agg.poe.nicheSummary, launchPotential: pick(agg.poe.launchPotential, ["productCount", "brandCount", "sellingPartnerCount", "newProductsLaunchedT360", "successfulLaunchesT360", "avgReviewCount", "avgReviewRating", "sponsoredProductsPercentage", "top5BrandsClickShareT360", "top20ProductsClickShareT360", "avgProductPrice", "avgOOSRate"]),
      terms: agg.poe.searchTermMetrics.slice(0, 20).map((t) => ({ term: t.term, svT360: t.svT360, growthYoy: r3(t.growthT360Yoy), conv: r3(t.convT360), clickShare: r3(t.clickShareT360), topClicked: t.topClicked.map((x) => x.asin) })),
      reviews: { negative: agg.poe.pdr.negative, positive: agg.poe.pdr.positive, returns: agg.poe.pdr.returns },
      insights: Object.fromEntries(Object.entries(agg.poe.insights || {}).map(([k, v]) => [k, String(v).slice(0, 1200)])),
    } : null,
    sqp: agg.sqp ? agg.sqp.rows.slice(0, 15).map((q) => ({ query: q.query, volume: q.volume, purchaseRate: r3(q.purchaseRate) })) : null,
  };
  return payload;
}

function topAsins(agg, inp) {
  const my = new Set((inp.myAsins || []).map((s) => s.toUpperCase()));
  if (agg.xray?.asins?.length) {
    return [...agg.xray.asins].sort((a, b) => (b.asinRevenue ?? 0) - (a.asinRevenue ?? 0)).slice(0, 20)
      .map((a) => ({ asin: a.asin, brand: a.brand, title: a.title.slice(0, 90), price: a.price, revenue: r2(a.asinRevenue), sales: a.asinSales, reviews: a.reviews, rating: a.rating, created: a.creationDate, mine: my.has(a.asin) || (inp.myBrand && a.brand.toLowerCase() === inp.myBrand.toLowerCase()) }));
  }
  if (agg.poe?.asinMetrics?.length) {
    return agg.poe.asinMetrics.slice(0, 20).map((a) => ({ asin: a.asin, brand: a.brand, title: a.title.slice(0, 90), price: r2(a.price), clickShare: r3(a.clickShareT360), reviews: a.reviews, rating: a.rating, launched: a.launchDate, mine: my.has(a.asin) || (inp.myBrand && a.brand.toLowerCase() === inp.myBrand.toLowerCase()) }));
  }
  return [];
}
function pick(o, keys) { const out = {}; for (const k of keys) if (o && o[k]) out[k] = o[k]; return out; }
