// Распределение трафика (урок 09), Adj. SV (SKILL), концентрация кликов POE (урок 11).
import { sum, safeDiv, median } from "./num.js";
import { tokens } from "./parse-cerebro.js";

export function traffic(p) {
  const { cerebro, poe, inputs, thresholds: th } = p;
  const out = { source: null, svCore: null, adjSv: null, clusterSv: null, clusterCount: 0, top2Share: null, relevantCount: null, groups: null,
    status: "na", cluster: [], cpcCore: null, poeConcentration: null, brandedShare: null };

  if (cerebro?.keywords?.length) {
    const selected = new Set((inputs.clusterKeywords || []).map((s) => s.toLowerCase()));
    const core = String(inputs.coreKeyword || "").toLowerCase().trim();
    const cluster = cerebro.keywords.filter((k) => selected.has(k.phrase.toLowerCase()) || k.phrase.toLowerCase() === core);
    const coreRow = cluster.find((k) => k.phrase.toLowerCase() === core) || cluster[0];
    if (cluster.length) {
      out.source = "cerebro";
      out.svCore = coreRow?.sv ?? 0;
      const bids5 = [...cluster].sort((a, b) => b.sv - a.sv).slice(0, 5).map((k) => k.bid).filter((b) => typeof b === "number");
      out.cpcCore = coreRow?.bid ?? median(bids5);
      out.cpcSource = coreRow?.bid != null ? `Sugg. Bid «${coreRow.phrase}»` : bids5.length ? "медиана Sugg. Bid топ-5 ключей кластера" : null;
      const others = cluster.filter((k) => k !== coreRow);
      out.adjSv = out.svCore + 0.4 * sum(others.map((k) => k.sv));
      out.clusterSv = sum(cluster.map((k) => k.sv));
      out.clusterCount = cluster.length;
      const sorted = [...cluster].sort((a, b) => b.sv - a.sv);
      out.top2Share = safeDiv(sum(sorted.slice(0, 2).map((k) => k.sv)), out.clusterSv);
      const minSv = inputs.clusterMinSv ?? th.traffic.minSv;
      out.minSv = minSv; out.multiAsin = cerebro.flags?.multiAsin ?? false;
      out.relevantCount = cluster.filter((k) => k.sv >= minSv).length;
      // группы = по «головному» слову фразы (последний токен)
      const g = new Map();
      for (const k of cluster) { const t = tokens(k.phrase); const head = t[t.length - 1] || k.phrase; g.set(head, (g.get(head) || 0) + k.sv); }
      out.groups = [...g.entries()].filter(([, sv]) => sv / (out.clusterSv || 1) >= 0.05).length;
      out.cluster = sorted.slice(0, 60).map((k) => ({ phrase: k.phrase, sv: k.sv, svTrend: k.svTrend, bid: k.bid, competingProducts: k.competingProducts, competingIsBound: k.competingIsBound, abaClickShare: k.abaClickShare, relevance: k.relevance, keywordSales: k.keywordSales, rankingCompetitors: k.rankingCompetitors, competitorRankAvg: k.competitorRankAvg, cpr: k.cpr }));
      out.clusterSales = sum(cluster.map((k) => k.keywordSales));
      const bad = (out.top2Share !== null && out.top2Share > th.traffic.top2ShareMax) || (out.relevantCount < th.traffic.relevantMin) || (out.groups < th.traffic.groupsMin);
      const good = out.top2Share !== null && out.top2Share <= th.traffic.top2ShareMax && out.relevantCount >= th.traffic.relevantMin && out.groups >= th.traffic.groupsMin;
      out.status = good ? "ok" : bad && out.top2Share > th.traffic.top2ShareMax ? "fail" : "warn";
    }
  }
  if (!out.source && poe?.searchTermMetrics?.length) {
    out.source = "poe";
    const terms = poe.searchTermMetrics;
    const total = sum(terms.map((t) => t.svT360));
    out.svCore = (terms[0]?.svT360 ?? 0) / 12;
    out.adjSv = out.svCore + 0.4 * sum(terms.slice(1).map((t) => (t.svT360 ?? 0) / 12));
    out.clusterSv = total / 12; out.clusterCount = terms.length;
    out.top2Share = safeDiv(sum(terms.slice(0, 2).map((t) => t.svT360)), total);
    out.relevantCount = terms.length; out.groups = null;
    out.cluster = terms.slice(0, 40).map((t) => ({ phrase: t.term, sv: Math.round((t.svT360 ?? 0) / 12), svTrend: t.growthT360Yoy !== null ? t.growthT360Yoy * 100 : null, bid: null, competingProducts: null, abaClickShare: t.clickShareT360, conv: t.convT360 }));
    out.status = out.top2Share !== null && out.top2Share > th.traffic.top2ShareMax ? "warn" : "ok";
  }
  if (poe) {
    const lp = poe.launchPotential || {};
    const terms = poe.searchTermMetrics || [];
    const totalSv = sum(terms.map((t) => t.svT360)) || 1;
    const conv = terms.length ? sum(terms.map((t) => (t.convT360 ?? 0) * (t.svT360 ?? 0))) / totalSv : null;
    const sponsored = lp.sponsoredProductsPercentageT360?.current ?? lp.sponsoredProductsPercentage?.current ?? null;
    out.poeConcentration = {
      top5Brands: lp.top5BrandsClickShareT360?.current ?? null, top20Brands: lp.top20BrandsClickShareT360?.current ?? null,
      top5Products: lp.top5ProductsClickShareT360?.current ?? null, top20Products: lp.top20ProductsClickShareT360?.current ?? null,
      sponsoredPct: sponsored, searchConv: conv, returnRate: poe.nicheSummary?.returnRateT360 ?? null,
      svGrowthT360: poe.nicheSummary?.searchVolumeGrowthT360 ?? null, svGrowthT90: poe.nicheSummary?.searchVolumeGrowthT90 ?? null,
      flags: {
        unmetDemand: conv !== null && conv < th.poe.searchConvLow,
        adWar: sponsored !== null && sponsored > th.poe.sponsoredHigh,
        top20Heavy: (lp.top20ProductsClickShareT360?.current ?? 0) > th.poe.top20ProductsHigh,
      },
    };
  }
  return out;
}

/** Критерий 3: Brand Loyalty = SV(бренд + core) / SV(core). */
export function brandLoyalty(cerebro, brand, svCore) {
  if (!cerebro?.keywords?.length || !brand || !svCore) return null;
  const b = brand.toLowerCase();
  const brandedSv = sum(cerebro.keywords.filter((k) => !k.isAsin && k.phrase.toLowerCase().includes(b)).map((k) => k.sv));
  return { brandedSv, ratio: brandedSv / svCore };
}
