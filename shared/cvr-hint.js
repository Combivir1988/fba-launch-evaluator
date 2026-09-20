// Подсказка для CVR из Search Query Performance (Brand Analytics). В расчётах рекламы нужна конверсия «клик → покупка»:
// цена продажи с рекламы = CPC / CVR. В SQP она считается честно: покупки / клики — и по всему рынку запроса, и по ASIN продавца.
// «Purchase rate %» из SQP — это покупки / объём поиска (в разы ниже) и для рекламной математики не годится, поэтому не используется.
const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const norm = (s) => String(s || "").toLowerCase().replace(/\s+/g, " ").trim();
export const CVR_HINT_MIN_CLICKS = { market: 200, mine: 50 }; // меньше — выборка мала, подсказка помечается как ненадёжная

function aggregate(rows, clicksKey, purchasesKey) {
  let clicks = 0, purchases = 0, queries = 0;
  for (const r of rows) { if (isNum(r[clicksKey]) && r[clicksKey] > 0 && isNum(r[purchasesKey])) { clicks += r[clicksKey]; purchases += r[purchasesKey]; queries++; } }
  return clicks > 0 ? { cvr: purchases / clicks, clicks, purchases, queries } : null;
}

/**
 * @param {object} sqp результат parseSqp
 * @param {object} ctx { coreKeyword, clusterKeywords: string[], realistic: [min, max] }
 * @returns {object|null} null — SQP не загружен или в нём нет кликов
 */
export function cvrHint(sqp, { coreKeyword = "", clusterKeywords = [], realistic = [0.08, 0.15] } = {}) {
  const rows = sqp?.rows || []; if (!rows.length) return null;
  const core = norm(coreKeyword); const cluster = new Set([core, ...clusterKeywords.map(norm)].filter(Boolean));
  const coreTokens = core.split(" ").filter((t) => t.length > 2);
  let scope = "cluster", picked = rows.filter((r) => cluster.has(norm(r.query)));
  if (picked.length < 3 && coreTokens.length) { const byCore = rows.filter((r) => coreTokens.every((t) => norm(r.query).includes(t))); if (byCore.length > picked.length) { picked = byCore; scope = "core"; } }
  if (!picked.length) { picked = rows; scope = "all"; }
  const market = aggregate(picked, "clicks", "purchases"); const mine = aggregate(picked, "clicksAsin", "purchasesAsin");
  if (!market && !mine) return null;
  const mark = (x, min) => (x ? { ...x, smallSample: x.clicks < min } : null);
  const out = { source: "sqp", scope, scopeLabel: { cluster: "по запросам вашего кластера", core: "по запросам с главным ключом", all: "по всем запросам отчёта" }[scope],
    market: mark(market, CVR_HINT_MIN_CLICKS.market), mine: mark(mine, CVR_HINT_MIN_CLICKS.mine) };
  // Для НОВОГО листинга честнее рынок: у свежей карточки нет отзывов и истории, конверсия зрелого собственного ASIN на неё не переносится.
  const base = out.market && !out.market.smallSample ? out.market : out.mine && !out.mine.smallSample ? out.mine : out.market || out.mine;
  out.suggested = Math.round(base.cvr * 1000) / 1000; out.suggestedFrom = base === out.market ? "market" : "mine";
  out.aboveRealistic = out.suggested > realistic[1]; out.belowRealistic = out.suggested < realistic[0];
  return out;
}
