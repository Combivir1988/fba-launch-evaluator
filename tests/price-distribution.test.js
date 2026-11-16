// spec 024: распределение выручки по коридорам цен.
// Диаграмма отвечает на вопрос «в каком коридоре цен лежат деньги ниши». Сегменты Entry/Mid/Premium
// на него не отвечают: они нарезаны по третям количества товаров и по построению содержат примерно
// по трети листингов каждый.
import { test } from "node:test";
import assert from "node:assert/strict";
import { priceDistribution, DEGENERATE_SHARE } from "../shared/price-distribution.js";

/** Листинг в той форме, в какой его отдаёт разбор Xray (лишние поля расчёту не нужны). */
const L = (price, revenue = 1000) => ({ asin: "B0" + String(price).padStart(8, "0"), price, asinRevenue: revenue });

// ВОРОТА SC-001. Один столбик, который молчит, хуже отсутствующей диаграммы: ему верят.
// Замер порога: 50 % → 26 ниш из 67, 60 % → 13, 70 % → 3, 80 % → 1. На 50–60 % оговорка
// стала бы шумом — медиана доли самого толстого коридора и так 43 %.
test("SC-024-001: вырожденная диаграмма говорит об этом вслух", () => {
  // почти все деньги в одном коридоре: девять дешёвых листингов с копеечной выручкой и один дорогой с огромной
  const skew = [...Array(9)].map((_, i) => L(10 + i, 100)).concat([L(90, 500_000)]);
  const d = priceDistribution(skew);
  assert.ok(d.bins.length > 1, "диаграмма построена, а не схлопнута");
  assert.ok(d.top, "назван самый толстый коридор");
  assert.ok(d.top.share > DEGENERATE_SHARE, "в этой нише доля выше порога");
  assert.equal(d.degenerate, true, "сказано, что на этом шаге распределение дальше не разбирается");

  // ровное распределение — оговорки быть не должно
  const even = [...Array(40)].map((_, i) => L(10 + i * 2, 1000));
  const e = priceDistribution(even);
  assert.equal(e.degenerate, false, "на ровном распределении оговорки нет");
  assert.ok(e.top && e.top.share < DEGENERATE_SHARE);
  // но самый толстый коридор назван ВСЕГДА — это факт о рынке, а не поломка
  assert.ok(Number.isFinite(e.top.share) && Number.isFinite(e.top.min) && Number.isFinite(e.top.max));
});

// Правило нарезки из contracts/distribution.md раздел 1. Шаг — человеческое число,
// иначе подписи осей нечитаемы; на живых данных это $5 и $10.
test("spec 024: человеческий шаг и круглые границы", () => {
  const a = priceDistribution([...Array(81)].map((_, i) => L(10 + i)));
  assert.equal(a.step, 10, "равномерно $10…$90 → шаг $10");
  assert.equal(a.min, 10); assert.equal(a.max, 90);

  const b = priceDistribution([...Array(41)].map((_, i) => L(5 + i)));
  assert.equal(b.step, 5, "$5…$45 → шаг $5");
  assert.equal(b.bins.length, 8, "восемь коридоров");

  // все границы кратны шагу — ни одной вида $17,33
  for (const bin of a.bins) {
    assert.equal(Math.round(bin.min / a.step) * a.step, bin.min);
    assert.equal(Math.round(bin.max / a.step) * a.step, bin.max);
  }
});

// Хвост НЕ растягивает шкалу: иначе один дорогой листинг делает диаграмму нечитаемой,
// а молча его потерять нельзя — это дорогой товар, и его отсутствие меняет вывод.
test("spec 024: выброс сводится в крайний коридор и помечается", () => {
  const d = priceDistribution([...Array(81)].map((_, i) => L(10 + i)).concat([L(5000, 9999)]));
  assert.ok(d.max < 5000, "границы не растянуты до выброса");
  const last = d.bins[d.bins.length - 1];
  assert.equal(last.edge, true, "последний коридор помечен крайним");
  assert.equal(last.edgeItems, 1, "назван один сведённый листинг");
  assert.equal(last.edgeRevenue, 9999, "и его выручка");
  assert.equal(d.bins[0].edge, false, "снизу хвоста нет — нижний коридор крайним не помечен");
});

// Правила отсутствия: приложение не имеет права показывать пустоту вместо причины.
test("spec 024: правила отсутствия названы причиной, а не пустотой", () => {
  assert.equal(priceDistribution([]).reason !== null, true, "нет листингов — названа причина");
  assert.equal(priceDistribution(null).bins.length, 0);
  const few = priceDistribution([...Array(9)].map((_, i) => L(10 + i)));
  assert.equal(few.bins.length, 0); assert.match(few.reason, /десяти|мало/i);
  const same = priceDistribution([...Array(20)].map(() => L(20)));
  assert.equal(same.bins.length, 0); assert.match(same.reason, /одной цене/i);
});

// «Много денег в коридоре» и «много товаров в коридоре» — разные вещи,
// и расхождение между ними и есть полезный сигнал.
test("spec 024: по каждому коридору и выручка, и число листингов", () => {
  const d = priceDistribution([L(10, 100), L(12, 100), L(50, 9000), ...[...Array(20)].map((_, i) => L(20 + i, 50))]);
  for (const b of d.bins) {
    assert.equal(typeof b.revenue, "number");
    assert.equal(typeof b.items, "number");
  }
  assert.equal(d.bins.reduce((s, b) => s + b.items, 0), 23, "все листинги разложены");
});
