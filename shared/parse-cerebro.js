// Разбор Helium 10 Cerebro CSV + автоотбор кластера релевантных ключей.
// Исключаем строки-ASIN («b0751cbxbt») и брендовые запросы (по списку брендов Xray) —
// пользователь может вернуть их вручную (SKILL: отбор по смысловой близости, не топ-N слепо).
import { toNum, toInt, isBound } from "./num.js";

const COLS = {
  phrase: ["keyword phrase", "keyword", "search term", "phrase"],
  abaClickShare: ["aba total click share"],
  abaConvShare: ["aba total conv. share", "aba total conv share"],
  keywordSales: ["keyword sales"],
  iq: ["cerebro iq score"],
  sv: ["search volume"],
  svTrend: ["search volume trend"],
  bid: ["h10 ppc sugg. bid", "suggested bid", "sugg. bid"],
  bidMin: ["h10 ppc sugg. min bid"],
  bidMax: ["h10 ppc sugg. max bid"],
  sponsoredAsins: ["sponsored asins"],
  competing: ["competing products"],
  cpr: ["cpr"],
  organic: ["organic"],
  titleDensity: ["title density"],
  amazonRecommended: ["amazon recommended"],
  // Cerebro по нескольким ASIN (multi-ASIN): сколько из заданных конкурентов ранжируются по фразе
  rankingCompetitors: ["ranking competitors (count)", "ranking competitors", "competitors ranking"],
  competitorRankAvg: ["competitor rank (avg)", "competitor rank avg", "competitor rank"],
  position: ["position (rank)", "position"],
  relativeRank: ["relative rank"],
  performanceScore: ["competitor performance score"],
};
const norm = (h) => String(h || "").replace(/^﻿/, "").toLowerCase().replace(/\s+/g, " ").trim();

export function mapCerebroColumns(headers) {
  const normed = headers.map((h) => [h, norm(h)]);
  const map = {};
  for (const [field, aliases] of Object.entries(COLS)) {
    for (const alias of aliases) {
      const hit = normed.find(([, n]) => n === alias);
      if (hit && !Object.values(map).includes(hit[0])) { map[field] = hit[0]; break; }
    }
  }
  return map;
}
export function isCerebroHeaders(headers) {
  const m = mapCerebroColumns(headers);
  return Boolean(m.phrase && m.sv);
}

export const ASIN_RE = /^b0[a-z0-9]{8}$/i;

/** Лёгкая нормализация токена: нижний регистр, без дефисов, без конечного s/es. */
export function stem(w) {
  let s = String(w).toLowerCase().replace(/[^a-z0-9]+/g, "");
  if (s.length > 4 && s.endsWith("ies")) s = s.slice(0, -3) + "y";
  else if (s.length > 4 && s.endsWith("es")) s = s.slice(0, -2);
  else if (s.length > 3 && s.endsWith("s")) s = s.slice(0, -1);
  return s;
}
export const tokens = (phrase) => String(phrase).toLowerCase().split(/[^a-z0-9]+/).filter(Boolean).map(stem);

