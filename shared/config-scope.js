// Этап 2 (spec 010, D4): область ASIN для загрузки страниц — уникальные ASIN Xray без исключённых брендов,
// по убыванию выручки, не больше thresholds.config.maxAsins. Ценовой диапазон область не сужает (он — переключатель на диаграммах).
const isNum = (v) => typeof v === "number" && Number.isFinite(v);

/** Вес листинга в нише: выручка ASIN из Xray; если её нет — цена × продажи; иначе 0. */
export function revenueOf(a) {
  if (isNum(a?.asinRevenue)) return a.asinRevenue;
  if (isNum(a?.price) && isNum(a?.asinSales)) return a.price * a.asinSales;
  return 0;
}

/** → { asins, items[{asin,title,brand,price,asinRevenue}], excluded, capped, total } */
export function configScope(analysis, th) {
  const xray = analysis?.aggregates?.xray; const max = th?.config?.maxAsins ?? 150;
  if (!xray?.asins?.length) return { asins: [], items: [], excluded: 0, capped: false, total: 0 };
  const ex = new Set((analysis.inputs?.excludedBrands || []).map((b) => String(b).toLowerCase()));
  const seen = new Set(); const items = []; let excluded = 0;
  for (const a of xray.asins) {
    if (!a?.asin || seen.has(a.asin)) continue; seen.add(a.asin);
    if (ex.has(String(a.brand || "").toLowerCase())) { excluded++; continue; }
    items.push({ asin: a.asin, title: a.title || "", brand: a.brand || "", price: isNum(a.price) ? a.price : null, asinRevenue: revenueOf(a) });
  }
  items.sort((x, y) => y.asinRevenue - x.asinRevenue);
  const capped = items.length > max; const kept = capped ? items.slice(0, max) : items;
  return { asins: kept.map((i) => i.asin), items: kept, excluded, capped, total: items.length };
}

/** Листинги, по которым AI предлагает схему полей: первые topForSchema по выручке. */
export function topForSchema(scope, th) { return scope.items.slice(0, th?.config?.topForSchema ?? 15); }

/** Страница в кэше годится, если загружена без ошибки и не старше cacheDays. */
export function isFresh(listing, th, now = Date.now()) {
  if (!listing || listing.error || !listing.fetchedAt) return false;
  const t = new Date(listing.fetchedAt).getTime(); if (Number.isNaN(t)) return false;
  return now - t < (th?.config?.cacheDays ?? 30) * 86_400_000;
}

/** Свежие страницы из кэша анализа для заданных ASIN. */
export function freshListings(listings, asins, th, now = Date.now()) {
  const out = {};
  for (const asin of asins) { const l = listings?.[asin]; if (isFresh(l, th, now)) out[asin] = l; }
  return out;
}
