// Разбор POE JSON (schemaVersion 1, расширение POE Analyzer / POE Collector):
// data.niche.{nicheSummary, launchPotential, asinMetrics, searchTermMetrics, trendsMetrics, nichePdr} + insights.*
import { toNum } from "./num.js";

const n = (v) => toNum(v);

export function isPoeJson(obj) {
  return Boolean(obj && obj.data && obj.data.niche && (obj.data.niche.nicheSummary || obj.data.niche.asinMetrics));
}

function stats(o) {
  if (!o || typeof o !== "object") return null;
  return { current: n(o.currentValue), qoq: n(o.qoq), yoy: n(o.yoy) };
}

export function htmlToText(html, limit = 2000) {
  if (!html) return "";
  const t = String(html)
    .replace(/<\s*(br|p|li|h\d|tr|div)[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"')
    .replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").replace(/[ \t]{2,}/g, " ").trim();
  return t.length > limit ? t.slice(0, limit - 1) + "…" : t;
}

const INSIGHT_TABS = {
  OX_NICHE_MARKET_POTENTIAL_PROMPT: "market",
  OX_NICHE_PRODUCT_FEATURE_EXTRACTOR_PROMPT: "features",
  OX_NICHE_REVIEWS_ANALYZER_PROMPT: "reviews",
  OX_NICHE_CUSTOMER_DEMOGRAPHICS_PROMPT: "demographics",
  OX_NICHE_SEARCH_TERMS_PROMPT: "searchTerms",
  OX_NICHE_PRICING_ANALYSIS_PROMPT: "pricing",
};

export function parsePoe(obj) {
  if (!isPoeJson(obj)) throw new Error("Это не POE JSON (нет data.niche)");
  const niche = obj.data.niche;
  const s = niche.nicheSummary || {};
  const lp = niche.launchPotential || {};
  const meta = obj.meta || {};

  const nicheSummary = {
    avgPrice: n(s.avgPrice ?? s.avgPriceT360), minPrice: n(s.minimumPrice), maxPrice: n(s.maximumPrice),
    productCount: n(s.productCount),
    searchVolumeT360: n(s.searchVolumeT360), searchVolumeT90: n(s.searchVolumeT90),
    searchVolumeGrowthT360: n(s.searchVolumeGrowthT360), searchVolumeGrowthT180: n(s.searchVolumeGrowthT180), searchVolumeGrowthT90: n(s.searchVolumeGrowthT90),
    minUnitsT360: n(s.minimumUnitsSoldT360), maxUnitsT360: n(s.maximumUnitsSoldT360),
    minUnitsT90: n(s.minimumUnitsSoldT90), maxUnitsT90: n(s.maximumUnitsSoldT90),
    minAvgUnitsT360: n(s.minimumAverageUnitsSoldT360), maxAvgUnitsT360: n(s.maximumAverageUnitsSoldT360),
    returnRateT360: n(s.returnRateT360),
  };

  const launchPotential = {};
  for (const [k, v] of Object.entries(lp)) if (k !== "__typename") launchPotential[k] = stats(v);

  const seenAsin = new Set();
  const asinMetrics = (niche.asinMetrics || []).filter((a) => { const id = String(a.asin || "").toUpperCase(); if (!id || seenAsin.has(id)) return false; seenAsin.add(id); return true; }).map((a) => ({
    asin: a.asin, brand: a.brand || "(без бренда)", title: a.asinTitle || "", imageUrl: a.asinImageUrl || null,
    price: n(a.avgPriceT360 ?? a.avgPrice), clickShareT360: n(a.clickShareT360), clickShareT90: n(a.clickShareT90),
    clickCountT360: n(a.clickCountT360), rating: n(a.customerRating), reviews: n(a.totalReviews),
    launchDate: a.launchDate || null, bsr: n(a.bestSellersRanking), sellers: n(a.avgSellerVendorCountT360 ?? a.avgSellerVendorCount),
    category: a.category || "",
  })).sort((a, b) => (b.clickShareT360 ?? 0) - (a.clickShareT360 ?? 0));

  const searchTermMetrics = (niche.searchTermMetrics || []).map((t) => ({
    term: t.searchTerm, svT360: n(t.searchVolumeT360), svT90: n(t.searchVolumeT90),
    growthT360Yoy: n(t.searchVolumeGrowthT360Yoy), growthT180: n(t.searchVolumeGrowthT180), qoq: n(t.searchVolumeQoq),
    clickShareT360: n(t.clickShareT360), convT360: n(t.searchConversionRateT360 ?? t.searchConversionRate),
    topClicked: (t.topClickedProducts || []).map((p) => ({ asin: p.asin, title: p.asinTitle || "" })),
  })).sort((a, b) => (b.svT360 ?? 0) - (a.svT360 ?? 0));

  const trends = (niche.trendsMetrics || []).map((t) => ({
    date: t.datasetDate, sv: n(t.searchVolumeT7), price: n(t.averagePriceT7 ?? t.avgSellingPriceT7),
    top5Brand: n(t.top5BrandClickShareT7), top20Brand: n(t.top20BrandClickShareT7),
    top5Prod: n(t.top5ProductsClickShareT7), top20Prod: n(t.top20ProductsClickShareT7),
    conv: n(t.searchConversionRateT7), productCount: n(t.productCount), brandCount: n(t.brandCountT7 ?? t.brandCount),
    sponsoredCount: n(t.sponsoredProductCountT7), newProductsT90: n(t.newProductCountT90), successT90: n(t.successLaunchProductCountT90),
    avgReviews: n(t.avgReviewCountOfProducts), avgRating: n(t.avgRatingsOfProducts), oos: n(t.avgOosRateT7),
  })).filter((t) => t.date).sort((a, b) => (a.date < b.date ? -1 : 1));

  const pdr = niche.nichePdr || {};
  const topic = (x) => ({ topic: x.topic || x.name, pct: n(x.percentOfMentions), verbatims: (x.verbatims || []).slice(0, 3) });
  const returns = (pdr.pdrTopics || [])
    .map((t) => ({ topic: t.name, pct: n(t.returnsInsights?.percentOfMentions) }))
    .filter((t) => t.pct !== null && t.pct > 0).sort((a, b) => b.pct - a.pct).slice(0, 10);

  const insights = {};
  for (const [pid, entry] of Object.entries(obj.insights || {})) {
    const key = INSIGHT_TABS[pid] || pid;
    insights[key] = htmlToText(entry?.html || "");
  }

  return {
    meta: {
      nicheId: niche.nicheId || meta.nicheId || null, nicheTitle: niche.nicheTitle || meta.nicheTitle || "",
      marketplaceId: niche.obfuscatedMarketplaceId || meta.obfuscatedMarketplaceId || null,
      capturedAt: meta.capturedAt || null, lastUpdated: niche.lastUpdatedTimeISO8601 || null, currency: niche.currency || "USD",
    },
    nicheSummary, launchPotential, asinMetrics, searchTermMetrics, trends,
    pdr: {
      negative: (pdr.negativeCustomerReviewInsights || []).map(topic).slice(0, 10),
      positive: (pdr.positiveCustomerReviewInsights || []).map(topic).slice(0, 10),
      returns,
    },
    insights,
  };
}

/** Оценка месячной выручки ниши по POE (прокси, систематически занижает — SKILL 1a). */
export function poeRevenueProxy(poe) {
  const s = poe?.nicheSummary; if (!s) return null;
  const units = (s.minUnitsT360 !== null && s.maxUnitsT360 !== null) ? (s.minUnitsT360 + s.maxUnitsT360) / 2 : (s.maxUnitsT360 ?? s.minUnitsT360);
  if (units === null || s.avgPrice === null) return null;
  return { monthly: units * s.avgPrice / 12, low: (s.minUnitsT360 ?? units) * s.avgPrice / 12, high: (s.maxUnitsT360 ?? units) * s.avgPrice / 12 };
}
