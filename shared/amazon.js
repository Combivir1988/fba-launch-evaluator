// Amazon как продавец в нише (spec 012): присутствие по выбранной области (вся ниша / ценовой диапазон) и режим порога (однозначно No-Go / учитывать в общей картине).
const AMZ_RE = /^amazon(\.com)?$/i;
export const isAmazonSeller = (a) => AMZ_RE.test(String(a?.seller || "").trim()) || AMZ_RE.test(String(a?.fulfillment || "").trim());

/**
 * @param {object} o { whole: competition всей ниши, band: competition коридора | null, th: thresholds.amazon, bandLabel }
 * @returns {{ mode, scope, scopeLabel, present, presentNiche, presentBand, source, asins, count, revenueShare, blocks, note }}
 */
export function amazonPresence({ whole, band = null, th = {}, bandLabel = "" } = {}) {
  const mode = th?.mode === "consider" ? "consider" : "block";
  const wantBand = th?.scope === "band"; const scope = wantBand && band ? "band" : "niche"; const src = scope === "band" ? band : whole;
  const present = Boolean(src?.amazonSells);
  const asins = src?.amazonAsins || []; const revenueShare = asins.length && typeof src?.amazonRevenueShare === "number" ? src.amazonRevenueShare : null; // без найденных листингов (ручной ответ «да») доли нет
  const note = wantBand && !band ? "область «мой ценовой диапазон» выбрана, но диапазон не задан — проверена вся ниша" : src?.amazonSellsSource === "user" ? "по ответу в чеклисте" : present ? "по колонкам Seller / Fulfillment в Xray" : "";
  return { mode, scope, scopeLabel: scope === "band" ? `в ценовом диапазоне ${bandLabel}`.trim() : "по всей нише", present, presentNiche: Boolean(whole?.amazonSells), presentBand: band ? Boolean(band.amazonSells) : null,
    source: src?.amazonSellsSource || "auto", asins, count: asins.length, revenueShare, blocks: mode === "block" && present, note };
}
