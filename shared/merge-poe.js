// Объединение нескольких ниш POE в один рынок (spec 007). Amazon часто делит один рынок на несколько ниш — каждый файл видит только его часть.
// Результат имеет ту же форму, что и parsePoe(): остальной расчёт о слиянии ничего не знает. Состав объединения — в poe.merged.
// Правила:
//  • вес ниши W = сумма кликов по её товарам за 360 дней (нет кликов — объём поиска ниши, нет и его — равные веса);
//  • товар в нескольких нишах — один раз: клики складываются, доля кликов = Σ(доля в нише × W) ÷ ΣW;
//  • запрос в нескольких нишах — один раз: объём поиска берётся один раз (это одни и те же поиски), доля кликов взвешивается так же, конверсия — максимальная;
//  • счётные показатели складываются, средние взвешиваются по W, доли топ-брендов и топ-товаров пересчитываются по объединённому списку;
//  • недельные тренды складываются только по неделям, которые есть во ВСЕХ нишах (иначе появились бы ложные провалы сезонности).
const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const up = (s) => String(s || "").toUpperCase();
const norm = (s) => String(s || "").toLowerCase().replace(/\s+/g, " ").trim();
export const MAX_POE_PARTS = 8;
const MIN_COMMON_WEEKS = 8;

const sumN = (xs) => { const v = xs.filter(isNum); return v.length ? v.reduce((a, b) => a + b, 0) : null; };
const maxN = (xs) => { const v = xs.filter(isNum); return v.length ? Math.max(...v) : null; };
const minN = (xs) => { const v = xs.filter(isNum); return v.length ? Math.min(...v) : null; };
/** Взвешенное среднее по парам [значение, вес]; пустые значения не участвуют. */
const wavg = (pairs) => { let s = 0, w = 0; for (const [v, k] of pairs) if (isNum(v) && isNum(k) && k > 0) { s += v * k; w += k; } return w > 0 ? s / w : null; };

/** Ключ ниши: идентификатор Amazon, а без него — название. */
export const poePartKey = (poe) => String(poe?.meta?.nicheId || norm(poe?.meta?.nicheTitle) || "");

/** Добавить нишу к списку: та же ниша обновляется (остаётся более свежая по порядку загрузки), новая — добавляется. → { parts, action: "added"|"updated" } */
export function upsertPoePart(parts, poe) {
  const key = poePartKey(poe), list = [...(parts || [])]; const i = list.findIndex((p) => poePartKey(p) === key && key);
  if (i >= 0) { list[i] = poe; return { parts: list, action: "updated" }; }
  if (list.length >= MAX_POE_PARTS) throw new Error(`В одном анализе можно объединить не больше ${MAX_POE_PARTS} ниш POE`);
  list.push(poe); return { parts: list, action: "added" };
}

function weights(parts) {
  const clicks = parts.map((p) => sumN((p.asinMetrics || []).map((a) => a.clickCountT360)));
  if (clicks.every((c) => isNum(c) && c > 0)) return { w: clicks, basis: "clicks" };
  const sv = parts.map((p) => p.nicheSummary?.searchVolumeT360);
  if (sv.every((c) => isNum(c) && c > 0)) return { w: sv, basis: "searchVolume" };
  return { w: parts.map(() => 1), basis: "equal" };
}

const COUNT_KEY = /Count|Launched|Launches/, SHARE_KEY = /^top(5|20)(Brands|Products)ClickShare/;

/**
 * @param {object[]} parts — результаты parsePoe() по каждой нише
 * @returns {object|null} POE той же формы; одна ниша возвращается КАК ЕСТЬ (тот же объект — расчёты совпадают с прежними)
 */
