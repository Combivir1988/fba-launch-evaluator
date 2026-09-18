// Критерий 1 — Рыночный контекст (1a–1h). Источник приоритетов: manual > xray/cerebro > poe (прокси).
// В счёт «N из 8» идут только чёткие OK; warn (в т.ч. пограничная цена) не засчитывается.
import { sum, median, relDelta, safeDiv } from "./num.js";
import { poeRevenueProxy } from "./parse-poe.js";

const item = (o) => ({ value: null, unit: "", threshold: "", status: "na", source: null, note: "", ...o });
const triage = (v, okFn, failFn) => (v === null || v === undefined || Number.isNaN(v) ? "na" : okFn(v) ? "ok" : failFn(v) ? "fail" : "warn");

export function criterion1(p) {
  const { xray, cerebro, poe, inputs, thresholds: th, competition: comp, traffic: tr } = p;
  const t = th.criterion1;
  const mo = inputs.manualOverrides || {};
  const items = {};

  // 1a — Niche Revenue
  {
    const it = item({ unit: "$/мес", threshold: `≥ $${fmtK(t.nicheRevenueMonthly)}/мес` });
    const proxy = poe ? poeRevenueProxy(poe) : null;
    if (xray?.asins?.length) {
      const ex = new Set((inputs.excludedBrands || []).map((b) => b.toLowerCase()));
      it.value = sum(xray.asins.filter((a) => !ex.has(a.brand.toLowerCase())).map((a) => a.asinRevenue));
      it.source = "xray"; it.note = "Σ ASIN Revenue (Xray, без исключённых брендов)";
      if (proxy) { it.proxyValue = proxy.monthly; it.proxyDelta = relDelta(it.value, proxy.monthly); it.note += `; прокси POE $${fmtK(proxy.monthly)} (расхождение ${Math.round((it.proxyDelta ?? 0) * 100)} %)`; }
    } else if (proxy) {
      it.value = proxy.monthly; it.source = "proxy"; it.proxyRange = [proxy.low, proxy.high];
      it.note = "ПРОКСИ POE: units × avgPrice / 12 — систематически занижает (до 10×), нужна сверка по Xray";
    }
    items["1a"] = finalize(it, mo["1a"], (v) => v >= t.nicheRevenueMonthly, (v) => v < t.nicheRevenueMonthly * 0.5);
  }
  // 1b — Средняя цена (медиана «проверенных» конкурентов)
  {
    const it = item({ unit: "$", threshold: `≥ $${t.priceOk} OK · $${t.priceWarn}–${t.priceOk} погранично · < $${t.priceWarn} НЕ OK` });
    if (xray?.asins?.length) {
      const proven = xray.asins.filter((a) => a.price !== null && (a.reviews ?? 0) >= t.provenReviews);
      const pool = proven.length >= 3 ? proven : xray.asins.filter((a) => a.price !== null);
      it.value = median(pool.map((a) => a.price)); it.source = "xray";
      it.note = proven.length >= 3 ? `медиана ${proven.length} листингов с ≥ ${t.provenReviews} отзывов` : "мало проверенных листингов — медиана по всем";
      it.allMedian = median(xray.asins.map((a) => a.price));
    } else if (poe?.nicheSummary?.avgPrice !== null && poe?.nicheSummary?.avgPrice !== undefined) {
      it.value = poe.nicheSummary.avgPrice; it.source = "poe"; it.note = "средняя цена ниши (POE)";
      const proven = (poe.asinMetrics || []).filter((a) => a.price !== null && (a.reviews ?? 0) >= t.provenReviews);
      if (proven.length >= 3) { it.provenMedian = median(proven.map((a) => a.price)); it.note += `; медиана проверенных $${it.provenMedian.toFixed(2)}`; }
    }
    items["1b"] = finalize(it, mo["1b"], (v) => v >= t.priceOk, (v) => v < t.priceWarn);
  }
  // 1c — Adj. SV
  {
    const it = item({ unit: "/мес", threshold: `≥ ${t.adjSv.toLocaleString("ru-RU")}/мес` });
    if (tr?.source === "cerebro" && tr.adjSv !== null) { it.value = tr.adjSv; it.source = "cerebro"; it.note = `SV core ${tr.svCore} + 0.4 × Σ кластера (${tr.clusterCount} ключей)`; }
    else if (tr?.source === "poe" && tr.adjSv !== null) { it.value = tr.adjSv; it.source = "proxy"; it.note = "ПРОКСИ POE: searchVolumeT360/12 по запросам ниши — сверить по Cerebro"; }
    items["1c"] = finalize(it, mo["1c"], (v) => v >= t.adjSv, (v) => v < t.adjSv * 0.5);
  }
  // 1d — Отзывы по нише
  {
    const it = item({ unit: "отзывов", threshold: `< ${t.reviewsOk} OK · > ${t.reviewsFail} НЕ OK` });
    if (comp?.reviewBarrier?.avg !== null && comp?.reviewBarrier?.avg !== undefined) {
      it.value = comp.reviewBarrier.avg; it.source = comp.source; it.median = comp.reviewBarrier.median;
      it.note = `среднее ${Math.round(it.value)} / медиана ${Math.round(it.median ?? 0)} — среднее искажают выбросы`;
      if (it.median !== null && it.value > t.reviewsOk && it.median < t.reviewsOk) it.note += "; по медиане барьер проходим";
    }
    items["1d"] = finalize(it, mo["1d"], (v) => v < t.reviewsOk, (v) => v > t.reviewsFail);
  }
  // 1e — Доминация бренда / Amazon
  {
    const it = item({ unit: "%", threshold: `Top Brand < ${Math.round(t.topBrandShare * 100)} % и нет Amazon как продавца`, pct: true });
    if (comp?.topBrandShare !== null && comp?.topBrandShare !== undefined) {
      it.value = comp.topBrandShare; it.source = comp.source; it.brand = comp.topBrand;
      it.note = `${comp.topBrand}: ${(comp.topBrandShare * 100).toFixed(1)} % ${comp.source === "xray" ? "выручки" : "кликов (прокси)"}`;
      if (comp.amazonSells) it.note += `; Amazon продаёт сам (${comp.amazonSellsSource === "user" ? "указано вручную" : "по Xray, колонка Seller"}) — НЕ OK независимо от доли`;
    }
    items["1e"] = finalize(it, mo["1e"], (v) => v < t.topBrandShare && !comp?.amazonSells, (v) => v >= t.topBrandShare || Boolean(comp?.amazonSells));
  }
  // 1f — Top-5 брендов
  {
    const it = item({ unit: "%", threshold: `< ${Math.round(t.top5Ok * 100)} % OK · > ${Math.round(t.top5Fail * 100)} % НЕ OK`, pct: true });
    if (comp?.top5Share !== null && comp?.top5Share !== undefined) {
      it.value = comp.top5Share; it.source = comp.source;
      it.note = comp.source === "xray" ? "доля выручки топ-5 БРЕНДОВ (не продуктов)" : "top5BrandsClickShareT360 (POE, бренды — не путать с продуктами)";
      const poeTop5 = poe?.launchPotential?.top5BrandsClickShareT360?.current;
      if (comp.source === "xray" && typeof poeTop5 === "number") { it.proxyValue = poeTop5; it.proxyDelta = relDelta(it.value, poeTop5); }
    }
    items["1f"] = finalize(it, mo["1f"], (v) => v < t.top5Ok, (v) => v > t.top5Fail);
  }
  // 1g — Сезонность (просадка SV по неделям)
  {
    const it = item({ unit: "%", threshold: `просадка < ${Math.round(t.seasonOk * 100)} % OK · > ${Math.round(t.seasonFail * 100)} % НЕ OK`, pct: true });
    const pts = (poe?.trends || []).filter((x) => x.sv !== null).slice(-52);
    if (pts.length >= t.minTrendWeeks) {
      const svs = pts.map((x) => x.sv); const peak = Math.max(...svs), trough = Math.min(...svs);
      it.value = peak ? (peak - trough) / peak : null; it.source = "poe";
      const pk = pts[svs.indexOf(peak)], tg = pts[svs.indexOf(trough)];
      it.note = `${pts.length} нед.: пик ${peak.toLocaleString("ru-RU")} (${pk.date}), минимум ${trough.toLocaleString("ru-RU")} (${tg.date})`;
    } else if (poe) { it.note = "недостаточно истории трендов (< 8 недель) — не «НЕ OK»"; }
    items["1g"] = finalize(it, mo["1g"], (v) => v < t.seasonOk, (v) => v > t.seasonFail);
  }
  // 1h — Успешность запусков + рост SV
  {
    const it = item({ unit: "%", threshold: `успешных запусков ≥ ${Math.round(t.launchOk * 100)} % OK · < ${Math.round(t.launchFail * 100)} % НЕ OK`, pct: true });
    const lp = poe?.launchPotential;
    const launched = lp?.newProductsLaunchedT360?.current, ok = lp?.successfulLaunchesT360?.current;
    if (typeof launched === "number" && launched > 0 && typeof ok === "number") {
      it.value = ok / launched; it.source = "poe";
      const g = poe.nicheSummary?.searchVolumeGrowthT360;
      it.note = `${ok} успешных из ${launched} запусков за 360 дн.` + (typeof g === "number" ? `; рост SV за год ${(g * 100).toFixed(0)} %` : "");
    } else if (poe) it.note = "запусков за 360 дн. нет — нет данных";
    items["1h"] = finalize(it, mo["1h"], (v) => v >= t.launchOk, (v) => v < t.launchFail);
  }

  const okCount = Object.values(items).filter((i) => i.status === "ok").length;
  const failCount = Object.values(items).filter((i) => i.status === "fail").length;
  const naCount = Object.values(items).filter((i) => i.status === "na").length;
  const proxyCount = Object.values(items).filter((i) => i.source === "proxy").length;
  return { items, okCount, failCount, naCount, proxyCount, total: 8, passCount: t.passCount, pass: okCount >= t.passCount,
    redItems: Object.entries(items).filter(([, i]) => i.status === "fail").map(([k]) => k),
    label: okCount >= t.passCount ? "ПРОЙДЕН" : "НИЖЕ ПОРОГА" };
}

function finalize(it, override, okFn, failFn) {
  if (override && override.value !== null && override.value !== undefined && override.value !== "") {
    it.autoValue = it.value; it.autoSource = it.source;
    it.value = Number(override.value); it.source = "manual"; it.note = (override.note ? override.note + "; " : "") + "введено вручную";
  }
  it.status = triage(it.value, okFn, failFn);
  return it;
}
function fmtK(v) { return v >= 1e6 ? (v / 1e6).toFixed(2) + "M" : v >= 1e3 ? Math.round(v / 1e3) + "k" : String(Math.round(v)); }
export { safeDiv };
