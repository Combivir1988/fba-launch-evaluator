// Amazon как продавец в нише (spec 012 + spec 016): кто именно продаёт — своя марка Amazon или чужой бренд-вендор,
// и насколько он велик. Против Amazon Basics заходить бессмысленно при любой доле; вендор опасен ровно по своей доле рынка.
const AMZ_RE = /^amazon(\.com)?$/i;
// Xray, колонка Fulfillment: FBA — чужой продавец на складе Amazon, MFN — свой склад, AMZ — продаёт сам Amazon.
// Замер по 25 анализам (2026-10-23): листингов с AMZ — 597, из них 5 без Seller = Amazon, раньше они проходили мимо правила.
const amzSeller = (a) => AMZ_RE.test(String(a?.seller || "").trim());
const amzFulfill = (a) => { const f = String(a?.fulfillment || "").trim(); return f.toUpperCase() === "AMZ" || AMZ_RE.test(f); };
export const isAmazonSeller = (a) => amzSeller(a) || amzFulfill(a);
/** Чем именно выдал себя листинг: продавцом Amazon или отгрузкой Amazon (в карточке листинга это разные истории). */
export const amazonBy = (a) => (amzSeller(a) ? "seller" : amzFulfill(a) ? "fulfillment" : null);

// Частные марки Amazon. Список заведомо неполон и пополняется; неизвестная марка считается вендором — мягче, а не строже.
export const AMAZON_OWN_BRANDS = ["amazon basics", "amazonbasics", "amazon essentials", "amazon commercial", "amazon collection", "amazon elements", "amazon aware",
  "solimo", "pinzon", "presto!", "presto", "happy belly", "mama bear", "wickedly prime", "goodthreads", "core 10", "daily ritual", "206 collective", "rivet", "stone & beam", "wag", "by dash"];
const norm = (s) => String(s || "").toLowerCase().replace(/\s+/g, " ").trim();
/** «своя марка Amazon» или «вендор» (чужой бренд, который Amazon продаёт как 1P). */
export function amazonBrandKind(brand) {
  const b = norm(brand);
  if (!b) return "vendor";
  if (/^amazon\b/.test(b)) return "own";
  return AMAZON_OWN_BRANDS.includes(b) ? "own" : "vendor";
}

/** Доля кликов бренда за 90 дней против года (POE): растёт вендор или сжимается. */
export function vendorTrend(poe, brand) {
  const rows = (poe?.asinMetrics || []).filter((m) => norm(m.brand) === norm(brand));
  if (!rows.length) return null;
  const sum = (k) => rows.reduce((s, m) => s + (typeof m[k] === "number" ? m[k] : 0), 0);
  const t90 = sum("clickShareT90"), t360 = sum("clickShareT360");
  if (!t90 || !t360) return null;
  const delta = (t90 - t360) / t360;
  return { t90, t360, delta, dir: delta > 0.15 ? "up" : delta < -0.15 ? "down" : "flat" };
}

/**
 * @param {object} o { whole: competition всей ниши, band: competition коридора | null, th: thresholds.amazon, bandLabel, poe }
 * @returns {{ mode, scope, scopeLabel, present, level, blocks, vendors, ownBrands, maxVendorShare, … }}
 */
export function amazonPresence({ whole, band = null, th = {}, bandLabel = "", poe = null } = {}) {
  const mode = th?.mode === "consider" ? "consider" : "block";
  const watchAt = typeof th?.vendorWatch === "number" ? th.vendorWatch : 0.15;
  const blockAt = typeof th?.vendorBlock === "number" ? th.vendorBlock : 0.6;
  const wantBand = th?.scope === "band"; const scope = wantBand && band ? "band" : "niche"; const src = scope === "band" ? band : whole;
  const present = Boolean(src?.amazonSells);
  const asins = src?.amazonAsins || []; const listings = src?.amazonListings || [];
  const revenueShare = asins.length && typeof src?.amazonRevenueShare === "number" ? src.amazonRevenueShare : null; // без найденных листингов (ручной ответ «да») доли нет

  // Доля бренда в нише берётся из общей таблицы брендов — той же, что рисует «Конкурентную карту».
  const brandShare = new Map((src?.brands || []).map((b) => [norm(b.brand), b.share]));
  const byBrand = new Map();
  for (const l of listings) {
    const key = norm(l.brand); const cur = byBrand.get(key) || { brand: l.brand || "(без бренда)", kind: amazonBrandKind(l.brand), listings: 0, revenue: 0, share: brandShare.get(key) ?? null };
    cur.listings++; cur.revenue += l.revenue || 0; byBrand.set(key, cur);
  }
  const all = [...byBrand.values()].sort((a, b) => (b.share ?? 0) - (a.share ?? 0));
  const ownBrands = all.filter((b) => b.kind === "own");
  const vendors = all.filter((b) => b.kind === "vendor").map((v) => ({ ...v, trend: vendorTrend(poe, v.brand) }));
  const maxVendorShare = vendors.length ? Math.max(...vendors.map((v) => v.share ?? 0)) : null;

  // Уровень опасности: своя марка > доминация вендора > «смотреть внимательно» > обычный конкурент.
  let level = "none";
  if (present) {
    if (ownBrands.length) level = "own";
    else if (!listings.length) level = "unknown"; // ручной ответ в чеклисте: листингов нет, доли нет
    else if (maxVendorShare !== null && maxVendorShare > blockAt) level = "dominant";
    else if (maxVendorShare !== null && maxVendorShare >= watchAt) level = "watch";
    else level = "normal";
  }
  const blocks = mode === "block" && (level === "own" || level === "dominant" || level === "unknown");
  const note = wantBand && !band ? "область «мой ценовой диапазон» выбрана, но диапазон не задан — проверена вся ниша" : src?.amazonSellsSource === "user" ? "по ответу в чеклисте" : present ? "по колонкам Seller / Fulfillment в Xray" : "";
  return { mode, scope, scopeLabel: scope === "band" ? `в ценовом диапазоне ${bandLabel}`.trim() : "по всей нише", present,
    presentNiche: Boolean(whole?.amazonSells), presentBand: band ? Boolean(band.amazonSells) : null,
    source: src?.amazonSellsSource || "auto", asins, listings, count: asins.length, revenueShare,
    level, blocks, ownBrands, vendors, maxVendorShare, watchAt, blockAt, note };
}
