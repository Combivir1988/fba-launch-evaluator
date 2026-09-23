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

test("подсказки графиков: только числа с единицей, без пояснений; пояснение «что это» — у значка «?» каждого графика", () => {
  const a = withConfig(entryFixture()); const el = draw(a); const charts = el.__w.__charts;
  assert.ok(charts.length >= 8, "графиков: " + charts.length);
  for (const c of charts) {
    const cb = c.cfg.options?.plugins?.tooltip?.callbacks; assert.ok(cb?.label, `${c.cfg.type}: нет подписи значения`); assert.equal(cb.footer, undefined, `${c.cfg.type}: в подсказке не должно быть пояснений`);
    if (c.cfg.type === "line" || c.cfg.type === "bar") assert.ok(c.cfg.options.interaction?.mode === "index" && c.cfg.options.interaction?.intersect === false, "подсказка по всей колонке, не только по фигуре");
    assert.equal(c.cfg.desc, undefined, "desc не уходит в Chart.js");
  }
  const marks = [...el.querySelectorAll(".chartbox .chart-what[data-tip]")]; assert.equal(marks.length, el.querySelectorAll(".chartbox").length, "значок «?» у каждого графика");
  assert.ok(marks.every((m) => /^Что это:/.test(m.getAttribute("data-tip")) && m.getAttribute("data-tip").length >= 40));
  const pie = charts.find((c) => c.cfg.type === "doughnut"); const cbp = pie.cfg.options.plugins.tooltip.callbacks; assert.equal(cbp.title(), "", "заголовок кольца не дублирует строку");
  const first = a.results.config.whole.fields[0].values[0]; const line = cbp.label({ label: first.label, parsed: Math.round(first.share * 1000) / 10, dataIndex: 0 });
  assert.match(line, /^(★ )?.+ · [\d,]+ % · \$\S+ · \d+ лист\.( · \$\S+)?$/, line); assert.ok(line.includes(first.label), "подпись содержит значение");
  assert.equal(pie.cfg.options.plugins.tooltip.displayColors, false);
});

test("вкладки «Этап 1 / Этап 2» внутри дашборда: есть в приложении, в снимке ссылки и без app.js; без Xray вкладок нет; переключение перерисовывает секции", () => {
  const a = withConfig(entryFixture()); const el = draw(a, { stage: 1 });
  const tabs = el.querySelectorAll("[data-stagetabs] [data-stage]"); assert.equal(tabs.length, 2); assert.equal(el.dataset.stage, "1"); assert.equal(tabs[0].classList.contains("active"), true);
  assert.match(tabs[1].textContent, /ТЗ готово/); assert.equal(el.querySelectorAll("[data-stagetabs] button").length, 0, "вкладки — не кнопки: публичная страница остаётся без элементов управления");
  let seen = null; el.__w.FBARender.setStage(el, a, 2); el.__w.FBARender.update(el, a, { onStage: (n) => { seen = n; } }, []);
  assert.equal(el.dataset.stage, "2"); assert.equal(el.querySelector('[data-stagetabs] [data-stage="2"]').classList.contains("active"), true);
  const before = el.__w.__charts.length; el.querySelector('[data-stagetabs] [data-stage="1"]').dispatchEvent(new el.__w.MouseEvent("click", { bubbles: true, cancelable: true }));
  assert.equal(el.dataset.stage, "1"); assert.equal(seen, 1, "приложению сообщён выбор"); assert.ok(el.__w.__charts.length > before, "секции этапа 1 перерисованы (графики созданы заново)");
  const snap = buildSnapshot(a, { mode: "full" }); const sh = draw(snap.analysis, { static: true, hidden: snap.hidden, stage: 2 });
  assert.equal(sh.querySelectorAll("[data-stagetabs] [data-stage]").length, 2, "в публичной ссылке вкладки есть"); assert.equal(sh.dataset.stage, "2"); assert.match(sh.querySelector('[data-stagetabs] [data-stage="2"]').textContent, /извлечено/, "ТЗ в снимке нет — бейдж «извлечено»");
  assert.equal(draw(entryFixture({ withXray: false })).querySelector("[data-stagetabs]"), null, "без Xray этапа 2 нет — вкладок нет");
  assert.equal(draw(entryFixture({ withXray: false }), { stage: 2 }).dataset.stage, "1");
});

test("после составления ТЗ обновляются и бейдж вкладки, и строка «Этап 2 …» в шапке — без полного рендера", () => {
  const a = withConfig(entryFixture(), { tz: false }); const el = draw(a);
  assert.match(text(el, "#sec-hero [data-goto]"), /ТЗ не составлено/); assert.match(el.querySelector('[data-stagetabs] [data-stage="2"]').textContent, /извлечено/);
  a.config.tz = { title: "ТЗ", summary: "s", rows: [{ section: "конструкция", param: "p", requirement: "r", rationale: "x", priority: "must", source: "s" }], openQuestions: [], generatedAt: "2026-09-22T00:00:00Z", model: "mock" };
  el.__w.FBARender.update(el, a, {}, ["tz"]);
  assert.match(text(el, "#sec-hero [data-goto]"), /ТЗ: 1 требований/); assert.match(el.querySelector('[data-stagetabs] [data-stage="2"]').textContent, /ТЗ готово/);
});

test("деньги по месяцам: причина стартового уровня продаж — на виду (с нуля / новички / вручную)", () => {
  const a = entryFixture({ inputs: { cogs: 4.37 } }); const el0 = draw(a); const cf = a.results.cashflow;
  const note = text(el0, "#sec-cashflow .notice.info"); assert.ok(note, "заметка о старте есть");
  if (cf.startSource === "cohort") assert.match(note, /стартуют с \d+ шт\/мес.*медиана продаж новичков/); else assert.match(note, /стартуют с нуля.*в нише нет новичков/);
  const b = entryFixture({ inputs: { cogs: 4.37, startSalesMonthly: 120 } }); assert.match(text(draw(b), "#sec-cashflow .notice.info"), /заданы вручную: 120 шт\/мес/);
  const z = entryFixture({ withXray: false, inputs: { cogs: 4.37 } }); const n = text(draw(z), "#sec-cashflow .notice.info"); assert.match(n, /стартуют с нуля/); assert.match(n, /по \d+ шт\/мес до цели \d+ шт\/мес за \d+ мес/);
});

test("схема изменилась после извлечения: секция предупреждает и зовёт «Извлечь заново»", () => {
  const a = withConfig(entryFixture(), { tz: false }); a.config.schema = { ...a.config.schema, fields: [...a.config.schema.fields, { id: "new_field", name: "Новое поле", type: "text", unit: null, options: [], hint: "" }] }; a.results = compute(a);
  const el = draw(a); assert.match(text(el, "#sec-config .notice"), /Схема изменилась после извлечения.*«Новое поле».*Извлечь заново.*кредиты Scrapfly не тратятся/);
  const ok = withConfig(entryFixture(), { tz: false }); assert.doesNotMatch(text(draw(ok), "#sec-config"), /Схема изменилась/);
});
