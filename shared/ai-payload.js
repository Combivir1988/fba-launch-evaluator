// Компактный агрегат для Claude: только то, что нужно для синтеза (≈ 6–10k токенов), без сырых файлов.
import { round } from "./num.js";
import { gateStatuses } from "./verdict-rules.js";
import { inBand } from "./price-band.js";

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
    budget: { status: R.budget.status, basis: R.budget.basis === "cash" ? "пик вложений помесячного сценария" : "две партии + реклама", need: r2(R.budget.need), needTwoBatchesReference: r2(R.budget.needTwoBatches), budget: R.budget.budget, batchCost: r2(R.budget.batchCost), leadDays: R.budget.leadDays, quickScreen: Object.fromEntries(Object.entries(R.budget.quickScreen).map(([k, v]) => [k, v.status])) },
    traffic: { source: R.traffic.source, svCore: r2(R.traffic.svCore), adjSv: r2(R.traffic.adjSv), top2Share: r3(R.traffic.top2Share), relevantCount: R.traffic.relevantCount, groups: R.traffic.groups, status: R.traffic.status,
      topKeywords: R.traffic.cluster.slice(0, 15).map((k) => ({ phrase: k.phrase, sv: k.sv, bid: k.bid, competing: k.competingProducts })), poeConcentration: R.traffic.poeConcentration },
    competition: { source: R.competition.source, topBrand: R.competition.topBrand, topBrandShare: r3(R.competition.topBrandShare), top5Share: r3(R.competition.top5Share), top20Share: r3(R.competition.top20Share),
      dominant: R.competition.dominant, amazonSells: R.competition.amazonSells, amazon: R.amazon ? { mode: R.amazon.mode, scope: R.amazon.scopeLabel, present: R.amazon.present, listings: R.amazon.count, revenueShare: r3(R.amazon.revenueShare), blocksVerdict: R.amazon.blocks } : null, reviewBarrier: { ...R.competition.reviewBarrier, avg: r2(R.competition.reviewBarrier.avg) }, playersOver100: R.competition.playersOver100, brandsOver10pct: R.competition.brandsOver10pct,
      topBrands: R.competition.brands.slice(0, 10).map((b) => ({ brand: b.brand, share: r3(b.share), asins: b.asins, reviewsMax: b.reviewsMax, rating: r2(b.rating), priceMedian: r2(b.priceMedian) })),
      contaminationCandidates: R.competition.contaminationCandidates.slice(0, 8), priceSegments: R.priceSegments },
    // Ценовой диапазон (spec 003): конкуренция выше и topAsins — по листингам коридора; спрос, сегменты цен и размер рынка — по всей нише.
    priceBand: R.priceBand?.active ? { label: R.priceBand.label, min: R.priceBand.min, max: R.priceBand.max, listingsInBand: R.priceBand.inCount, listingsTotal: R.priceBand.totalCount, noPrice: R.priceBand.noPrice,
      shareOfNiche: r3(R.priceBand.revenueShare), shareBasis: R.priceBand.weightLabel, revenueBand: r2(R.priceBand.source === "xray" ? R.priceBand.revenueBand : null), sample: R.priceBand.sample, myPriceOutside: R.priceBand.myPriceOutside,
      note: "criterion1 1b/1d/1e/1f, competition, challenger и topAsins посчитаны ТОЛЬКО по листингам этого ценового диапазона; 1a, 1c, 1g, 1h, traffic, priceSegments — по всей нише" } : null,
    wholeNiche: R.priceBand?.active && R.priceBand.whole ? { revenue: r2(R.priceBand.whole.revenue), topBrand: R.priceBand.whole.topBrand, topBrandShare: r3(R.priceBand.whole.topBrandShare), top5Share: r3(R.priceBand.whole.top5Share),
      priceMedian: r2(R.priceBand.whole.priceMedian), reviewsAvg: r2(R.priceBand.whole.reviewsAvg), reviewsMedian: r2(R.priceBand.whole.reviewsMedian) } : null,
    cvrHint: R.cvrHint ? { note: "конверсия клик→покупка; usedCvr — значение в расчёте (по умолчанию 10 % — допущение). nicheClickCvr — конверсия клика НИШИ по POE (покупки ÷ клики товаров ниши, 360 дней, зрелые листинги; у нового листинга обычно ниже)", usedCvr: inp.cvr,
      nicheClickCvr: R.cvrHint.niche && { cvr: r3(R.cvrHint.niche.cvr), searchConv: r3(R.cvrHint.niche.searchConv), clicks: R.cvrHint.niche.clicks, smallSample: R.cvrHint.niche.smallSample },
      scope: R.cvrHint.scopeLabel, market: R.cvrHint.market && { cvr: r3(R.cvrHint.market.cvr), clicks: R.cvrHint.market.clicks, smallSample: R.cvrHint.market.smallSample }, mine: R.cvrHint.mine && { cvr: r3(R.cvrHint.mine.cvr), clicks: R.cvrHint.mine.clicks, smallSample: R.cvrHint.mine.smallSample } } : null,
    // Вход в нишу (spec 005): по ВСЕЙ нише. reach.status — предварительная оценка, на rulesVerdict не влияет.
    entry: R.entry?.available ? {
      note: "salesPer1pctClicks — продаж в месяц на 1 % кликов ниши (Xray × POE); reach — какая доля кликов нужна под цель менеджера и есть ли такая у товаров ниши; newEntrants — листинги 2–24 мес с долей кликов не ниже равномерной (без унаследованных отзывов): их продажи — реалистичный старт, их отзывы — планка; reviews — срок до планки",
      salesPer1pctClicks: R.entry.salesPerClickPct.ok ? { median: r2(R.entry.salesPerClickPct.median), p25: r2(R.entry.salesPerClickPct.p25), p75: r2(R.entry.salesPerClickPct.p75), products: R.entry.salesPerClickPct.n } : { unavailable: R.entry.salesPerClickPct.reason },
      reach: R.entry.reach.ok ? { targetUnitsMonthly: R.entry.reach.targetMonthly, requiredClickShare: r3(R.entry.reach.requiredShare), range: [r3(R.entry.reach.requiredLow), r3(R.entry.reach.requiredHigh)], productsWithSuchShare: R.entry.reach.productsWithShare, productsTotal: R.entry.reach.productsTotal,
        leaderShare: r3(R.entry.reach.leaderShare), bestNewcomerShare: r3(R.entry.reach.bestNewcomerShare), status: R.entry.reach.status, preliminary: true, comment: R.entry.reach.note, okUpToUnitsPerDay: r2(R.entry.reach.okUpToPerDay) } : { unavailable: R.entry.reach.reason },
      newEntrants: R.entry.cohort.ok ? { count: R.entry.cohort.size, ofProducts: R.entry.cohort.population, excluded: R.entry.cohort.excluded, salesMedianMonthly: r2(R.entry.cohort.salesMedian), salesRange: [r2(R.entry.cohort.salesP25), r2(R.entry.cohort.salesP75)],
        reviewsMedian: r2(R.entry.cohort.reviewsMedian), reviewsKind: R.entry.cohort.reviewsSource === "poe" ? "только отзывы с текстом (POE)" : "все оценки (Xray)", clickShareMedian: r3(R.entry.cohort.shareMedian),
        top: R.entry.cohort.members.slice(0, 6).map((m) => ({ asin: m.asin, brand: m.brand, ageMonths: m.ageMonths, clickShare: r3(m.share), salesMonthly: m.sales, reviews: m.reviews })) } : { unavailable: R.entry.cohort.reason },
      reviews: R.entry.reviews.ok ? { threshold: r2(R.entry.reviews.threshold), thresholdFrom: R.entry.reviews.thresholdFrom, leaderReviews: R.entry.reviews.leaderReviews, reviewRate: R.entry.reviews.reviewRate, reviewRateIsAssumption: R.entry.reviews.reviewRateAssumed, vineReviews: R.entry.reviews.vineReviews,
        monthsAtTargetSales: r2(R.entry.reviews.atTarget?.months), monthsAtNewcomerSales: r2(R.entry.reviews.atCohort?.months) } : null,
    } : null,
    // Деньги по месяцам (spec 005): стоп-вопрос о бюджете оценивается по peakInvestment.
    cashflow: R.cashflow && !R.cashflow.pending ? { peakInvestment: r2(R.cashflow.peak), peakMonth: R.cashflow.peakMonth, batches: R.cashflow.batches, unitsPurchased: R.cashflow.unitsPurchased, paybackMonth: R.cashflow.paybackMonth, monthsModelled: R.cashflow.rows.length - 1,
      endBalance: r2(R.cashflow.endCum), stockValueAtEnd: r2(R.cashflow.stockValueEnd), stockoutMonths: R.cashflow.stockoutMonths, startSalesMonthly: r2(R.cashflow.startSales), startSource: R.cashflow.startSource, targetSalesMonthly: R.cashflow.targetMonthly,
      first90DaysByRampScenario: R.cashflow.first90 && { units: r2(R.cashflow.first90.units), revenue: r2(R.cashflow.first90.revenue), ads: r2(R.cashflow.first90.ads), profit: r2(R.cashflow.first90.profit), note: "те же 90 дней, что criterion2 2g–2i, но по сценарию разгона; criterion2 считает их на целевом уровне продаж" }, assumptions: R.cashflow.assumptions } : null,
    clickWeightedPrice: R.clickPrice ? { value: r2(R.clickPrice.value), simpleAvg: r2(R.clickPrice.simpleAvg), median: r2(R.clickPrice.median), myPriceGap: r3(R.clickPrice.myPriceGap), flags: R.clickPrice.flags, note: "цена ниши, взвешенная долей кликов (POE, средние за 360 дней)" } : null,
    borderline: (R.borderline?.items || []).slice(0, 10).map((i) => ({ metric: i.label, text: i.text })),
    regulatory: R.regulatory ? { note: R.regulatory.note, triggers: R.regulatory.triggers.map((t) => ({ agency: t.agency, kind: t.kind === "claim" ? "обещание в листингах (можно отказаться)" : "тип товара", title: t.title, meaning: t.meaning, words: t.words, inNicheName: t.where.head, titlesShare: r3(t.where.titleShare) })) } : null,
    dataNotes: (R.dataNotes || []).map((n) => n.text),
    topAsins: topAsins(agg, inp, R.priceBand),
    challenger: { active: R.challenger.active, greenCount: R.challenger.greenCount, mandatoryOk: R.challenger.mandatoryOk, pass: R.challenger.pass, gate4Discussed: R.challenger.gate4Discussed,
      items: Object.fromEntries(Object.entries(R.challenger.items).map(([k, v]) => [k, { title: v.title, status: v.status, kind: v.kind, note: v.note }])) },
    scorecard: { total: r2(R.scorecard.total), band: R.scorecard.band, weakest: R.scorecard.weakest, axes: Object.fromEntries(Object.entries(R.scorecard.axes).map(([k, a]) => [k, { score: r2(a.score), note: a.note }])) },
    rulesVerdict: R.verdict,
    gateStatuses: gateStatuses(R),
    reconciliation: R.reconciliation.map((x) => ({ metric: x.metric, a: { ...x.a, value: r2(x.a.value) }, b: { ...x.b, value: r2(x.b.value) }, deltaPct: r3(x.deltaPct), level: x.level })),
    checklist: inp.checklist, challengerUser: inp.challenger, canDifferentiate: inp.canDifferentiate,
    patentScan: analysis.patents ? { status: analysis.patents.status, summary: analysis.patents.summary, feature: analysis.patents.feature, top: (analysis.patents.items || []).slice(0, 6).map((x) => ({ number: x.number, risk: x.risk, expired: x.expired, claimed: x.claimed, overlap: x.overlap, designAround: x.designAround })) } : null,
    poe: agg.poe ? {
      mergedFrom: agg.poe.merged ? { note: "POE собран из нескольких ниш Amazon: товары и запросы учтены по одному разу, доли кликов пересчитаны от общих кликов; счётные показатели сложены (при общих товарах — верхняя оценка), средние взвешены по кликам ниш, значения «квартал/год назад» для долей топ-брендов и топ-товаров отсутствуют", niches: agg.poe.merged.niches.map((n) => ({ title: n.title, products: n.asins, weight: r3(n.weight) })), sharedProducts: agg.poe.merged.overlapAsins, sharedQueries: agg.poe.merged.overlapTerms, trends: agg.poe.merged.trendsFrom === "common" ? "сложены по общим неделям" : "взяты по самой крупной нише" } : null,
      summary: agg.poe.nicheSummary, launchPotential: pick(agg.poe.launchPotential, ["productCount", "brandCount", "sellingPartnerCount", "newProductsLaunchedT360", "successfulLaunchesT360", "avgReviewCount", "avgReviewRating", "sponsoredProductsPercentage", "top5BrandsClickShareT360", "top20ProductsClickShareT360", "avgProductPrice", "avgOOSRate"]),
      terms: agg.poe.searchTermMetrics.slice(0, 20).map((t) => ({ term: t.term, svT360: t.svT360, growthYoy: r3(t.growthT360Yoy), conv: r3(t.convT360), clickShare: r3(t.clickShareT360), topClicked: t.topClicked.map((x) => x.asin) })),
      reviews: { negative: agg.poe.pdr.negative, positive: agg.poe.pdr.positive, returns: agg.poe.pdr.returns },
      insights: Object.fromEntries(Object.entries(agg.poe.insights || {}).map(([k, v]) => [k, String(v).slice(0, 1200)])),
    } : null,
    sqp: agg.sqp ? agg.sqp.rows.slice(0, 15).map((q) => ({ query: q.query, volume: q.volume, purchaseRate: r3(q.purchaseRate) })) : null,
  };
  return payload;
}

