import { test } from "node:test";
import assert from "node:assert/strict";
import { parseXray, isXrayHeaders } from "../shared/parse-xray.js";
import { readCsv, XRAY } from "./helpers.js";

const rows = readCsv(XRAY);

test("Xray: заголовки распознаются (BOM, Price  USD)", () => {
  assert.equal(isXrayHeaders(Object.keys(rows[0])), true);
});

test("Xray: европейские числа и иерархия вариаций", () => {
  const x = parseXray(rows);
  const k = x.asins.find((a) => a.asin === "B0751CBXBT");
  assert.ok(k, "KILMAT parent найден");
  assert.equal(k.price, 69.95);
  assert.equal(k.asinSales, 2889);
  assert.equal(k.parentSales, 6892);
  assert.equal(k.asinRevenue, 202083.81);
  assert.equal(k.reviews, 26511);
  assert.equal(k.rating, 4.8);
  assert.equal(k.creationDate, "2017-08-22");
  assert.equal(k.isVariation, false);
  const v = x.asins.find((a) => a.asin === "B07CBK48XN");
  assert.equal(v.isVariation, true);
  assert.equal(v.parentAsin, "B0751CBXBT");
  assert.equal(v.parentRevenue, 396634.08);
  assert.equal(x.flags.hasAsinSales, true);
  assert.equal(x.flags.hasParentHierarchy, true);
});

test("Xray: дубли ASIN учитываются один раз", () => {
  const baseline = parseXray(rows).flags.duplicatesDropped; // в реальном экспорте дубли уже есть
  const dup = [...rows, rows[1], rows[1]];
  const x = parseXray(dup);
  const ids = x.asins.map((a) => a.asin);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(x.flags.duplicatesDropped, baseline + 2);
  assert.ok(baseline > 0, "реальный Xray содержит дубли ASIN (ловушка из SKILL)");
});

test("Xray: сумма ASIN Revenue не задваивает Parent Level Revenue", () => {
  const x = parseXray(rows);
  const total = x.asins.reduce((s, a) => s + (a.asinRevenue ?? 0), 0);
  const parentSum = x.asins.reduce((s, a) => s + (a.parentRevenue ?? 0), 0);
  assert.ok(total > 0);
  assert.ok(total < parentSum, "сумма Parent Level по вариациям была бы завышена");
});
