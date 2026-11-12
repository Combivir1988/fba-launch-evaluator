// US1 (spec 020): возвраты в экономике. ВОРОТА SC-004 и тождество формулы написаны
// ДО реализации и обязаны упасть без неё.
import { test } from "node:test";
import assert from "node:assert/strict";
import { economics } from "../shared/economics.js";
import { mergeThresholds } from "../shared/thresholds.js";
import { econInputs, nearEdgeInputs, IDENTITY_CASES, EDGE_RATES } from "./helpers/fixture-returns.js";
import { resultsHash } from "./helpers/results-hash.js";
import { compute } from "../shared/compute.js";
import { newAnalysis } from "../shared/analysis.js";

const TH = mergeThresholds(null);
/** Доля возвратов приходит контекстом — тем же приёмом, что и dataCvr (compute.js). */
const eco = (inputs, returnRate, th = TH) => economics(inputs, th, returnRate === undefined ? {} : { returnRate });

test("ВОРОТА SC-004: неизвестная доля возвратов НЕ превращается в ноль", () => {
  const r = eco(econInputs(), EDGE_RATES.unknown);

  // 1. Признак прямо говорит, что возвраты не учтены.
  assert.equal(r.returnsCounted, false, "расчёт обязан признать, что возвраты не учтены");

  // 2. Стоимость возвратов ОТСУТСТВУЕТ, а не равна нулю. Ноль — это утверждение
  //    «возвратов нет», которого приложение делать не вправе.
  assert.equal(r.returnCost, null, "неизвестное — это не ноль");
  assert.equal(r.returnRate, null);

  // 3. Прибыль считается как раньше.
  assert.equal(r.gate1.net0, r.netGross, "без доли возвратов прибыль равна прибыли до возвратов");
});

test("ВОРОТА SC-004: ноль и «неизвестно» — РАЗНЫЕ состояния", () => {
  const unknown = eco(econInputs(), EDGE_RATES.unknown);
  const zero = eco(econInputs(), EDGE_RATES.zero);

  // Числа совпадают…
  assert.equal(unknown.gate1.net0, zero.gate1.net0);
  // …но утверждения разные, и это единственное, что отличает честный расчёт от «?? 0».
  assert.equal(unknown.returnsCounted, false);
  assert.equal(zero.returnsCounted, true, "ноль возвратов — это посчитанный ноль, а не незнание");
  assert.equal(unknown.returnCost, null);
  assert.equal(zero.returnCost, 0);
});

test("тождество формулы: при самой строгой модели возвраты стоят ровно чистой выручки", () => {
  for (const c of IDENTITY_CASES) {
    const r = eco(econInputs({ price: c.price, referralPct: c.referralPct }), c.returnRate);
    assert.ok(Math.abs(r.returnCost - c.expect) < 1e-6,
      `${c.label}: ожидалось ${c.expect}, получено ${r.returnCost}`);
    // то же самое, выраженное независимо от реализации
    assert.ok(Math.abs(r.returnCost - c.returnRate * c.price * (1 - c.referralPct)) < 1e-9, c.label);
  }
});

test("прибыль после возвратов = прибыль до возвратов минус их стоимость", () => {
  const r = eco(econInputs(), 0.08);
  assert.ok(Math.abs(r.netGross - (25 - 4 - 1 - 25 * 0.15 - 5)) < 1e-9, "прибыль до возвратов считается как раньше");
  assert.ok(Math.abs(r.gate1.net0 - (r.netGross - r.returnCost)) < 1e-9);
  assert.ok(r.gate1.net0 < r.netGross, "возвраты могут только уменьшить прибыль");
});

test("возвраты доезжают до маржи, ROI и безубыточного CVR", () => {
  const без = eco(econInputs(), 0);
  const с = eco(econInputs(), 0.08);
  assert.ok(с.marginNoAds < без.marginNoAds, "маржа");
  assert.ok(с.roi < без.roi, "ROI");
  assert.ok(с.breakEvenCvr > без.breakEvenCvr, "безубыточный CVR растёт: прибыли меньше — конверсия нужна выше");
});

test("Gate 1 переворачивается у тех, кто стоял на границе", () => {
  // маржа 31 % при пороге 30 %
  const edge = nearEdgeInputs();
  const без = eco(edge, 0);
  assert.ok(без.marginNoAds > TH.economics.marginMin, `маржа до возвратов ${(без.marginNoAds * 100).toFixed(1)} % должна быть выше порога`);
  assert.equal(без.gate1.condMargin, true);

  // 2 % возвратов съедают 1,7 процентного пункта маржи — этого хватает
  const с = eco(edge, 0.02);
  assert.equal(с.gate1.condMargin, false, "после возвратов маржа ушла под порог");
  assert.ok(с.gate1.status !== без.gate1.status, "и статус Gate 1 изменился");
});

