// Пороги методологии (SKILL.md fba-launch-evaluator + курс «Выбор товара на Amazon»).
// Это ДАННЫЕ, не код: редактируются в UI (панель «Пороги») и сохраняются в анализе.

export const METHODOLOGY_VERSION = "2026-09-17";

export const DEFAULT_THRESHOLDS = {
  criterion1: {
    passCount: 6,                       // минимум зелёных из 8
    nicheRevenueMonthly: 500_000,       // 1a, $/мес
    priceOk: 30, priceWarn: 25,         // 1b, $
    adjSv: 3000,                        // 1c, /мес
    reviewsOk: 300, reviewsFail: 1000,  // 1d
    topBrandShare: 0.25,                // 1e
    top5Ok: 0.45, top5Fail: 0.65,       // 1f
    seasonOk: 0.30, seasonFail: 0.50,   // 1g, просадка
    launchOk: 0.30, launchFail: 0.10,   // 1h, успешность запусков
    provenReviews: 100,                 // «проверенный» конкурент для медианы цены
    minTrendWeeks: 8,                   // меньше — «недостаточно истории»
  },
  economics: {
    marginMin: 0.30, profitMin: 15, cheapPrice: 25, cheapMarginMin: 0.40, // Gate 1
    cvrGrid: [0.08, 0.10, 0.12, 0.15], cvrPassMax: 0.12,                   // Gate 2
    roiOk: 1.5, roiLoss: 1.0, roiSuspicious: 2.0,                           // урок 07/10
    c2PassCount: 8, roiAdsMin: 0.20, marginAdsMin: 0.25,                    // 2j / 2k
    cvrRealistic: [0.08, 0.15], ppcShareRealistic: [0.5, 0.9],             // 2c / 2e
    periodDays: 90,                                                         // горизонт 2g–2k
  },
  budget: { receivingDays: 15, batches: 2 },                                // урок 08
  traffic: { top2ShareMax: 0.80, relevantMin: 30, minSv: 100, groupsMin: 3 }, // урок 09
  poe: { searchConvLow: 0.01, sponsoredHigh: 0.80, top20ProductsHigh: 0.70 },  // урок 11
  challenger: {
    activateTopBrand: 0.25, passCount: 6,
    loyaltyOk: 0.05, loyaltyFail: 0.15,             // критерий 3
    leaderRatingSafe: 4.6, complaintMinPct: 15,     // критерий 4
    playersMin: 3, playerShareMin: 0.10, top5Ok: 0.30, top5Fail: 0.65, // критерий 5
  },
  reviewsMoat: { breakable: 500, medium: 2000 },   // ров отзывов лидера
  scorecard: {
    weights: { market: 0.25, competition: 0.25, economics: 0.25, brandFit: 0.15, opRisk: 0.10 },
    bands: { goPriority: 80, go: 60, rework: 40 },
  },
  reconciliation: { noise: 0.10, borderline: 0.30 }, // сверка источников
  checklist: { designTestMin: 30, lifecycleMonthsMin: 25, listingsHigh: 3000 },
};

/** Глубокое слияние пользовательских порогов с дефолтами. */
export function mergeThresholds(custom) {
  const out = structuredClone(DEFAULT_THRESHOLDS);
  if (!custom || typeof custom !== "object") return out;
  for (const [k, v] of Object.entries(custom)) {
    if (v && typeof v === "object" && !Array.isArray(v) && out[k]) Object.assign(out[k], v);
    else if (v !== undefined) out[k] = v;
  }
  return out;
}
