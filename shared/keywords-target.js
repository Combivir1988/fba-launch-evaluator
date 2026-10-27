// Целевые ключи листинга (spec 017, этап 3): что нужно написать в карточке, чтобы товар находили.
// Три источника об одном и том же, но с разной природой: Cerebro даёт объём поиска и оценку продаж по ключу,
// POE — доли кликов и конверсию запроса ВНУТРИ НИШИ, SQP — воронку (показы → клики → покупки).
// ВАЖНО: SQP выдаётся только по СВОИМ ASIN. Для нового листинга в чужой нише он всегда пустой, поэтому
// «ключ продаёт» для нового листинга считается по рынку (Cerebro Keyword Sales, иначе конверсия POE выше медианы),
// а покупки из SQP остаются отдельным признаком и работают только при аудите своего листинга (2026-10-27).
// Всё детерминированно, без AI.

/** Фраза как ключ объединения: регистр и лишние пробелы ничего не значат. */
export const normPhrase = (s) => String(s || "").toLowerCase().replace(/\s+/g, " ").trim();

const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const num = (v) => (isNum(v) ? v : null);

/** Фраза содержит имя бренда: такие ключи чужие, в свой листинг их не берут. */
function brandHit(phrase, brands) {
  if (!brands?.length) return false;
  const p = " " + phrase + " ";
  return brands.some((b) => { const t = normPhrase(b); return t.length > 2 && p.includes(" " + t + " "); });
}

/**
 * @param {object} o { cerebro, poe, sqp, brands, th }
 * @returns {{ items, total, kept, hasVolume, sources, note }}
 */
export function targetKeywords({ cerebro, poe, sqp, brands = [], th } = {}) {
  const t = th?.stage3 || {};
  const top = Number(t.topKeywords) || 50;
  const map = new Map();
  const put = (phrase) => { const k = normPhrase(phrase); if (!k) return null;
    if (!map.has(k)) map.set(k, { phrase: k, sv: null, svSource: null, sales: null, clickShare: null, conv: null, impressions: null, clicks: null, purchases: null, branded: false, fromAsin: false });
    return map.get(k); };

  for (const k of cerebro?.keywords || []) {
    const it = put(k.phrase); if (!it) continue;
    it.sv = num(k.sv); it.svSource = "cerebro"; it.sales = num(k.keywordSales);
    if (k.isBranded) it.branded = true;
    if (k.isAsin) it.fromAsin = true;
  }
  for (const s of poe?.searchTermMetrics || []) {
    const it = put(s.term); if (!it) continue;
    it.clickShare = num(s.clickShareT360); it.conv = num(s.convT360);
    if (it.sv === null && isNum(s.svT360)) { it.sv = Math.round(s.svT360 / 12); it.svSource = "poe"; } // POE даёт год, нам нужен месяц
  }
  for (const r of sqp?.rows || []) {
    const it = put(r.query); if (!it) continue;
    it.impressions = num(r.impressions); it.clicks = num(r.clicks); it.purchases = num(r.purchases);
    if (it.sv === null && isNum(r.volume)) { it.sv = r.volume; it.svSource = "sqp"; }
  }

  const all = [...map.values()].map((it) => ({
    ...it,
    weight: isNum(it.sv) ? it.sv : 0,
    buys: isNum(it.purchases) && it.purchases > 0,
    trafficOnly: isNum(it.purchases) && it.purchases === 0 && ((isNum(it.clicks) && it.clicks > 0) || (isNum(it.impressions) && it.impressions > 0)),
  }));
  const dropped = { branded: 0, asin: 0, empty: 0 };
  const kept = all.filter((it) => {
    if (it.fromAsin) { dropped.asin++; return false; }
    if (it.branded || brandHit(it.phrase, brands)) { dropped.branded++; return false; }
    if (!it.weight && !it.buys && !isNum(it.sales) && !isNum(it.clickShare)) { dropped.empty++; return false; } // о ключе не известно ничего
    return true;
  });
  // Отбираем по покупкам и объёму, и только потом смотрим, кто из отобранных продаёт лучше остальных.
  kept.sort((a, b) => Number(b.buys) - Number(a.buys) || b.weight - a.weight || a.phrase.localeCompare(b.phrase));
  const short = kept.slice(0, top);

  // Медианы считаем ПО ОТОБРАННЫМ ключам, а не по всему файлу Cerebro: там сотни длинных хвостов с нулевыми
  // продажами, медиана по ним крошечная, и «продаёт» получали все до одного — признак, который ничего не делит.
  const mid = (arr) => { const v = arr.filter(isNum).filter((x) => x > 0).sort((a, b) => a - b); return v.length ? v[Math.floor(v.length / 2)] : null; };
  const salesMid = mid(short.map((it) => it.sales));
  const convMid = mid(short.map((it) => it.conv));
  for (const it of short) {
    it.sells = isNum(it.sales) && isNum(salesMid) ? it.sales >= salesMid : !isNum(it.sales) && isNum(it.conv) && isNum(convMid) ? it.conv >= convMid : false;
    it.sellsSource = it.sells ? (isNum(it.sales) ? "cerebro" : "poe") : null;
  }
  // Сначала то, что приносит покупки нам (SQP, бывает только при аудите), потом то, что сильнее продаёт на рынке,
  // потом остальное по объёму: порядок задаёт, что писать в тайтл, а что в буллеты.
  short.sort((a, b) => Number(b.buys) - Number(a.buys) || Number(b.sells) - Number(a.sells) || b.weight - a.weight || a.phrase.localeCompare(b.phrase));
  const items = short.map((it, i) => ({ ...it, rank: i + 1 }));

  const sources = [cerebro?.keywords?.length ? "cerebro" : null, poe?.searchTermMetrics?.length ? "poe" : null, sqp?.rows?.length ? "sqp" : null].filter(Boolean);
  const hasVolume = Boolean(cerebro?.keywords?.length);
  const note = !sources.length ? "нет ни одного источника ключей — загрузите Cerebro, POE или SQP"
    : !hasVolume ? "объёмов поиска нет: Cerebro не загружен, вес ключей взят из " + (sources.includes("poe") ? "POE (год ÷ 12)" : "SQP") : "";
  const withSales = items.filter((i) => isNum(i.sales));
  return { items, total: kept.length, kept: items.length, weightTotal: items.reduce((s, i) => s + i.weight, 0),
    hasVolume, sources, dropped, note,
    sellsCount: items.filter((i) => i.sells).length,
    sellsSource: items.some((i) => i.sellsSource === "cerebro") ? "cerebro" : items.some((i) => i.sellsSource === "poe") ? "poe" : null,
    salesTotal: withSales.length ? withSales.reduce((s, i) => s + i.sales, 0) : null, salesKnown: withSales.length, salesMid,
    buysCount: items.filter((i) => i.buys).length, hasSqp: Boolean(sqp?.rows?.length) };
}
