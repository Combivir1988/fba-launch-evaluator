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

test("Cerebro multi-ASIN: Ranking Competitors → кластер по правилу «≥ 3 конкурентов», сортировка/поля", () => {
  const rows = [
    { "Keyword Phrase": "urinal screen deodorizer", "Search Volume": "20,000", "Keyword Sales": "1,200", "Ranking Competitors (count)": "8", "Competitor Rank (avg)": "5", "H10 PPC Sugg. Bid": "1.4" },
    { "Keyword Phrase": "urinal cakes", "Search Volume": "9,000", "Keyword Sales": "600", "Ranking Competitors (count)": "6", "Competitor Rank (avg)": "12" },
    { "Keyword Phrase": "bathroom air freshener", "Search Volume": "50,000", "Keyword Sales": "50", "Ranking Competitors (count)": "1", "Competitor Rank (avg)": "180" },
    { "Keyword Phrase": "tenkaiwick urinal screen", "Search Volume": "3,000", "Keyword Sales": "100", "Ranking Competitors (count)": "5", "Competitor Rank (avg)": "9" },
    { "Keyword Phrase": "b077pnbddd", "Search Volume": "300", "Ranking Competitors (count)": "8" },
    { "Keyword Phrase": "urinal mat", "Search Volume": "80", "Ranking Competitors (count)": "4" },
  ];
  const c = parseCerebro(rows, { coreKeyword: "urinal screen deodorizer", brands: ["TenkaiWick"] });
  assert.equal(c.flags.multiAsin, true);
  assert.equal(c.flags.maxCompetitors, 8);
  assert.equal(c.keywords.find((k) => k.phrase === "urinal cakes").rankingCompetitors, 6);
  assert.equal(c.keywords.find((k) => k.phrase === "urinal cakes").keywordSales, 600);
  const cl = suggestCluster(c.keywords, { coreKeyword: "urinal screen deodorizer", minSv: 100 });
  assert.ok(cl.includes("urinal screen deodorizer") && cl.includes("urinal cakes"), cl.join(","));
  assert.ok(!cl.includes("bathroom air freshener"), "1 конкурент в топе → не релевантно, несмотря на 50k SV");
  assert.ok(!cl.includes("tenkaiwick urinal screen"), "брендовый запрос исключён");
  assert.ok(!cl.includes("b077pnbddd"), "ASIN исключён");
  assert.ok(!cl.includes("urinal mat"), "SV 80 < порога 100");
  const cl2 = suggestCluster(c.keywords, { coreKeyword: "urinal screen deodorizer", minSv: 50, minCompetitors: 4 });
  assert.ok(cl2.includes("urinal mat"), "порог SV и минимум конкурентов настраиваются");
});

test("порог «конкурентов в топе» по умолчанию: число ASIN в multi-ASIN Cerebro минус один; single-ASIN — порог настроек", async () => {
  const { defaultMinCompetitors } = await import("../shared/parse-cerebro.js");
  assert.equal(defaultMinCompetitors({ flags: { multiAsin: true, maxCompetitors: 5 } }, 3), 4);
  assert.equal(defaultMinCompetitors({ flags: { multiAsin: true, maxCompetitors: 2 } }, 3), 1);
  assert.equal(defaultMinCompetitors({ flags: { multiAsin: true, maxCompetitors: 1 } }, 3), 3, "один ASIN — правило не имеет смысла, остаётся порог настроек");
  assert.equal(defaultMinCompetitors({ flags: { multiAsin: false, maxCompetitors: null } }, 3), 3); assert.equal(defaultMinCompetitors(null, 3), 3);
});
