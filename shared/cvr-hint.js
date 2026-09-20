// Подсказка для CVR. В расчётах рекламы нужна конверсия «клик → покупка»: цена продажи с рекламы = CPC / CVR.
// Два источника данных:
//  • POE — конверсия клика НИШИ: покупки по запросам ÷ клики по товарам ниши. Доступна для любой ниши, в том числе новой.
//  • SQP (Brand Analytics) — покупки ÷ клики по запросам, по всему рынку запроса и по ASIN продавца. Есть только у бренда, который уже продаёт.
// «Purchase rate %» из SQP и «конверсия поиска» из POE — это покупки на объём ПОИСКА (в разы ниже), в рекламную математику они не годятся.
const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const norm = (s) => String(s || "").toLowerCase().replace(/\s+/g, " ").trim();
export const CVR_HINT_MIN_CLICKS = { market: 200, mine: 50, poe: 1000 }; // меньше — выборка мала, подсказка помечается как ненадёжная

function aggregate(rows, clicksKey, purchasesKey) {
  let clicks = 0, purchases = 0, queries = 0;
  for (const r of rows) { if (isNum(r[clicksKey]) && r[clicksKey] > 0 && isNum(r[purchasesKey])) { clicks += r[clicksKey]; purchases += r[purchasesKey]; queries++; } }
  return clicks > 0 ? { cvr: purchases / clicks, clicks, purchases, queries } : null;
}

/**
 * Конверсия клика ниши целиком из POE. Числитель и знаменатель — об одном: покупки после поиска по запросам ниши и клики из поиска по товарам ниши, за 360 дней.
 *   покупки по запросу = объём поиска × доля поисков с покупкой;  клики по запросу = клик-доля запроса × сумма кликов по товарам ниши.
 * Самопроверка: конверсия клика обязана быть выше конверсии поиска (кликают не после каждого поиска) — иначе данные неполные, подсказка не выдаётся.
 */
export function poeClickConversion(poe) {
  const asins = poe?.asinMetrics || [], terms = poe?.searchTermMetrics || [];
  const nicheClicks = asins.reduce((s, a) => s + (isNum(a.clickCountT360) ? a.clickCountT360 : 0), 0);
  if (!(nicheClicks > 0) || !terms.length) return null;
  let purchases = 0, clicks = 0, searches = 0, used = 0, shareSum = 0;
  for (const t of terms) {
    if (!isNum(t.svT360) || !isNum(t.convT360) || !isNum(t.clickShareT360)) continue; // подставных значений вместо пустых полей не берём
    purchases += t.svT360 * t.convT360; clicks += t.clickShareT360 * nicheClicks; searches += t.svT360; shareSum += t.clickShareT360; used++;
  }
  if (!used || !(clicks > 0) || !(searches > 0)) return null;
  const cvr = purchases / clicks, searchConv = purchases / searches;
  if (!(cvr > searchConv) || cvr > 1) return null;
  return { cvr, searchConv, clicks: Math.round(clicks), purchases: Math.round(purchases), queries: used, queriesTotal: terms.length, asins: asins.length,
    clickShareCovered: shareSum, smallSample: clicks < CVR_HINT_MIN_CLICKS.poe || shareSum < 0.5 };
}

/**
 * @param {object} src { sqp, poe } — результат parseSqp и parsePoe (любой может отсутствовать)
 * @param {object} ctx { coreKeyword, clusterKeywords: string[], realistic: [min, max] }
 * @returns {object|null} null — данных о конверсии клика нет ни в одном источнике
 */
export function cvrHint({ sqp = null, poe = null } = {}, { coreKeyword = "", clusterKeywords = [], realistic = [0.08, 0.15] } = {}) {
  const niche = poeClickConversion(poe);
  let market = null, mine = null, scope = null;
  const rows = sqp?.rows || [];
  if (rows.length) {
    const core = norm(coreKeyword); const cluster = new Set([core, ...clusterKeywords.map(norm)].filter(Boolean));
    const coreTokens = core.split(" ").filter((t) => t.length > 2);
    scope = "cluster"; let picked = rows.filter((r) => cluster.has(norm(r.query)));
    if (picked.length < 3 && coreTokens.length) { const byCore = rows.filter((r) => coreTokens.every((t) => norm(r.query).includes(t))); if (byCore.length > picked.length) { picked = byCore; scope = "core"; } }
    if (!picked.length) { picked = rows; scope = "all"; }
    market = aggregate(picked, "clicks", "purchases"); mine = aggregate(picked, "clicksAsin", "purchasesAsin");
    if (market) market.smallSample = market.clicks < CVR_HINT_MIN_CLICKS.market;
    if (mine) mine.smallSample = mine.clicks < CVR_HINT_MIN_CLICKS.mine;
  }
  if (!niche && !market && !mine) return null;
  const out = { source: market || mine ? (niche ? "sqp+poe" : "sqp") : "poe", scope, scopeLabel: scope ? { cluster: "по запросам вашего кластера", core: "по запросам с главным ключом", all: "по всем запросам отчёта" }[scope] : null,
    niche, market, mine };
  // Что предлагать НОВОМУ листингу: рынок по SQP (самый близкий срез), затем конверсия клика ниши из POE, затем свой зрелый ASIN.
  const base = [market, niche, mine].find((x) => x && !x.smallSample) || market || niche || mine;
  out.suggested = Math.round(base.cvr * 1000) / 1000; out.suggestedFrom = base === market ? "market" : base === niche ? "niche" : "mine";
  out.aboveRealistic = out.suggested > realistic[1]; out.belowRealistic = out.suggested < realistic[0];
  return out;
}
