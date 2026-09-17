// Разбор Helium 10 Xray CSV (строки уже распарсены PapaParse с header:true).
// Ловушки: BOM в первом заголовке, «Price  USD» (двойной пробел), европейские числа,
// дубли ASIN, иерархия вариаций в Display Order («3.» родитель, «3.1.» вариация),
// Parent Level Revenue повторяется на каждой вариации — суммировать только ASIN Revenue.
import { toNum, toInt, parseDateEn } from "./num.js";

const COLS = {
  displayOrder: ["display order"],
  title: ["product details", "title", "product name"],
  asin: ["asin"],
  brand: ["brand"],
  price: ["price"],
  parentSales: ["parent level sales"],
  asinSales: ["asin sales", "sales"],
  recentPurchases: ["recent purchases", "bought in past month"],
  parentRevenue: ["parent level revenue"],
  asinRevenue: ["asin revenue", "revenue"],
  bsr: ["bsr"],
  fees: ["fees"],
  activeSellers: ["active sellers"],
  rating: ["ratings", "rating"],
  reviews: ["review count", "reviews"],
  reviewVelocity: ["review velocity"],
  category: ["category"],
  fulfillment: ["fulfillment"],
  creationDate: ["creation date"],
  sponsored: ["sponsored"],
  bestSeller: ["best seller"],
  sellerAge: ["seller age"],
  seller: ["seller"],
  sellerCountry: ["seller country"],
  url: ["url"],
  imageUrl: ["image url"],
};

function norm(h) {
  return String(h || "").replace(/^﻿/, "").toLowerCase().replace(/\s+/g, " ").replace(/\s*usd\s*$/, "").trim();
}

/** Сопоставляет заголовки файла с нашими полями. Возвращает {field: header}. */
export function mapXrayColumns(headers) {
  const normed = headers.map((h) => [h, norm(h)]);
  const map = {};
  for (const [field, aliases] of Object.entries(COLS)) {
    for (const alias of aliases) {
      // сначала точное совпадение, затем startsWith (Price USD, Fees USD)
      let hit = normed.find(([, n]) => n === alias);
      if (!hit) hit = normed.find(([, n]) => n.startsWith(alias) && !Object.values(map).includes(n));
      if (hit && !Object.values(map).includes(hit[0])) { map[field] = hit[0]; break; }
    }
  }
  return map;
}

export function isXrayHeaders(headers) {
  const m = mapXrayColumns(headers);
  return Boolean(m.asin && (m.asinRevenue || m.parentRevenue) && m.brand);
}

/**
 * @param {object[]} rows — объекты PapaParse (header: true)
 * @returns {{asins: object[], flags: object, columns: object}}
 */
export function parseXray(rows) {
  if (!rows?.length) return { asins: [], flags: { rowsTotal: 0, hasAsinSales: false, duplicatesDropped: 0, amazonSells: false }, columns: {} };
  const headers = Object.keys(rows[0]);
  const c = mapXrayColumns(headers);
  const get = (r, f) => (c[f] ? r[c[f]] : undefined);
  const seen = new Set();
  const asins = [];
  let duplicatesDropped = 0;
  let lastParent = null;
  let amazonSells = false;

  for (const r of rows) {
    const asin = String(get(r, "asin") || "").trim().toUpperCase();
    if (!/^B0[A-Z0-9]{8}$/.test(asin)) continue;
    const order = String(get(r, "displayOrder") ?? "").trim();
    const isVariation = /^\d+\.\d+\.?$/.test(order);
    if (!isVariation) lastParent = asin;
    if (seen.has(asin)) { duplicatesDropped++; continue; }
    seen.add(asin);
    const seller = String(get(r, "seller") || "").trim();
    if (/^amazon(\.com)?$/i.test(seller) || /^amazon(\.com)?$/i.test(String(get(r, "fulfillment") || ""))) amazonSells = true;
    asins.push({
      asin,
      parentAsin: isVariation ? lastParent : asin,
      isVariation,
      displayOrder: order || null,
      title: String(get(r, "title") || "").trim(),
      brand: String(get(r, "brand") || "").trim() || "(без бренда)",
      price: toNum(get(r, "price")),
      asinSales: toNum(get(r, "asinSales")),
      parentSales: toNum(get(r, "parentSales")),
      recentPurchases: toNum(get(r, "recentPurchases")),
      asinRevenue: toNum(get(r, "asinRevenue")),
      parentRevenue: toNum(get(r, "parentRevenue")),
      bsr: toInt(get(r, "bsr")),
      fees: toNum(get(r, "fees")),
      activeSellers: toInt(get(r, "activeSellers")),
      rating: toNum(get(r, "rating")),
      reviews: toInt(get(r, "reviews")),
      reviewVelocity: toInt(get(r, "reviewVelocity")),
      category: String(get(r, "category") || "").trim(),
      fulfillment: String(get(r, "fulfillment") || "").trim(),
      creationDate: parseDateEn(get(r, "creationDate")),
      sponsored: /yes|true|1/i.test(String(get(r, "sponsored") || "")),
      bestSeller: /yes|true|1/i.test(String(get(r, "bestSeller") || "")),
      seller,
      sellerCountry: String(get(r, "sellerCountry") || "").trim(),
      url: String(get(r, "url") || "").trim() || `https://www.amazon.com/dp/${asin}`,
      imageUrl: String(get(r, "imageUrl") || "").trim() || null,
    });
  }
  const hasAsinSales = Boolean(c.asinSales) && asins.some((a) => a.asinSales !== null);
  return {
    asins,
    flags: { rowsTotal: rows.length, hasAsinSales, duplicatesDropped, amazonSells, hasParentHierarchy: asins.some((a) => a.isVariation) },
    columns: c,
  };
}