// ---------- брендовые запросы ----------
const BRAND_STOP = new Set(["the", "and", "for", "pro", "max", "plus", "new", "generic", "unbranded", "brand", "inc", "llc", "ltd", "usa", "shop", "store", "official", "без бренда"]);
const normBrand = (b) => String(b ?? "").toLowerCase().replace(/['’`]/g, "").replace(/[^a-z0-9а-яё]+/gi, " ").trim();
/**
 * Матчер брендовых запросов. Бренд считается найденным, если запрос содержит нормализованное имя бренда (без апострофов и знаков:
 * «Ling's moment» → «lings moment», «Melorca&Guilla» → «melorca guilla») или — отдельным словом — его «голову»: первое слово
 * двухсловного бренда либо основу притяжательного («Mandy's» → «mandy»), если голова не короче 5 букв, не общее слово и не слово core-ключа.
 */
export function brandMatcher(brands = [], coreKeyword = "") {
  const core = new Set(normBrand(coreKeyword).split(" ").filter(Boolean));
  const full = new Set(), heads = new Set();
  for (const raw of brands || []) {
    const n = normBrand(raw); if (!n || n.length < 3 || BRAND_STOP.has(n)) continue; full.add(n);
    const first = String(raw).trim().split(/\s+/)[0] || ""; const head = normBrand(first);
    const possessive = /['’]s$/i.test(first);
    if ((n.includes(" ") || possessive) && head) { const h = possessive ? head.replace(/s$/, "") : head; if (h.length >= 5 && !BRAND_STOP.has(h) && !core.has(h)) heads.add(h); }
  }
  return (phrase) => { const p = normBrand(phrase); if (!p) return false; for (const f of full) if (p.includes(f)) return true; const padded = " " + p + " "; for (const h of heads) if (padded.includes(" " + h + " ")) return true; return false; };
}
/** Все известные бренды анализа: Xray, POE (в т. ч. объединённый) и список исключённых брендов. */
export function knownBrands({ xray, poe, excludedBrands } = {}) {
  const out = new Set();
  for (const a of xray?.asins || []) if (a?.brand) out.add(String(a.brand).trim());
  for (const a of poe?.asinMetrics || []) if (a?.brand) out.add(String(a.brand).trim());
  for (const b of excludedBrands || []) if (b) out.add(String(b).trim());
  return [...out].filter((b) => b && !/^\(без бренда\)$/i.test(b));
}

/**
 * @param {object[]} rows PapaParse rows
 * @param {{coreKeyword?: string, brands?: string[], minSv?: number}} opts
 */
export function parseCerebro(rows, opts = {}) {
  if (!rows?.length) return { keywords: [], flags: { rowsTotal: 0 } };
  const c = mapCerebroColumns(Object.keys(rows[0]));
  const get = (r, f) => (c[f] ? r[c[f]] : undefined);
  const isBrand = brandMatcher(opts.brands, opts.coreKeyword);
  const coreTokens = tokens(opts.coreKeyword || "");
  const seen = new Set();
  const keywords = [];
  for (const r of rows) {
    const phrase = String(get(r, "phrase") || "").trim();
    if (!phrase) continue;
    const key = phrase.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const competingRaw = get(r, "competing");
    const isAsin = ASIN_RE.test(phrase);
    const isBranded = isBrand(phrase);
    const toks = tokens(phrase);
    const relevance = coreTokens.length ? coreTokens.filter((t) => toks.includes(t)).length / coreTokens.length : 0;
    keywords.push({
      phrase, isAsin, isBranded, relevance,
      isCore: coreTokens.length > 0 && key === String(opts.coreKeyword).toLowerCase().trim(),
      sv: toInt(get(r, "sv")) ?? 0,
      svTrend: toNum(get(r, "svTrend")),
      bid: toNum(get(r, "bid")), bidMin: toNum(get(r, "bidMin")), bidMax: toNum(get(r, "bidMax")),
      sponsoredAsins: toInt(get(r, "sponsoredAsins")),
      competingProducts: toInt(competingRaw), competingIsBound: isBound(competingRaw),
      cpr: toInt(get(r, "cpr")),
      abaClickShare: toNum(get(r, "abaClickShare")), abaConvShare: toNum(get(r, "abaConvShare")),
      keywordSales: toInt(get(r, "keywordSales")), iq: toNum(get(r, "iq")),
      organicRank: toInt(get(r, "organic")), titleDensity: toInt(get(r, "titleDensity")),
      amazonRecommended: toInt(get(r, "amazonRecommended")),
      rankingCompetitors: toInt(get(r, "rankingCompetitors")), competitorRankAvg: toNum(get(r, "competitorRankAvg")),
      position: toInt(get(r, "position")), performanceScore: toNum(get(r, "performanceScore")),
    });
  }
  keywords.sort((a, b) => b.sv - a.sv);
  const multiAsin = Boolean(c.rankingCompetitors) && keywords.some((k) => k.rankingCompetitors !== null);
  const maxCompetitors = multiAsin ? Math.max(...keywords.map((k) => k.rankingCompetitors ?? 0)) : null;
  return { keywords, flags: { rowsTotal: rows.length, coreFound: keywords.some((k) => k.isCore), multiAsin, maxCompetitors } };
}

/** Пересчёт флагов isCore/isBranded/relevance при смене core-ключа или списка брендов (без сырых строк). */
export function annotateKeywords(keywords, opts = {}) {
  const isBrand = brandMatcher(opts.brands, opts.coreKeyword);
  const coreTokens = tokens(opts.coreKeyword || "");
  const core = String(opts.coreKeyword || "").toLowerCase().trim();
  return keywords.map((k) => {
    const key = k.phrase.toLowerCase(); const toks = tokens(k.phrase);
    return { ...k, isBranded: isBrand(k.phrase), isCore: coreTokens.length > 0 && key === core,
      relevance: coreTokens.length ? coreTokens.filter((t) => toks.includes(t)).length / coreTokens.length : 0 };
  });
}

/** Экспорт Cerebro по нескольким ASIN? (есть колонка Ranking Competitors) */
export const isMultiAsin = (keywords) => keywords.some((k) => typeof k.rankingCompetitors === "number");

/** Порог «конкурентов в топе» по умолчанию для multi-ASIN Cerebro: число ASIN в отчёте минус один (не меньше 1); без multi-ASIN — порог из настроек. */
export function defaultMinCompetitors(cerebro, fallback = 3) {
  const n = cerebro?.flags?.multiAsin ? cerebro.flags.maxCompetitors : null;
  return typeof n === "number" && n >= 2 ? n - 1 : fallback;
}

/**
 * Автопредложение кластера.
 * Multi-ASIN Cerebro (правило отбора): фраза релевантна, если по ней ранжируются ≥ minCompetitors из заданных
 * конкурентов (по умолчанию 3) — и хотя бы одно слово core-ключа совпадает (страховка от мусора).
 * Single-ASIN: релевантность ≥ 2/3 токенов core-ключа (для core из 1–2 слов — все).
 * Всегда: не ASIN, не бренд, SV ≥ minSv. Возвращает фразы (≤ limit) по убыванию SV.
 */
export function suggestCluster(keywords, opts = {}) {
  const minSv = opts.minSv ?? 100;
  const limit = opts.limit ?? 40;
  const minComp = opts.minCompetitors ?? 3;
  const coreLen = tokens(opts.coreKeyword || "").length;
  const minRel = coreLen <= 2 ? 0.999 : 2 / 3 - 1e-9;
  const multi = isMultiAsin(keywords);
  return keywords
    .filter((k) => !k.isAsin && !k.isBranded && k.sv >= minSv && (k.isCore || (multi
      ? (k.rankingCompetitors ?? 0) >= minComp && (coreLen === 0 || k.relevance > 0)
      : k.relevance >= minRel)))
    .slice(0, multi ? Math.max(limit, 60) : limit)
    .map((k) => k.phrase);
}