export function mergePoe(parts) {
  const list = (parts || []).filter(Boolean);
  if (!list.length) return null;
  if (list.length === 1) return list[0];
  const { w, basis } = weights(list); const W = w.reduce((a, b) => a + b, 0); const share = (i) => w[i] / W;
  const primary = w.indexOf(Math.max(...w));

  // ---------- товары ----------
  const amap = new Map(); let overlapAsins = 0;
  list.forEach((p, i) => { for (const a of p.asinMetrics || []) { const k = up(a.asin); if (!k) continue; const e = amap.get(k); if (e) { e.rows.push([a, i]); } else amap.set(k, { rows: [[a, i]] }); } });
  const asinMetrics = [...amap.entries()].map(([asin, { rows }]) => {
    if (rows.length > 1) overlapAsins++;
    const first = rows.find(([a]) => a.title)?.[0] || rows[0][0];
    const wsum = (f) => { let s = 0, any = false; for (const [a, i] of rows) if (isNum(a[f])) { s += a[f] * share(i); any = true; } return any ? s : null; };
    const dates = rows.map(([a]) => a.launchDate).filter(Boolean).sort();
    return { asin: first.asin, brand: first.brand, title: first.title, imageUrl: first.imageUrl ?? null,
      price: wavg(rows.map(([a, i]) => [a.price, (a.clickShareT360 ?? 0) * w[i] || w[i]])), clickShareT360: wsum("clickShareT360"), clickShareT90: wsum("clickShareT90"),
      clickCountT360: sumN(rows.map(([a]) => a.clickCountT360)), rating: rows.map(([a]) => a.rating).find(isNum) ?? null, reviews: maxN(rows.map(([a]) => a.reviews)),
      launchDate: dates[0] || null, bsr: minN(rows.map(([a]) => a.bsr)), sellers: maxN(rows.map(([a]) => a.sellers)), category: first.category || "", niches: rows.length };
  }).sort((a, b) => (b.clickShareT360 ?? 0) - (a.clickShareT360 ?? 0));

  // ---------- запросы ----------
  const tmap = new Map(); let overlapTerms = 0, dupSv360 = 0, dupSv90 = 0;
  list.forEach((p, i) => { for (const t of p.searchTermMetrics || []) { const k = norm(t.term); if (!k) continue; const e = tmap.get(k); if (e) e.push([t, i]); else tmap.set(k, [[t, i]]); } });
  const searchTermMetrics = [...tmap.values()].map((rows) => {
    const t0 = rows[0][0]; const sv360 = rows.map(([t]) => t.svT360), sv90 = rows.map(([t]) => t.svT90);
    if (rows.length > 1) { overlapTerms++; dupSv360 += (sumN(sv360) ?? 0) - (maxN(sv360) ?? 0); dupSv90 += (sumN(sv90) ?? 0) - (maxN(sv90) ?? 0); }
    const seen = new Set(); const topClicked = rows.flatMap(([t]) => t.topClicked || []).filter((x) => { const k = up(x.asin); if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, 6);
    let cs = 0, anyCs = false; for (const [t, i] of rows) if (isNum(t.clickShareT360)) { cs += t.clickShareT360 * share(i); anyCs = true; }
    return { term: t0.term, svT360: maxN(sv360), svT90: maxN(sv90), growthT360Yoy: rows.map(([t]) => t.growthT360Yoy).find(isNum) ?? null, growthT180: rows.map(([t]) => t.growthT180).find(isNum) ?? null, qoq: rows.map(([t]) => t.qoq).find(isNum) ?? null,
      clickShareT360: anyCs ? cs : null, convT360: maxN(rows.map(([t]) => t.convT360)), topClicked, niches: rows.length };
  }).sort((a, b) => (b.svT360 ?? 0) - (a.svT360 ?? 0));

  // ---------- сводка ниши ----------
  const S = list.map((p) => p.nicheSummary || {}); const byW = (f) => wavg(S.map((s, i) => [s[f], w[i]]));
  const sv360 = sumN(S.map((s) => s.searchVolumeT360)), sv90 = sumN(S.map((s) => s.searchVolumeT90));
  const bySv = (f) => wavg(S.map((s) => [s[f], s.searchVolumeT360 ?? 1]));
  const nicheSummary = { avgPrice: byW("avgPrice"), minPrice: minN(S.map((s) => s.minPrice)), maxPrice: maxN(S.map((s) => s.maxPrice)),
    productCount: isNum(sumN(S.map((s) => s.productCount))) ? Math.max(asinMetrics.length, sumN(S.map((s) => s.productCount)) - overlapAsins) : null,
    searchVolumeT360: isNum(sv360) ? sv360 - dupSv360 : null, searchVolumeT90: isNum(sv90) ? sv90 - dupSv90 : null,
    searchVolumeGrowthT360: bySv("searchVolumeGrowthT360"), searchVolumeGrowthT180: bySv("searchVolumeGrowthT180"), searchVolumeGrowthT90: bySv("searchVolumeGrowthT90"),
    minUnitsT360: sumN(S.map((s) => s.minUnitsT360)), maxUnitsT360: sumN(S.map((s) => s.maxUnitsT360)), minUnitsT90: sumN(S.map((s) => s.minUnitsT90)), maxUnitsT90: sumN(S.map((s) => s.maxUnitsT90)),
    minAvgUnitsT360: byW("minAvgUnitsT360"), maxAvgUnitsT360: byW("maxAvgUnitsT360"), returnRateT360: byW("returnRateT360") };

  // ---------- структура ниши (сейчас / квартал назад / год назад) ----------
  const topShare = (n, by) => { const m = new Map(); for (const a of asinMetrics) { const k = by === "brand" ? a.brand : a.asin; m.set(k, (m.get(k) || 0) + (a.clickShareT360 ?? 0)); } return [...m.values()].sort((x, y) => y - x).slice(0, n).reduce((x, y) => x + y, 0); };
  const keys = new Set(list.flatMap((p) => Object.keys(p.launchPotential || {}))); const launchPotential = {};
  for (const k of keys) {
    const stats = list.map((p) => p.launchPotential?.[k] || null); const m = SHARE_KEY.exec(k);
    if (m) { launchPotential[k] = { current: topShare(Number(m[1]), m[2] === "Brands" ? "brand" : "asin"), qoq: null, yoy: null, recomputed: true }; continue; } // прошлые периоды по объединённому рынку восстановить нельзя
    const f = (part) => (COUNT_KEY.test(k) && !/^avg/.test(k) ? sumN(stats.map((s) => s?.[part])) : wavg(stats.map((s, i) => [s?.[part], w[i]])));
    launchPotential[k] = { current: f("current"), qoq: f("qoq"), yoy: f("yoy") };
  }

  // ---------- недельные тренды: только недели, общие для всех ниш ----------
  const dateSets = list.map((p) => new Set((p.trends || []).map((t) => t.date))); const common = [...dateSets[0]].filter((d) => dateSets.every((s) => s.has(d))).sort();
  let trends, trendsFrom = "common";
  if (common.length >= MIN_COMMON_WEEKS) {
    const idx = list.map((p) => new Map((p.trends || []).map((t) => [t.date, t])));
    trends = common.map((date) => { const rows = idx.map((m) => m.get(date)); const bySvW = (f) => wavg(rows.map((r) => [r[f], r.sv ?? 1])); const add = (f) => sumN(rows.map((r) => r[f]));
      return { date, sv: add("sv"), price: bySvW("price"), top5Brand: bySvW("top5Brand"), top20Brand: bySvW("top20Brand"), top5Prod: bySvW("top5Prod"), top20Prod: bySvW("top20Prod"), conv: bySvW("conv"),
        productCount: add("productCount"), brandCount: add("brandCount"), sponsoredCount: add("sponsoredCount"), newProductsT90: add("newProductsT90"), successT90: add("successT90"), avgReviews: bySvW("avgReviews"), avgRating: bySvW("avgRating"), oos: bySvW("oos") }; });
  } else { trends = list[primary].trends || []; trendsFrom = "primary"; }

  // ---------- темы отзывов: одноимённые сливаются со взвешенной долей ----------
  const topics = (f) => { const m = new Map(); list.forEach((p, i) => { for (const t of p.pdr?.[f] || []) { const k = norm(t.topic); if (!k) continue; const e = m.get(k) || { topic: t.topic, pct: 0, verbatims: [] }; e.pct += (t.pct ?? 0) * share(i); for (const v of t.verbatims || []) if (e.verbatims.length < 3 && !e.verbatims.includes(v)) e.verbatims.push(v); m.set(k, e); } });
    return [...m.values()].sort((a, b) => b.pct - a.pct).slice(0, 10); };
  const pdr = { negative: topics("negative"), positive: topics("positive"), returns: topics("returns").map(({ topic, pct }) => ({ topic, pct })) };

  const captured = list.map((p) => p.meta?.capturedAt).filter(Boolean).sort(); const spreadDays = captured.length > 1 ? Math.round((new Date(captured.at(-1)) - new Date(captured[0])) / 86400000) : 0;
  const niches = list.map((p, i) => ({ key: poePartKey(p), nicheId: p.meta?.nicheId || null, title: p.meta?.nicheTitle || "(без названия)", asins: (p.asinMetrics || []).length, terms: (p.searchTermMetrics || []).length, weight: share(i), capturedAt: p.meta?.capturedAt || null, primary: i === primary }));
  return {
    meta: { nicheId: null, nicheTitle: niches.map((n) => n.title).join(" + "), marketplaceId: list[primary].meta?.marketplaceId || null, capturedAt: captured.at(-1) || null, lastUpdated: list[primary].meta?.lastUpdated || null, currency: list[primary].meta?.currency || "USD" },
    nicheSummary, launchPotential, asinMetrics, searchTermMetrics, trends, pdr, insights: list[primary].insights || {},
    merged: { count: list.length, weightBasis: basis, niches, overlapAsins, overlapTerms, asinsTotal: asinMetrics.length, termsTotal: searchTermMetrics.length, trendsFrom, commonWeeks: common.length, capturedSpreadDays: spreadDays, insightsFrom: niches[primary].title },
  };
}

/** Пометки о том, как собран объединённый рынок, — для секции «Особенности данных POE» и для AI. */
export function mergedPoeNotes(poe) {
  const m = poe?.merged; if (!m) return [];
  const pc = (v) => Math.round(v * 100) + " %"; const notes = [];
  notes.push({ id: "merged", text: `POE объединён из ${m.count} ниш: ${m.niches.map((n) => `«${n.title}» — ${n.asins} товаров, ${pc(n.weight)} ${m.weightBasis === "clicks" ? "кликов" : m.weightBasis === "searchVolume" ? "объёма поиска" : "(веса равные)"}`).join("; ")}. Товары и запросы учтены по одному разу: клики сложены, доли кликов пересчитаны от общего числа кликов, объём поиска общего запроса взят один раз.` });
  if (m.overlapAsins || m.overlapTerms) notes.push({ id: "mergedOverlap", text: `Общих товаров в нишах: ${m.overlapAsins} из ${m.asinsTotal}, общих запросов: ${m.overlapTerms} из ${m.termsTotal}. Клики общих товаров по общим запросам могут быть учтены дважды — разделить их по данным POE нельзя, поэтому доли таких товаров слегка завышены.` });
  notes.push({ id: "mergedApprox", text: `Сложены: число товаров, брендов, продавцов, запусков и успешных запусков, оценка проданных штук (при общих товарах это верхняя оценка). Взвешены по весу ниш: средние отзывы, рейтинг, цена, доля спонсорских, отсутствие в наличии, возвраты, темы отзывов. Доли топ-брендов и топ-товаров пересчитаны по объединённому списку; их значения «квартал / год назад» не показываются. Выводы Amazon (Insights) — из ниши «${m.insightsFrom}».` });
  notes.push({ id: "mergedTrends", text: m.trendsFrom === "common" ? `Недельные тренды сложены по ${m.commonWeeks} неделям, которые есть во всех нишах.` : `Общих недель в трендах ниш мало (${m.commonWeeks}) — сезонность взята по самой крупной нише.` });
  if (m.capturedSpreadDays > 30) notes.push({ id: "mergedDates", text: `Файлы ниш сняты с разницей ${m.capturedSpreadDays} дн. — возраст листингов считается от самой поздней даты.` });
  if (m.weightBasis !== "clicks") notes.push({ id: "mergedWeights", text: m.weightBasis === "searchVolume" ? "Не у всех ниш есть счётчики кликов по товарам — веса ниш взяты по объёму поиска." : "Нет ни кликов, ни объёма поиска по нишам — веса ниш равные." });
  return notes;
}
