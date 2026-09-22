// Этап 2 (spec 010, D7): диаграммы «характеристика → выручка» детерминированно из таблицы ASIN × поля.
// Вес — выручка ASIN (Xray); сектор «нет данных» всегда есть, сумма долей = 100 %. Считается по всей нише и по ценовому диапазону.
import { mean, median, round } from "./num.js";
import { inBand } from "./price-band.js";
import { revenueOf } from "./config-scope.js";

const isNum = (v) => typeof v === "number" && Number.isFinite(v);
export const NO_DATA = "нет данных";

const fmtNum = (v) => (Number.isInteger(v) ? String(v) : String(round(v, 2)).replace(".", ","));
export const valueLabel = (field, v) => (v === null || v === undefined ? NO_DATA : field.type === "number" ? fmtNum(v) + (field.unit ? " " + field.unit : "") : String(v));

/** Квантильные интервалы для числового поля с большим разбросом → [{lo, hi, label}] */
function buckets(values, n = 5) {
  const s = [...values].sort((a, b) => a - b); const cuts = [];
  for (let i = 1; i < n; i++) cuts.push(s[Math.min(s.length - 1, Math.floor((s.length * i) / n))]);
  const edges = [...new Set(cuts)];
  const out = []; let lo = s[0];
  for (const e of edges) { if (e > lo) { out.push({ lo, hi: e, label: `${fmtNum(lo)}–${fmtNum(e)}` }); lo = e; } }
  out.push({ lo, hi: Infinity, label: `от ${fmtNum(lo)}` });
  return out;
}

function fieldStats(field, rows, byAsin, totalRevenue, th) {
  const cells = rows.map(([asin, r]) => ({ asin, a: byAsin.get(asin), v: r.status === "failed" ? null : r.values?.[field.id]?.value ?? null }));
  let keyOf = (v) => v, labelOf = (v) => valueLabel(field, v), groupsDef = null;
  if (field.type === "number") {
    const nums = [...new Set(cells.map((c) => c.v).filter(isNum))];
    if (nums.length > (th?.numericDistinctMax ?? 12)) {
      groupsDef = buckets(nums); const find = (v) => groupsDef.find((b) => v >= b.lo && v < b.hi) || groupsDef[groupsDef.length - 1];
      keyOf = (v) => (isNum(v) ? find(v).label : v); labelOf = (k) => k;
    }
  }
  const groups = new Map(); const noData = { revenue: 0, count: 0, share: 0 };
  for (const c of cells) {
    const w = c.a ? revenueOf(c.a) : 0; const price = c.a?.price;
    if (c.v === null || c.v === undefined) { noData.revenue += w; noData.count++; continue; }
    const k = keyOf(c.v); const g = groups.get(k) || { value: field.type === "number" && !groupsDef ? c.v : k, label: labelOf(k), revenue: 0, count: 0, prices: [] };
    g.revenue += w; g.count++; if (isNum(price)) g.prices.push(price); groups.set(k, g);
  }
  const n = cells.length; const byCount = totalRevenue <= 0;
  const share = (rev, cnt) => (n === 0 ? 0 : byCount ? cnt / n : rev / totalRevenue);
  const priceMedian = median(cells.filter((c) => c.v !== null && c.v !== undefined && isNum(c.a?.price)).map((c) => c.a.price));
  const values = [...groups.values()].map((g) => {
    const s = share(g.revenue, g.count), ls = n ? g.count / n : 0, avg = mean(g.prices);
    return { value: g.value, label: g.label, revenue: g.revenue, share: s, count: g.count, listingShare: ls, avgPrice: avg, premium: g.count >= 2 && s > ls && isNum(avg) && isNum(priceMedian) && avg > priceMedian };
  }).sort((x, y) => y.revenue - x.revenue || y.count - x.count || String(x.label).localeCompare(String(y.label), "ru"));
  noData.share = share(noData.revenue, noData.count);
  return { id: field.id, name: field.name, type: field.type, unit: field.unit || null, bucketed: Boolean(groupsDef), values, noData, dominant: values.length ? { value: values[0].value, label: values[0].label, share: values[0].share, listingShare: values[0].listingShare, avgPrice: values[0].avgPrice } : null, coverage: n ? 1 - noData.count / n : 0, priceMedian };
}

/** Статистика по одному множеству листингов. */
export function configStatsFor(config, xray, { band = null, th } = {}) {
  const fields = config?.schema?.fields || []; const rowsAll = Object.entries(config?.table?.rows || {});
  if (!fields.length || !rowsAll.length) return null;
  const byAsin = new Map((xray?.asins || []).map((a) => [a.asin, a]));
  const rows = band?.active ? rowsAll.filter(([asin]) => { const a = byAsin.get(asin); return a && inBand(a.price, band); }) : rowsAll;
  const totalRevenue = rows.reduce((s, [asin]) => s + (byAsin.has(asin) ? revenueOf(byAsin.get(asin)) : 0), 0);
  const withRevenue = rows.filter(([asin]) => byAsin.has(asin) && revenueOf(byAsin.get(asin)) > 0).length;
  return { asins: rows.length, withRevenue, totalRevenue, weightLabel: totalRevenue > 0 ? "revenue" : "count", fields: fields.map((f) => fieldStats(f, rows, byAsin, totalRevenue, th)) };
}

/** → { whole, band|null } или null, если этап 2 ещё не выполнен. */
export function configStats(config, xray, { band = null, th } = {}) {
  const whole = configStatsFor(config, xray, { th });
  if (!whole) return null;
  return { whole, band: band?.active ? configStatsFor(config, xray, { band, th }) : null, extractedAt: config.table?.extractedAt || null, failed: config.table?.failed?.length || 0 };
}
