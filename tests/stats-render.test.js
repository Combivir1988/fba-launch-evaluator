// DOM-smoke раздела «Статистика» (jsdom + заглушка Chart.js), spec 018.
// Проверяется не красота, а два обещания спеки: у каждого графика есть числовая форма (FR-021, SC-009)
// и рядом с процентом всегда стоит число и база (FR-013).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import { summarize } from "../shared/stats-summary.js";

const ITEMS = JSON.parse(readFileSync(new URL("./fixtures/stats-outcomes.json", import.meta.url), "utf8"));
const REF = JSON.parse(readFileSync(new URL("./fixtures/stats-reference.json", import.meta.url), "utf8"));

function makeWindow() {
  const dom = new JSDOM('<!doctype html><html><body><div id="d"></div></body></html>', { pretendToBeVisual: true, runScripts: "outside-only" });
  const w = dom.window;
  w.matchMedia = () => ({ matches: false });
  w.HTMLCanvasElement.prototype.getContext = () => ({});
  const created = [];
  class Chart { constructor(ctx, cfg) { created.push(cfg); this.cfg = cfg; } destroy() {} }
  w.Chart = Chart;
  w.eval(readFileSync(new URL("../public/js/stats.js", import.meta.url), "utf8"));
  return { w, created };
}

const DATA = (over = {}) => {
  const { summary, rows, mismatch } = summarize(ITEMS);
  return { freshness: { computedAt: "2026-11-02T18:40:11.000Z", total: 67, counted: 65, empty: 2, failed: 0, failures: [], stale: 0, recomputing: false, methodChanged: false, recomputeError: null, ...(over.freshness || {}) },
    mismatch, summary, rows };
};

test("раздел рисуется целиком: все срезы, у каждого графика — таблица", () => {
  const { w, created } = makeWindow();
  const el = w.document.getElementById("d");
  w.FBAStats.render(el, DATA());

  for (const need of ["Вердикты", "Решающая причина", "Как часто проблема есть вообще", "Критерий 1 по восьми подпунктам", "Экономика по Gate 1 и Gate 2", "Критерии 1–8", "Scorecard"]) {
    assert.ok(el.textContent.includes(need), "нет среза: " + need);
  }
  assert.ok(created.length >= 8, `графиков создано ${created.length}`);
  const blocks = el.querySelectorAll(".stblock");
  assert.equal(blocks.length, created.length, "у каждого графика свой блок");
  for (const b of blocks) assert.ok(b.querySelector("details.sttable table"), `у блока «${b.querySelector("h3").textContent}» нет числовой формы`);
});

test("FR-013: рядом с процентом всегда число и база", () => {
  const { w } = makeWindow();
  const el = w.document.getElementById("d");
  w.FBAStats.render(el, DATA());
  const text = el.textContent;
  assert.match(text, /% — \d+ из 65/, "процент напечатан без числа и базы");
  // эталонные цифры 2026-11-02 видны глазами, а не только в данных
  assert.ok(text.includes(String(REF.c1pass)) && text.includes("из 65"), "Критерий 1: прошедшие и база");
  assert.ok(text.includes(String(REF.eco.noCogs)), "названо число анализов без введённого COGS");
});

test("FR-008: расхождение сохранённого и пересчитанного названо числом", () => {
  const { w } = makeWindow();
  const el = w.document.getElementById("d");
  w.FBAStats.render(el, DATA());
  const headEl = el.querySelector("#stats-head");
  assert.ok(headEl.textContent.includes(String(REF.changed)), "в шапке нет числа расхождений");
  assert.match(headEl.textContent, /сами анализы не тронуты/);
});

test("FR-016: про сумму больше 100 % сказано текстом, а не оставлено на догадку", () => {
  const { w } = makeWindow();
  const el = w.document.getElementById("d");
  w.FBAStats.render(el, DATA());
  assert.match(el.textContent, /больше 100 %/);
  assert.match(el.textContent, /одна на анализ/);
});

