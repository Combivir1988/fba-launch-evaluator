// Этап 2 (spec 010): секции «Конфигурация продукта — этап 2» и «ТЗ производителю» в дашборде (jsdom): состояния до схемы / после схемы / с таблицей и ТЗ, static-режим, переключатель диапазона, сумма долей.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import { entryFixture } from "./helpers/entry-fixture.js";
import { withConfig } from "./helpers/config-fixture.js";
import { compute } from "../shared/compute.js";
import { buildSnapshot } from "../shared/share-snapshot.js";

const RENDER = readFileSync(new URL("../public/js/render.js", import.meta.url), "utf8");
function makeWindow() {
  const dom = new JSDOM(`<!doctype html><html><body><div id="d"></div></body></html>`, { pretendToBeVisual: true, runScripts: "outside-only" });
  const w = dom.window; w.matchMedia = () => ({ matches: false }); w.HTMLCanvasElement.prototype.getContext = () => ({});
  const charts = []; class Chart { constructor(_, cfg) { this.cfg = cfg; charts.push(this); } destroy() {} } Chart.defaults = { color: "", borderColor: "", font: {}, plugins: { legend: { labels: {} } } }; w.Chart = Chart; w.__charts = charts;
  w.eval(RENDER); return w;
}
const draw = (a, opts = {}) => { const w = makeWindow(); const el = w.document.getElementById("d"); w.FBARender.render(el, a, opts); el.__w = w; return el; };
const text = (el, sel) => el.querySelector(sel)?.textContent.replace(/\s+/g, " ").trim() || "";

test("до этапа 2: секция показывает область ASIN и кнопку шага 1; без Xray скрыта; ТЗ скрыто", () => {
  const a = entryFixture(); const el = draw(a);
  const sec = el.querySelector("#sec-config"); assert.equal(sec.classList.contains("hidden"), false);
  assert.match(text(el, "#sec-config h2"), /Конфигурация продукта — этап 2/); assert.match(text(el, "#sec-config h2"), new RegExp(`${a.results.configScope.count} ASIN`));
  assert.ok(sec.querySelector('[data-action="config-schema"]')); assert.equal(sec.querySelector('[data-action="config-extract"]').disabled, true, "извлечение недоступно без схемы");
  assert.equal(el.querySelector("#sec-tz").classList.contains("hidden"), true);
  const noX = entryFixture({ withXray: false }); assert.equal(draw(noX).querySelector("#sec-config").classList.contains("hidden"), true);
  const st = draw(a, { static: true }); assert.equal(st.querySelectorAll("#sec-config button").length, 0, "в static-режиме кнопок нет");
  const noKey = draw(a, { scrapfly: false }); assert.match(text(noKey, "#sec-config .notice"), /SCRAPFLY_API_KEY/);
});

test("схема без таблицы: поля чипами, кнопка извлечения активна", () => {
  const a = withConfig(entryFixture(), { tz: false }); delete a.config.table; a.results = compute(a);
  const el = draw(a); const sec = el.querySelector("#sec-config");
  assert.match(text(el, "#sec-config summary"), /Схема полей \(\d+\)/); assert.ok(sec.querySelectorAll(".chips .chip").length >= 3);
  assert.equal(sec.querySelector('[data-action="config-extract"]').disabled, false); assert.equal(sec.querySelector('[data-action="config-edit"]').disabled, false);
  assert.equal(sec.querySelector(".piegrid"), null);
});

