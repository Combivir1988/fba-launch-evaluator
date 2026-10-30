// ТЗ человеческим языком: модель, получив факты в JSON, охотно вставляет в текст имена полей
// («целевая розничная цена — pricing.marketPrice», «promo.discountRevSharePct 29.9%»).
// Производителю это ничего не говорит, поэтому имена полей переводятся на русский — и в новых ТЗ,
// и в уже сохранённых (вызывается из migrate) (2026-10-29).

// Длинные пути идут первыми: иначе «pricing.marketPriceWithCoupons» превратится в «рыночная цена…WithCoupons».
const PATHS = [
  ["pricing.marketPriceWithCoupons", "рыночная цена с учётом купонов"],
  ["pricing.cogsCeilingForMinMargin", "потолок себестоимости при минимальной марже"],
  ["pricing.amazonReferralPct", "комиссия Amazon"], ["pricing.adCostPerUnit", "стоимость рекламы на единицу"], ["pricing.fbaFeePerUnit", "FBA-сбор за единицу"], ["pricing.shippingPerUnitToAmazon", "доставка до склада Amazon за единицу"],
  ["pricing.cogsCeilingWarning", "оговорка к потолку себестоимости"], ["pricing.cogsCeilingIsAfter", "что уже вычтено из потолка себестоимости"],
  ["pricing.matchedFieldsPct", "совпадение полей конфигурации"],
  ["pricing.marketPrice", "рыночная цена аналогов такой же конфигурации"],
  ["pricing.ceilingPrice", "потолок цены (P75 аналогов)"],
  ["pricing.entryPrice", "цена входа (P25 аналогов)"],
  ["pricing.minMarginPct", "минимальная маржа"],
  ["pricing.analogs", "число аналогов"],
  ["prices.nicheMedian", "медианная цена ниши"],
  ["prices.segments", "ценовые сегменты ниши"],
  ["prices.myPrice", "цена в нашем расчёте"],
  ["promo.discountRevSharePct", "доля выручки со скидкой от List Price"],
  ["promo.couponRevSharePct", "доля выручки с купонами"],
  ["promo.dealRevSharePct", "доля выручки с дилами"],
  ["promo.avgDiscountPct", "средний размер скидки"],
  ["promo.avgCouponPct", "средний размер купона"],
  ["promo.saturation", "насыщенность промо"],
  ["promo.listings", "листингов с известным промо"],
  ["reviews.negative", "негативные темы отзывов"],
  ["reviews.positive", "позитивные темы отзывов"],
  ["reviews.returns", "причины возвратов"],
  ["batch.unitsPerDay", "цель продаж, шт/день"],
  ["batch.leadDays", "срок производства"],
  ["batch.units", "размер первой партии"],
  ["patents.status", "итог патентного скана"],
  ["listingsAnalyzed", "проанализировано листингов"],
];
// Одиночные имена полей, которые модель пишет без префикса.
const KEYS = [
  ["marketPriceWithCoupons", "рыночная цена с учётом купонов"], ["cogsCeilingForMinMargin", "потолок себестоимости при минимальной марже"], ["amazonReferralPct", "комиссия Amazon"], ["adCostPerUnit", "стоимость рекламы на единицу"], ["fbaFeePerUnit", "FBA-сбор за единицу"], ["shippingPerUnitToAmazon", "доставка до склада Amazon за единицу"],
  ["marketPrice", "рыночная цена аналогов"], ["ceilingPrice", "потолок цены"], ["entryPrice", "цена входа"], ["minMarginPct", "минимальная маржа"],
  ["discountRevSharePct", "доля выручки со скидкой"], ["couponRevSharePct", "доля выручки с купонами"], ["dealRevSharePct", "доля выручки с дилами"],
  ["avgDiscountPct", "средний размер скидки"], ["avgCouponPct", "средний размер купона"],
  ["revenueSharePct", "доля выручки"], ["listingsSharePct", "доля листингов"], ["mentionsPct", "доля упоминаний"],
  ["nicheMedian", "медианная цена ниши"], ["avgPrice", "средняя цена"], ["specRequirement", "требование к спецификации"], ["designAround", "обход патента"],
];
// Корень, написанный в одиночку: модель часто ставит его в графу «источник».
const BARE = [
  ["configuration", "конфигурация ниши (этап 2)"], ["differentiation", "гипотезы дифференциации"], ["regulatory", "регуляторные триггеры"],
  ["patents", "патентный скан"], ["reviews", "отзывы ниши"], ["pricing", "ценовой ориентир по конфигурации"], ["prices", "цены ниши"],
  ["promo", "промо в нише"], ["batch", "первая партия"], ["matchedFieldsPct", "совпадение полей конфигурации"], ["analogs", "аналогов"],
  ["leadDays", "срок производства"], ["saturation", "насыщенность промо"],
];
// Корни на случай незнакомого поля: «configuration[2].dominant.value» → «доминирующая конфигурация».
const ROOTS = [
  ["configuration", "доминирующая конфигурация (этап 2)"], ["differentiation", "гипотезы дифференциации"], ["regulatory", "регуляторные триггеры"],
  ["patents", "патентный скан"], ["reviews", "отзывы ниши"], ["pricing", "ценовой ориентир"], ["prices", "цены ниши"], ["promo", "промо в нише"], ["batch", "первая партия"],
];
const esc = (s) => s.split(".").join("[.]"); // в путях вида «promo.avgDiscountPct» экранировать нужно только точку
const before = "(^|[^" + '\\w.' + "])"; // имя поля не внутри слова и не хвост чужого пути
const tail = '(?:\\[[\\d ,.-]+\\])?(?:[.][A-Za-z_]\\w*(?:\\[[\\d ,.-]+\\])?)*'; // и вместе с остатком пути: «reviews.negative[0].topic» — тоже одно имя
const rule = ([k, v], guard = null) => ({ re: new RegExp(before + esc(k) + '\\b' + tail, "g"), human: v, guard });
// «promo.example.com» — не поле фактов, а домен: корень засчитываем, только если дальше идёт номер в скобках,
// camelCase или знакомый кусок пути (dominant, items, negative…).
const FIELDISH = /[0-9A-Z]|[.](?:dominant|premium|alternatives|value|values|items|negative|positive|returns|segments|status|summary|topic|overlap|risk|units|label|min|max)\\b/;
const bareRule = ([k, v]) => ({ re: new RegExp(before + esc(k) + '\\b(?![.[])', "g"), human: v, guard: null });
const RULES = [...PATHS.map((p) => rule(p)), ...ROOTS.map((p) => rule(p, (m) => FIELDISH.test(m))), ...KEYS.map((p) => rule(p)), ...BARE.map(bareRule)];

/** Текст ТЗ без имён полей JSON. */
export function humanizeFacts(text) {
  let out = String(text ?? "");
  for (const { re, human, guard } of RULES) out = out.replace(re, (m, pre = "") => (guard && !guard(m) ? m : (pre || "") + human));
  return out;
}

/** То же по всему документу ТЗ: строки, итоговая фраза, вопросы. */
export function humanizeTz(tz) {
  if (!tz || typeof tz !== "object") return tz;
  return {
    ...tz,
    summary: humanizeFacts(tz.summary),
    rows: (tz.rows || []).map((r) => ({ ...r, param: humanizeFacts(r.param), requirement: humanizeFacts(r.requirement), rationale: humanizeFacts(r.rationale), source: humanizeFacts(r.source) })),
    openQuestions: (tz.openQuestions || []).map(humanizeFacts),
  };
}
