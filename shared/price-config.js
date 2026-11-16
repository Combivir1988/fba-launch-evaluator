// Ценовой ориентир по конфигурации (spec 013): цены листингов-аналогов с такой же конфигурацией (взвешенная выручкой медиана, P25–P75),
// вклад каждого поля относительно доминанты, ориентир себестоимости. Детерминированно, без AI.
import { median, round } from "./num.js";
import { revenueOf } from "./config-scope.js";
import { normKey } from "./config-extract.js";
import { valueLabel } from "./config-stats.js";
import { effectivePrice } from "./promo-stats.js";

const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const TIERS = [1, 0.8, 0.6];

/** Взвешенный квантиль: элементы {v, w}. */
export function wquantile(items, q) {
  const s = items.filter((x) => isNum(x.v) && isNum(x.w) && x.w >= 0).sort((a, b) => a.v - b.v); if (!s.length) return null;
  const total = s.reduce((a, x) => a + x.w, 0); if (total <= 0) return median(s.map((x) => x.v));
  let acc = 0; for (const x of s) { acc += x.w; if (acc / total >= q) return x.v; } return s.at(-1).v;
}
/** Интервал вида «6–15» (числовое поле с большим разбросом показывается интервалами). → [lo, hi] или null */
export function parseRange(v) {
  const t = String(v ?? "").trim(); const num = (x) => Number(String(x).replace(",", "."));
  const m = /^(-?\d+(?:[.,]\d+)?)\s*[–—-]\s*(-?\d+(?:[.,]\d+)?)$/.exec(t);
  if (m) return [num(m[1]), num(m[2])];
  const from = /^(?:от|more than|≥|>=?)\s*(-?\d+(?:[.,]\d+)?)\+?$/i.exec(t) || /^(-?\d+(?:[.,]\d+)?)\+$/.exec(t);
  if (from) return [num(from[1]), Infinity];
  const to = /^(?:до|less than|≤|<=?)\s*(-?\d+(?:[.,]\d+)?)$/i.exec(t);
  if (to) return [-Infinity, num(to[1])];
  return null;
}
/** Совпадение значения строки со значением, выбранным в селекте. Для интервала — попадание числа внутрь. */
const same = (field, a, b) => {
  if (field.type === "number") {
    const r = parseRange(b);
    if (r) return isNum(a) && a >= r[0] - 1e-9 && a <= r[1] + 1e-9;
    return isNum(a) && isNum(b) && Math.abs(a - b) < 1e-9;
  }
  return normKey(a) === normKey(b);
};

/**
 * @param {object} o { config: core.config, stats: results.config.whole, xray, listings, choice: config.priceChoice, inputs, th }
 * @returns {object|null} { fields, selectedCount, tier, analogs, market, entry, ceiling, marketEff, cogsCeiling, contributions, warn }
 * Потолок себестоимости: COGS ≤ цена × (1 − referral − маржа) − FBA − доставка до склада − реклама на единицу,
 * и одновременно не выше порога Gate 1 (там маржа считается без рекламы, а в дешёвом сегменте планка выше).
 */
