// US2 (spec 020): план измерений. Пороги ВЫЧИСЛЯЮТСЯ из экономики этой ниши,
// а не берутся постоянным текстом. Тест написан ДО реализации.
import { test } from "node:test";
import assert from "node:assert/strict";
import { launchPlan } from "../shared/launch-plan.js";
import { mergeThresholds } from "../shared/thresholds.js";
import { compute } from "../shared/compute.js";
import { fixtureAnalysis } from "./helpers/fixture-analysis.js";
import { buildSnapshot } from "../shared/share-snapshot.js";

const TH = mergeThresholds(null);
const planOf = (over = {}) => {
  const a = fixtureAnalysis({ inputs: over });
  return { plan: launchPlan(a.results, TH), R: a.results };
};

test("пороги различаются у ниш с разной экономикой — это план, а не цитата", () => {
  const дешёвая = planOf({ price: 19.99, cogs: 7 });
  const дорогая = planOf({ price: 59.99, cogs: 9 });
  const key = (p, k) => p.thresholds.find((t) => t.key === k)?.value;

  assert.notEqual(key(дешёвая.plan, "cvr"), key(дорогая.plan, "cvr"), "порог конверсии обязан различаться");
  assert.notEqual(key(дешёвая.plan, "acos"), key(дорогая.plan, "acos"), "порог расхода на рекламу тоже");
});

test("у каждого порога названо, из чего он получен", () => {
  const { plan } = planOf();
  assert.ok(plan.thresholds.length >= 4, `порогов ${plan.thresholds.length}`);
  for (const t of plan.thresholds) {
    assert.ok(t.label && t.label.length > 3, `${t.key}: нет названия`);
    assert.ok(t.from && t.from.length > 3, `${t.key}: не сказано, из какого показателя получен`);
    assert.ok(t.action && t.action.length > 3, `${t.key}: не сказано, что делать`);
    assert.ok(t.value !== undefined, `${t.key}: нет значения`);
  }
});

test("пороги совпадают с числами расчёта, а не выдуманы", () => {
  const { plan, R } = planOf();
  const key = (k) => plan.thresholds.find((t) => t.key === k);

  assert.ok(Math.abs(key("cvr").value - R.economics.breakEvenCvr) < 1e-9, "конверсия — из безубыточного CVR");
  assert.ok(Math.abs(key("acos").value - R.economics.gate1.net0 / R.economics.price) < 1e-9, "реклама — из прибыли на цену");
  assert.equal(key("stock").value, R.cashflow.reorder.days, "запас — из точки дозаказа");
  assert.equal(key("reviews").value, R.entry.reviews.threshold, "отзывы — из планки входа в нишу");
});

test("ритм разбора разделён на ежедневный и еженедельный", () => {
  const { plan } = planOf();
  assert.ok(plan.daily.length >= 4, "ежедневно смотрят то, что останавливает продажи сразу");
  assert.ok(plan.weekly.length >= 4, "еженедельно — направление изменений");
  // «запас» и «реклама не показывается» — ежедневные; «тренд конверсии» — недельный
  assert.ok(plan.daily.join(" ").match(/запас|остат/i));
  assert.ok(plan.weekly.join(" ").match(/конверс|трафик|видим/i));
});

test("таблица диагностики не меньше шести строк и каждая строка полна", () => {
  const { plan } = planOf();
  assert.ok(plan.diagnosis.length >= 6, `строк ${plan.diagnosis.length}`);
  for (const d of plan.diagnosis) {
    assert.ok(d.signal && d.cause && d.check, JSON.stringify(d));
  }
});

test("без экономики показываются только независимые пороги и сказано, чего не хватает", () => {
  const a = fixtureAnalysis();
  delete a.inputs.cogs;
  a.results = compute(a);
  const plan = launchPlan(a.results, TH);

  assert.equal(plan.pending, true);
  assert.ok(plan.missing.length > 0, "названо, чего не хватает");
  assert.ok(!plan.thresholds.some((t) => t.key === "cvr" || t.key === "acos"),
    "пороги, зависящие от экономики, не показываются");
  assert.ok(plan.diagnosis.length >= 6, "таблица диагностики от экономики не зависит и остаётся");
});

test("порог числа сессий берётся из настроек, а не из экономики", () => {
  const { plan } = planOf();
  const s = plan.thresholds.find((t) => t.key === "sessions");
  assert.equal(s.value, TH.launchPlan.minSessions);
  assert.match(s.from, /настройк|порог/i, "честно сказано, что это не вывод из экономики");
});

test("SC-010: план уезжает по публичной ссылке целиком", () => {
  const a = fixtureAnalysis();
  const snap = buildSnapshot(a, { mode: "full", preparedBy: "x", snapshotAt: "2026-01-01T00:00:00.000Z" });
  const lp = snap.analysis.results.launchPlan;
  assert.ok(lp, "план обязан быть в снимке — его уносят с собой");
  assert.deepEqual(lp.thresholds.map((t) => t.key).sort(), a.results.launchPlan.thresholds.map((t) => t.key).sort());
  assert.equal(lp.diagnosis.length, a.results.launchPlan.diagnosis.length);
});

test("режим «без закупочной экономики»: пороги, посчитанные из неё, уходят вместе с ней", () => {
  const a = fixtureAnalysis();
  const lp = buildSnapshot(a, { mode: "no_economics", preparedBy: "x", snapshotAt: "2026-01-01T00:00:00.000Z" }).analysis.results.launchPlan;
  const keys = lp.thresholds.map((t) => t.key);
  assert.ok(!keys.includes("cvr"), "безубыточный CVR — это закупочная экономика");
  assert.ok(!keys.includes("acos"), "прибыль на цену — тоже");
  assert.ok(keys.includes("stock") && keys.includes("sessions"), "остальное остаётся: оно не из экономики");
  assert.ok(lp.missing.some((m) => /скрыт/.test(m)), "и сказано, почему их нет");
});
