// Вход в нишу (spec 005): реально ли новому листингу сюда зайти.
//  • продажи на 1 % кликов ниши и доля кликов, нужная под цель продаж менеджера;
//  • когорта новых участников — кто недавно вошёл и уже продаёт: их продажи (стартовый уровень) и отзывы (планка);
//  • срок до планки отзывов; цена «по кликам покупателей»; особенности полей POE.
// Всё считается по ВСЕЙ нише (не по ценовому диапазону): внимание покупателей по цене не делится.
// Чистые функции: одинаково работают в браузере и в тестах. Когда данных мало — возвращают причину, а не оценку «на глаз».
import { median, monthsSince } from "./num.js";

const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const num = (v) => (v === null || v === undefined || v === "" || Number.isNaN(Number(v)) ? null : Number(v));
const up = (s) => String(s || "").toUpperCase();

/** Перцентиль с линейной интерполяцией (p в 0…100). */
export function percentile(arr, p) {
  const a = arr.filter(isNum).sort((x, y) => x - y); if (!a.length) return null;
  const pos = (a.length - 1) * (p / 100), lo = Math.floor(pos), hi = Math.ceil(pos);
  return a[lo] + (a[hi] - a[lo]) * (pos - lo);
}

/** Доля кликов товара: за 90 дней (ближе к «сейчас»), запасной вариант — за 360. */
function clickShare(a) { return isNum(a.clickShareT90) && a.clickShareT90 > 0 ? { share: a.clickShareT90, period: "T90" } : isNum(a.clickShareT360) && a.clickShareT360 > 0 ? { share: a.clickShareT360, period: "T360" } : null; }

/** Продажи в месяц на 1 % кликов ниши — по товарам, которые есть и в Xray (продажи), и в POE (доля кликов). */
export function salesPerClickPct(xray, poe, th) {
  const out = { ok: false, reason: null, n: 0, median: null, p25: null, p75: null, fallbackT360: 0, rows: [] };
  if (!xray?.asins?.length || !poe?.asinMetrics?.length) { out.reason = !poe?.asinMetrics?.length ? "нужен POE: доли кликов по товарам есть только там" : "нужен Xray: продажи по товарам есть только там"; return out; }
  if (!xray.flags?.hasAsinSales) { out.reason = "в Xray нет колонки продаж в штуках (ASIN Sales) — продажи на 1 % кликов не посчитать"; return out; }
  const sales = new Map(xray.asins.map((a) => [up(a.asin), a]));
  for (const p of poe.asinMetrics) {
    const x = sales.get(up(p.asin)); const cs = clickShare(p);
    if (!x || !cs || !isNum(x.asinSales) || x.asinSales <= 0) continue;
    if (cs.period === "T360") out.fallbackT360++;
    out.rows.push({ asin: up(p.asin), brand: p.brand, sales: x.asinSales, share: cs.share, per1pct: x.asinSales / (cs.share * 100) });
  }
  out.n = out.rows.length;
  if (out.n < th.minOverlap) { out.reason = `в обоих отчётах одновременно есть только ${out.n} товар(ов) с продажами и долей кликов — нужно не меньше ${th.minOverlap}`; return out; }
  const v = out.rows.map((r) => r.per1pct);
  out.median = median(v); out.p25 = percentile(v, 25); out.p75 = percentile(v, 75); out.ok = true;
  return out;
}

