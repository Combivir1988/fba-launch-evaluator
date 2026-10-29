// ТЗ человеческим языком: имена полей JSON из фактов не должны доезжать до производителя.
import { test } from "node:test";
import assert from "node:assert/strict";
import { humanizeFacts, humanizeTz } from "../shared/tz-human.js";
import { migrate } from "../shared/analysis.js";

test("имена полей заменяются на человеческие, вместе с остатком пути", () => {
  assert.equal(humanizeFacts("Целевая цена — pricing.marketPrice"), "Целевая цена — рыночная цена аналогов такой же конфигурации");
  assert.equal(humanizeFacts("promo.discountRevSharePct 29.9%, avgDiscountPct 8.92%"), "доля выручки со скидкой от List Price 29.9%, средний размер скидки 8.92%");
  assert.equal(humanizeFacts("из configuration[3].dominant.value"), "из доминирующая конфигурация (этап 2)");
  assert.equal(humanizeFacts("reviews.negative[0].topic"), "негативные темы отзывов");
  assert.equal(humanizeFacts("pricing.cogsCeilingForMinMargin"), "потолок себестоимости при минимальной марже", "длинный путь не рвётся на части");
});

test("обычный текст не трогаем", () => {
  for (const t of ["Гарантия 365 дней, цена $25.98", "Слово pricingmarket и домен promo.example.com не поля", "Alloy Steel, Nickel Plated"]) {
    assert.equal(humanizeFacts(t), t);
  }
});

test("одиночный корень в графе «источник» тоже переводится", () => {
  assert.equal(humanizeFacts("pricing"), "ценовой ориентир по конфигурации");
  assert.equal(humanizeFacts("regulatory + differentiation[3] + patents.designAround"), "регуляторные триггеры + гипотезы дифференциации + патентный скан");
  assert.equal(humanizeFacts("patents.items[0-4].designAround"), "патентный скан", "диапазон в скобках — тот же путь");
});

test("весь документ ТЗ: строки, итоговая фраза и вопросы", () => {
  const tz = humanizeTz({
    summary: "Позиционирование по pricing.marketPrice",
    rows: [{ param: "Цена", requirement: "$25.98", rationale: "pricing.marketPrice — рыночная цена", source: "prices.nicheMedian" }],
    openQuestions: ["Подтвердить batch.leadDays"],
  });
  assert.equal(tz.summary, "Позиционирование по рыночная цена аналогов такой же конфигурации");
  assert.match(tz.rows[0].rationale, /^рыночная цена аналогов такой же конфигурации/);
  assert.equal(tz.rows[0].source, "медианная цена ниши");
  assert.equal(tz.openQuestions[0], "Подтвердить срок производства");
  assert.equal(tz.rows[0].requirement, "$25.98", "числа и доллары не трогаем");
});

test("migrate чинит уже сохранённые ТЗ", () => {
  const doc = migrate({ schemaVersion: 1, config: { table: {}, tz: { summary: "x", rows: [{ rationale: "promo.avgDiscountPct 8.92%" }] } } });
  assert.equal(doc.config.tz.rows[0].rationale, "средний размер скидки 8.92%");
  assert.ok(doc.config.table, "остальная часть этапа 2 на месте");
  assert.equal(migrate({ schemaVersion: 1 }).config, null, "без ТЗ ничего не ломается");
});
