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

// 2026-11-14. Подсказка отвечала про цену аналогов такой же конфигурации и не говорила об этом. Живой случай:
// аналоги $29,99, человек планирует $65 — текст «маржа 30 % недостижима даже при бесплатном товаре» не менялся
// ни при цене от $30 до $200, ни при COGS от $2 до $40, а рядом стоял Gate 1 PASS с маржой 44,2 %.
test("подсказка под COGS: отвечает про цену, по которой считается экономика, и всегда её называет", () => {
  const market = { market: 29.99, cogsCeiling: -6.04, marginMin: 0.3, cogsCeilingAfterAds: true, cogsCeilingMissing: [] };

  // прежнее поведение (своей цены нет) сохранено дословно — подсказка просто называет, о какой цене речь
  const old = cogsHint(market, 10);
  assert.equal(old.level, "none");
  assert.match(old.text, /при цене аналогов такой конфигурации \$29\.99/);

  // тот самый живой случай: своя цена $65 → потолок сходится, и уровень меняется
  const own = { ...market, cogsCeilingAtPrice: { price: 65, ceiling: 13.22, afterAds: true, marginMin: 0.3, cheap: false } };
  const h = cogsHint(own, 10);
  assert.equal(h.level, "ok", "при своей цене потолок сходится — прежний текст был неправдой");
  assert.match(h.text, /потолок ≤ \$13\.22 при вашей цене \$65\.00/);
  assert.match(h.text, /аналоги такой конфигурации берут \$29\.99/, "расхождение с рынком названо отдельно");

  // подсказка следует за COGS — именно этого человек и не видел
  assert.equal(cogsHint(own, 20).level, "over");
  assert.match(cogsHint(own, 20).text, /выше потолка на \$6\.78/);

  // и за ценой: тот же анализ при своей цене $30 даёт другой ответ
  const low = { ...market, cogsCeilingAtPrice: { price: 30, ceiling: -5.9, afterAds: true, marginMin: 0.3, cheap: false } };
  assert.equal(cogsHint(low, 10).level, "none");
  assert.match(cogsHint(low, 10).text, /при вашей цене \$30\.00/);
  assert.notEqual(cogsHint(low, 10).text, cogsHint(own, 10).text, "разная цена — разный ответ");

  // цена совпадает с рынком → лишней строки про аналогов нет
  const eq = { ...market, cogsCeilingAtPrice: { price: 29.99, ceiling: -6.04, afterAds: true, marginMin: 0.3, cheap: false } };
  assert.doesNotMatch(cogsHint(eq, 10).text, /аналоги такой конфигурации берут/);
});