/** Когорта новых участников: возраст от minAge до maxAge месяцев, доля не ниже равномерной (1/N), без «наследников» отзывов. */
export function newEntrantCohort(xray, poe, th, refDate = new Date()) {
  const out = { ok: false, reason: null, basis: null, population: 0, uniformShare: null, size: 0, minAgeMonths: th.cohortMinAgeMonths, maxAgeMonths: th.cohortMaxAgeMonths, ageFilterSkipped: false, inheritedChecked: false,
    excluded: { noDate: 0, tooYoung: 0, tooOld: 0, lowShare: 0, inherited: 0 }, ageFromPoe: 0,
    salesMedian: null, salesP25: null, salesP75: null, salesN: 0, reviewsMedian: null, reviewsSource: null, shareMedian: null, shareP75: null, shareP90: null, bestShare: null, members: [] };
  const xr = new Map((xray?.asins || []).map((a) => [up(a.asin), a]));
  let pop;
  if (poe?.asinMetrics?.length) {
    out.basis = "clicks";
    pop = poe.asinMetrics.map((p) => { const x = xr.get(up(p.asin)); const cs = clickShare(p); return { asin: up(p.asin), brand: p.brand, share: cs?.share ?? null, dateX: x?.creationDate || null, dateP: p.launchDate || null, sales: isNum(x?.asinSales) ? x.asinSales : null, reviewsX: isNum(x?.reviews) ? x.reviews : null, reviewsP: isNum(p.reviews) ? p.reviews : null }; });
  } else if (xray?.asins?.length) {
    out.basis = "revenue"; // без POE «заметность» меряем долей выручки
    const total = xray.asins.reduce((s, a) => s + (a.asinRevenue ?? 0), 0);
    pop = xray.asins.map((a) => ({ asin: up(a.asin), brand: a.brand, share: total > 0 && isNum(a.asinRevenue) ? a.asinRevenue / total : null, dateX: a.creationDate || null, dateP: null, sales: isNum(a.asinSales) ? a.asinSales : null, reviewsX: isNum(a.reviews) ? a.reviews : null, reviewsP: null }));
  } else { out.reason = "нет данных о товарах ниши — загрузите POE или Xray"; return out; }
  pop = pop.filter((m) => isNum(m.share)); out.population = pop.length;
  if (!pop.length) { out.reason = "в отчёте нет долей по товарам"; return out; }
  out.uniformShare = 1 / pop.length;
  for (const m of pop) { m.ageSource = m.dateX ? "xray" : m.dateP ? "poe" : null; m.age = monthsSince(m.dateX || m.dateP, refDate); }
  const dated = pop.filter((m) => m.age !== null);
  out.ageFilterSkipped = dated.length > 0 && dated.every((m) => m.age < th.cohortMinAgeMonths); // вся ниша моложе порога — нижний фильтр возраста не применяем
  out.inheritedChecked = pop.some((m) => m.sales !== null);
  for (const m of pop) {
    if (m.age === null) { out.excluded.noDate++; continue; }
    if (m.age >= th.cohortMaxAgeMonths) { out.excluded.tooOld++; continue; }
    if (!out.ageFilterSkipped && m.age < th.cohortMinAgeMonths) { out.excluded.tooYoung++; continue; }
    if (m.share < out.uniformShare) { out.excluded.lowShare++; continue; }
    const reviews = m.reviewsX ?? m.reviewsP;
    // «Наследник»: отзывов больше, чем листинг мог собрать за свою жизнь при нынешних продажах — отзывы перенесены со старого листинга / вариации.
    if (m.sales !== null && isNum(reviews) && reviews > m.sales * Math.max(m.age, 1) * th.inheritedReviewRate + 50) { out.excluded.inherited++; continue; }
    if (m.ageSource === "poe") out.ageFromPoe++;
    out.members.push({ asin: m.asin, brand: m.brand, ageMonths: Math.round(m.age * 10) / 10, ageSource: m.ageSource, share: m.share, sales: m.sales, reviews: isNum(reviews) ? reviews : null });
  }
  out.members.sort((a, b) => b.share - a.share); out.size = out.members.length;
  if (out.size < th.minCohort) { out.reason = out.size ? `новых участников, вышедших на продажи, всего ${out.size} — для ориентиров нужно не меньше ${th.minCohort}` : "в нише нет листингов моложе " + th.cohortMaxAgeMonths + " месяцев с заметной долей — новички сюда не заходят или не закрепляются"; }
  else out.ok = true;
  const sales = out.members.map((m) => m.sales).filter(isNum); out.salesN = sales.length;
  if (sales.length) { out.salesMedian = median(sales); out.salesP25 = percentile(sales, 25); out.salesP75 = percentile(sales, 75); }
  const fromX = out.members.some((m) => xr.get(m.asin) && isNum(xr.get(m.asin).reviews));
  out.reviewsMedian = median(out.members.map((m) => m.reviews)); out.reviewsSource = out.reviewsMedian === null ? null : fromX ? "xray" : "poe";
  const shares = out.members.map((m) => m.share);
  out.shareMedian = median(shares); out.shareP75 = percentile(shares, th.reachOkPct ?? 75); out.shareP90 = percentile(shares, th.reachWarnPct ?? 90); /* границы «достижимо» и «на пределе» */ out.bestShare = shares.length ? Math.max(...shares) : null;
  return out;
}