test("крайние случаи доли возвратов", () => {
  // подозрительно высокая — принимается, но помечается
  const susp = eco(econInputs(), EDGE_RATES.suspicious);
  assert.equal(susp.returnRateSuspicious, true);
  assert.ok(susp.returnCost > 0);

  // разорительная — прибыль уходит в минус и показывается как есть
  const bad = eco(econInputs(), EDGE_RATES.ruinous);
  assert.ok(bad.gate1.net0 < 0, "отрицательная прибыль — допустимый результат");
  assert.equal(bad.gate1.status, "no_go");

  // обычная — не помечается
  assert.equal(eco(econInputs(), 0.08).returnRateSuspicious, false);
});

test("режим «ожидает COGS» не тронут", () => {
  const r = eco(econInputs({ cogs: null }), 0.08);
  assert.equal(r.pending, true);
  assert.equal(r.gate1.status, "pending");
  assert.equal(r.returnCost, null, "пока экономики нет, возвраты не считаются");
});

test("источник значения виден", () => {
  assert.equal(economics(econInputs(), TH, { returnRate: 0.05, returnSource: "poe" }).returnSource, "poe");
  assert.equal(economics(econInputs({ returnRate: 0.07 }), TH, {}).returnSource, "manual");
  assert.equal(economics(econInputs({ returnRate: 0.07 }), TH, { returnRate: 0.05 }).returnRate, 0.07,
    "введённое вручную побеждает значение из отчёта");
});

test("пороги модели меняют результат предсказуемо", () => {
  const strict = eco(econInputs(), 0.10);
  const soft = eco(econInputs(), 0.10, mergeThresholds({ economics: { resalableShare: 1 } }));
  // при полностью пригодном к перепродаже товаре теряется только сбор за отправку
  assert.ok(soft.returnCost < strict.returnCost, "мягкая модель дешевле строгой");
  assert.ok(Math.abs(soft.returnCost - 0.10 * (soft.netGross + 5)) < 1e-9,
    "при пригодном товаре теряются сбор за отправку и сама продажа, но не себестоимость");

  const withFee = eco(econInputs(), 0.10, mergeThresholds({ economics: { returnFee: 2 } }));
  assert.ok(Math.abs(withFee.returnCost - (strict.returnCost + 0.10 * 2)) < 1e-9, "сбор за обработку добавляется");
});

// ---------- ВОРОТА SC-002 ----------
// Ниши, где доля возвратов равна нулю или неизвестна, не должны измениться НИ НА КОПЕЙКУ.
// Проверяем не записанное число, а сам инвариант: при отсутствии возвратов расчёт обязан
// совпасть с прежней формулой, посчитанной здесь же, независимо от реализации.

/** Прежняя формула, до spec 020. Переписана в тесте намеренно: если реализация съедет, тест это увидит. */
function предыдущаяПрибыль(i) {
  const ship = i.shippingPerUnit ?? 0, ref = i.referralPct ?? 0.15, fba = i.fbaFee ?? 0;
  return i.price - i.cogs - ship - i.price * ref - fba;
}

test("ВОРОТА SC-002: без возвратов расчёт совпадает с прежним до последнего знака", () => {
  for (const [label, rate] of [["неизвестна", EDGE_RATES.unknown], ["ровно ноль", EDGE_RATES.zero]]) {
    for (const over of [{}, { price: 12, referralPct: 0.2 }, { price: 89.99, cogs: 30, fbaFee: 9.5 }, { price: 19.99, cogs: 3.1 }]) {
      const i = econInputs(over);
      const r = eco(i, rate);
      const было = предыдущаяПрибыль(i);

      assert.ok(Math.abs(r.gate1.net0 - было) < 1e-12, `${label} ${JSON.stringify(over)}: прибыль`);
      assert.ok(Math.abs(r.marginNoAds - было / i.price) < 1e-12, `${label}: маржа`);
      assert.ok(Math.abs(r.roi - было / (i.cogs + (i.shippingPerUnit ?? 0))) < 1e-12, `${label}: ROI`);
      // безубыточный CVR не считается при неположительной прибыли — и это тоже прежнее поведение
      if (было > 0) assert.ok(Math.abs(r.breakEvenCvr - (i.cpc * i.ppcShare) / было) < 1e-12, `${label}: безубыточный CVR`);
      else assert.equal(r.breakEvenCvr, null, `${label}: при неположительной прибыли CVR не считается`);
    }
  }
});

test("ВОРОТА SC-002: контрольный отпечаток ниши без возвратов не сдвинулся", () => {
  // Анализ без отчётов: экономики нет, возвратов нет — отпечаток обязан совпасть с записанным
  // ДО spec 020. Если он изменился, значит правка задела то, чего касаться не должна была.
  assert.equal(resultsHash(compute(newAnalysis({ niche: "без отчётов" }))), "f0ef040ef6e247ce");
});

test("ВОРОТА SC-002 не пусты: там, где возвраты ЕСТЬ, расчёт обязан отличаться", () => {
  // Иначе предыдущие две проверки прошли бы и на реализации, которая не делает ничего.
  const i = econInputs();
  assert.notEqual(eco(i, 0.08).gate1.net0, предыдущаяПрибыль(i));
});