test("FR-027…FR-029: момент расчёта, пометка догона, неудавшийся пересчёт", () => {
  const { w } = makeWindow();
  const el = w.document.getElementById("d");

  w.FBAStats.render(el, DATA());
  assert.match(el.querySelector("#stats-head").textContent, /посчитано на/);

  w.FBAStats.render(el, DATA({ freshness: { stale: 40, recomputing: true, methodChanged: true } }));
  assert.match(el.textContent, /идёт пересчёт/);
  assert.match(el.textContent, /изменилась методика/);
  assert.match(el.textContent, /прежние цифры/);

  w.FBAStats.render(el, DATA({ freshness: { stale: 40, recomputing: false, recomputeError: "база отвалилась" } }));
  assert.match(el.textContent, /пересчёт не прошёл/);
  assert.ok(!el.textContent.includes("идёт пересчёт"), "вечного «считаем» быть не должно");
});

test("крайний случай: считать нечего — объяснение, а не нули", () => {
  const { w, created } = makeWindow();
  const el = w.document.getElementById("d");
  w.FBAStats.render(el, { freshness: { total: 3, counted: 0, empty: 3, failed: 0, failures: [] }, mismatch: { count: 0 }, summary: { n: 0 }, rows: [] });
  assert.equal(created.length, 0, "нулевых графиков не рисуем");
  assert.match(el.textContent, /Считать пока нечего/);
  assert.match(el.textContent, /наполнится сам/);
});

test("без Chart.js цифры всё равно доступны", () => {
  const { w } = makeWindow();
  delete w.Chart;
  const el = w.document.getElementById("d");
  w.FBAStats.render(el, DATA());
  assert.ok(el.querySelectorAll("details.sttable table").length >= 8, "таблицы остались");
  assert.match(el.textContent, /Chart\.js не загрузился/);
});

test("US4: таблица ниш, фильтр по категории и переход в анализ — и ни слова об авторе (FR-022, FR-023)", () => {
  const { w } = makeWindow();
  const el = w.document.getElementById("d");
  const data = DATA();
  w.FBAStats.render(el, data);

  const box = el.querySelector("#stats-niches");
  assert.ok(box, "таблицы ниш нет");
  const heads = [...box.querySelectorAll("thead th")].map((t) => t.textContent.trim());
  assert.deepEqual(heads, ["Ниша", "Вердикт", "Решающая причина", "Категория", "Критерий 1", "Scorecard", "COGS", ""]);
  for (const bad of ["Автор", "Кто", "Пользователь"]) assert.ok(!heads.includes(bad), `колонка «${bad}» — раздел отвечает про ниши, а не оценивает людей`);
  assert.ok(!/автор/i.test(box.textContent), "слова об авторе в таблице быть не должно");

  const trs = box.querySelectorAll("tbody tr");
  assert.equal(trs.length, data.rows.length);
  assert.ok(box.querySelector("button[data-open]"), "из строки нельзя открыть анализ");
  assert.ok(box.textContent.includes("было:"), "у изменившегося вердикта показан прежний (FR-008)");

  // фильтр работает на месте, без похода на сервер
  const eco = data.summary.decisiveCat.find((c) => c.label === "Экономика");
  const btn = [...box.querySelectorAll(".stfilter")].find((b) => b.dataset.cat === "Экономика");
  assert.ok(btn, "кнопки фильтра «Экономика» нет");
  btn.dispatchEvent(new w.Event("click", { bubbles: true }));
  const shown = [...box.querySelectorAll("tbody tr")].filter((t) => !t.classList.contains("hidden"));
  assert.equal(shown.length, eco.count, `фильтр оставил ${shown.length}, а в сводке ${eco.count}`);
  assert.match(box.querySelector("#stats-count").textContent, new RegExp(String(eco.count)));
});

test("US5: блок про неразличающие пороги назван числами (FR-024)", () => {
  const { w } = makeWindow();
  const el = w.document.getElementById("d");
  w.FBAStats.render(el, DATA());
  const box = el.querySelector("#stats-blind");
  assert.ok(box, "блока нет");
  assert.match(box.textContent, /1f · Доля топ-5 брендов/);
  assert.match(box.textContent, /из 65/);
});
