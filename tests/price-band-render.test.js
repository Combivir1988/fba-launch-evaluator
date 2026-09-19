// spec 003: ценовой диапазон в дашборде (jsdom), в снимке публичной ссылки и в общей истории.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import { fixtureAnalysis } from "./helpers/fixture-analysis.js";
import { buildSnapshot, findEconomicsLeaks } from "../shared/share-snapshot.js";
import { splitDoc, joinDoc, migrate } from "../shared/analysis.js";
import { compute } from "../shared/compute.js";
import { resultsHash } from "./helpers/results-hash.js";
import { testDb } from "./helpers/db.js";
import { createAnalyses } from "../server/analyses.js";

function makeWindow() {
  const dom = new JSDOM(`<!doctype html><html><body><div id="d"></div></body></html>`, { pretendToBeVisual: true, runScripts: "outside-only" });
  const w = dom.window; w.matchMedia = () => ({ matches: false }); w.HTMLCanvasElement.prototype.getContext = () => ({});
  class Chart { constructor() {} destroy() {} } Chart.defaults = { color: "", borderColor: "", font: {}, plugins: { legend: { labels: {} } } }; w.Chart = Chart;
  w.eval(readFileSync(new URL("../public/js/render.js", import.meta.url), "utf8"));
  return w;
}
const draw = (a, opts = {}) => { const w = makeWindow(); const el = w.document.getElementById("d"); w.FBARender.render(el, a, opts); return el; };
const prices = (el) => [...el.querySelectorAll("#sec-competitors tbody tr td:nth-child(4)")].map((td) => Number(td.textContent.replace(/[^0-9,.-]/g, "").replace(",", ".")));

test("шапка с диапазоном, пометки «в диапазоне / вся ниша», две цифры у 1a, таблица конкурентов только из диапазона", () => {
  const a = fixtureAnalysis({ inputs: { priceMin: 20, priceMax: 60 } }); const el = draw(a, { static: false }); const pb = a.results.priceBand;
  const hero = el.querySelector("#sec-hero").textContent;
  assert.match(hero, /Анализ сужен до цен \$20–\$60/); assert.ok(hero.includes(`${pb.inCount} из ${pb.totalCount} листингов`)); assert.match(hero, /выручки ниши/);
  const c1 = [...el.querySelectorAll("#sec-criterion1 .gate")].map((g) => g.textContent);
  assert.match(c1[0], /вся ниша/); assert.match(c1[0], /Статус — по всей нише/); assert.match(c1[0], /В диапазоне \$20–\$60/);
  assert.match(c1[1], /в диапазоне/); assert.match(c1[2], /вся ниша/); assert.match(c1[4], /в диапазоне/); assert.match(c1[6], /вся ниша/);
  const pr = prices(el); assert.ok(pr.length > 3 && pr.every((p) => p >= 20 && p <= 60), "цены в таблице: " + pr.join(", "));
  assert.match(el.querySelector("#sec-competitors").textContent, /против всей ниши/); assert.match(el.querySelector("#sec-competitors").textContent, /во всей нише:/);
  assert.match(el.querySelector("#sec-traffic h2").textContent, /вся ниша/);
  assert.equal(el.querySelectorAll("#sec-pricing .seg-pick").length, 3); assert.ok(el.querySelector("#sec-pricing tr.seg-selected"));
});

test("без диапазона — никаких пометок; static и снимок ссылки: пометка есть, кнопок выбора сегмента нет", () => {
  const plain = draw(fixtureAnalysis(), { static: false });
  assert.doesNotMatch(plain.textContent, /Анализ сужен|в диапазоне|вся ниша/); assert.equal(plain.querySelectorAll("#sec-pricing .seg-pick").length, 3);
  const a = fixtureAnalysis({ inputs: { priceMin: 20, priceMax: 60 } });
  for (const mode of ["full", "no_economics"]) {
    const snap = buildSnapshot(a, { mode, preparedBy: "Анна" });
    assert.equal(snap.analysis.inputs.priceMin, 20); assert.equal(snap.analysis.results.priceBand.label, "$20–$60");
    if (mode === "no_economics") assert.deepEqual(findEconomicsLeaks(snap, a), []);
    const el = draw(snap.analysis, { static: true, hidden: snap.hidden, snapshot: { preparedBy: snap.preparedBy, snapshotAt: snap.snapshotAt, mode } });
    assert.match(el.querySelector("#sec-hero").textContent, /Анализ сужен до цен \$20–\$60/, mode);
    assert.equal(el.querySelectorAll("button, input, select, .seg-pick").length, 0, mode);
  }
});

test("предупреждения: малая и недостаточная выборка, цена товара вне диапазона, некорректный диапазон", () => {
  const xs = fixtureAnalysis().aggregates.xray.asins.map((x) => x.price).filter((v) => typeof v === "number").sort((p, q) => p - q);
  assert.match(draw(fixtureAnalysis({ inputs: { priceMin: xs[0], priceMax: xs[9] } })).querySelector("#sec-hero").textContent, /малая выборка/);
  const none = draw(fixtureAnalysis({ inputs: { priceMin: 99999 } }));
  assert.match(none.querySelector("#sec-hero").textContent, /не считаются/); assert.match(none.querySelector("#sec-competitors").textContent, /этого мало/); assert.doesNotMatch(none.querySelector("#sec-competitors").textContent, /Загрузите Xray/);
  assert.ok(none.querySelector("#sec-scorecard").textContent.length > 20 && none.querySelector("#sec-conclusion").textContent.length > 20, "остальной дашборд работает");
  assert.match(draw(fixtureAnalysis({ inputs: { priceMin: 20, priceMax: 60, price: 99 } })).querySelector("#sec-hero").textContent, /цена вашего товара вне заданного диапазона/);
  const bad = fixtureAnalysis({ inputs: { priceMin: 60, priceMax: 20 } });
  assert.match(draw(bad, { static: false }).querySelector("#sec-hero").textContent, /диапазон не применён/i); assert.doesNotMatch(draw(bad, { static: true }).querySelector("#sec-hero").textContent, /не применён/i);
});

let db; before(async () => { db = await testDb(); }); after(async () => { await db.close(); });
test("диапазон живёт в общей истории; старый документ открывается без диапазона и с прежними цифрами", async () => {
  const A = createAnalyses(db); const u = await db.makeUser({ name: "Анна" });
  const a = fixtureAnalysis({ inputs: { priceMin: 20, priceMax: 60 } }); const { core, aggregates } = splitDoc(a);
  await A.saveCore({ id: a.id, core }, u); await A.saveAggregates({ id: a.id, baseVersion: 1, aggregates }, u);
  const g = await A.get(a.id); const opened = migrate(joinDoc(g.core, g.aggregates));
  assert.equal(opened.inputs.priceMin, 20); assert.equal(opened.inputs.priceMax, 60);
  assert.equal(compute(opened).priceBand.inCount, a.results.priceBand.inCount);
  const legacy = JSON.parse(JSON.stringify(fixtureAnalysis())); delete legacy.inputs.priceMin; delete legacy.inputs.priceMax; delete legacy.results;
  const m = migrate(legacy); assert.equal(m.inputs.priceMin, null); assert.equal(resultsHash(compute(m)), "c5e5835d0ca04abf");
});