test("таблица извлечена: диаграммы по полям (сумма 100 %), доминирующая конфигурация, таблица ASIN × поля с правкой; ТЗ с редактируемыми строками и DOCX", () => {
  const a = withConfig(entryFixture()); const el = draw(a); const w = el.__w;
  const st = a.results.config.whole; assert.ok(st.fields.length >= 3);
  const canvases = el.querySelectorAll("#sec-config canvas"); assert.equal(canvases.length, st.fields.length, "по одной диаграмме на поле");
  const pies = w.__charts.filter((c) => c.cfg.type === "doughnut"); assert.equal(pies.length, st.fields.length);
  for (const c of pies) { const sum = c.cfg.data.datasets[0].data.reduce((s, v) => s + v, 0); assert.ok(Math.abs(sum - 100) < 0.6, `сумма секторов ${sum}`); }
  assert.match(text(el, "#sec-config h3"), /Доминирующая конфигурация/);
  const domRows = el.querySelectorAll("#sec-config h3 + table tbody tr"); assert.equal(domRows.length, st.fields.length);
  assert.match(text(el, "#sec-config"), /Вес — выручка ASIN по Xray/);
  const det = el.querySelector("#sec-config details.cfgtable"); assert.ok(det); assert.match(det.querySelector("summary").textContent, /листингов × \d+ полей/);
  const cells = det.querySelectorAll("td[data-cell]"); assert.equal(cells.length, Object.keys(a.config.table.rows).length * a.config.schema.fields.length, "каждая клетка правится");
  assert.ok([...cells].some((td) => td.getAttribute("title")?.includes("источник:")));
  assert.equal(el.querySelector("#sec-config [data-config-view]"), null, "без ценового диапазона переключателя нет");
  // ТЗ
  const tz = el.querySelector("#sec-tz"); assert.equal(tz.classList.contains("hidden"), false);
  assert.match(text(el, "#sec-tz h2"), new RegExp(`${a.config.tz.rows.length} требований`));
  assert.equal(tz.querySelectorAll("tbody tr").length, a.config.tz.rows.length); assert.equal(tz.querySelectorAll('td[contenteditable="true"][data-tz$="|requirement"]').length, a.config.tz.rows.length);
  assert.ok(tz.querySelector('[data-action="tz-docx"]') && !tz.querySelector('[data-action="tz-docx"]').disabled); assert.ok(tz.querySelector("[data-tz-summary][contenteditable]"));
  assert.equal(tz.querySelectorAll('select[data-tz$="|priority"]').length, a.config.tz.rows.length);
  // static: без правки и кнопок
  const s = draw(a, { static: true }); assert.equal(s.querySelectorAll("#sec-tz [contenteditable], #sec-tz button, #sec-tz select, #sec-config button, #sec-config td[data-cell]").length, 0);
  assert.equal(s.querySelectorAll("#sec-config canvas").length, st.fields.length, "диаграммы есть и в static");
});

test("ценовой диапазон: переключатель «вся ниша / мой диапазон» перерисовывает секцию (работает без app.js — как в автономном HTML)", () => {
  const a = withConfig(entryFixture()); a.inputs.priceMin = 10; a.inputs.priceMax = 40; a.results = compute(a);
  assert.ok(a.results.config.band, "статистика по диапазону есть");
  const el = draw(a); const radios = el.querySelectorAll("#sec-config [data-config-view]"); assert.equal(radios.length, 2); assert.equal(radios[0].checked, true);
  assert.doesNotMatch(text(el, "#sec-config h3"), /диапазон/);
  radios[1].checked = true; radios[1].dispatchEvent(new el.__w.Event("change", { bubbles: true }));
  assert.match(text(el, "#sec-config h3"), /диапазон/); assert.equal(el.querySelector('#sec-config [data-config-view][value="band"]').checked, true, "выбор сохранён после перерисовки");
  assert.match(text(el, "#sec-config"), new RegExp(`листингов ${a.results.config.band.asins}\\b`));
});

test("снимок ссылки рендерится без ТЗ; секция конфигурации остаётся", () => {
  const a = withConfig(entryFixture()); const snap = buildSnapshot(a, { mode: "full" }); const el = draw(snap.analysis, { static: true, hidden: snap.hidden });
  assert.equal(el.querySelector("#sec-config").classList.contains("hidden"), false); assert.equal(el.querySelector("#sec-tz").classList.contains("hidden"), true);
});
