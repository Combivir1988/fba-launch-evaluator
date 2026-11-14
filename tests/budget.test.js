import { test } from "node:test";
import assert from "node:assert/strict";
import { budget } from "../shared/budget.js";
import { cashflow } from "../shared/cashflow.js";
import { DEFAULT_THRESHOLDS as TH } from "../shared/thresholds.js";

test("Партия, пример 1: $7 × 10 шт × 60 дн = $4 200 партия, две партии $8 400", () => {
  const b = budget({ cogs: 7, shippingPerUnit: 0, unitsPerDay: 10, productionDays: 30, shippingDays: 15, receivingDays: 15, budget: 8400 }, TH);
  assert.equal(b.leadDays, 60);
  assert.equal(b.batchCost, 4200);
  assert.equal(b.twoBatches, 8400);
  assert.equal(b.status, "ok");
});

test("Партия, пример 2: $10 × 10 × 90 = $9 000; бюджет $15 000 не покрывает две партии", () => {
  const b = budget({ cogs: 10, unitsPerDay: 10, productionDays: 45, shippingDays: 30, receivingDays: 15, budget: 15000 }, TH);
  assert.equal(b.batchCost, 9000);
  assert.equal(b.need, 18000);
  assert.equal(b.status, "fail");
  assert.equal(b.quickScreen.budgetFit.status, "fail");
});

test("Четыре стоп-вопроса", () => {
  const b = budget({ cogs: 5, unitsPerDay: 10, budget: 20000, canDifferentiate: "yes" }, TH, { roi: 1.8, revenueStatus: "ok", revenueMonthly: 600000 });
  assert.equal(b.quickScreenStatus, "ok");
  const b2 = budget({ cogs: 5, unitsPerDay: 10, budget: 20000, canDifferentiate: "no" }, TH, { roi: 0.9, revenueStatus: "fail" });
  assert.equal(b2.quickScreenStatus, "fail");
  assert.equal(b2.quickScreen.roi150.status, "fail");
});

test("Стоп-вопрос «выручка ≥ $500k» по прокси POE — погранично, не жёсткий No-Go (прокси занижает)", () => {
  const b = budget({ cogs: 5, unitsPerDay: 10, budget: 20000, canDifferentiate: "yes" }, TH, { roi: 1.8, revenueStatus: "fail", revenueSource: "proxy", revenueMonthly: 145000 });
  assert.equal(b.quickScreen.revenue500k.status, "warn");
  assert.notEqual(b.quickScreenStatus, "fail");
  const x = budget({ cogs: 5, unitsPerDay: 10, budget: 20000, canDifferentiate: "yes" }, TH, { roi: 1.8, revenueStatus: "fail", revenueSource: "xray", revenueMonthly: 145000 });
  assert.equal(x.quickScreen.revenue500k.status, "fail", "по Xray — реальный стоп");
});

test("spec 005: стоп-вопрос о бюджете оценивается по пику вложений помесячного сценария; прежняя сумма остаётся справочно", () => {
  const inp = { cogs: 10, unitsPerDay: 10, productionDays: 45, shippingDays: 30, receivingDays: 15, budget: 15000 };
  const ok = budget(inp, TH, { cash: { pending: false, peak: 12000 } });
  assert.equal(ok.basis, "cash"); assert.equal(ok.need, 12000); assert.equal(ok.needTwoBatches, 18000); assert.equal(ok.gap, 3000); assert.equal(ok.status, "ok");
  assert.match(ok.quickScreen.budgetFit.text, /пик вложений/); assert.match(ok.quickScreen.budgetFit.detail, /пик вложений \$12.000, бюджет \$15.000 — запас \$3.000; справочно, две партии \+ реклама: \$18.000/);
  assert.equal(budget(inp, TH, { cash: { pending: false, peak: 16500 } }).status, "warn", "дефицит в пределах 15 % от потребности");
  assert.equal(budget(inp, TH, { cash: { pending: false, peak: 25000 } }).quickScreen.budgetFit.status, "fail");
  const noBudget = budget({ ...inp, budget: null }, TH, { cash: { pending: false, peak: 12000 } }); assert.equal(noBudget.status, "unknown"); assert.match(noBudget.quickScreen.budgetFit.detail, /нужно \$12.000 на пике вложений/);
  const fallback = budget(inp, TH, { cash: { pending: true, peak: null } }); assert.equal(fallback.basis, "two_batches"); assert.equal(fallback.need, 18000); assert.match(fallback.quickScreen.budgetFit.text, /две партии/);
});

test("отзыв 2026-11-13: первая партия в бюджете та же, что в сценарии — с учётом возвратов", () => {
  // Было: budget считал units × leadDays БЕЗ поправки на возвраты, а cashflow — с ней.
  // Одна и та же первая партия расходилась в одном отчёте: 75 шт против 83 при 10 % возвратов.
  const inputs = { price: 40, cogs: 8, shippingPerUnit: 2, referralPct: 0.15, fbaFee: 6, cpc: 1, cvr: 0.1, ppcShare: 0.7,
    unitsPerDay: 1, productionDays: 30, shippingDays: 30, receivingDays: 15 };
  const cash = cashflow(inputs, TH, { cohortSalesMedian: 500, returnRate: 0.10 });
  const b = budget(inputs, TH, { cash });

  assert.ok(cash.lossRate > 0, "возвраты в сценарии учтены");
  assert.equal(b.batchUnits, cash.firstBatchUnits, "в отчёте одна первая партия, а не две разные");
  assert.equal(b.batchFrom, "cashflow");
  assert.ok(b.batchUnits > inputs.unitsPerDay * b.leadDays, "и она БОЛЬШЕ прежней: списанное надо докупить");
  assert.equal(b.batchCost, b.landed * b.batchUnits);
});

test("без сценария первая партия считается по сроку поставки — запасной путь жив", () => {
  const inputs = { price: 40, cogs: 8, shippingPerUnit: 2, unitsPerDay: 2, productionDays: 30, shippingDays: 30, receivingDays: 15 };
  const b = budget(inputs, TH, {});           // цели продаж нет — сценарий не строится
  assert.equal(b.batchFrom, "lead_time");
  assert.equal(b.batchUnits, 2 * b.leadDays);
});
