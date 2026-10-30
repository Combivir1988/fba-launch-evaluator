// Этап 2 (spec 010, D9): факты для ТЗ производителю — из расчётов этапа 1 и 2. AI пишет текст только по этим фактам;
// каждое число в ТЗ должно встречаться среди чисел пейлоада, иначе строка помечается «проверьте число».
import { round } from "./num.js";
import { valueLabel } from "./config-stats.js";

const r3 = (v) => (typeof v === "number" ? round(v, 3) : null), r2 = (v) => (typeof v === "number" ? round(v, 2) : null);
const pct = (v) => (typeof v === "number" ? round(v * 100, 1) : null);

/** Пустой раздел — это не факт, а дырка в фактах: выкидываем, чтобы модель не писала о нём в ТЗ. */
function dropEmpty(o) {
  const out = {};
  for (const [k, v] of Object.entries(o)) {
    if (v === null || v === undefined) continue;
    if (Array.isArray(v) && !v.length) continue;
    if (typeof v === "object" && !Array.isArray(v) && !Object.keys(v).length) continue;
    out[k] = v;
  }
  return out;
}

export function buildTzPayload(analysis) {
  const R = analysis?.results || {}; const st = R.config?.whole; const inp = analysis?.inputs || {}; const poe = analysis?.aggregates?.poe;
  const val = (f, v) => ({ value: v.label ?? valueLabel(f, v.value), ...(typeof v.value === "number" ? { number: v.value } : {}), revenueSharePct: pct(v.share), listingSharePct: pct(v.listingShare), listings: v.count, avgPrice: r2(v.avgPrice), premium: Boolean(v.premium) });
  return dropEmpty({
    niche: analysis?.niche || "", coreKeyword: analysis?.coreKeyword || "",
    listingsAnalyzed: st?.asins ?? 0,
    configuration: (st?.fields || []).map((f) => ({
      field: f.name, unit: f.unit, coveragePct: pct(f.coverage),
      dominant: f.values[0] ? val(f, f.values[0]) : null,
      alternatives: f.values.slice(1, 4).map((v) => val(f, v)),
      premium: f.values.filter((v) => v.premium).slice(0, 3).map((v) => val(f, v)),
    })),
    prices: {
      nicheMedian: r2(R.criterion1?.items?.["1b"]?.value ?? null), myPrice: r2(R.effective?.price ?? null),
      segments: (R.priceSegments?.segments || []).map((s) => ({ label: s.label, min: r2(s.min), max: r2(s.max), revenueSharePct: pct(s.weightShare), listingsSharePct: pct(s.itemsShare) })),
    },
    reviews: poe?.pdr ? {
      negative: (poe.pdr.negative || []).slice(0, 8).map((t) => ({ topic: t.topic, mentionsPct: r2(t.pct), examples: (t.verbatims || []).slice(0, 2) })),
      positive: (poe.pdr.positive || []).slice(0, 6).map((t) => ({ topic: t.topic, mentionsPct: r2(t.pct) })),
      returns: (poe.pdr.returns || []).slice(0, 5).map((t) => ({ topic: t.topic, pct: r2(t.pct) })),
    } : null,
    regulatory: (R.regulatory?.triggers || []).map((t) => ({ agency: t.agency, kind: t.kind === "claim" ? "обещание в листингах" : "тип товара", title: t.title, meaning: t.meaning })),
    // ВАЖНО: пустые разделы вычищаются ниже (dropEmpty). Пустой массив или null модель пересказывает как
    // «патентный скан не передан (null)» — строка про внутренности приложения вместо требования производителю (2026-10-30).
    patents: analysis?.patents ? { status: analysis.patents.status, summary: analysis.patents.summary, items: (analysis.patents.items || []).slice(0, 5).map((x) => ({ number: x.number, risk: x.risk, overlap: x.overlap, designAround: x.designAround })) } : null,
    differentiation: (analysis?.ai?.differentiation || []).slice(0, 6).map((d) => ({ hypothesis: d.hypothesis, evidence: d.evidence, specRequirement: d.specRequirement })),
    pricing: R.priceConfig && R.priceConfig.market !== null ? { marketPrice: r2(R.priceConfig.market), entryPrice: r2(R.priceConfig.entry), ceilingPrice: r2(R.priceConfig.ceiling), marketPriceWithCoupons: r2(R.priceConfig.marketEff), analogs: R.priceConfig.analogs, matchedFieldsPct: pct(R.priceConfig.tier), cogsCeilingForMinMargin: r2(R.priceConfig.cogsCeiling), minMarginPct: pct(R.priceConfig.marginMin),
      cogsCeilingIsAfter: "комиссия Amazon, FBA-сбор и доставка до склада уже вычтены; маржа — без рекламы",
      amazonReferralPct: pct(R.priceConfig.cogsCeilingParts?.referral), fbaFeePerUnit: r2(R.priceConfig.cogsCeilingParts?.fba), shippingPerUnitToAmazon: r2(R.priceConfig.cogsCeilingParts?.ship),
      cogsCeilingWarning: R.priceConfig.cogsCeilingMissing?.length ? `не задано: ${R.priceConfig.cogsCeilingMissing.join(", ")} — потолок завышен` : null } : null,
    promo: R.config?.promo?.known ? { listings: R.config.promo.known, couponRevSharePct: pct(R.config.promo.coupon.revShare), avgCouponPct: r2(R.config.promo.coupon.avgValuePct), dealRevSharePct: pct(R.config.promo.deal.revShare), discountRevSharePct: pct(R.config.promo.discount.revShare), avgDiscountPct: r2(R.config.promo.discount.avgPct), saturation: R.config.promo.saturation } : null,
    batch: { units: R.budget?.batchUnits ?? null, unitsPerDay: inp.unitsPerDay ?? null, leadDays: R.budget?.leadDays ?? null },
    myBrand: inp.myBrand || "",
  });
}

