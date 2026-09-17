import { test } from "node:test";
import assert from "node:assert/strict";
import { budget } from "../shared/budget.js";
import { DEFAULT_THRESHOLDS as TH } from "../shared/thresholds.js";

test("Урок 08, пример 1: $7 × 10 шт × 60 дн = $4 200 партия, две партии $8 400", () => {
  const b = budget({ cogs: 7, shippingPerUnit: 0, unitsPerDay: 10, productionDays: 30, shippingDays: 15, receivingDays: 15, budget: 8400 }, TH);
  assert.equal(b.leadDays, 60);
  assert.equal(b.batchCost, 4200);
  assert.equal(b.twoBatches, 8400);
  assert.equal(b.status, "ok");
});

test("Урок 08, пример 2: $10 × 10 × 90 = $9 000; бюджет $15 000 не покрывает две партии", () => {
  const b = budget({ cogs: 10, unitsPerDay: 10, productionDays: 45, shippingDays: 30, receivingDays: 15, budget: 15000 }, TH);
  assert.equal(b.batchCost, 9000);
  assert.equal(b.need, 18000);
  assert.equal(b.status, "fail");
  assert.equal(b.quickScreen.budgetFit.status, "fail");
});

test("Стоп-вопросы урока 07", () => {
  const b = budget({ cogs: 5, unitsPerDay: 10, budget: 20000, canDifferentiate: "yes" }, TH, { roi: 1.8, revenueStatus: "ok", revenueMonthly: 600000 });
  assert.equal(b.quickScreenStatus, "ok");
  const b2 = budget({ cogs: 5, unitsPerDay: 10, budget: 20000, canDifferentiate: "no" }, TH, { roi: 0.9, revenueStatus: "fail" });
  assert.equal(b2.quickScreenStatus, "fail");
  assert.equal(b2.quickScreen.roi150.status, "fail");
});
