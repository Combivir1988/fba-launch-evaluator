// Оркестратор: Analysis → Results. Чистая функция, одинаковая в браузере и тестах.
import { mergeThresholds } from "./thresholds.js";
import { competition, priceSegments } from "./competition.js";
import { traffic } from "./traffic.js";
import { criterion1, summarizeCriterion1 } from "./criterion1.js";
import { applyPriceBand, wholeNicheRef } from "./price-band.js";
import { cvrHint } from "./cvr-hint.js";
import { economics } from "./economics.js";
import { budget } from "./budget.js";
import { challenger } from "./challenger.js";
import { scorecard } from "./scorecard.js";
import { gate0, verdictCeiling } from "./verdict-rules.js";
import { relDelta } from "./num.js";
import { entryFeasibility, clickWeightedPrice, poeDataNotes } from "./entry.js";
import { cashflow } from "./cashflow.js";
import { borderline } from "./borderline.js";
import { regulatoryTriggers } from "./regulatory.js";
import { configStats } from "./config-stats.js";
import { configScope } from "./config-scope.js";
import { amazonPresence } from "./amazon.js";
import { promoStats } from "./promo-stats.js";
import { priceByConfig } from "./price-config.js";

export function compute(analysis) {
  const th = mergeThresholds(analysis.thresholds);
  const inputs = { ...analysis.inputs, coreKeyword: analysis.coreKeyword };
  const agg = analysis.aggregates || {};
  let p = { xray: agg.xray || null, cerebro: agg.cerebro || null, poe: agg.poe || null, sqp: agg.sqp || null, inputs, thresholds: th, patents: analysis.patents || null };

  // Ценовой диапазон (spec 003): конкуренция считается по «виду» — листингам коридора; спрос, уровень данных, сегменты цен и размер рынка (1a) — по всей нише.
  const whole = p;
  const bandRes = applyPriceBand(whole);
  const band = bandRes.summary;
  if (band.active) p = { ...whole, xray: bandRes.view.xray, poe: bandRes.view.poe };
  p.competition = competition(p);
  // Amazon как продавец (spec 012): область по порогу; 1e, scorecard и чеклист смотрят туда же, куда и вердикт
  const compAll = band.active ? competition(whole) : p.competition;
  const amazon = amazonPresence({ whole: compAll, band: band.active ? p.competition : null, th: th.amazon, bandLabel: band.label });
  p.competition = { ...p.competition, amazonSells: amazon.present, amazonSellsSource: amazon.source };
  p.traffic = traffic(whole);
  p.criterion1 = criterion1(p);
  if (band.active) {
    const c1All = criterion1({ ...whole, competition: compAll, traffic: p.traffic });
    const items = { ...p.criterion1.items };
    items["1a"] = { ...c1All.items["1a"], bandValue: band.source === "xray" ? band.revenueBand : null, bandShare: band.revenueShare };
    for (const k of ["1b", "1d", "1e", "1f"]) { items[k] = { ...items[k], inBand: true }; if (band.sample === "insufficient" && items[k].source !== "manual") items[k].note = `в диапазоне ${band.label} меньше ${th.priceBand.minSample} листингов — показатель не считается`; }
    for (const k of ["1c", "1g", "1h"]) items[k] = c1All.items[k]; // спрос от цены не зависит
    p.criterion1 = summarizeCriterion1(items, th.criterion1);
    band.whole = { ...wholeNicheRef(compAll, c1All.items["1b"].value), revenue: c1All.items["1a"].value };
  }
  // Подсказка CVR (клик → покупка): конверсия клика ниши из POE и/или SQP. Значение по умолчанию (10 %) — допущение; подсказка сама ничего не меняет.
  const hint = cvrHint({ sqp: whole.sqp, poe: whole.poe }, { coreKeyword: analysis.coreKeyword, clusterKeywords: inputs.clusterKeywords || [], realistic: th.economics.cvrRealistic });
  if (hint) {
    const h = hint, pc = (v) => (v * 100).toFixed(1).replace(".", ",") + " %"; const parts = [];
    if (h.niche) parts.push(`конверсия клика ниши по POE ${pc(h.niche.cvr)}`);
    if (h.market) parts.push(`SQP ${h.scopeLabel}: рынок ${pc(h.market.cvr)}${h.mine ? `, ваш ASIN ${pc(h.mine.cvr)}` : ""}`);
    h.note = "по данным: " + parts.join("; ");
  }
  const dataCvr = hint?.market?.cvr ?? hint?.niche?.cvr ?? null, dataCvrLabel = hint?.market ? "рынок по SQP" : hint?.niche ? "конверсия клика ниши по POE" : null;
  // цена по умолчанию = медиана 1b, CPC по умолчанию = bid core-ключа
  const price = inputs.price ?? p.criterion1.items["1b"].value ?? null;
  const cpcFromCerebro = inputs.cpc === null || inputs.cpc === undefined || inputs.cpc === "";
  const cpc = cpcFromCerebro ? p.traffic.cpcCore : inputs.cpc;
  p.economics = economics({ ...inputs, price, cpc }, th, { priceMedian: p.criterion1.items["1b"].value, cpcFromCerebro: cpcFromCerebro && p.traffic.cpcCore !== null, dataCvr, dataCvrLabel });
  // Вход в нишу (spec 005): трафик, новички и отзывы — по ВСЕЙ нише. Опорная дата возраста листингов — дата снятия POE (анализ, открытый через год, покажет те же возрасты).
  const compWhole = band.active ? compAll : p.competition;
  const refDate = new Date(whole.poe?.meta?.capturedAt || analysis.createdAt || Date.now());
  p.entry = entryFeasibility(whole, { refDate: Number.isNaN(refDate.getTime()) ? new Date() : refDate, nicheReviewMedian: compWhole.reviewBarrier?.median ?? null, leaderReviews: compWhole.reviewBarrier?.leaderReviews ?? null });
  p.cashflow = cashflow({ ...inputs, price, cpc }, th, { cohortSalesMedian: p.entry.cohort.ok ? p.entry.cohort.salesMedian : null, reviewThreshold: p.entry.reviews.threshold });
  p.budget = budget({ ...inputs, price }, th, { cash: p.cashflow, roi: p.economics.roi, revenueStatus: p.criterion1.items["1a"].status, revenueMonthly: p.criterion1.items["1a"].value, revenueSource: p.criterion1.items["1a"].source });
  // Промо по нише (spec 014): если чеклист «Купоны/дилы» не заполнен вручную — берём из промо листингов этапа 2
  const promo = analysis.config?.table ? promoStats(agg.listings, whole.xray?.asins, Object.keys(analysis.config.table.rows)) : null;
  if (promo?.saturation && (inputs.checklist?.couponsDealsSaturation ?? "unknown") === "unknown") { p.inputs = { ...p.inputs, checklist: { ...p.inputs.checklist, couponsDealsSaturation: promo.saturation } }; promo.appliedToChecklist = true; }
  p.challenger = challenger(p);
  p.scorecard = scorecard(p);
  const g0 = gate0(whole);
  const results = {
    gate0: g0, criterion1: p.criterion1, economics: p.economics, budget: p.budget, traffic: p.traffic, competition: p.competition,
    priceSegments: priceSegments({ ...whole, priceBand: band }), priceBand: band, challenger: p.challenger, scorecard: p.scorecard,
    effective: { price, cpc, cpcFromCerebro: cpcFromCerebro && p.traffic.cpcCore !== null, cpcSource: cpcFromCerebro ? p.traffic.cpcSource : "введено вручную", priceFromMedian: (inputs.price === null || inputs.price === undefined || inputs.price === "") && price !== null },
    reconciliation: reconciliation(p), cvrHint: hint,
    entry: p.entry, cashflow: p.cashflow,
    clickPrice: clickWeightedPrice(whole.poe, { priceMedian: (band.active ? band.whole?.priceMedian : null) ?? p.criterion1.items["1b"].value, myPrice: price, band }, th.entry),
    regulatory: regulatoryTriggers({ niche: analysis.niche, coreKeyword: analysis.coreKeyword, xray: whole.xray, poe: whole.poe, cerebro: whole.cerebro }),
    dataNotes: poeDataNotes(whole.xray, whole.poe, th.entry),
    amazon,
  };
  results.config = configStats(analysis.config, whole.xray, { band, th: th.config }); // этап 2 (spec 010): null, пока таблица характеристик не извлечена
  if (results.config) { results.config.promo = promo; results.priceConfig = priceByConfig({ config: analysis.config, stats: results.config.whole, xray: whole.xray, listings: agg.listings || {}, choice: analysis.config.priceChoice || {}, inputs, th: { minAnalogs: th.config.minAnalogs, marginMin: th.economics.marginMin } }); } else results.priceConfig = null; // spec 013/014
  if (whole.xray?.asins?.length) { const sc = configScope(analysis, th); results.configScope = { count: sc.asins.length, total: sc.total, excluded: sc.excluded, capped: sc.capped }; } else results.configScope = null;
  results.borderline = borderline(results, th);
  results.verdict = verdictCeiling(results);
  results.computedAt = new Date().toISOString();
  results.methodologyVersion = th.methodologyVersion || analysis.methodologyVersion;
  return results;
}

