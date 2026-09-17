import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCerebro, suggestCluster, isCerebroHeaders } from "../shared/parse-cerebro.js";
import { readCsv, CEREBRO } from "./helpers.js";

const rows = readCsv(CEREBRO);

test("Cerebro: заголовки, ASIN-строки, границы", () => {
  assert.equal(isCerebroHeaders(Object.keys(rows[0])), true);
  const c = parseCerebro(rows, { coreKeyword: "car sound deadening mat", brands: ["KILMAT", "Siless"] });
  const asinRow = c.keywords.find((k) => k.phrase === "b0751cbxbt");
  assert.equal(asinRow.isAsin, true);
  assert.equal(asinRow.sv, 294);
  const gd = c.keywords.find((k) => k.phrase === "garage door insulation");
  assert.equal(gd.sv, 12217);
  assert.equal(gd.bid, 0.73);
  assert.equal(gd.competingProducts, 3000);
  assert.equal(gd.competingIsBound, true);
  const branded = c.keywords.find((k) => k.phrase.includes("siless"));
  assert.equal(branded.isBranded, true);
  assert.ok(c.keywords[0].sv >= c.keywords[1].sv, "сортировка по SV");
});

test("Cerebro: автокластер исключает ASIN/бренды и берёт релевантные", () => {
  const c = parseCerebro(rows, { coreKeyword: "sound deadening mat", brands: ["KILMAT", "Siless", "Noico"] });
  const cl = suggestCluster(c.keywords, { coreKeyword: "sound deadening mat", minSv: 100 });
  assert.ok(cl.length > 0);
  for (const p of cl) {
    assert.ok(!/^b0/i.test(p), "нет ASIN");
    assert.ok(!/kilmat|siless|noico/i.test(p), "нет брендов");
    assert.ok(/deaden|sound|mat/.test(p), p);
  }
});