export function priceByConfig({ config, stats, xray, listings = {}, choice = {}, inputs = {}, th = {} } = {}) {
  const rows = Object.entries(config?.table?.rows || {}); if (!stats || !rows.length) return null;
  const byAsin = new Map((xray?.asins || []).map((a) => [a.asin, a]));
  const fields = (config.schema?.fields || []).filter((f) => f.type !== "text").map((f) => {
    const st = stats.fields.find((x) => x.id === f.id); const values = (st?.values || []).filter((v) => !v.noData).slice(0, 12);
    const has = Object.prototype.hasOwnProperty.call(choice, f.id); const raw = has ? choice[f.id] : (st?.dominant?.value ?? null);
    // Число может прийти интервалом («6–15») — тогда оставляем строкой, иначе Number() дал бы NaN и поле «не выбиралось».
    const value = raw === null || raw === undefined || raw === "" ? null : f.type === "number" && !parseRange(raw) ? Number(raw) : raw;
    return { id: f.id, name: f.name, type: f.type, unit: f.unit || null, value, label: value === null ? null : valueLabel(f, value), dominant: st?.dominant?.value ?? null, dominantLabel: st?.dominant?.label ?? null, values: values.map((v) => ({ value: v.value, label: v.label, share: v.share, avgPrice: v.avgPrice, premium: v.premium })), field: f };
  });
  const selected = fields.filter((f) => f.value !== null); if (!selected.length) return { fields, selectedCount: 0, tier: null, analogs: 0, market: null, entry: null, ceiling: null, marketEff: null, cogsCeiling: null, contributions: [], warn: "выберите хотя бы одно значение" };
  const scored = rows.map(([asin, r]) => { const x = byAsin.get(asin); const hits = selected.filter((f) => same(f.field, r.values?.[f.id]?.value, f.value)).length; const price = isNum(x?.price) ? x.price : null; return { asin, hits, ratio: hits / selected.length, price, eff: effectivePrice(price, listings[asin]?.promo), w: x ? revenueOf(x) : 0 }; }).filter((s) => s.price !== null);
  const minAnalogs = th?.minAnalogs ?? 5;
  let tier = null, analogs = [];
  for (const t of TIERS) { const a = scored.filter((s) => s.ratio >= t - 1e-9); if (a.length >= minAnalogs) { tier = t; analogs = a; break; } }
  let warn = null;
  if (tier === null) { const best = TIERS.map((t) => ({ t, a: scored.filter((s) => s.ratio >= t - 1e-9) })).find((x) => x.a.length >= 3) || TIERS.map((t) => ({ t, a: scored.filter((s) => s.ratio >= t - 1e-9) })).find((x) => x.a.length); if (best) { tier = best.t; analogs = best.a; } warn = analogs.length ? `аналогов мало (${analogs.length}) — ориентир приблизительный` : "аналогов с такой конфигурацией в нише нет"; }
  // Аналогов может не найтись вовсе (редкое сочетание значений). Раньше блок в этом случае показывал только фразу «аналогов нет»:
  // ни цены, ни кнопки — тупик. Теперь берём цену по всем листингам области и честно помечаем, что это не аналоги.
  let fallback = null;
  if (!analogs.length) { fallback = "scope"; analogs = scored.filter((s) => isNum(s.price)); warn = "Под выбранное сочетание значений аналогов не нашлось — показана цена по всем листингам этой области. Поменяйте одно из полей, чтобы получить ориентир по похожим товарам."; }
  const items = analogs.map((s) => ({ v: s.price, w: s.w || 1 })), effItems = analogs.map((s) => ({ v: s.eff ?? s.price, w: s.w || 1 }));
  const market = wquantile(items, 0.5), entry = wquantile(items, 0.25), ceiling = wquantile(items, 0.75), marketEff = wquantile(effItems, 0.5);
  const contributions = selected.map((f) => { const cur = f.values.find((v) => same(f.field, v.value, f.value)); const dom = f.values.find((v) => same(f.field, v.value, f.dominant)); return { id: f.id, name: f.name, value: f.label, dominant: f.dominantLabel, isDominant: f.dominant !== null && same(f.field, f.value, f.dominant), avgPrice: cur?.avgPrice ?? null, dominantAvgPrice: dom?.avgPrice ?? null, delta: isNum(cur?.avgPrice) && isNum(dom?.avgPrice) ? round(cur.avgPrice - dom.avgPrice, 2) : null, premium: Boolean(cur?.premium), share: cur?.share ?? 0 }; });
  // Потолок себестоимости считается по ТОМУ ЖЕ определению маржи, что и Gate 1 (shared/economics.js):
  //   нетто = цена − COGS − доставка до склада − комиссия Amazon − FBA,  маржа = нетто / цена,
  // отсюда COGS ≤ цена × (1 − referral − маржа) − FBA − доставка. Доставка за единицу раньше не вычиталась вовсе —
  // потолок был завышен ровно на неё, и товар с таким COGS Gate 1 не проходил.
  const referral = isNum(inputs.referralPct) ? inputs.referralPct : 0.15;
  const fbaKnown = isNum(inputs.fbaFee) && inputs.fbaFee > 0, shipKnown = isNum(inputs.shippingPerUnit) && inputs.shippingPerUnit > 0;
  const fba = fbaKnown ? inputs.fbaFee : 0, ship = shipKnown ? inputs.shippingPerUnit : 0;
  // Реклама — такой же расход на единицу, как FBA: покупку надо сначала купить. Считаем её как Gate 2:
  // цена клика ÷ конверсия = стоимость заказа, умноженная на долю продаж с рекламы.
  const cvr = isNum(inputs.cvr) && inputs.cvr > 0 ? inputs.cvr : 0.1, ppc = isNum(inputs.ppcShare) ? inputs.ppcShare : 0.7;
  const adKnown = isNum(inputs.cpc) && inputs.cpc > 0;
  const ad = adKnown ? (inputs.cpc / cvr) * ppc : 0;
  // Две планки, и обе должны выполняться. Основная — маржа ПОСЛЕ рекламы; вторая — Gate 1 без рекламы, где
  // для дешёвого сегмента порог выше (при цене ниже $25 прибыль $15/шт недостижима). Берём меньшее:
  // потолок не вправе обещать себестоимость, с которой гейт не пропустит.
  const cheapPrice = isNum(th?.cheapPrice) ? th.cheapPrice : null;
  const marginAds = th?.marginMin ?? 0.3;
  // ОДНА функция на два разных вопроса, и это намеренно: «сколько можно платить за товар, если продавать по цене
  // аналогов такой же конфигурации» и «…если продавать по цене из панели „Экономика“». Два отдельных расчёта
  // разошлись бы при первой правке; а не различать эти цены нельзя — ответы отличаются в разы.
  const ceilingAt = (pr) => {
    if (!isNum(pr) || pr <= 0) return null;
    const cheap = cheapPrice !== null && pr < cheapPrice;
    const marginNoAds = (cheap && isNum(th?.cheapMarginMin) ? th.cheapMarginMin : th?.marginMin) ?? 0.3;
    const byAds = pr * (1 - referral - marginAds) - fba - ship - ad;
    const byGate1 = pr * (1 - referral - marginNoAds) - fba - ship;
    const afterAds = adKnown && byAds <= byGate1; // без цены клика реклама не вычтена — потолок не «после рекламы»
    return { price: round(pr, 2), ceiling: round(Math.min(byAds, byGate1), 2), afterAds, marginMin: afterAds ? marginAds : marginNoAds, cheap };
  };
  const atMarket = ceilingAt(market);
  // Цена, по которой приложение считает экономику (панель или медиана 1b). Подсказка под полем COGS стоит среди
  // собственных чисел человека и обязана отвечать про них: прежде она отвечала про цену аналогов и молчала об этом.
  const atOwnPrice = ceilingAt(inputs.price);
  const cogsCeiling = atMarket?.ceiling ?? null;
  const adBinds = Boolean(atMarket?.afterAds);
  const cheap = Boolean(atMarket?.cheap);
  const marginMin = atMarket?.marginMin ?? (th?.marginMin ?? 0.3);
  // Не задано — значит не вычтено: честнее сказать, что потолок завышен, чем молча считать расход нулевым.
  const cogsCeilingMissing = [!fbaKnown ? "FBA-сбор" : null, !shipKnown ? "доставка до склада Amazon" : null, !adKnown ? "реклама (нет цены клика)" : null].filter(Boolean);
  // spec 024: четыре числа, объясняющие цену. БЕЗУСЛОВНЫЕ — замер показал, что сосредоточенность денег
  // в группе аналогов это НОРМА (доля самого тяжёлого медиана 43 %, трёх самых тяжёлых 71 %,
  // «три держат больше 30 %» в 17 нишах из 18), и любой порог здесь не различал бы ничего.
  // Без них верное число выглядело опиской: средние цены характеристик $41–74 против цены $29,99.
  const byRev = analogs.slice().sort((a, b) => (b.w || 0) - (a.w || 0));
  const revTotal = byRev.reduce((acc, a) => acc + (a.w || 0), 0);
  const concentration = revTotal > 0 ? {
    topShare: round(byRev[0].w / revTotal, 4),
    topPrice: byRev[0].price,
    top3Share: round(byRev.slice(0, 3).reduce((acc, a) => acc + (a.w || 0), 0) / revTotal, 4),
    top3Count: Math.min(3, byRev.length),
  } : null;
  // Уровень совпадения словами, БЕЗ оценочной окраски: ступень 0,6 это пятнадцать ниш из восемнадцати,
  // то есть обычный режим работы блока, а не проблема.
  const matchOf = selected.length;
  const matchFields = Math.round((tier ?? 0) * matchOf);
  const leader = analogs.slice().sort((a, b) => b.w - a.w)[0] || null;
  return { fields, selectedCount: selected.length, tier, fallback, analogs: analogs.length,
    // spec 024: мера названа явно — это медиана, ВЗВЕШЕННАЯ ВЫРУЧКОЙ, а не средняя цена и не простая медиана
    priceMeasure: "weighted-median", matchFields, matchOf, matchWords: matchFields + " из " + matchOf, concentration, market, entry, ceiling, marketEff, leaderPrice: leader?.price ?? null, leaderAsin: leader?.asin ?? null, cogsCeiling, marginMin, cogsCeilingCheap: cheap, cheapPrice, cogsCeilingMissing, cogsCeilingAfterAds: adBinds, adCostPerUnit: adKnown ? round(ad, 2) : null, cogsCeilingAtPrice: atOwnPrice,
    cogsCeilingParts: { referral, fba, ship, ad: adKnown ? round(ad, 2) : null, cpc: adKnown ? inputs.cpc : null, cvr, ppcShare: ppc }, contributions, warn, analogAsins: analogs.map((a) => a.asin).slice(0, 50) };
}
