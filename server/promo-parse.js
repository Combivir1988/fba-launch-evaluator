// Промо на странице листинга Amazon (spec 014): List Price / скидка, купон, дил, Subscribe & Save, акции — из сырого HTML того же ответа Scrapfly.
// Разбор идёт ТОЛЬКО внутри блоков цены и акций (apex / corePrice, promoPriceBlockMessage, couponBadge, dealBadge, snsAccordionRowMiddle):
// поиск по всей странице ловит навигацию («Prime Big Deal Days», меню «Subscribe & Save») — это не промо листинга.
const strip = (h) => String(h || "").replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;|&#160;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
/** Текст блока с данным id — до начала следующего feature_div (сосед), но не больше max символов. */
function inner(html, id, max = 12000) {
  const i = html.indexOf(`id="${id}"`); if (i < 0) return "";
  const from = html.lastIndexOf("<", i); const rest = html.slice(from, from + max);
  const next = rest.slice(80).search(/<div[^>]+id="[A-Za-z0-9_]+_feature_div"/); const end = next >= 0 ? next + 80 : rest.length;
  return strip(rest.slice(0, end));
}
/** Все блоки с таким id: на странице их несколько, и первый бывает скрытой заготовкой без содержимого. */
function innerAll(html, id, max = 12000) {
  const out = []; let from = 0;
  for (;;) {
    const i = html.indexOf(`id="${id}"`, from); if (i < 0) break;
    const start = html.lastIndexOf("<", i); const rest = html.slice(start, start + max);
    const next = rest.slice(80).search(/<div[^>]+id="[A-Za-z0-9_]+_feature_div"/); const end = next >= 0 ? next + 80 : rest.length;
    out.push(strip(rest.slice(0, end))); from = i + 1;
    if (out.length >= 6) break;
  }
  return out;
}
const num = (s) => { const n = Number(String(s).replace(/,/g, "")); return Number.isFinite(n) ? n : null; };

/** Версия разбора: если она выросла, кнопка «Обновить промо» предложит перечитать страницы (v2 — починен Subscribe & Save). */
export const PROMO_VERSION = 2;

/** @returns {{ v, price, listPrice, discountPct, coupon, deal, sns, promotions, hasPromo } | null} */
export function parsePromo(html) {
  if (!html || typeof html !== "string" || html.length < 500) return null;
  const price = inner(html, "apex_desktop", 14000) || inner(html, "corePriceDisplay_desktop_feature_div", 14000) || inner(html, "corePrice_feature_div", 14000);
  const listM = price.match(/(?:List Price|Typical price|Was):\s*\$\s?([0-9][0-9,]*\.?\d*)/i);
  const listPrice = listM ? num(listM[1]) : null;
  const pctM = price.match(/-\s?(\d{1,2})%/) || price.match(/with (\d{1,2}) percent savings/i);
  const discountPct = pctM ? Number(pctM[1]) : null;
  const payM = price.match(/\$\s?([0-9][0-9,]*\.\d{2}) with \d{1,2} percent savings/i) || price.match(/\$\s?([0-9][0-9,]*\.\d{2})/);
  const pagePrice = payM ? num(payM[1]) : null;

  const promoText = [inner(html, "promoPriceBlockMessage_feature_div", 5000), inner(html, "couponBadge_feature_div", 3000), inner(html, "vpcButton", 2000)].join(" ");
  const cm = promoText.match(/(?:Save|Apply|Clip)\s+(\$\s?[0-9][0-9.]*|\d{1,2}%)\s*(?:with\s+)?coupon/i) || promoText.match(/(\$\s?[0-9][0-9.]*|\d{1,2}%)\s+(?:off\s+)?coupon\s+(?:applied|available|clipped)/i) || promoText.match(/coupon:?\s*(?:Save\s+)?(\$\s?[0-9][0-9.]*|\d{1,2}%)/i);
  const coupon = cm ? { text: cm[0].trim(), value: num(cm[1].replace(/[$%\s]/g, "")), unit: cm[1].includes("%") ? "%" : "$" } : null;
  const promotions = [...new Set([...promoText.matchAll(/(Buy \d+,? (?:save|get) [^.|]{1,40}|Get \d+ for the price of \d+|Save \d{1,2}% on \d+ select item\(?s?\)?|Extra \d{1,2}% off[^.|]{0,30}|\d{1,2}% off when you buy \d+)/gi)].map((m) => m[1].trim()))].slice(0, 5);

  const dealText = inner(html, "dealBadge_feature_div", 3000);
  const dm = dealText.match(/(Limited time deal|Lightning Deal|Deal of the Day|Prime Exclusive Deal|Black Friday Deal|Cyber Monday Deal|Prime Day Deal|Prime Big Deal Days Deal|Holiday Deal|Spring Deal|Top Deal|With Prime|[A-Z][A-Za-z]+ Deal)/);
  const deal = dm ? dm[1] : null;

  // Subscribe & Save: блоков с этим id несколько (первый — скрытая заготовка), а процент скидки лежит либо в самом блоке,
  // либо в тексте доставки «…with 10% savings». Навигация магазина упоминает «Subscribe & Save» без процента и без этого блока.
  const snsRange = (t) => {
    const a = /Save (\d{1,2})\s?%/i.exec(t), b = /up to (\d{1,2})\s?%/i.exec(t), c = /(\d{1,2})\s?% savings/i.exec(t);
    if (a || b) return { min: a ? Number(a[1]) : Number(b[1]), max: b ? Number(b[1]) : Number(a[1]) };
    return c ? { min: Number(c[1]), max: Number(c[1]) } : null;
  };
  let sns = null;
  const snsBlocks = innerAll(html, "snsAccordionRowMiddle", 16000).filter((t) => /Subscribe\s*&\s*Save/i.test(t));
  if (snsBlocks.length) {
    for (const t of snsBlocks) { sns = snsRange(t); if (sns) break; }
    // процент часто живёт не в самом блоке, а в тексте доставки: «…with 10% savings»
    if (!sns) { const m = /Subscribe\s*&\s*Save[\s\S]{0,240}?(\d{1,2})\s?% savings/i.exec(html); sns = { min: m ? Number(m[1]) : null, max: m ? Number(m[1]) : null }; }
  }

  const hasPromo = Boolean(coupon || deal || promotions.length || (discountPct && discountPct > 0) || sns);
  return { v: PROMO_VERSION, price: pagePrice, listPrice, discountPct, coupon, deal, sns, promotions, hasPromo };
}

/** Цена «с учётом купона»: тег минус купон (% или $). */
export function effectivePrice(price, promo) {
  if (typeof price !== "number" || !Number.isFinite(price)) return null;
  const c = promo?.coupon; if (!c || typeof c.value !== "number") return price;
  return Math.max(0, Math.round((c.unit === "%" ? price * (1 - c.value / 100) : price - c.value) * 100) / 100);
}
