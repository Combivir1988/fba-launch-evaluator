import { test } from "node:test";
import assert from "node:assert/strict";
import { toNum, isBound, parseDateEn, median, relDelta } from "../shared/num.js";

test("toNum: европейский формат Xray", () => {
  assert.equal(toNum("69,95"), 69.95);
  assert.equal(toNum("6 892"), 6892);
  assert.equal(toNum("366 714,82"), 366714.82);
  assert.equal(toNum("4 000"), 4000);
  assert.equal(toNum("4,8"), 4.8);
  assert.equal(toNum("26 511"), 26511);
});

test("toNum: US-формат Cerebro и границы", () => {
  assert.equal(toNum("294,000"), 294000);
  assert.equal(toNum("12,217"), 12217);
  assert.equal(toNum("1,234,567"), 1234567);
  assert.equal(toNum(">100,000"), 100000);
  assert.equal(isBound(">100,000"), true);
  assert.equal(isBound("100"), false);
  assert.equal(toNum("1.53"), 1.53);
  assert.equal(toNum("1,234.56"), 1234.56);
});

test("toNum: пустые/служебные значения → null", () => {
  for (const v of ["", "-", "N/A", "n/a", null, undefined, "—"]) assert.equal(toNum(v), null, String(v));
  assert.equal(toNum("﻿3."), 3);
  assert.equal(toNum(12), 12);
  assert.equal(toNum("-27"), -27);
});

test("parseDateEn", () => {
  assert.equal(parseDateEn("Aug 22, 2017"), "2017-08-22");
  assert.equal(parseDateEn("Apr 5, 2018"), "2018-04-05");
  assert.equal(parseDateEn("2024-09-22"), "2024-09-22");
  assert.equal(parseDateEn(""), null);
});

test("median / relDelta", () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 2, 3]), 2.5);
  assert.equal(median([]), null);
  assert.equal(relDelta(100, 50), 0.5);
});
