// Оркестратор: Analysis → Results. Чистая функция, одинаковая в браузере и тестах.
import { mergeThresholds } from "./thresholds.js";
import { competition, priceSegments } from "./competition.js";
import { traffic } from "./traffic.js";
import { criterion1 } from "./criterion1.js";
import { economics } from "./economics.js";
import { budget } from "./budget.js";
import { challenger } from "./challenger.js";
import { scorecard } from "./scorecard.js";
import { gate0, verdictCeiling } from "./verdict-rules.js";
import { relDelta } from "./num.js";

export function compute(analysis) {
  const th = mergeThresholds(analysis.thresholds);
  const inputs = { ...analysis.inputs, coreKeyword: analysis.coreKeyword };
  const agg = analysis.aggregates || {};
  const p = { xray: agg.xray || null, cerebro: agg.cerebro || null, poe: agg.poe || null, sqp: agg.sqp || null, inputs, thresholds: th };

  p.competition = competition(p);
  p.traffic = traffic(p);
  p.criterion1 = criterion1(p);
  // цена по умолчанию = медиана 1b, CPC по умолчанию = bid core-ключа
  const price = inputs.price ?? p.criterion1.items["1b"].value ?? null;
  const cpcFromCerebro = inputs.cpc === null || inputs.cpc === undefined || inputs.cpc === "";
  const cpc = cpcFromCerebro ? p.traffic.cpcCore : inputs.cpc;
  p.economics = economics({ ...inputs, price, cpc }, th, { priceMedian: p.criterion1.items["1b"].value, cpcFromCerebro: cpcFromCerebro && p.traffic.cpcCore !== null });
  p.budget = budget({ ...inputs, price }, th, { roi: p.economics.roi, revenueStatus: p.criterion1.items["1a"].status, revenueMonthly: p.criterion1.items["1a"].value, revenueSource: p.criterion1.items["1a"].source });
  p.challenger = challenger(p);
  p.scorecard = scorecard(p);
  const g0 = gate0(p);
  const results = {
    gate0: g0, criterion1: p.criterion1, economics: p.economics, budget: p.budget, traffic: p.traffic, competition: p.competition,
    priceSegments: priceSegments(p), challenger: p.challenger, scorecard: p.scorecard,
    effective: { price, cpc, cpcFromCerebro: cpcFromCerebro && p.traffic.cpcCore !== null },
    reconciliation: reconciliation(p),
  };
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
