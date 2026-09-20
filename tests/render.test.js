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

// ---------- spec 002, US3: снимок для публичной ссылки ----------
import { buildSnapshot } from "../shared/share-snapshot.js";

test("снимок публичной ссылки (полный): все секции, шапка «подготовил», без элементов управления", () => {
  const { w } = makeWindow(); const a = fullAnalysis();
  const snap = buildSnapshot(a, { mode: "full", preparedBy: "Анна Коваль", snapshotAt: "2026-09-19T12:00:00.000Z" });
  const el = w.document.getElementById("d");
  w.FBARender.render(el, snap.analysis, { static: true, hidden: snap.hidden, snapshot: { preparedBy: snap.preparedBy, snapshotAt: snap.snapshotAt, mode: snap.mode } });
  assert.match(el.querySelector("#sec-hero").textContent, /Подготовил\(а\): Анна Коваль/); assert.match(el.querySelector("#sec-hero").textContent, /только чтение/);
  assert.equal(el.querySelectorAll("button, input, select, textarea, [data-action]").length, 0, "на публичной странице нет элементов управления");
  for (const id of ["economics", "budget", "traffic", "competitors", "scorecard", "challenger", "patents", "ai", "conclusion"]) assert.equal(el.querySelector("#sec-" + id).classList.contains("hidden"), false, id);
  assert.match(el.querySelector("#sec-ai").textContent, /AI получает только агрегаты|AI-вердикт/);
  assert.match(el.querySelector("#sec-patents").textContent, /не проверено/);
});

test("снимок без закупочной экономики: секции экономики и бюджета скрыты, рендер не падает, чисел нет в HTML", () => {
  const { w } = makeWindow(); const a = fullAnalysis();
  const snap = buildSnapshot(a, { mode: "no_economics", preparedBy: "Анна" });
  const el = w.document.getElementById("d");
  assert.doesNotThrow(() => w.FBARender.render(el, snap.analysis, { static: true, hidden: snap.hidden, snapshot: { preparedBy: snap.preparedBy, snapshotAt: snap.snapshotAt, mode: snap.mode } }));
  for (const id of ["economics", "budget", "cashflow"]) { const s = el.querySelector("#sec-" + id); assert.ok(s.classList.contains("hidden"), id); assert.equal(s.innerHTML, ""); }
  for (const id of ["hero", "overview", "criterion1", "traffic", "competitors", "challenger", "scorecard", "conclusion"]) assert.ok(el.querySelector("#sec-" + id).textContent.length > 20, id);
  assert.match(el.querySelector("#sec-hero").textContent, /закупочная экономика скрыта автором/);
  assert.match(el.querySelector("#sec-challenger").textContent, /экономика скрыта автором/);
  // Ищем только в секциях, построенных из расчётов: в рыночных секциях (POE/Xray) встречаются свои проценты, напр. «+41 %» роста запусков.
  const html = ["hero", "criterion1", "challenger", "scorecard", "conclusion", "ai", "checklist", "reconciliation"].map((id) => el.querySelector("#sec-" + id).innerHTML).join(" | "); const e = a.results.economics;
  for (const needle of ["12.00", "20000", "20 000", e.gate1.net0.toFixed(2), String(Math.round(e.gate1.margin0 * 100)) + " %"]) assert.equal(html.includes(needle), false, `в HTML осталось «${needle}»`);
  assert.equal(el.querySelectorAll("button, input, select, [data-action]").length, 0);
});
