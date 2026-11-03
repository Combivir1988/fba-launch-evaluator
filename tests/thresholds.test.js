// Пороги spec 019: совместимость старых личных наборов и неприкосновенность критерия 5.
import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_THRESHOLDS, mergeThresholds, thresholdOverrides } from "../shared/thresholds.js";

test("T005 · старый личный набор с подкрученной долей топ-5 загружается и не ломается", () => {
  // Набор, сохранённый до spec 019: человек подкрутил порог, которого больше нет.
  const saved = { criterion1: { top5Ok: 0.55, top5Fail: 0.75, priceOk: 35 } };

  // 1. Отбор известных порогов не падает и выбрасывает исчезнувшие ключи (thresholds.js: `if (dv === undefined) continue`).
  const kept = thresholdOverrides(saved);
  assert.equal(kept.criterion1.priceOk, 35, "живая подкрутка обязана сохраниться");
  assert.ok(!("top5Ok" in kept.criterion1), "исчезнувший порог в набор не попадает");
  assert.ok(!("top5Fail" in kept.criterion1), "исчезнувший порог в набор не попадает");

  // 2. Сборка порогов из такого набора тоже не падает, а концентрация приходит из умолчаний.
  const th = mergeThresholds(kept);
  assert.equal(th.criterion1.hhiOk, 1500);
  assert.equal(th.criterion1.hhiFail, 2500);
  assert.equal(th.criterion1.priceOk, 35);
});

test("T005 · даже неотфильтрованный старый набор не меняет порогов концентрации", () => {
  // Худший случай: набор лёг в анализ как есть, мимо thresholdOverrides.
  const th = mergeThresholds({ criterion1: { top5Ok: 0.55, top5Fail: 0.75 } });
  assert.equal(th.criterion1.hhiOk, 1500, "мёртвый ключ не должен влиять на живой порог");
  assert.equal(th.criterion1.hhiFail, 2500);
  assert.equal(th.criterion1.passCount, 6, "порог прохождения Критерия 1 не менялся");
});

test("T006 · критерий 5 не тронут: его собственные пороги на месте", () => {
  // challenger.top5Ok / top5Fail — ЭТО КРИТЕРИЙ 5, у него своя доля топ-5 брендов,
  // и shared/challenger.js читает competition.top5Share. Молчаливое удаление сломало бы его (D4).
  const ch = DEFAULT_THRESHOLDS.challenger;
  assert.equal(ch.top5Ok, 0.30);
  assert.equal(ch.top5Fail, 0.65);
  assert.equal(ch.playerShareMin, 0.10);
  assert.equal(ch.playersMin, 3);
});

test("T004 · группа летаргии заведена и коэффициент сглаживания ОДИН", () => {
  const L = DEFAULT_THRESHOLDS.lethargy;
  assert.deepEqual(Object.keys(L).sort(), ["efficientMax", "giantMin", "moneyMin", "smooth", "tiredMin"]);
  assert.equal(L.smooth, 0.01);
  assert.equal(L.moneyMin, 0.10);
  assert.equal(L.giantMin, 2.0);
  assert.equal(L.tiredMin, 1.5);
  assert.equal(L.efficientMax, 0.8);
  // Второго коэффициента быть не должно: равенство слагаемых — часть контракта, а не настройка (D7).
  for (const k of Object.keys(L)) assert.ok(!/^(alpha|beta|smoothA|smoothB|smoothNum|smoothDen)$/.test(k), `раздельный коэффициент «${k}» ломает контракт`);
});

test("T004 · доля топ-5 брендов ушла из Критерия 1", () => {
  assert.equal(DEFAULT_THRESHOLDS.criterion1.top5Ok, undefined);
  assert.equal(DEFAULT_THRESHOLDS.criterion1.top5Fail, undefined);
});