function topAsins(agg, inp, band) {
  const keep = (a) => !band?.active || inBand(a.price, band);
  const my = new Set((inp.myAsins || []).map((s) => s.toUpperCase()));
  if (agg.xray?.asins?.length) {
    return agg.xray.asins.filter(keep).sort((a, b) => (b.asinRevenue ?? 0) - (a.asinRevenue ?? 0)).slice(0, 20)
      .map((a) => ({ asin: a.asin, brand: a.brand, title: a.title.slice(0, 90), price: a.price, revenue: r2(a.asinRevenue), sales: a.asinSales, reviews: a.reviews, rating: a.rating, created: a.creationDate, mine: my.has(a.asin) || (inp.myBrand && a.brand.toLowerCase() === inp.myBrand.toLowerCase()) }));
  }
  if (agg.poe?.asinMetrics?.length) {
    return agg.poe.asinMetrics.filter(keep).slice(0, 20).map((a) => ({ asin: a.asin, brand: a.brand, title: a.title.slice(0, 90), price: r2(a.price), clickShare: r3(a.clickShareT360), reviews: a.reviews, rating: a.rating, launched: a.launchDate, mine: my.has(a.asin) || (inp.myBrand && a.brand.toLowerCase() === inp.myBrand.toLowerCase()) }));
  }
  return [];
}
function pick(o, keys) { const out = {}; for (const k of keys) if (o && o[k]) out[k] = o[k]; return out; }
