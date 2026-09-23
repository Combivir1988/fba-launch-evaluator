// spec 011: личные наборы порогов — только известные пороги правильного типа, только отличия от умолчаний; проверка формы на сервере.
import test from "node:test";
import assert from "node:assert/strict";
import { thresholdOverrides, sanitizePresets, PRESET_LIMITS, DEFAULT_THRESHOLDS, mergeThresholds } from "../shared/thresholds.js";

test("thresholdOverrides: отличия от умолчаний, чужие ключи и неверные типы отбрасываются", () => {
  const ov = thresholdOverrides({ criterion1: { priceOk: 25, priceWarn: DEFAULT_THRESHOLDS.criterion1.priceWarn, nope: 1, adjSv: "3000" }, economics: { cvrGrid: [0.05, 0.1], marginMin: NaN }, evil: { x: 1 }, scorecard: { weights: { market: 0.3, competition: 0.2, economics: 0.25, brandFit: 0.15, opRisk: 0.1 }, bands: "x" }, config: { maxAsins: 150 } });
  assert.deepEqual(ov, { criterion1: { priceOk: 25 }, economics: { cvrGrid: [0.05, 0.1] }, scorecard: { weights: { market: 0.3, competition: 0.2, economics: 0.25, brandFit: 0.15, opRisk: 0.1 } } });
  assert.deepEqual(thresholdOverrides(null), {}); assert.deepEqual(thresholdOverrides({ criterion1: { priceOk: 30 } }), {}, "равно умолчанию — не отличие");
  assert.equal(mergeThresholds(ov).criterion1.priceOk, 25); assert.equal(mergeThresholds(ov).criterion1.priceWarn, DEFAULT_THRESHOLDS.criterion1.priceWarn);
});

test("sanitizePresets: форма, лимиты, уникальные id, пустое имя — ошибка", () => {
  const ok = sanitizePresets([{ id: "a", name: "  Дешёвые товары ", thresholds: { criterion1: { priceOk: 20, junk: 1 } }, updatedAt: "2026-09-23T00:00:00Z" }, { name: "Без id", thresholds: {} }]);
  assert.equal(ok.length, 2); assert.equal(ok[0].name, "Дешёвые товары"); assert.deepEqual(ok[0].thresholds, { criterion1: { priceOk: 20 } }); assert.equal(ok[0].updatedAt, "2026-09-23T00:00:00Z");
  assert.equal(ok[1].id, "p2"); assert.deepEqual(ok[1].thresholds, {}); assert.ok(!Number.isNaN(Date.parse(ok[1].updatedAt)));
  assert.throws(() => sanitizePresets("x"), /не список/); assert.throws(() => sanitizePresets([{ id: "a", name: "" }]), /пустое имя/); assert.throws(() => sanitizePresets([{ id: "a", name: "x" }, { id: "a", name: "y" }]), /повторяющийся/);
  assert.throws(() => sanitizePresets(Array.from({ length: PRESET_LIMITS.max + 1 }, (_, i) => ({ id: "p" + i, name: "n" }))), /не больше/);
  assert.equal(sanitizePresets([{ id: "a", name: "x".repeat(200) }])[0].name.length, PRESET_LIMITS.nameMax);
});
