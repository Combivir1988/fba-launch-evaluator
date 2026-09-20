// Конкурентная структура: доли брендов (Xray revenue / POE click share), барьер отзывов,
// число игроков, contamination-кандидаты, Amazon как продавец.
import { sum, mean, median, safeDiv } from "./num.js";

/** Группировка Xray по бренду (без исключённых брендов). */
export function brandShares(asins, excludedBrands = []) {
  const ex = new Set(excludedBrands.map((b) => b.toLowerCase()));
  const rows = asins.filter((a) => !ex.has(a.brand.toLowerCase()));
  const map = new Map();
  for (const a of rows) {
    const b = map.get(a.brand) || { brand: a.brand, revenue: 0, sales: 0, asins: 0, reviewsMax: 0, reviewsSum: 0, ratingSum: 0, ratingN: 0, prices: [] };
    b.revenue += a.asinRevenue ?? 0;
    b.sales += a.asinSales ?? 0;
    b.asins += 1;
    b.reviewsMax = Math.max(b.reviewsMax, a.reviews ?? 0);
    b.reviewsSum += a.reviews ?? 0;
    if (a.rating !== null) { b.ratingSum += a.rating; b.ratingN++; }
    if (a.price !== null) b.prices.push(a.price);
    map.set(a.brand, b);
  }
  const total = sum([...map.values()].map((b) => b.revenue));
  const brands = [...map.values()].map((b) => ({
    brand: b.brand, revenue: b.revenue, share: safeDiv(b.revenue, total) ?? 0, sales: b.sales, asins: b.asins,
    reviewsMax: b.reviewsMax, rating: b.ratingN ? b.ratingSum / b.ratingN : null, priceMedian: median(b.prices),
  })).sort((x, y) => y.revenue - x.revenue);
  return { brands, totalRevenue: total, rows };
}

/** Доли кликов по брендам из POE asinMetrics (прокси revenue share). */
export function poeBrandClickShares(asinMetrics, excludedBrands = []) {
  const ex = new Set(excludedBrands.map((b) => b.toLowerCase()));
  const map = new Map();
  for (const a of asinMetrics) {
    if (ex.has(a.brand.toLowerCase())) continue;
    const b = map.get(a.brand) || { brand: a.brand, share: 0, asins: 0, reviewsMax: 0 };
    b.share += a.clickShareT360 ?? 0; b.asins++; b.reviewsMax = Math.max(b.reviewsMax, a.reviews ?? 0);
    map.set(a.brand, b);
  }
  return [...map.values()].sort((x, y) => y.share - x.share);
}

export function reviewTier(reviews, th) {
  if (reviews === null || reviews === undefined) return null;
  if (reviews < th.breakable) return "breakable";
  if (reviews <= th.medium) return "medium";
  return "moat";
}

/**
 * @param {object} p {xray, poe, inputs, thresholds}
 */