/** Достижимость цели: какая доля кликов нужна и есть ли она у кого-то. Информационно — на вердикт не влияет (пороги предварительные). */
export function reach(per, cohort, poe, inputs, th) {
  const unitsPerDay = num(inputs.unitsPerDay); const target = isNum(unitsPerDay) && unitsPerDay > 0 ? unitsPerDay * 30 : null;
  const out = { ok: false, reason: per.reason, preliminary: true, targetMonthly: target, requiredShare: null, requiredLow: null, requiredHigh: null, productsWithShare: null, productsTotal: null,
    leaderShare: null, bestNewcomerShare: cohort.bestShare, status: "na", basis: null, okUpToPerDay: null, warnUpToPerDay: null, note: "" };
  if (!per.ok) return out;
  const shares = (poe?.asinMetrics || []).map((a) => clickShare(a)?.share).filter(isNum);
  out.productsTotal = shares.length; out.leaderShare = shares.length ? Math.max(...shares) : null;
  if (target === null) { out.reason = "цель продаж не задана — показаны только продажи на 1 % кликов"; return out; }
  out.ok = true; out.reason = null;
  out.requiredShare = target / per.median / 100; out.requiredLow = target / per.p75 / 100; out.requiredHigh = target / per.p25 / 100;
  out.productsWithShare = shares.filter((s) => s >= out.requiredShare).length;
  const perDay = (share) => (share * 100 * per.median) / 30; // до какой цели (шт/день) хватает такой доли кликов
  if (cohort.ok) {
    out.basis = "cohort";
    out.status = out.requiredShare <= cohort.shareP75 ? "ok" : out.requiredShare <= cohort.shareP90 ? "warn" : "fail";
    out.okUpToPerDay = perDay(cohort.shareP75); out.warnUpToPerDay = perDay(cohort.shareP90);
    out.note = out.status === "ok" ? "такую долю кликов уже берут новички ниши" : out.status === "warn" ? "на пределе: такую долю берут только лучшие из новичков" : "выше того, чего достигли новички ниши";
  } else {
    out.basis = "niche";
    out.status = out.productsWithShare >= th.reachOkProducts ? "ok" : out.productsWithShare >= 1 ? "warn" : "fail";
    const sorted = [...shares].sort((a, b) => b - a);
    out.okUpToPerDay = sorted.length >= th.reachOkProducts ? perDay(sorted[th.reachOkProducts - 1]) : null; out.warnUpToPerDay = sorted.length ? perDay(sorted[0]) : null;
    out.note = out.status === "ok" ? `такая доля кликов есть у ${out.productsWithShare} товаров ниши` : out.status === "warn" ? `такая доля кликов есть только у ${out.productsWithShare} товар(ов) ниши` : "такой доли кликов нет ни у одного товара ниши";
  }
  return out;
}

/** Срок до планки отзывов: (планка − Vine) ÷ доля покупателей с отзывом ÷ продажи в месяц. */
export function reviewBarrier(cohort, nicheReviewMedian, leaderReviews, inputs, th, targetMonthly) {
  const rateIn = num(inputs.reviewRate), vineIn = num(inputs.vineReviews);
  const rate = isNum(rateIn) && rateIn > 0 ? rateIn : th.reviewRate, vine = isNum(vineIn) && vineIn >= 0 ? vineIn : th.vineReviews;
  const fromCohort = cohort.ok && isNum(cohort.reviewsMedian);
  const threshold = fromCohort ? cohort.reviewsMedian : isNum(nicheReviewMedian) ? nicheReviewMedian : null;
  const out = { ok: threshold !== null, threshold, thresholdFrom: threshold === null ? null : fromCohort ? "cohort" : "niche", source: fromCohort ? cohort.reviewsSource : null,
    leaderReviews: isNum(leaderReviews) ? leaderReviews : null, reviewRate: rate, reviewRateAssumed: !(isNum(rateIn) && rateIn > 0), vineReviews: vine, vineOnly: false, atTarget: null, atCohort: null };
  if (threshold === null) return out;
  const rest = Math.max(0, threshold - vine); out.vineOnly = rest === 0;
  const months = (sales) => (isNum(sales) && sales > 0 ? rest / (rate * sales) : null);
  out.atTarget = { salesMonthly: targetMonthly ?? null, months: months(targetMonthly) };
  out.atCohort = { salesMonthly: cohort.salesMedian, months: months(cohort.salesMedian) };
  return out;
}

