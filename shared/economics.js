// Экономика: Gate 1 (без рекламы), Gate 2 (стресс-тест рекламы), ROI, Критерий 2 (2a–2k).
// Критерий 2 заполняется ТОЛЬКО из введённых менеджером чисел (COGS обязателен) — никогда из AI.
import { safeDiv, round } from "./num.js";

const st3 = (ok, warn) => (ok ? "ok" : warn ? "warn" : "fail");

export function economics(inputs, th, ctx = {}) {
  const e = th.economics;
  const price = num(inputs.price), cogs = num(inputs.cogs), ship = num(inputs.shippingPerUnit) ?? 0,
    referral = num(inputs.referralPct) ?? 0.15, fba = num(inputs.fbaFee) ?? 0, cpc = num(inputs.cpc),
    cvr = num(inputs.cvr) ?? 0.10, ppc = num(inputs.ppcShare) ?? 0.70, unitsPerDay = num(inputs.unitsPerDay) ?? 0;
  const pending = price === null || price <= 0 || cogs === null;
  const out = { pending, price, cogs, gate1: null, gate2: null, roi: null, criterion2: null, marginNoAds: null, marginWithAds: null, breakEvenCvr: null, cheapSegment: price !== null && price < e.cheapPrice };
  if (pending) {
    out.criterion2 = Object.fromEntries(["2a","2b","2c","2d","2e","2f","2g","2h","2i","2j","2k"].map((k) => [k, { status: "pending", value: null }]));
    out.gate1 = { status: "pending" }; out.gate2 = { status: "pending", byCvr: [] };
    return out;
  }
  const landed = cogs + ship;
  const net0 = price - cogs - ship - price * referral - fba;
  const margin0 = net0 / price;
  const roi = safeDiv(net0, landed);
  out.marginNoAds = margin0; out.roi = roi;

  // Gate 1
  const condMargin = margin0 > e.marginMin;
  const condProfit = net0 > e.profitMin || (out.cheapSegment && margin0 > e.cheapMarginMin);
  out.gate1 = { net0, margin0, roi, landed, condMargin, condProfit, status: condMargin && condProfit ? "pass" : condMargin || condProfit ? "rework" : "no_go",
    note: out.cheapSegment ? "Сегмент < $25: применяется поправка (маржа > 40 % вместо $15/юнит)" : null };

  // Gate 2
  const grid = cpc !== null ? e.cvrGrid.map((c) => { const adCost = cpc / c; const net = net0 - adCost * ppc; return { cvr: c, adCost, net, acos: safeDiv(adCost * ppc, price) }; }) : [];
  const atCvr = cpc !== null ? { cvr, adCost: cpc / cvr, net: net0 - (cpc / cvr) * ppc, acos: safeDiv((cpc / cvr) * ppc, price) } : null;
  let g2 = "pending";
  if (cpc !== null) {
    const passRow = grid.find((r) => Math.abs(r.cvr - e.cvrPassMax) < 1e-9) || grid[grid.length - 2];
    const lastRow = grid[grid.length - 1];
    g2 = passRow.net > 0 ? "pass" : lastRow.net > 0 ? "rework" : "no_go";
  }
  out.breakEvenCvr = cpc !== null && net0 > 0 ? (cpc * ppc) / net0 : null;
  out.gate2 = { status: g2, byCvr: grid, atCvr, cpc, ppcShare: ppc, breakEvenCvr: out.breakEvenCvr };

  // Критерий 2 (горизонт periodDays)
  const days = e.periodDays;
  const units = unitsPerDay * days;
  const adCostUnit = atCvr ? atCvr.adCost * ppc : 0;
  const adSpend = units * adCostUnit;
  const revenue = units * price;
  const netUnitAds = net0 - adCostUnit;
  const totalProfit = units * netUnitAds;
  const invested = units * landed + adSpend;
  const roiAds = safeDiv(totalProfit, invested);
  const marginAds = safeDiv(totalProfit, revenue);
  out.marginWithAds = marginAds;
  const medianPrice = ctx.priceMedian ?? null;
  const priceFit = medianPrice ? Math.abs(price - medianPrice) / medianPrice <= 0.3 : null;
  const c2 = {
    "2a": { value: price, status: priceFit === null ? "warn" : priceFit ? "ok" : "fail", note: medianPrice ? `медиана проверенных конкурентов $${round(medianPrice, 2)}` : "медиана ниши неизвестна" },
    "2b": { value: cogs, status: inputs.cogsConfirmed ? "ok" : "warn", note: inputs.cogsConfirmed ? "подтверждено поставщиком" : "оценка — подтвердите котировкой" },
    "2c": cvrItem(cvr, e, ctx),
    "2d": { value: cpc, status: cpc === null ? "pending" : ctx.cpcFromCerebro ? "ok" : "warn", note: ctx.cpcFromCerebro ? "из Cerebro (Sugg. Bid)" : "введено вручную" },
    "2e": { value: ppc, status: st3(ppc >= e.ppcShareRealistic[0] && ppc <= e.ppcShareRealistic[1], ppc < e.ppcShareRealistic[0] && ppc > 0.3), note: "70/30 в пользу PPC типично на старте" },
    "2f": { value: netUnitAds, status: cpc === null ? "pending" : netUnitAds > 0 ? "ok" : "fail", note: "чистая прибыль/юнит с рекламой (= Gate 2 при текущем CVR)" },
    "2g": { value: adSpend, status: cpc === null ? "pending" : inputs.adsReserve && adSpend > num(inputs.adsReserve) * (days / 30) ? "warn" : "ok", note: `реклама за ${days} дн.` },
    "2h": { value: revenue, status: units > 0 ? "ok" : "warn", note: `выручка за ${days} дн. при ${unitsPerDay} шт/день` },
    "2i": { value: totalProfit, status: cpc === null ? "pending" : totalProfit > 0 ? "ok" : "fail", note: `прибыль за ${days} дн.` },
    "2j": { value: roiAds, status: cpc === null ? "pending" : roiAds !== null && roiAds >= e.roiAdsMin ? "ok" : roiAds !== null && roiAds > 0 ? "warn" : "fail", note: `ROI с рекламой, порог ≥ ${Math.round(e.roiAdsMin * 100)} %` },
    "2k": { value: marginAds, status: cpc === null ? "pending" : marginAds !== null && marginAds >= e.marginAdsMin ? "ok" : "fail", note: `маржинальность с рекламой, порог ≥ ${Math.round(e.marginAdsMin * 100)} %` },
  };
  const okCount = Object.values(c2).filter((x) => x.status === "ok").length;
  const mandatoryOk = ["2f", "2j", "2k"].every((k) => c2[k].status === "ok");
  const anyPending = Object.values(c2).some((x) => x.status === "pending");
  out.criterion2 = c2;
  out.criterion2Summary = { okCount, total: 11, mandatoryOk, pass: !anyPending && okCount >= e.c2PassCount && mandatoryOk, pending: anyPending, period: { days, units, adSpend, revenue, totalProfit, roiAds, marginAds } };
  // ROI-подсказки
  out.roiHint = roi === null ? null : roi > e.roiSuspicious ? "suspicious" : roi >= e.roiOk ? "ok" : roi >= e.roiLoss ? "low" : "loss";
  return out;
}

