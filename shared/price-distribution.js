// spec 024: распределение выручки ниши по коридорам цен.
//
// Зачем отдельно от сегментов Entry / Mid / Premium: те нарезаны по третям КОЛИЧЕСТВА товаров и по
// построению содержат примерно по трети листингов каждый — это инструмент ВЫБОРА ценового коридора,
// а на вопрос «в каком коридоре цен лежат деньги» он не отвечает.
//
// Правило нарезки выбрано замером на 67 живых нишах (research.md, D1), а не на глаз:
//   • края по 2-му и 98-му процентилю — равный шаг от минимума до максимума портят именно края:
//     «один коридор держит больше 80 % выручки» встречалось в 8 нишах, после подрезки — в одной;
//   • шаг из ряда 1 / 2 / 2,5 / 5 × 10^k при цели в девять коридоров — на живых данных это $5 и $10,
//     коридоров выходит 5…10 (медиана 8) и больше десяти НИ В ОДНОЙ нише, поэтому отдельного правила
//     «меньше коридоров, когда листингов мало» не нужно: замер снял требование, а не добавил;
//   • хвосты сводятся в крайние коридоры и ПОМЕЧАЮТСЯ: молча потерять дорогие или дешёвые товары
//     нельзя — их отсутствие меняет вывод. За краями оказывается медиана 2 % листингов, максимум 4 %.

/** Доля выручки в одном коридоре, после которой распределение на этом шаге дальше не разбирается.
 *  Порог выбран замером, а не вкусом: 50 % → 26 ниш из 67, 60 % → 13, 70 % → 3, 80 % → 1.
 *  На 50–60 % оговорка стала бы шумом — медиана доли самого толстого коридора и так 43 %.
 *  Живёт здесь, рядом с правилом, а не в настройках: описывает читаемость диаграммы, а не вкус человека. */
export const DEGENERATE_SHARE = 0.7;

/** Минимум листингов с ценой, ниже которого резать нечего. */
const MIN_LISTINGS = 10;
/** Во сколько коридоров целимся; фактическое число получается 5…10 после округления границ. */
const TARGET_BINS = 9;

const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const q = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(p * (sorted.length - 1))))];

/** Шаг-«человеческое число»: ближайшее сверху из ряда 1 / 2 / 2,5 / 5 × 10^k. */
export function niceStep(raw) {
  if (!isNum(raw) || raw <= 0) return null;
  const e = Math.pow(10, Math.floor(Math.log10(raw)));
  const m = raw / e;
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10) * e;
}

const empty = (reason) => ({ bins: [], step: null, min: null, max: null, total: 0, items: 0, top: null, degenerate: false, reason });

/**
 * @param {object[]} listings листинги выгрузки Xray (нужны price и asinRevenue)
 * @returns {{bins: object[], step: number|null, min: number|null, max: number|null,
 *            total: number, items: number, top: object|null, degenerate: boolean, reason: string|null}}
 */
export function priceDistribution(listings) {
  const items = (listings || []).filter((a) => isNum(a?.price) && a.price > 0);
  if (!items.length) return empty("нет листингов с известной ценой");
  if (items.length < MIN_LISTINGS) return empty(`листингов с ценой меньше десяти (${items.length}) — резать нечего`);

  const prices = items.map((a) => a.price).sort((x, y) => x - y);
  if (prices[0] === prices[prices.length - 1]) return empty("все листинги по одной цене");

  const lo0 = q(prices, 0.02), hi0 = q(prices, 0.98);
  const step = niceStep((hi0 - lo0) / TARGET_BINS) ?? niceStep((prices[prices.length - 1] - prices[0]) / TARGET_BINS);
  if (!step) return empty("все листинги по одной цене");

  const min = Math.floor(lo0 / step) * step;
  const max = Math.max(min + step, Math.ceil(hi0 / step) * step);
  const n = Math.max(1, Math.round((max - min) / step));

  const bins = Array.from({ length: n }, (_, i) => ({
    min: round(min + i * step), max: round(min + (i + 1) * step),
    revenue: 0, items: 0, edge: false, edgeItems: 0, edgeRevenue: 0,
  }));
  for (const a of items) {
    const rev = isNum(a.asinRevenue) ? a.asinRevenue : 0;
    let i = Math.floor((a.price - min) / step);
    // Хвост не растягивает шкалу: он сводится в крайний коридор и там ПОМЕЧАЕТСЯ числом.
    // Листинг РОВНО по верхней границе принадлежит последнему коридору как обычный, а не как сведённый
    // хвост: верхний коридор включает свою границу. Без этой оговорки `max` попадал в хвост и
    // помечался «и дороже», хотя он внутри шкалы.
    if (a.price < min) { i = 0; bins[0].edge = true; bins[0].edgeItems++; bins[0].edgeRevenue += rev; }
    else if (a.price > max) { i = n - 1; bins[n - 1].edge = true; bins[n - 1].edgeItems++; bins[n - 1].edgeRevenue += rev; }
    else i = Math.min(n - 1, Math.max(0, i));
    bins[i].revenue += rev; bins[i].items++;
  }

  const total = bins.reduce((s, b) => s + b.revenue, 0);
  let top = null;
  if (total > 0) {
    const b = bins.reduce((a, x) => (x.revenue > a.revenue ? x : a), bins[0]);
    top = { min: b.min, max: b.max, revenue: round(b.revenue), items: b.items, share: b.revenue / total };
  }
  for (const b of bins) { b.revenue = round(b.revenue); b.edgeRevenue = round(b.edgeRevenue); }

  return {
    bins, step: round(step), min: round(min), max: round(max),
    total: round(total), items: items.length,
    top,
    // Самый толстый коридор называется ВСЕГДА — это факт о рынке. Оговорка «дальше не разбирается»
    // появляется только за порогом: иначе каждая четвёртая ниша получала бы предупреждение о норме.
    degenerate: Boolean(top && top.share > DEGENERATE_SHARE),
    reason: null,
  };
}

function round(v) { return Math.round(v * 100) / 100; }
