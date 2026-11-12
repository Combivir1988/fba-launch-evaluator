// US3 (spec 020): запас с учётом возвратов, три сценария продаж, точка дозаказа.
// Тесты написаны ДО реализации и обязаны упасть без неё.
import { test } from "node:test";
import assert from "node:assert/strict";
import { cashflow } from "../shared/cashflow.js";
import { mergeThresholds } from "../shared/thresholds.js";

const TH = mergeThresholds(null);
const BASE = { price: 24.99, cogs: 4.37, shippingPerUnit: 1.13, fbaFee: 5.41, cpc: 1.27,
  cvr: 0.10, ppcShare: 0.70, unitsPerDay: 10, productionDays: 30, shippingDays: 30, receivingDays: 15 };
const run = (over = {}, ctx = {}) => cashflow({ ...BASE, ...over }, TH, { cohortSalesMedian: null, reviewThreshold: null, ...ctx });

test("SC-006a: возвраты увеличивают закупку под ту же цель по проданным", () => {
  const без = run({}, { returnRate: 0 });
  const с10 = run({}, { returnRate: 0.10 });

  assert.ok(с10.unitsPurchased > без.unitsPurchased,
    `при 10 % возвратов закуплено ${с10.unitsPurchased}, без возвратов ${без.unitsPurchased} — партия обязана вырасти`);
  // продаём столько же, а отгружаем больше
  assert.ok(Math.abs(с10.unitsSold - без.unitsSold) / без.unitsSold < 0.02, "цель по проданным та же");
  assert.ok(с10.peak > без.peak, "и денег на это нужно больше");
});

test("SC-006a: рост закупки соразмерен доле потерь", () => {
  const без = run({}, { returnRate: 0 });
  for (const r of [0.05, 0.10, 0.20]) {
    const c = run({}, { returnRate: r });
    const ожид = без.unitsPurchased / (1 - r);
    assert.ok(Math.abs(c.unitsPurchased - ожид) / ожид < 0.08,
      `возвраты ${r}: закуплено ${c.unitsPurchased}, ожидалось около ${Math.round(ожид)}`);
  }
});

test("неизвестная доля возвратов не увеличивает закупку", () => {
  const нет = run({}, {});
  const ноль = run({}, { returnRate: 0 });
  assert.equal(нет.unitsPurchased, ноль.unitsPurchased, "незнание не повод закупать больше");
  assert.equal(нет.lossRate, 0);
});

test("три сценария различаются и назван самый требовательный", () => {
  const r = run();
  assert.equal(r.scenarios.length, 3);
  const by = Object.fromEntries(r.scenarios.map((s) => [s.key, s]));
  assert.ok(by.slow && by.base && by.fast);

  // разгон: медленный дольше, быстрый короче
  assert.ok(by.slow.rampMonths > by.base.rampMonths, "медленный разгоняется дольше");
  assert.ok(by.fast.rampMonths < by.base.rampMonths, "быстрый — быстрее");

  // пики РАЗНЫЕ: сценарии не выродились в один
  const peaks = r.scenarios.map((s) => Math.round(s.peak));
  assert.equal(new Set(peaks).size, 3, `пики совпали: ${peaks.join(", ")}`);

  // ГЛАВНОЕ: денег больше всего требует БЫСТРЫЙ рост, а не медленный.
  // Замер 2026-11-12: быстрый $9163, ожидаемый $8643, медленный $7586.
  assert.ok(by.fast.peak > by.base.peak, "быстрый рост требует больше денег, чем ожидаемый");
  assert.ok(by.slow.peak < by.base.peak, "медленные продажи = более редкие и меньшие дозаказы");
  assert.equal(r.hungriest, "fast", "самым требовательным назван быстрый рост");
});

test("ожидаемый сценарий совпадает с прежними полями модели", () => {
  const r = run();
  const base = r.scenarios.find((s) => s.key === "base");
  assert.equal(base.peak, r.peak, "прежние поля продолжают описывать ожидаемый сценарий");
  assert.equal(base.paybackMonth, r.paybackMonth);
  assert.equal(base.rampMonths, r.rampMonths);
});

test("точка дозаказа считается от всей цепочки поставки", () => {
  const r = run();
  assert.equal(r.leadDays, 75, "30 + 30 + 15");
  assert.equal(r.reorder.days, 75 + TH.cashflow.safetyDays, "срок цепочки плюс страховой запас");
  assert.ok(r.reorder.units > 0);
  // при 10 шт/день целевых продаж и 89 днях — около 890 штук
  assert.ok(Math.abs(r.reorder.units - 10 * 89) / (10 * 89) < 0.15, `получено ${r.reorder.units}`);
});

test("нулевой срок цепочки: точка вырождается и это сказано", () => {
  const r = run({ productionDays: 0, shippingDays: 0, receivingDays: 0 });
  assert.equal(r.leadDays, 0);
  assert.ok(r.reorder.note, "вместо нуля дней — объяснение");
});

test("предупреждение о бюджете считается по ВСЕМ сценариям", () => {
  const r0 = run();
  const by = Object.fromEntries(r0.scenarios.map((s) => [s.key, s]));

  // бюджет между ожидаемым и самым требовательным — предупредить обязаны
  const между = Math.round((by.base.peak + by.fast.peak) / 2);
  const r = run({ budget: между });
  assert.ok(r.budgetGap, "предупреждение обязано появиться");
  assert.equal(r.budgetGap.scenario, "fast", "и назвать сценарий, который не влезает");
  assert.ok(Math.abs(r.budgetGap.amount - (by.fast.peak - между)) < 1, "нехватка названа числом");

  // бюджет выше всех пиков — предупреждения нет
  assert.equal(run({ budget: Math.ceil(by.fast.peak) + 1000 }).budgetGap, null);
});

test("бюджет не задан — сценарии есть, предупреждения нет", () => {
  const r = run();
  assert.equal(r.scenarios.length, 3);
  assert.equal(r.budgetGap, null, "сравнивать не с чем");
});
