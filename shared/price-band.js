// Ценовой диапазон анализа (spec 003). Фильтр строит «вид» на листинги ДО расчётов: конкуренция считается по виду,
// спрос и размер рынка — по всей нише (см. specs/003-price-band-filter/research.md, R1–R3).
import { toNum, sum, mean } from "./num.js";

const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const bound = (v) => { if (v === null || v === undefined || v === "") return null; const n = typeof v === "number" ? v : toNum(String(v)); return n; };

/** → { active, valid, error, min, max }. Пустые границы — диапазон не задан; некорректный диапазон не применяется. */
export function normalizeBand(inputs = {}) {
  const min = bound(inputs.priceMin), max = bound(inputs.priceMax);
  const none = { active: false, valid: true, error: null, min: null, max: null };
  if (min === null && max === null) return none;
  const bad = (error) => ({ active: false, valid: false, error, min: isNum(min) ? min : null, max: isNum(max) ? max : null });
  if ((min !== null && !isNum(min)) || (max !== null && !isNum(max))) return bad("Границы цены должны быть числами");
  if ((min !== null && min < 0) || (max !== null && max < 0)) return bad("Цена не может быть отрицательной");
  if (min !== null && max !== null && min > max) return bad("Нижняя граница больше верхней — диапазон не применён");
  return { active: true, valid: true, error: null, min, max };
}

/** Границы включительные; листинг без цены в диапазон не входит. */
export function inBand(price, band) {
  if (!band?.active) return true;
  if (!isNum(price)) return false;
  return (band.min === null || price >= band.min) && (band.max === null || price <= band.max);
}

export function bandLabel(band) {
  if (!band?.active) return "";
  const m = (v) => "$" + (Number.isInteger(v) ? v : v.toFixed(2));
  return band.min !== null && band.max !== null ? `${m(band.min)}–${m(band.max)}` : band.min !== null ? `от ${m(band.min)}` : `до ${m(band.max)}`;
}

/**
 * @param {object} p { xray, poe, inputs, thresholds }
 * @returns {{ view: {xray, poe}, summary: object }} view — те же объекты, если диапазон не активен (совместимость: расчёт идёт прежним путём).
 */
export function applyPriceBand(p) {
  const band = normalizeBand(p.inputs);
  const th = p.thresholds?.priceBand || { smallSample: 15, minSample: 5 };
  const xr = p.xray?.asins?.length ? p.xray.asins : null;
  const pm = !xr && p.poe?.asinMetrics?.length ? p.poe.asinMetrics : null;
  const source = xr ? "xray" : pm ? "poe" : null;
  const summary = { active: false, valid: band.valid, error: band.error, min: band.min, max: band.max, label: "", source, weightLabel: xr ? "revenue" : pm ? "clicks" : null,
    totalCount: (xr || pm || []).length, inCount: null, noPrice: null, revenueAll: null, revenueBand: null, revenueShare: null, sample: null, whole: null, myPriceOutside: false };
  if (!band.active) return { view: { xray: p.xray, poe: p.poe }, summary };

  summary.active = true; summary.label = bandLabel(band);
  const myPrice = bound(p.inputs?.price);
  summary.myPriceOutside = isNum(myPrice) && !inBand(myPrice, band);
  if (!source) { summary.inCount = 0; summary.noPrice = 0; summary.sample = "insufficient"; return { view: { xray: p.xray, poe: p.poe }, summary }; }

  const all = xr || pm; const weight = (a) => (xr ? a.asinRevenue : a.clickShareT360) ?? 0;
  const kept = all.filter((a) => inBand(a.price, band));
  summary.inCount = kept.length; summary.noPrice = all.filter((a) => !isNum(a.price)).length;
  summary.revenueAll = sum(all.map(weight)); summary.revenueBand = sum(kept.map(weight));
  summary.revenueShare = summary.revenueAll > 0 ? summary.revenueBand / summary.revenueAll : null;
  summary.sample = kept.length < th.minSample ? "insufficient" : kept.length < th.smallSample ? "small" : "ok";
  // При недостаточной выборке конкурентные показатели диапазона не считаем вовсе: пустой вид → статусы «нет данных».
  const rows = summary.sample === "insufficient" ? [] : kept;

  let xray = p.xray, poe = p.poe;
  if (xr) xray = { ...p.xray, asins: rows };
  if (p.poe?.asinMetrics) {
    const inPoe = p.poe.asinMetrics.filter((a) => inBand(a.price, band));
    const poeRows = xr ? inPoe : (summary.sample === "insufficient" ? [] : inPoe);
    // Доли кликов внутри коридора нормируются на клики коридора; сводные показатели всей ниши (топ-5/топ-20 брендов, средние отзывы, средняя цена)
    // из POE заменяются расчётом по листингам диапазона — иначе модуль конкуренции взял бы цифры всей ниши.
    const total = sum(poeRows.map((a) => a.clickShareT360 ?? 0));
    const scaled = poeRows.map((a) => ({ ...a, clickShareT360: total > 0 && isNum(a.clickShareT360) ? a.clickShareT360 / total : a.clickShareT360 }));
    const prices = poeRows.map((a) => a.price).filter(isNum);
    const lp = p.poe.launchPotential ? { ...p.poe.launchPotential, top5BrandsClickShareT360: undefined, top20BrandsClickShareT360: undefined, avgReviewCount: undefined } : p.poe.launchPotential;
    poe = { ...p.poe, asinMetrics: scaled, launchPotential: lp, nicheSummary: p.poe.nicheSummary ? { ...p.poe.nicheSummary, avgPrice: prices.length ? mean(prices) : null } : p.poe.nicheSummary };
  }
  return { view: { xray, poe }, summary };
}

/** Показатели всей ниши для сравнения с диапазоном (из результата competition() и пункта 1b по целым данным). */
export function wholeNicheRef(compAll, priceMedianAll) {
  return { topBrand: compAll?.topBrand ?? null, topBrandShare: compAll?.topBrandShare ?? null, top5Share: compAll?.top5Share ?? null, priceMedian: priceMedianAll ?? null,
    reviewsAvg: compAll?.reviewBarrier?.avg ?? null, reviewsMedian: compAll?.reviewBarrier?.median ?? null };
}