/** Все числа пейлоада в формах, в которых они могут встретиться в тексте (целое, 1–2 знака, проценты от долей). */
export function collectTzNumbers(payload) {
  const out = new Set();
  const add = (v) => { if (typeof v !== "number" || !Number.isFinite(v)) return; for (const x of [v, Math.round(v), round(v, 1), round(v, 2)]) out.add(x); if (v > 0 && v <= 1) { out.add(Math.round(v * 100)); out.add(round(v * 100, 1)); } };
  const addFromText = (t) => { for (const m of String(t).matchAll(/\d+(?:[.,]\d+)?/g)) add(Number(m[0].replace(",", "."))); };
  // Значения характеристик приходят строками («126», «5,62 мм», «11/128"») — если их не разобрать, они выглядят выдуманными.
  const walk = (n) => { if (Array.isArray(n)) n.forEach(walk); else if (n && typeof n === "object") Object.values(n).forEach(walk); else if (typeof n === "string") addFromText(n); else add(n); };
  walk(payload); return out;
}

const NUM_RE = /\d+(?:[.,]\d+)?/g;
const MONEY_RE = /\$\s?(\d+(?:[.,]\d+)?)(?:\s*[-–—]\s*(\d+(?:[.,]\d+)?))?/g;
/** Цены, которые приложение считало само: только они имеют право стоять в ТЗ со знаком доллара. */
export function priceFacts(payload) {
  const p = payload?.pricing || {};
  const out = [p.marketPrice, p.entryPrice, p.ceilingPrice, p.marketPriceWithCoupons, p.cogsCeilingForMinMargin];
  return new Set(out.filter((v) => typeof v === "number" && Number.isFinite(v)).flatMap((v) => [v, round(v, 1), Math.round(v)]));
}

// Слова, после которых цена перестаёт быть ценой чужого товара и становится нашей.
const OWN_PRICE_RE = /позиционир|премиум-сегмент|целев\w* цен|целев\w* рознич|наша цена|нашу цену|продавать по|рознич\w* цена нашего|RRP|рекоменд\w* цен/i;

