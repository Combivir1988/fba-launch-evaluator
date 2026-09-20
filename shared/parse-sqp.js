// Search Query Performance (Brand Analytics) — ASIN/Brand view. Первая служебная строка
// («ASIN or Product=[...]») отбрасывается вызывающей стороной до PapaParse (см. public/js/files.js).
import { toNum, safeDiv } from "./num.js";

const norm = (h) => String(h || "").replace(/^﻿/, "").toLowerCase().replace(/\s+/g, " ").trim();
const find = (headers, ...aliases) => headers.find((h) => aliases.includes(norm(h)));

export function isSqpHeaders(headers) {
  return Boolean(find(headers, "search query") && find(headers, "search query volume"));
}

export function parseSqp(rows) {
  if (!rows?.length) return { rows: [], flags: { rowsTotal: 0 } };
  const h = Object.keys(rows[0]);
  const cQ = find(h, "search query"), cV = find(h, "search query volume"),
    cI = find(h, "impressions: total count"), cC = find(h, "clicks: total count"),
    cA = find(h, "cart adds: total count"), cP = find(h, "purchases: total count"),
    cPr = find(h, "purchases: purchase rate %"), cPa = find(h, "purchases: asin count"), cCa = find(h, "clicks: asin count"), cScore = find(h, "search query score");
  const out = rows.map((r) => {
    const volume = toNum(r[cV]); const purchases = toNum(r[cP]);
    return {
      query: String(r[cQ] || "").trim(), score: toNum(r[cScore]), volume,
      impressions: toNum(r[cI]), clicks: toNum(r[cC]), cartAdds: toNum(r[cA]), purchases,
      purchasesAsin: toNum(r[cPa]), clicksAsin: cCa ? toNum(r[cCa]) : null,
      purchaseRate: cPr && toNum(r[cPr]) !== null ? toNum(r[cPr]) / 100 : safeDiv(purchases, volume),
    };
  }).filter((r) => r.query && r.volume !== null);
  out.sort((a, b) => b.volume - a.volume);
  return { rows: out, flags: { rowsTotal: rows.length } };
}
