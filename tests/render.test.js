// DOM-smoke рендера дашборда (jsdom + заглушка Chart.js): все секции строятся на реальных фикстурах,
// статический режим (экспорт) без ползунков, «мой ASIN» подсвечивается.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import { parseXray } from "../shared/parse-xray.js";
import { parseCerebro, suggestCluster } from "../shared/parse-cerebro.js";
import { parsePoe } from "../shared/parse-poe.js";
import { newAnalysis } from "../shared/analysis.js";
import { compute } from "../shared/compute.js";
import { readCsv, readJson, XRAY, CEREBRO, POE } from "./helpers.js";

function makeWindow() {
  const dom = new JSDOM(`<!doctype html><html><body><div id="d"></div></body></html>`, { pretendToBeVisual: true, runScripts: "outside-only" });
  const w = dom.window;
  w.matchMedia = () => ({ matches: false });
  w.HTMLCanvasElement.prototype.getContext = () => ({});
  const created = [];
  class Chart { constructor(ctx, cfg) { created.push(cfg); this.cfg = cfg; } destroy() {} }
  Chart.defaults = { color: "", borderColor: "", font: {}, plugins: { legend: { labels: {} } } };
  w.Chart = Chart;
  const code = readFileSync(new URL("../public/js/render.js", import.meta.url), "utf8");
  w.eval(code);
  return { w, created };
}
function fullAnalysis() {
  const xray = parseXray(readCsv(XRAY));
  const core = "sound deadening mat";
  const cerebro = parseCerebro(readCsv(CEREBRO), { coreKeyword: core, brands: xray.asins.map((a) => a.brand) });
  const a = newAnalysis({ niche: "car sound deadening mat", coreKeyword: core });
  a.aggregates = { xray, cerebro, poe: parsePoe(readJson(POE)) };
  a.sources = { xray: { fileName: "x.csv", rows: 100 }, cerebro: { fileName: "c.csv", rows: 4000 }, poe: { fileName: "p.json", rows: 67 }, sqp: null };
  a.inputs.clusterKeywords = suggestCluster(cerebro.keywords, { coreKeyword: core });
  Object.assign(a.inputs, { price: 45, cogs: 12, fbaFee: 8, cpc: 1.1, budget: 20000, myAsins: ["B0751CBXBT"] });
  a.inputs.checklist.patentSearch = "clear";
  a.results = compute(a);
  return a;
}

test("render: все секции присутствуют, графики созданы, мой ASIN подсвечен", () => {
  const { w, created } = makeWindow();
  const a = fullAnalysis();
  const el = w.document.getElementById("d");
  w.FBARender.render(el, a, { static: false });
  const ids = [...el.querySelectorAll("[data-section]")].filter((s) => !s.classList.contains("hidden")).map((s) => s.dataset.section);
  for (const need of ["hero", "overview", "criterion1", "quick", "economics", "budget", "traffic", "competitors", "pricing", "trend", "structure", "reviews", "challenger", "scorecard", "reconciliation", "checklist", "conclusion", "ai"]) assert.ok(ids.includes(need), "секция " + need);
  assert.ok(created.length >= 8, `графиков создано ${created.length}`);
  assert.ok(el.querySelector("tr.mine"), "строка моего ASIN подсвечена");
  assert.ok(el.querySelectorAll(".gate").length === 8, "8 строк Критерия 1");
  assert.ok(el.querySelectorAll('input[data-quick]').length === 6, "6 быстрых ползунков");
  assert.match(el.textContent, /Gate 1/);
  assert.match(el.textContent, /2f/);
  // update только экономически зависимых секций не ломает остальные
  a.inputs.cvr = 0.08; a.results = compute(a);
  w.FBARender.update(el, a, { static: false });
  assert.ok(el.querySelector("#sec-traffic table"), "трафик остался");
});

test("render static (экспорт): без ползунков и кнопок; pending-экономика без COGS", () => {
  const { w } = makeWindow();
  const a = fullAnalysis();
  a.inputs.cogs = null; a.results = compute(a);
  const el = w.document.getElementById("d");
  w.FBARender.render(el, a, { static: true });
  assert.equal(el.querySelectorAll("input[data-quick]").length, 0);
  assert.equal(el.querySelectorAll('[data-action="ai"]').length, 0);
  assert.match(el.querySelector("#sec-economics").textContent, /ожидает COGS/);
});

test("render: AI-блок с скорректированным вердиктом", () => {
  const { w } = makeWindow();
  const a = fullAnalysis();
  a.ai = { verdict: "rework", aiVerdictRaw: "go", adjustedByRules: true, adjustmentNote: "AI предложил «Go»…", summary: "S", decisiveGate: "Gate 2", criterion1Summary: "C", gates: [{ gate: "gate2", status: "fail", reasoning: "r" }], differentiation: [{ hypothesis: "h", evidence: "e", specRequirement: "s" }], recommendations: [{ priority: "high", title: "t", text: "x" }], risks: ["r1"], pricingPackComment: "p", nextSteps: ["a"], model: "claude-opus-5", usage: { input: 1, output: 2, cacheRead: 0 }, createdAt: new Date().toISOString() };
  const el = w.document.getElementById("d");
  w.FBARender.render(el, a, { static: false });
  assert.match(el.querySelector("#sec-ai").textContent, /скорректирован правилами/);
  assert.match(el.querySelector("#sec-hero").textContent, /Доработка/);
  assert.ok(el.querySelector(".rec.high"));
});
