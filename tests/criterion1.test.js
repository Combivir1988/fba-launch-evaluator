import { test } from "node:test";
import assert from "node:assert/strict";
import { parseXray } from "../shared/parse-xray.js";
import { parseCerebro, suggestCluster } from "../shared/parse-cerebro.js";
import { parsePoe } from "../shared/parse-poe.js";
import { newAnalysis } from "../shared/analysis.js";
import { compute } from "../shared/compute.js";
import { readCsv, readJson, XRAY, CEREBRO, POE } from "./helpers.js";

function fullAnalysis() {
  const xray = parseXray(readCsv(XRAY));
  const brands = [...new Set(xray.asins.map((a) => a.brand))];
  const core = "sound deadening mat";
  const cerebro = parseCerebro(readCsv(CEREBRO), { coreKeyword: core, brands });
  const a = newAnalysis({ niche: "car sound deadening mat", coreKeyword: core });
  a.aggregates = { xray, cerebro };
  a.inputs.clusterKeywords = suggestCluster(cerebro.keywords, { coreKeyword: core });
  return a;
}

test("Критерий 1 на Xray + Cerebro: источники, статусы, N из 8", () => {
  const a = fullAnalysis();
  const R = compute(a);
  const c = R.criterion1.items;
  assert.equal(c["1a"].source, "xray");
  const manual = a.aggregates.xray.asins.reduce((s, x) => s + (x.asinRevenue ?? 0), 0);
  assert.equal(Math.round(c["1a"].value), Math.round(manual), "1a = Σ ASIN Revenue");
  assert.equal(c["1a"].status, manual >= 500000 ? "ok" : manual < 250000 ? "fail" : "warn");
  assert.equal(c["1b"].source, "xray");
  assert.ok(c["1b"].value > 0);
  assert.equal(c["1c"].source, "cerebro");
  assert.ok(c["1c"].value > 0);
  assert.equal(c["1e"].source, "xray");
  assert.equal(c["1e"].brand, "KILMAT", "лидер по выручке — KILMAT");
  assert.ok(c["1e"].value > 0.25, "KILMAT доминирует → 1e НЕ OK");
  assert.equal(c["1e"].status, "fail");
  assert.ok(c["1f"].value >= c["1e"].value);
  assert.equal(c["1g"].status, "na", "без POE сезонность — нет данных");
  assert.equal(c["1h"].status, "na");
  assert.equal(R.criterion1.okCount, Object.values(c).filter((i) => i.status === "ok").length);
  assert.equal(R.gate0.level, "full");
  assert.equal(R.competition.dominant, true);
  assert.equal(R.challenger.active, true);
  assert.equal(R.economics.pending, true, "COGS не введён → экономика pending");
  assert.ok(["rework", "no_go"].includes(R.verdict.ceiling), "без экономики потолок не выше «Доработка»");
});

test("Критерий 1 только по POE: прокси-пометки, сезонность и запуски", () => {
  const poe = parsePoe(readJson(POE));
  const a = newAnalysis({ niche: poe.meta.nicheTitle, coreKeyword: poe.meta.nicheTitle });
  a.aggregates = { poe };
  const R = compute(a);
  const c = R.criterion1.items;
  assert.equal(R.gate0.level, "poe_only");
  assert.equal(c["1a"].source, "proxy");
  assert.ok(Math.abs(c["1a"].value - 144705) < 100);
  assert.equal(c["1a"].status, "fail", "прокси $145k < $500k");
  assert.equal(c["1c"].source, "proxy");
  assert.ok(c["1c"].value > 3000, "SV ниши по POE / 12 явно выше 3k");
  assert.equal(c["1c"].status, "ok");
  assert.equal(c["1b"].source, "poe");
  assert.equal(c["1b"].status, "ok", "$31.57 ≥ $30");
  assert.equal(c["1g"].source, "poe");
  assert.ok(c["1g"].value > 0 && c["1g"].value < 1);
  assert.equal(c["1h"].source, "poe");
  assert.ok(Math.abs(c["1h"].value - 9 / 24) < 1e-9);
  assert.equal(c["1h"].status, "ok", "37.5 % ≥ 30 %");
  assert.equal(c["1f"].source, "poe");
  assert.ok(Math.abs(c["1f"].value - 0.60166553) < 1e-6, "top5BrandsClickShareT360, не products");
  assert.equal(c["1f"].status, "warn");
  assert.equal(R.criterion1.proxyCount, 2);
  assert.ok(R.verdict.reasons.some((r) => r.includes("Gate 0")));
  assert.equal(R.traffic.poeConcentration.flags.adWar, false);
  assert.equal(R.competition.source, "poe");
  assert.equal(R.priceSegments.segments.length, 3);
});

test("Ручное переопределение метрики побеждает и помечается", () => {
  const a = fullAnalysis();
  a.inputs.manualOverrides = { "1g": { value: 0.2, note: "по скрину Cerebro" } };
  const R = compute(a);
  assert.equal(R.criterion1.items["1g"].source, "manual");
  assert.equal(R.criterion1.items["1g"].status, "ok");
});

test("Xray + POE одной ниши: сверка источников считается", () => {
  const poe = parsePoe(readJson(POE));
  const a = fullAnalysis();
  a.aggregates.poe = poe; // разные ниши намеренно — проверяем только механику расхождения
  const R = compute(a);
  assert.ok(R.reconciliation.length >= 2);
  assert.ok(R.reconciliation.every((x) => ["noise", "borderline", "conflict"].includes(x.level)));
  assert.ok(typeof R.criterion1.items["1a"].proxyDelta === "number");
});