export function competition(p) {
  const { xray, poe, inputs, thresholds: th } = p;
  const excluded = inputs.excludedBrands || [];
  const out = { source: null, brands: [], topBrand: null, topBrandShare: null, top5Share: null, top10Share: null, top20Share: null,
    reviewBarrier: { leaderReviews: null, avg: null, median: null, tier: null }, playersOver100: null, brandsOver10pct: null,
    amazonSells: false, amazonSellsSource: "auto", contaminationCandidates: [], poeBrands: [] };
  // Amazon как продавец: явный ответ пользователя побеждает автоопределение по колонке Seller в Xray
  const az = inputs.checklist?.amazonSells;
  if (az === "yes" || az === true) { out.amazonSells = true; out.amazonSellsSource = "user"; }
  else if (az === "no") { out.amazonSells = false; out.amazonSellsSource = "user"; }
  else { out.amazonSells = Boolean(xray?.flags?.amazonSells); out.amazonSellsSource = xray?.flags?.amazonSells ? "xray" : "auto"; }

  if (poe?.asinMetrics?.length) {
    out.poeBrands = poeBrandClickShares(poe.asinMetrics, excluded);
  }
  if (xray?.asins?.length) {
    const { brands, rows } = brandShares(xray.asins, excluded);
    out.source = "xray";
    out.brands = brands;
    out.topBrand = brands[0]?.brand ?? null;
    out.topBrandShare = brands[0]?.share ?? null;
    out.top5Share = sum(brands.slice(0, 5).map((b) => b.share));
    out.top10Share = sum(brands.slice(0, 10).map((b) => b.share));
    out.top20Share = sum(brands.slice(0, 20).map((b) => b.share));
    const revs = rows.map((a) => a.reviews);
    out.reviewBarrier = { leaderReviews: brands[0]?.reviewsMax ?? null, avg: mean(revs), median: median(revs), tier: reviewTier(brands[0]?.reviewsMax ?? null, th.reviewsMoat) };
    out.playersOver100 = brands.filter((b) => b.reviewsMax >= 100).length;
    out.brandsOver10pct = brands.filter((b) => b.share > th.challenger.playerShareMin).length;
    if (poe?.asinMetrics?.length) {
      const poeBrands = new Set(poe.asinMetrics.map((a) => a.brand.toLowerCase()));
      const poeAsins = new Set(poe.asinMetrics.map((a) => a.asin));
      out.contaminationCandidates = brands
        .filter((b) => !poeBrands.has(b.brand.toLowerCase()) && !xray.asins.some((a) => a.brand === b.brand && poeAsins.has(a.asin)))
        .map((b) => ({ brand: b.brand, share: b.share, revenue: b.revenue }));
    }
  } else if (out.poeBrands.length) {
    out.source = "poe";
    const pb = out.poeBrands;
    out.brands = pb.map((b) => ({ brand: b.brand, revenue: null, share: b.share, sales: null, asins: b.asins, reviewsMax: b.reviewsMax, rating: null, priceMedian: null }));
    out.topBrand = pb[0].brand; out.topBrandShare = pb[0].share;
    out.top5Share = poe.launchPotential?.top5BrandsClickShareT360?.current ?? sum(pb.slice(0, 5).map((b) => b.share));
    out.top10Share = sum(pb.slice(0, 10).map((b) => b.share));
    out.top20Share = poe.launchPotential?.top20BrandsClickShareT360?.current ?? sum(pb.slice(0, 20).map((b) => b.share));
    const revs = poe.asinMetrics.map((a) => a.reviews);
    out.reviewBarrier = { leaderReviews: pb[0].reviewsMax, avg: poe.launchPotential?.avgReviewCount?.current ?? mean(revs), median: median(revs), tier: reviewTier(pb[0].reviewsMax, th.reviewsMoat) };
    out.playersOver100 = pb.filter((b) => b.reviewsMax >= 100).length;
    out.brandsOver10pct = pb.filter((b) => b.share > th.challenger.playerShareMin).length;
  }
  out.dominant = out.topBrandShare !== null && out.topBrandShare > th.challenger.activateTopBrand;
  return out;
}

/** Ценовые сегменты (терцили) по Xray или POE: доля товаров и доля выручки/кликов. */
export function priceSegments(p) {
  const items = p.xray?.asins?.length
    ? p.xray.asins.filter((a) => a.price !== null).map((a) => ({ price: a.price, weight: a.asinRevenue ?? 0 }))
    : (p.poe?.asinMetrics || []).filter((a) => a.price !== null).map((a) => ({ price: a.price, weight: a.clickShareT360 ?? 0 }));
  if (items.length < 3) return null;
  const prices = items.map((i) => i.price).sort((a, b) => a - b);
  const q1 = prices[Math.floor(prices.length / 3)], q2 = prices[Math.floor((2 * prices.length) / 3)];
  const segs = [
    { name: "Entry", min: prices[0], max: q1, items: 0, weight: 0 },
    { name: "Mid", min: q1, max: q2, items: 0, weight: 0 },
    { name: "Premium", min: q2, max: prices[prices.length - 1], items: 0, weight: 0 },
  ];
  const totalW = sum(items.map((i) => i.weight)) || 1;
  for (const it of items) {
    const s = it.price < q1 ? segs[0] : it.price < q2 ? segs[1] : segs[2];
    s.items++; s.weight += it.weight;
  }
  const band = p.priceBand?.active ? p.priceBand : null; // сегмент пересекается с выбранным коридором цен
  // Соседние сегменты делят границу ($30 — конец Mid и начало Premium): касание в одной точке пересечением не считаем,
  // иначе выбор Premium подсвечивал бы и Mid. Нестрогая проверка остаётся запасной — для диапазона-точки и вырожденных сегментов.
  const strict = (sg) => (band.max === null || sg.min < band.max) && (band.min === null || sg.max > band.min);
  const loose = (sg) => (band.max === null || sg.min <= band.max) && (band.min === null || sg.max >= band.min);
  const anyStrict = Boolean(band) && segs.some(strict);
  const hit = (sg) => Boolean(band) && (anyStrict ? strict(sg) : loose(sg));
  return { weightLabel: p.xray?.asins?.length ? "revenue" : "clicks", segments: segs.map((s) => ({ ...s, selected: hit(s), itemsShare: s.items / items.length, weightShare: s.weight / totalW })) };
}
