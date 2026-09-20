import { test } from "node:test";
import assert from "node:assert/strict";
import { cashflow } from "../shared/cashflow.js";
import { mergeThresholds } from "../shared/thresholds.js";
import { entryFixture } from "./helpers/entry-fixture.js";

const TH = mergeThresholds();
const BASE = { price: 40, cogs: 8, shippingPerUnit: 2, referralPct: 0.15, fbaFee: 6, cpc: 1, cvr: 0.10, ppcShare: 0.7, unitsPerDay: 10, productionDays: 30, shippingDays: 30, receivingDays: 15 };
const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`);
const sum = (rows, k) => rows.reduce((s, r) => s + r[k], 0);

test("SC-003: оплаты партий = закупленные штуки × себестоимость; с продаж себестоимость не вычитается второй раз", () => {
  const c = cashflow(BASE, TH, { cohortSalesMedian: 90, reviewThreshold: 120 });
  assert.equal(c.pending, false); assert.equal(c.landed, 10); assert.equal(c.leadDays, 75); assert.equal(c.leadMonths, 3); assert.equal(c.rows.length, 3 + 12);
  near(sum(c.rows, "orderCost"), c.unitsPurchased * 10); assert.equal(sum(c.rows, "ordered"), c.unitsPurchased); assert.equal(c.batches, c.rows.filter((r) => r.ordered > 0).length);
  for (const r of c.rows) { near(r.payout, r.sold * (40 - 6 - 6)); near(r.revenue, r.sold * 40); near(r.net, r.payout - r.ads - r.orderCost - r.startup); }
  near(c.endCum, sum(c.rows, "payout") - sum(c.rows, "ads") - c.unitsPurchased * 10); near(c.rows.at(-1).cum, c.endCum);
  near(c.unitsSold, sum(c.rows, "sold")); near(c.stockUnitsEnd, c.unitsPurchased - c.unitsSold); near(c.stockValueEnd, c.stockUnitsEnd * 10);
  assert.equal(c.rows[0].ordered, 750, "первая партия по умолчанию — продажи за срок поставки"); assert.equal(c.rows[0].orderCost, 7500); assert.equal(c.rows[3].arrived, 750);
});

test("разгон: от медианы новичков до цели за rampMonths; без данных о новичках — с нуля; ручной стартовый уровень важнее", () => {
  const c = cashflow(BASE, TH, { cohortSalesMedian: 90 }); const sell = c.rows.filter((r) => r.sellingMonth);
  assert.equal(c.startSource, "cohort"); assert.equal(sell[0].demand, 90); near(sell[1].demand, 90 + (300 - 90) / 5); assert.equal(sell[5].demand, 300); assert.equal(sell[11].demand, 300);
  const z = cashflow(BASE, TH, {}); assert.equal(z.startSource, "zero"); near(z.rows[3].demand, 50); near(z.rows[8].demand, 300); assert.match(z.assumptions[0], /с нуля/);
  const m = cashflow({ ...BASE, startSalesMonthly: 150, rampMonths: 3 }, TH, { cohortSalesMedian: 90 }); assert.equal(m.startSource, "input"); assert.deepEqual(m.rows.slice(3, 7).map((r) => r.demand), [150, 225, 300, 300]);
  assert.equal(cashflow({ ...BASE, startSalesMonthly: 900 }, TH).startSales, 300, "стартовый уровень не выше цели");
  assert.equal(cashflow({ ...BASE, rampMonths: 1 }, TH).rows[3].demand, 300);
});

test("дозаказ с учётом срока поставки: без провалов наличия при партии по умолчанию; маленькая первая партия → «нет в наличии»", () => {
  const c = cashflow(BASE, TH, { cohortSalesMedian: 90 });
  assert.equal(c.stockoutMonths, 0); assert.ok(c.batches >= 3, `партий ${c.batches}`);
  for (const r of c.rows.filter((x) => x.ordered > 0 && x.month > 0)) { const arrival = c.rows[r.month + 3]; assert.ok(arrival, "партия успевает прийти до конца горизонта"); assert.equal(arrival.arrived, r.ordered); }
  assert.ok(c.stockUnitsEnd < 300 * 2, "к концу горизонта склад не раздут");
  const tiny = cashflow({ ...BASE, firstBatchUnits: 100 }, TH, { cohortSalesMedian: 250 });
  assert.ok(tiny.stockoutMonths > 0); const so = tiny.rows.find((r) => r.stockout); assert.ok(so.sold < so.demand); assert.equal(so.stockEnd, 0);
});

test("пик вложений и месяц возврата; убыточная реклама — деньги на горизонте не возвращаются", () => {
  const c = cashflow(BASE, TH, { cohortSalesMedian: 90 });
  near(c.peak, -Math.min(...c.rows.map((r) => r.cum))); assert.equal(c.rows[c.peakMonth].cum, -c.peak); assert.ok(c.peak >= 7500);
  assert.ok(c.paybackMonth > c.peakMonth); assert.ok(c.rows.slice(c.paybackMonth).every((r) => r.cum >= 0)); assert.ok(c.rows[c.paybackMonth - 1].cum < 0);
  const bad = cashflow({ ...BASE, cpc: 4 }, TH, { cohortSalesMedian: 90 }); assert.equal(bad.paybackMonth, null); assert.ok(bad.endCum < 0); assert.ok(bad.peak > c.peak);
});

test("реклама: до планки отзывов CVR × 0,7, после — полный; отзывы = Vine + доля × продажи", () => {
  const c = cashflow(BASE, TH, { cohortSalesMedian: 90, reviewThreshold: 60 }); const sell = c.rows.filter((r) => r.sellingMonth);
  near(sell[0].cvr, 0.07); near(sell[0].ads, (sell[0].sold * 0.7 * 1) / 0.07); assert.equal(sell.at(-1).cvr, 0.10);
  assert.ok(c.reviewsReachedMonth >= 3); near(c.rows[c.reviewsReachedMonth].reviews, 30 + 0.02 * sum(c.rows.slice(0, c.reviewsReachedMonth + 1), "sold")); assert.ok(c.rows[c.reviewsReachedMonth].reviews >= 60);
  const noThr = cashflow(BASE, TH, {}); assert.ok(noThr.rows.filter((r) => r.sellingMonth).every((r) => r.cvr === 0.10)); assert.equal(noThr.reviewsReachedMonth, null);
  const vine0 = cashflow({ ...BASE, vineReviews: 0, reviewRate: 0.05 }, TH, { reviewThreshold: 60 }); assert.equal(vine0.rows[2].reviews, 0); near(vine0.rows[3].reviews, 0.05 * vine0.rows[3].sold);
});

test("крайние случаи: нет COGS, нет цели, CPC неизвестен, срок поставки больше горизонта, стартовые расходы", () => {
  assert.equal(cashflow({ ...BASE, cogs: null }, TH).pending, true); assert.match(cashflow({ ...BASE, cogs: "" }, TH).reason, /COGS/); assert.match(cashflow({ ...BASE, unitsPerDay: 0 }, TH).reason, /цель продаж/);
  const noCpc = cashflow({ ...BASE, cpc: null, adsReserve: 3000, startupCosts: 1200 }, TH, {});
  assert.equal(noCpc.cpcMissing, true); assert.equal(sum(noCpc.rows, "ads"), 0); assert.equal(noCpc.rows[0].startup, 4200); assert.equal(noCpc.adsReserveUsed, 3000); assert.match(noCpc.assumptions.join(" "), /CPC неизвестен.*резерв на рекламу \$3000 списан/);
  const withCpc = cashflow({ ...BASE, adsReserve: 3000, startupCosts: 1200 }, TH, {}); assert.equal(withCpc.rows[0].startup, 1200); assert.equal(withCpc.adsReserveUsed, 0); assert.match(withCpc.assumptions.join(" "), /резерв на рекламу в сценарий не добавляется/);
  const long = cashflow({ ...BASE, productionDays: 300, shippingDays: 90, horizonMonths: 6 }, TH, {}); assert.equal(long.leadMonths, 14); assert.equal(long.batches, 1, "вторая партия не успела бы прийти");
  assert.equal(cashflow({ ...BASE, horizonMonths: 18 }, TH).rows.length, 3 + 18);
});

test("в общем расчёте: сценарий берёт старт из когорты и планку отзывов, бюджет сравнивается с пиком; ползунки меняют пик", () => {
  const a = entryFixture(); const R = a.results;
  assert.equal(R.cashflow.startSource, "cohort"); near(R.cashflow.startSales, Math.min(R.entry.cohort.salesMedian, 300)); assert.equal(R.cashflow.reviewThreshold, R.entry.reviews.threshold);
  assert.equal(R.budget.basis, "cash"); near(R.budget.need, R.cashflow.peak); near(R.budget.gap, 18750 - R.cashflow.peak); assert.equal(R.budget.needTwoBatches, R.budget.twoBatches);
  const more = entryFixture({ inputs: { unitsPerDay: 20 } }).results; assert.ok(more.cashflow.peak > R.cashflow.peak); assert.ok(more.cashflow.rows[0].ordered > R.cashflow.rows[0].ordered);
  const cheaper = entryFixture({ inputs: { cogs: 2 } }).results; assert.ok(cheaper.cashflow.peak < R.cashflow.peak);
  const poor = entryFixture({ inputs: { budget: 1000 } }).results; assert.equal(poor.budget.quickScreen.budgetFit.status, "fail"); assert.equal(poor.verdict.ceiling, "no_go");
});

test("первые 90 дней по сценарию разгона — тот же горизонт, что у Критерия 2, но продажи ниже цели; на целевом старте суммы совпадают с 2g–2i", () => {
  const c = cashflow(BASE, TH, { cohortSalesMedian: 90 }); const f = c.first90, first3 = c.rows.filter((r) => r.sellingMonth && r.sellingMonth <= 3);
  assert.equal(f.months, 3); assert.equal(f.days, 90); assert.equal(f.targetUnits, 900); near(f.units, sum(first3, "sold")); near(f.units, 90 + 132 + 174); near(f.revenue, f.units * 40); near(f.ads, sum(first3, "ads"));
  near(f.profit, f.units * (40 - 6 - 6 - 10) - f.ads, 1e-6); assert.ok(f.units < f.targetUnits);
  const a = entryFixture({ inputs: { startSalesMonthly: 300, rampMonths: 1, vineReviews: 0, reviewRate: 0.0001 } }); // старт сразу с цели
  const R = a.results, p = R.economics.criterion2Summary.period; near(R.cashflow.first90.units, p.units); near(R.cashflow.first90.revenue, p.revenue, 1e-6);
  const noPenalty = entryFixture({ inputs: { startSalesMonthly: 300, rampMonths: 1, vineReviews: 30, reviewRate: 0.02 } }).results; // планка отзывов влияет только на рекламу
  assert.ok(noPenalty.cashflow.first90.ads >= p.adSpend - 1e-6, "до планки отзывов реклама дороже, чем на целевом уровне");
  assert.equal(cashflow({ ...BASE, cogs: null }, TH).first90, null);
});
