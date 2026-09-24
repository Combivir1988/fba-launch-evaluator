// Промо по нише (spec 014): доли листингов и выручки с купоном / дилом / скидкой от List Price / Subscribe & Save — из записей листингов этапа 2.
import { mean } from "./num.js";
import { revenueOf } from "./config-scope.js";

const isNum = (v) => typeof v === "number" && Number.isFinite(v);
/** Цена «с учётом купона»: тег минус купон (% или $). Дублирует server/promo-parse.js, чтобы ядро не зависело от сервера. */
export function effectivePrice(price, promo) {
  if (!isNum(price)) return null; const c = promo?.coupon; if (!c || !isNum(c.value)) return price;
  return Math.max(0, Math.round((c.unit === "%" ? price * (1 - c.value / 100) : price - c.value) * 100) / 100);
}

/**
 * @param {object} listings aggregates.listings; @param {object[]} xrayAsins; @param {string[]} asins — какие ASIN считать (строки таблицы или область)
 * @returns {{ n, known, withPromo, coupon, deal, discount, sns, saturation, snapshotAt } | null}
 */
export function promoStats(listings, xrayAsins, asins) {
  const byAsin = new Map((xrayAsins || []).map((a) => [a.asin, a])); const list = (asins || []).map((a) => ({ asin: a, x: byAsin.get(a), l: listings?.[a] })).filter((r) => r.l && !r.l.error);
  if (!list.length) return null;
  const known = list.filter((r) => r.l.promo !== undefined && r.l.promo !== null);
  const total = known.reduce((s, r) => s + (r.x ? revenueOf(r.x) : 0), 0);
  const agg = (pred) => { const hit = known.filter((r) => pred(r.l.promo)); const rev = hit.reduce((s, r) => s + (r.x ? revenueOf(r.x) : 0), 0); return { count: hit.length, share: known.length ? hit.length / known.length : 0, revShare: total > 0 ? rev / total : (known.length ? hit.length / known.length : 0) }; };
  const coupon = agg((p) => Boolean(p.coupon)); coupon.avgValuePct = mean(known.filter((r) => r.l.promo.coupon?.unit === "%").map((r) => r.l.promo.coupon.value));
  const deal = agg((p) => Boolean(p.deal)); const discount = agg((p) => isNum(p.discountPct) && p.discountPct > 0); discount.avgPct = mean(known.filter((r) => isNum(r.l.promo.discountPct) && r.l.promo.discountPct > 0).map((r) => r.l.promo.discountPct));
  const sns = agg((p) => Boolean(p.sns)); const promotions = agg((p) => (p.promotions || []).length > 0); const withPromo = agg((p) => Boolean(p.hasPromo));
  const hot = agg((p) => Boolean(p.coupon || p.deal));
  // Насыщенность — по всем активным скидкам: купон, дил, акция «купи N» и зачёркнутая цена. Subscribe & Save не считается: это подписка, а не борьба ценой.
  const active = agg((p) => Boolean(p.coupon || p.deal || (p.promotions || []).length || (isNum(p.discountPct) && p.discountPct > 0)));
  const saturation = !known.length ? null : active.revShare >= 0.5 ? "high" : active.revShare >= 0.2 ? "mid" : "low"; // как значения чеклиста «Купоны/дилы»
  const snapshotAt = known.map((r) => r.l.fetchedAt).filter(Boolean).sort().at(-1) || null;
  return { n: list.length, known: known.length, withPromo, coupon, deal, discount, sns, promotions, active, hotRevShare: hot.revShare, activeRevShare: active.revShare, saturation, snapshotAt };
}