/** Цена «по кликам покупателей»: взвешена долей кликов — дорогой неходовой товар не тянет её вверх, как обычную среднюю. */
export function clickWeightedPrice(poe, ctx = {}, th = { clickPriceGap: 0.15 }) {
  const rows = (poe?.asinMetrics || []).map((a) => ({ price: a.price, w: clickShare(a)?.share })).filter((r) => isNum(r.price) && r.price > 0 && isNum(r.w));
  if (rows.length < 3) return null;
  const w = rows.reduce((s, r) => s + r.w, 0); if (!(w > 0)) return null;
  const value = rows.reduce((s, r) => s + r.price * r.w, 0) / w;
  const gap = (v) => (isNum(v) && v > 0 ? (v - value) / value : null);
  const out = { value, n: rows.length, simpleAvg: rows.reduce((s, r) => s + r.price, 0) / rows.length, median: median(rows.map((r) => r.price)), reference: isNum(ctx.priceMedian) ? ctx.priceMedian : null,
    myPrice: isNum(ctx.myPrice) ? ctx.myPrice : null, band: ctx.band?.active ? { min: ctx.band.min, max: ctx.band.max, label: ctx.band.label } : null, gapLimit: th.clickPriceGap, flags: [] };
  out.referenceGap = gap(out.reference); out.avgGap = gap(out.simpleAvg); out.myPriceGap = gap(out.myPrice);
  if (isNum(out.avgGap) && Math.abs(out.avgGap) > th.clickPriceGap) out.flags.push("avg");
  if (isNum(out.referenceGap) && Math.abs(out.referenceGap) > th.clickPriceGap) out.flags.push("reference");
  if (isNum(out.myPriceGap) && Math.abs(out.myPriceGap) > th.clickPriceGap) out.flags.push("myPrice");
  if (out.band && ((isNum(out.band.min) && value < out.band.min) || (isNum(out.band.max) && value > out.band.max))) out.flags.push("band");
  return out;
}

/** Особенности полей POE, о которые легко споткнуться. */
export function poeDataNotes(xray, poe, th) {
  if (!poe) return [];
  const notes = [
    { id: "reviews", text: "Отзывы в POE — только отзывы с текстом; Xray считает все оценки. Для одного и того же товара в POE число будет меньше — это не ошибка." },
    { id: "launchDate", text: "Дата запуска в POE может быть датой всей вариации, а не конкретного ASIN. Возраст листинга берём из Xray (Creation Date), когда он загружен." },
    { id: "avgPrice", text: "Цена товара и средняя цена ниши в POE — средние за 360 дней, а не сегодняшние." },
  ];
  const xr = new Map((xray?.asins || []).map((a) => [up(a.asin), a])); const gaps = [];
  for (const p of poe.asinMetrics || []) {
    const x = xr.get(up(p.asin)); if (!x?.creationDate || !p.launchDate) continue;
    const days = Math.abs(new Date(x.creationDate) - new Date(p.launchDate)) / 86400000;
    if (days > th.dateGapDays) gaps.push({ asin: up(p.asin), brand: p.brand, xray: x.creationDate, poe: String(p.launchDate).slice(0, 10), days: Math.round(days) });
  }
  if (gaps.length) notes.push({ id: "dateGap", text: `У ${gaps.length} товар(ов) дата создания в Xray и дата запуска в POE расходятся больше чем на ${th.dateGapDays} дней — в расчёте возраста взята дата Xray.`, items: gaps.sort((a, b) => b.days - a.days).slice(0, 8) });
  return notes;
}

/**
 * @param {object} p { xray, poe, inputs, thresholds } — ВСЯ ниша (до ценового диапазона)
 * @param {object} ctx { refDate, nicheReviewMedian, leaderReviews }
 */
export function entryFeasibility(p, ctx = {}) {
  const th = p.thresholds.entry, thc = p.thresholds.cashflow;
  const per = salesPerClickPct(p.xray, p.poe, th);
  const cohort = newEntrantCohort(p.xray, p.poe, th, ctx.refDate || new Date());
  const r = reach(per, cohort, p.poe, p.inputs, th);
  const reviews = reviewBarrier(cohort, ctx.nicheReviewMedian, ctx.leaderReviews, p.inputs, thc, r.targetMonthly);
  const { rows, ...perSummary } = per; // строки по товарам в результаты не кладём — они восстанавливаются из отчётов
  return { available: Boolean(p.xray?.asins?.length || p.poe?.asinMetrics?.length), salesPerClickPct: perSummary, cohort: { ...cohort, members: cohort.members.slice(0, 12) }, reach: r, reviews };
}