/** 2c: 8–15 % — норма для нового листинга; ниже — осторожно; выше — оптимистично, но не ошибка: если данные ниши (POE / SQP) дают не меньше, статус OK. */
function cvrItem(cvr, e, ctx) {
  const [lo, hi] = e.cvrRealistic; const pc = (v) => (v * 100).toFixed(1).replace(".", ",") + " %";
  if (cvr < lo) return { value: cvr, status: "warn", note: "8–15 % реалистично для нового листинга" };
  if (cvr <= hi) return { value: cvr, status: "ok", note: "8–15 % реалистично для нового листинга" };
  const data = typeof ctx.dataCvr === "number" && ctx.dataCvr > 0 ? ctx.dataCvr : null;
  if (data !== null && data >= cvr * 0.8) return { value: cvr, status: "ok", note: `выше типичных 8–15 % для нового листинга, но подтверждено данными: ${ctx.dataCvrLabel || "конверсия ниши"} ${pc(data)}; у листинга без отзывов на старте обычно ниже` };
  return { value: cvr, status: "warn", note: `выше типичных 8–15 % для нового листинга${data !== null ? ` и выше данных ниши (${pc(data)})` : " и данными не подтверждено"} — оптимистично, проверьте` };
}
function num(v) { return v === null || v === undefined || v === "" || Number.isNaN(Number(v)) ? null : Number(v); }
