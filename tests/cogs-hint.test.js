// spec 013: подсказка под полем COGS — сколько можно платить за товар, чтобы осталась целевая маржа.
import test from "node:test";
import assert from "node:assert/strict";
import { cogsHint } from "../shared/cogs-hint.js";

test("подсказка под COGS: потолок, превышение и случай «не сходится»", () => {
  assert.equal(cogsHint(null, 4), null); assert.equal(cogsHint({ cogsCeiling: null }, 4), null, "без этапа 2 подсказки нет");

  const pc = { cogsCeiling: 1.64, marginMin: 0.3, cogsCeilingAfterAds: true, cogsCeilingMissing: [] };
  const ok = cogsHint(pc, 1.2);
  assert.equal(ok.level, "ok"); assert.equal(ok.text, "потолок ≤ $1.64 — маржа 30 % после рекламы");

  const over = cogsHint(pc, 4);
  assert.equal(over.level, "over"); assert.equal(over.text, "выше потолка на $2.36: нужно ≤ $1.64, чтобы осталась маржа 30 % после рекламы");
  assert.equal(cogsHint(pc, null).level, "ok", "пустое поле — просто потолок, без упрёка");
  assert.equal(cogsHint(pc, 1.64).level, "ok", "ровно потолок ещё проходит");

  // реклама не вычтена — потолок завышен, и об этом сказано прямо в строке
  const noAd = cogsHint({ ...pc, cogsCeilingAfterAds: false, marginMin: 0.4, cogsCeilingMissing: ["реклама (нет цены клика)"] }, 1);
  assert.match(noAd.text, /маржа 40 % без рекламы \(Gate 1\)/); assert.match(noAd.text, /потолок завышен/);

  // маржа недостижима даже при нулевой себестоимости — это ответ, а не пустая строка
  const none = cogsHint({ ...pc, cogsCeiling: -5.08 }, 4);
  assert.equal(none.level, "none"); assert.match(none.text, /не сходится/); assert.match(none.text, /не хватает \$5\.08/);
});
