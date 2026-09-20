import { test } from "node:test";
import assert from "node:assert/strict";
import { percentile, salesPerClickPct, newEntrantCohort, reviewBarrier, clickWeightedPrice, poeDataNotes } from "../shared/entry.js";
import { mergeThresholds } from "../shared/thresholds.js";
import { median, monthsSince } from "../shared/num.js";
import { compute } from "../shared/compute.js";
import { migrate } from "../shared/analysis.js";
import { entryFixture } from "./helpers/entry-fixture.js";
import { fixtureAnalysis } from "./helpers/fixture-analysis.js";

const TH = mergeThresholds();
const REF = new Date("2026-09-15T10:39:50.578Z");
const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`);

test("percentile: линейная интерполяция, пустой массив", () => {
  assert.equal(percentile([1, 2, 3, 4, 5], 50), 3); assert.equal(percentile([1, 2, 3, 4], 25), 1.75); assert.equal(percentile([10], 90), 10); assert.equal(percentile([], 50), null);
  assert.equal(percentile([5, 1, null, "x", 3], 100), 5);
});

test("SC-002: продажи на 1 % кликов совпадают с ручным расчётом по тем же строкам", () => {
  const a = entryFixture(); const { xray, poe } = a.aggregates;
  const bySales = new Map(xray.asins.map((x) => [x.asin, x.asinSales]));
  const manual = poe.asinMetrics.filter((p) => (p.clickShareT90 ?? p.clickShareT360) > 0 && bySales.get(p.asin) > 0).map((p) => bySales.get(p.asin) / ((p.clickShareT90 ?? p.clickShareT360) * 100));
  const per = salesPerClickPct(xray, poe, TH.entry);
  assert.equal(per.ok, true); assert.equal(per.n, manual.length); assert.ok(per.n >= 40, `пересечение ${per.n}`);
  near(per.median, median(manual)); near(per.p25, percentile(manual, 25)); near(per.p75, percentile(manual, 75));
  assert.ok(per.median > 26 && per.median < 54, `медиана ${per.median} — около заложенных 40`); assert.ok(per.p25 < per.median && per.median < per.p75);
  const R = a.results.entry; near(R.salesPerClickPct.median, per.median); assert.equal(R.salesPerClickPct.rows, undefined, "строки по товарам в результаты не дублируются");
});

test("требуемая доля кликов под цель: формула, разброс, число товаров с такой долей; ползунок цели меняет ответ", () => {
  const a = entryFixture({ inputs: { unitsPerDay: 10 } }); const r = a.results.entry.reach, per = a.results.entry.salesPerClickPct;
  assert.equal(r.ok, true); assert.equal(r.targetMonthly, 300); assert.equal(r.preliminary, true);
  near(r.requiredShare, 300 / per.median / 100); near(r.requiredLow, 300 / per.p75 / 100); near(r.requiredHigh, 300 / per.p25 / 100); assert.ok(r.requiredLow < r.requiredShare && r.requiredShare < r.requiredHigh);
  const shares = a.aggregates.poe.asinMetrics.map((p) => p.clickShareT90 ?? p.clickShareT360);
  assert.equal(r.productsWithShare, shares.filter((s) => s >= r.requiredShare).length); near(r.leaderShare, Math.max(...shares));
  assert.ok(["ok", "warn", "fail"].includes(r.status)); assert.equal(r.basis, "cohort");
  const small = entryFixture({ inputs: { unitsPerDay: 2 } }).results.entry.reach, big = entryFixture({ inputs: { unitsPerDay: 60 } }).results.entry.reach;
  assert.ok(small.requiredShare < r.requiredShare && r.requiredShare < big.requiredShare); assert.equal(small.status, "ok"); assert.equal(big.status, "fail"); assert.equal(big.productsWithShare, 0);
  // обратная задача: на границе «зелёной» цели статус ещё ok, чуть выше — уже нет
  const edge = entryFixture({ inputs: { unitsPerDay: Math.floor(r.okUpToPerDay * 10) / 10 } }).results.entry.reach; assert.equal(edge.status, "ok");
  assert.notEqual(entryFixture({ inputs: { unitsPerDay: r.okUpToPerDay * 1.05 } }).results.entry.reach.status, "ok");
});

test("когорта новых участников: возраст 2–24 мес, доля не ниже равномерной, причины отсева в сумме дают всю нишу", () => {
  const a = entryFixture(); const c = a.results.entry.cohort, poe = a.aggregates.poe;
  assert.equal(c.ok, true); assert.equal(c.basis, "clicks"); assert.equal(c.population, poe.asinMetrics.length); near(c.uniformShare, 1 / c.population);
  assert.equal(c.size + Object.values(c.excluded).reduce((s, x) => s + x, 0), c.population, "никто не потерян");
  for (const m of c.members) { assert.ok(m.ageMonths >= 2 && m.ageMonths < 24, `${m.asin}: ${m.ageMonths} мес`); assert.ok(m.share >= c.uniformShare); assert.equal(m.ageSource, "xray"); }
  const expected = poe.asinMetrics.filter((p) => { const age = monthsSince(p.launchDate, REF); return age >= 2 && age < 24 && (p.clickShareT90 ?? p.clickShareT360) >= c.uniformShare; }).length;
  assert.equal(c.size + c.excluded.inherited, expected);
  assert.equal(c.reviewsSource, "xray"); assert.ok(c.salesMedian > 0 && c.salesP25 <= c.salesMedian && c.salesMedian <= c.salesP75); near(c.bestShare, Math.max(...c.members.map((m) => m.share)));
  assert.ok(c.members.length <= 12);
});

test("«наследник» отзывов исключается из ориентиров и назван", () => {
  const base = entryFixture().results.entry.cohort; const victim = base.members[0].asin;
  const a = entryFixture({ mutateXray: (x) => { x.asins.find((r) => r.asin === victim).reviews = 9000; } }); const c = a.results.entry.cohort;
  assert.equal(c.excluded.inherited, base.excluded.inherited + 1); assert.equal(c.members.some((m) => m.asin === victim), false); assert.equal(c.inheritedChecked, true);
  assert.ok(c.reviewsMedian < 9000);
});

test("нехватка данных: причина названа, оценок «на глаз» нет", () => {
  const poeOnly = entryFixture({ withXray: false }).results.entry;
  assert.equal(poeOnly.salesPerClickPct.ok, false); assert.match(poeOnly.salesPerClickPct.reason, /нужен Xray/); assert.equal(poeOnly.reach.status, "na"); assert.equal(poeOnly.reach.requiredShare, null);
  assert.equal(poeOnly.cohort.ok, true, "когорта по POE считается и без Xray"); assert.equal(poeOnly.cohort.reviewsSource, "poe"); assert.equal(poeOnly.cohort.salesMedian, null); assert.equal(poeOnly.cohort.inheritedChecked, false); assert.ok(poeOnly.cohort.ageFromPoe > 0);
  const mixed = fixtureAnalysis().results.entry; // Xray и POE из разных ниш — пересечения нет
  assert.equal(mixed.salesPerClickPct.ok, false); assert.match(mixed.salesPerClickPct.reason, /нужно не меньше 5/);
  const noSales = entryFixture({ mutateXray: (x) => { x.flags.hasAsinSales = false; } }).results.entry; assert.match(noSales.salesPerClickPct.reason, /нет колонки продаж/);
  const few = entryFixture({ mutateXray: (x) => { x.asins = x.asins.slice(0, 3); } }).results.entry; assert.equal(few.salesPerClickPct.ok, false); assert.equal(few.salesPerClickPct.n <= 3, true);
  const empty = compute(migrate({ schemaVersion: 1, id: "e", niche: "пусто" })).entry; assert.equal(empty.available, false); assert.equal(empty.cohort.ok, false); assert.equal(empty.reviews.ok, false);
  const noGoal = entryFixture({ inputs: { unitsPerDay: 0 } }).results.entry.reach; assert.equal(noGoal.ok, false); assert.match(noGoal.reason, /цель продаж не задана/);
});

test("вся ниша моложе 2 месяцев — нижний фильтр возраста не применяется; нет доли за 90 дней — берётся годовая", () => {
  const a = entryFixture(); const { xray, poe } = a.aggregates;
  const young = { asins: xray.asins.map((x) => ({ ...x, creationDate: "2026-08-20" })), flags: xray.flags };
  const c = newEntrantCohort(young, poe, TH.entry, REF); assert.equal(c.ageFilterSkipped, true); assert.equal(c.excluded.tooYoung, 0); assert.ok(c.size > 0);
  const noT90 = { ...poe, asinMetrics: poe.asinMetrics.map((p, i) => (i < 10 ? { ...p, clickShareT90: null } : p)) };
  assert.equal(salesPerClickPct(xray, noT90, TH.entry).fallbackT360, 10);
});

test("FR-013: ценовой диапазон не меняет трафик, когорту и отзывы", () => {
  const whole = entryFixture().results, banded = entryFixture({ inputs: { priceMin: 20, priceMax: 30 } }).results;
  assert.equal(banded.priceBand.active, true); assert.ok(banded.priceBand.inCount < banded.priceBand.totalCount);
  assert.deepEqual(banded.entry, whole.entry); assert.equal(banded.clickPrice.value, whole.clickPrice.value); assert.deepEqual(banded.regulatory, whole.regulatory);
  assert.equal(banded.clickPrice.band.label, "$20–$30");
});

test("срок до планки отзывов: две точки продаж, Vine, допущение 2 %", () => {
  const a = entryFixture(); const rv = a.results.entry.reviews, c = a.results.entry.cohort;
  assert.equal(rv.thresholdFrom, "cohort"); assert.equal(rv.threshold, c.reviewsMedian); assert.equal(rv.source, "xray"); assert.equal(rv.reviewRateAssumed, true); assert.equal(rv.reviewRate, 0.02); assert.equal(rv.vineReviews, 30);
  near(rv.atTarget.months, Math.max(0, rv.threshold - 30) / (0.02 * 300)); near(rv.atCohort.months, Math.max(0, rv.threshold - 30) / (0.02 * c.salesMedian)); assert.equal(rv.atCohort.salesMonthly, c.salesMedian);
  assert.ok(rv.leaderReviews > rv.threshold, "планка новичков ниже отзывов лидера");
  const custom = entryFixture({ inputs: { reviewRate: 0.04, vineReviews: 0 } }).results.entry.reviews; assert.equal(custom.reviewRateAssumed, false); near(custom.atTarget.months, custom.threshold / (0.04 * 300));
  const cohortStub = { ok: true, reviewsMedian: 25, reviewsSource: "poe", salesMedian: 120 };
  const vineOnly = reviewBarrier(cohortStub, 400, 5000, {}, TH.cashflow, 300); assert.equal(vineOnly.vineOnly, true); assert.equal(vineOnly.atTarget.months, 0); assert.equal(vineOnly.source, "poe");
  const fallback = reviewBarrier({ ok: false, reviewsMedian: null, salesMedian: null }, 400, 5000, {}, TH.cashflow, 300); assert.equal(fallback.thresholdFrom, "niche"); assert.equal(fallback.threshold, 400); assert.equal(fallback.atCohort.months, null);
  assert.equal(reviewBarrier({ ok: false }, null, null, {}, TH.cashflow, 300).ok, false);
});

test("цена по кликам покупателей: взвешена долей кликов, флаги расхождения > 15 %", () => {
  const poe = { asinMetrics: [{ price: 10, clickShareT90: 0.6 }, { price: 20, clickShareT90: 0.3 }, { price: 100, clickShareT90: 0.1 }, { price: null, clickShareT90: 0.2 }, { price: 50, clickShareT90: null, clickShareT360: null }] };
  const cp = clickWeightedPrice(poe, { priceMedian: 20, myPrice: 40 }, TH.entry);
  near(cp.value, (10 * 0.6 + 20 * 0.3 + 100 * 0.1) / 1.0); assert.equal(cp.n, 3); near(cp.simpleAvg, 130 / 3); assert.equal(cp.median, 20);
  assert.deepEqual(cp.flags.sort(), ["avg", "myPrice"]); near(cp.myPriceGap, (40 - 22) / 22);
  assert.deepEqual(clickWeightedPrice(poe, { band: { active: true, min: 30, max: 60, label: "$30–$60" } }, TH.entry).flags, ["avg", "band"]);
  assert.equal(clickWeightedPrice({ asinMetrics: poe.asinMetrics.slice(0, 2) }, {}, TH.entry), null); assert.equal(clickWeightedPrice(null), null);
  const real = entryFixture().results.clickPrice; assert.ok(real.value > 5 && real.value < 200); assert.equal(real.myPrice, 24.99);
});

test("ловушки данных POE: три постоянные пометки и расхождение дат Xray/POE > 90 дней", () => {
  const a = entryFixture(); assert.deepEqual(a.results.dataNotes.map((n) => n.id), ["reviews", "launchDate", "avgPrice"]);
  const asin = a.aggregates.poe.asinMetrics[0].asin;
  const b = entryFixture({ mutateXray: (x) => { x.asins.find((r) => r.asin === asin).creationDate = "2024-06-01"; } });
  const gap = b.results.dataNotes.find((n) => n.id === "dateGap"); assert.ok(gap); assert.equal(gap.items[0].asin, asin); assert.ok(gap.items[0].days > 90); assert.equal(gap.items[0].xray, "2024-06-01");
  assert.deepEqual(poeDataNotes(a.aggregates.xray, null, TH.entry), []);
});