/** Цена НАШЕГО товара, которой нет среди посчитанных. Проверяем только фразы о позиционировании:
 *  цены конкурентов и средние по характеристикам в ТЗ законны, а вот «позиционирование в премиум-сегменте ($35–47)»
 *  при рыночной цене аналогов $15,88 модель взяла из головы — сегменты ниши описывают весь рынок, а не наш товар (2026-10-27). */
export function strayPrices(text, prices) {
  const out = [];
  for (const sentence of String(text || "").split(/[.;!?\n]+/)) {
    if (!OWN_PRICE_RE.test(sentence)) continue;
    for (const m of sentence.matchAll(MONEY_RE)) {
      for (const raw of [m[1], m[2]]) {
        if (!raw) continue;
        const v = Number(raw.replace(",", "."));
        if (Number.isFinite(v) && !prices.has(v) && !prices.has(round(v, 1)) && !prices.has(Math.round(v))) out.push(v);
      }
    }
  }
  return out;
}

/** Числа текста, которых нет среди фактов: берём только «значащие» — от 10 или с дробной частью. */
function strayNumbers(text, numbers) {
  return [...String(text || "").matchAll(NUM_RE)].map((m) => Number(m[0].replace(",", ".")))
    .filter((n) => Number.isFinite(n) && (n >= 10 || !Number.isInteger(n)))
    .filter((n) => !numbers.has(n) && !numbers.has(round(n, 1)) && !numbers.has(Math.round(n)));
}

// Разговор о внутренностях приложения вместо требования производителю: «патентный скан не передан (null)»,
// «регуляторные триггеры не переданы». Факт при этом мог быть передан — модель просто не нашла его в JSON
// (у камер патентный скан был: status clear, 12 патентов, 1970 знаков в фактах). Производителю такая строка бесполезна.
// JS-класс \w — только латиница, поэтому «фактах» через \w+ не ловилось: собираем класс со своими буквами.
// WC — СОДЕРЖИМОЕ класса, без скобок: вставлять готовый «[...]» внутрь «[^...]» нельзя, получается мусор.
const WC = "0-9A-Za-zА-Яа-яЁё_";
const PIPELINE_RE = new RegExp(
  `(^|[^${WC}])null([^${WC}]|$)`
  + `|не\\s+передан`
  + `|не\\s+предоставлен`
  + `|(отсутству|нет|не\\s+указан|не\\s+найден)[${WC}]*(\\s+[${WC}]+)?\\s+(в\\s+)?(переданн[${WC}]+\\s+)?факт(?!ур)`, "i");
/** Говорит ли строка о наличии фактов, а не о товаре. */
export const pipelineTalk = (text) => PIPELINE_RE.test(String(text || ""));

/** Строка ТЗ «не проверена», если в требовании/обосновании есть число, которого нет среди фактов.
 *  Итоговую фразу проверяем так же: именно там модель выдумывала ценовое позиционирование («премиум-сегмент $35–47»
 *  при рыночной цене аналогов $15,88), и раньше этого никто не ловил — проверялись только строки (2026-10-27). */
export function markUnverified(tz, numbers, prices = null) {
  const rows = (tz?.rows || []).map((row) => {
    const text = `${row.requirement || ""} ${row.rationale || ""}`;
    return { ...row, unverified: strayNumbers(text, numbers).length > 0 || (prices ? strayPrices(text, prices).length > 0 : false), internal: pipelineTalk(`${text} ${row.source || ""}`) };
  });
  const texts = [tz?.summary || "", ...(tz?.openQuestions || [])];
  const summaryUnverified = [...new Set(texts.flatMap((t) => strayNumbers(t, numbers)))].sort((a, b) => a - b);
  const strayMoney = prices ? [...new Set([...texts, ...(tz?.rows || []).map((r) => `${r.requirement || ""} ${r.rationale || ""}`)].flatMap((t) => strayPrices(t, prices)))].sort((a, b) => a - b) : [];
  return { ...tz, rows, summaryUnverified, strayPrices: strayMoney, internalRows: rows.filter((r) => r.internal).length + (pipelineTalk(tz?.summary) ? 1 : 0) };
}