/** Сверка источников (Xray/Cerebro vs POE): <10 % шум, 10–30 % погранично, >30 % конфликт. */
function reconciliation(p) {
  const th = p.thresholds.reconciliation;
  const out = [];
  const push = (metric, a, b) => {
    if (typeof a.value !== "number" || typeof b.value !== "number") return;
    const d = relDelta(a.value, b.value);
    out.push({ metric, a, b, deltaPct: d, level: d < th.noise ? "noise" : d < th.borderline ? "borderline" : "conflict" });
  };
  const c1 = p.criterion1.items;
  if (c1["1a"].source === "xray" && typeof c1["1a"].proxyValue === "number") push("Выручка ниши, $/мес", { src: "Xray", value: c1["1a"].value }, { src: "POE прокси", value: c1["1a"].proxyValue });
  if (c1["1f"].source === "xray" && typeof c1["1f"].proxyValue === "number") push("Top-5 брендов, доля", { src: "Xray revenue", value: c1["1f"].value }, { src: "POE click share", value: c1["1f"].proxyValue });
  if (c1["1b"].source === "xray" && typeof p.poe?.nicheSummary?.avgPrice === "number") push("Средняя цена, $", { src: "Xray медиана", value: c1["1b"].value }, { src: "POE avgPrice", value: p.poe.nicheSummary.avgPrice });
  if (p.traffic.source === "cerebro" && p.poe?.searchTermMetrics?.length) push("SV главного ключа, /мес", { src: "Cerebro", value: p.traffic.svCore }, { src: "POE T360/12", value: (p.poe.searchTermMetrics[0].svT360 ?? 0) / 12 });
  if (p.competition.source === "xray" && typeof p.poe?.launchPotential?.avgReviewCount?.current === "number") push("Среднее отзывов", { src: "Xray", value: p.competition.reviewBarrier.avg }, { src: "POE", value: p.poe.launchPotential.avgReviewCount.current });
  return out;
}
