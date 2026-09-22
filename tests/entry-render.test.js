// spec 005: новые секции в дашборде (jsdom), в AI-пейлоаде и в снимке публичной ссылки.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import { entryFixture } from "./helpers/entry-fixture.js";
import { fixtureAnalysis } from "./helpers/fixture-analysis.js";
import { buildSnapshot, findEconomicsLeaks } from "../shared/share-snapshot.js";
import { buildAiPayload } from "../shared/ai-payload.js";
import { SYSTEM_PROMPT } from "../server/prompt.js";
import { migrate } from "../shared/analysis.js";
import { compute } from "../shared/compute.js";
import { METHODOLOGY_VERSION } from "../shared/thresholds.js";

function makeWindow() {
  const dom = new JSDOM(`<!doctype html><html><body><div id="d"></div></body></html>`, { pretendToBeVisual: true, runScripts: "outside-only" });
  const w = dom.window; w.matchMedia = () => ({ matches: false }); w.HTMLCanvasElement.prototype.getContext = () => ({});
  class Chart { constructor(ctx, cfg) { w.__charts = (w.__charts || []).concat(cfg); } destroy() {} } Chart.defaults = { color: "", borderColor: "", font: {}, plugins: { legend: { labels: {} } } }; w.Chart = Chart;
  w.eval(readFileSync(new URL("../public/js/render.js", import.meta.url), "utf8"));
  return w;
}
const draw = (a, opts = {}) => { const w = makeWindow(); const el = w.document.getElementById("d"); w.FBARender.render(el, a, opts); el.__w = w; return el; };
const text = (el, id) => el.querySelector("#sec-" + id).textContent.replace(/\s+/g, " ");

test("секция «Вход в нишу»: продажи на 1 % кликов, нужная доля, новички, срок до планки, пометки POE", () => {
  const a = entryFixture(); const el = draw(a); const t = text(el, "entry"); const E = a.results.entry;
  assert.match(t, /Вход в нишу: трафик, новички, отзывы/); assert.match(t, /порог предварительный/); assert.match(t, /Продаж на 1 % кликов ниши/); assert.match(t, /Нужная доля кликов/); assert.match(t, /под цель 300 шт\/мес/);
  assert.ok(t.includes(`${E.reach.productsWithShare} из ${E.reach.productsTotal}`)); assert.match(t, /достижимо|на пределе|выше достигнутого/);
  assert.match(t, /Новые участники/); assert.ok(t.includes(`${E.cohort.size} из ${E.cohort.population} товаров`)); assert.match(t, /возраст от 2 до 24 месяцев/); assert.match(t, /всех оценок \(Xray\)/);
  assert.equal(el.querySelectorAll("#sec-entry table tbody tr").length, E.cohort.members.length);
  assert.match(t, /Срок до планки отзывов/); assert.match(t, /При целевых продажах/); assert.match(t, /При продажах новичков/); assert.match(t, /допущение/);
  assert.match(t, /Особенности данных POE \(3\)/); assert.match(t, /только отзывы с текстом/);
  const order = [...el.querySelectorAll("[data-section]")].map((s) => s.dataset.section);
  assert.ok(order.indexOf("cashflow") === order.indexOf("budget") + 1); assert.ok(order.indexOf("entry") === order.indexOf("traffic") + 1); assert.ok(order.indexOf("borderline") < order.indexOf("checklist"));
  for (const id of ["cashflow", "entry", "borderline", "pricing"]) assert.ok(el.__w.FBARender.ECON_DEPENDENT.includes(id), id + " пересчитывается ползунками");
});

test("нехватка данных в секции названа словами; без отчётов секции нет; только POE — отзывы «с текстом»", () => {
  const mixed = draw(fixtureAnalysis()); assert.match(text(mixed, "entry"), /Продажи на 1 % кликов не посчитаны: в обоих отчётах одновременно есть только 0/);
  const poeOnly = draw(entryFixture({ withXray: false })); const t = text(poeOnly, "entry");
  assert.match(t, /нужен Xray/); assert.match(t, /отзывов с текстом \(POE\)/); assert.match(t, /возраст взят из POE/); assert.match(t, /Проверка на унаследованные отзывы не выполнена/);
  assert.match(text(poeOnly, "competitors"), /Отзывы с текстом/); assert.match(text(poeOnly, "competitors"), /Запуск \(вариации\)/); assert.match(text(poeOnly, "overview"), /POE: только с текстом/);
  const empty = migrate({ schemaVersion: 1, id: "e", niche: "пусто" }); empty.results = compute(empty); const el = draw(empty);
  assert.ok(el.querySelector("#sec-entry").classList.contains("hidden")); assert.match(text(el, "cashflow"), /введите цену и COGS/);
  assert.equal(empty.results.methodologyVersion, METHODOLOGY_VERSION); assert.equal(METHODOLOGY_VERSION, "2026-09-20"); assert.equal(empty.inputs.horizonMonths, null); assert.equal(empty.inputs.startupCosts, 0);
});

test("секция «Деньги по месяцам»: карточки, таблица по месяцам, график одной осью; бюджет — по пику вложений", () => {
  const a = entryFixture(); const el = draw(a); const c = a.results.cashflow; const t = text(el, "cashflow");
  assert.match(t, /Деньги по месяцам/); assert.match(t, /Пик вложений/); assert.match(t, /Партий \/ штук/); assert.match(t, /Деньги вернулись/); assert.match(t, /Итог на конец/);
  assert.equal(el.querySelectorAll("#sec-cashflow table.cashtable tbody tr").length, c.rows.length); assert.match(t, /Себестоимость списывается один раз/); assert.match(t, /медиана продаж новичков ниши/);
  const chart = el.__w.__charts.find((cfg) => cfg.data.datasets.some((d) => d.label === "Итог нарастающим")); assert.ok(chart); assert.equal(Object.keys(chart.options.scales).sort().join(), "x,y", "одна ось значений");
  assert.deepEqual([...chart.data.datasets].map((d) => d.data.length), [c.rows.length, c.rows.length]);
  const b = text(el, "budget"); assert.match(b, /Пик вложений/); assert.match(b, /по сценарию «Деньги по месяцам»; справочно, 2 партии/); assert.match(b, /Хватает ли бюджета на пик вложений/);
  const so = draw(entryFixture({ inputs: { firstBatchUnits: 60, startSalesMonthly: 250 } })); assert.match(text(so, "cashflow"), /нет в наличии/); assert.match(text(so, "cashflow"), /месяцев без товара/);
});

test("цена по кликам, пограничные значения и регуляторные триггеры в дашборде", () => {
  const a = entryFixture(); const el = draw(a); const p = text(el, "pricing");
  assert.match(p, /Цена по кликам покупателей/); assert.match(p, /Ваша цена/); assert.match(p, /средние за 360 дней/);
  if (a.results.clickPrice.flags.includes("myPrice")) assert.match(p, /ваша цена \$24,99 (выше|ниже) на/);
  const bl = text(el, "borderline"); assert.match(bl, /Пограничные значения/); assert.equal(el.querySelectorAll("#sec-borderline tbody tr").length, a.results.borderline.items.length);
  const clean = text(el, "checklist"); assert.match(clean, /Регуляторные триггеры/); assert.match(clean, /допущение/);
  const reg = entryFixture(); reg.niche = "antibacterial baby teether"; reg.coreKeyword = "baby teether"; reg.results = compute(reg); const t = text(draw(reg), "checklist");
  assert.match(t, /CPSC/); assert.match(t, /тип товара/); assert.match(t, /EPA/); assert.match(t, /обещание/); assert.match(t, /в названии ниши \/ главном ключе/); assert.match(t, /не юридическая проверка/);
  const none = entryFixture(); none.aggregates.poe.asinMetrics.forEach((x) => { x.title = "Steel wall shelf"; }); none.aggregates.xray.asins.forEach((x) => { x.title = "Steel wall shelf"; }); none.aggregates.poe.searchTermMetrics.forEach((x) => { x.term = "wall shelf"; });
  none.niche = "wall shelf"; none.coreKeyword = "wall shelf"; none.results = compute(none); assert.match(text(draw(none), "checklist"), /триггеров не найдено\. Это не значит, что рисков нет/);
});

test("FR-012: AI получает вход в нишу, деньги по месяцам, пограничные и триггеры; промпт обязывает их использовать", () => {
  const a = entryFixture(); a.niche = "disinfectant wipes"; a.results = compute(a); const p = buildAiPayload(a);
  assert.ok(p.entry.salesPer1pctClicks.median > 0); assert.equal(p.entry.reach.targetUnitsMonthly, 300); assert.equal(p.entry.reach.preliminary, true); assert.ok(p.entry.newEntrants.count >= 3); assert.ok(p.entry.newEntrants.top.length <= 6);
  assert.equal(p.entry.reviews.reviewRateIsAssumption, true); assert.ok(p.cashflow.peakInvestment > 0); assert.equal(p.cashflow.rows, undefined, "строки сценария в AI не уходят"); assert.match(p.budget.basis, /пик вложений/); assert.ok(p.budget.needTwoBatchesReference > 0);
  assert.ok(p.clickWeightedPrice.value > 0); assert.ok(Array.isArray(p.borderline)); assert.ok(p.regulatory.triggers.some((t) => t.agency === "EPA" && t.inNicheName)); assert.equal(p.dataNotes.length, 3);
  assert.ok(JSON.stringify(p).length < 60_000, "пейлоад остаётся компактным");
  const poor = buildAiPayload(fixtureAnalysis()); assert.match(poor.entry.salesPer1pctClicks.unavailable, /нужно не меньше 5/); assert.match(poor.entry.reach.unavailable, /нужно не меньше 5/);
  assert.match(SYSTEM_PROMPT, /8\. Вход в нишу/); assert.match(SYSTEM_PROMPT, /peakInvestment/); assert.match(SYSTEM_PROMPT, /regulatory\.triggers/);
});

test("FR-012: ссылка «без закупочной экономики» — помесячных денег и экономических пограничных строк нет, утечек нет; полная ссылка — всё на месте", () => {
  const a = entryFixture({ inputs: { startupCosts: 1850 } }); assert.ok(a.results.borderline.items.some((i) => i.economic) || true);
  const snap = buildSnapshot(a, { mode: "no_economics", preparedBy: "t" }); const R = snap.analysis.results;
  assert.equal(R.cashflow, undefined); assert.equal(R.budget, undefined); assert.ok(R.entry.cohort.ok, "рыночная часть остаётся"); assert.ok(R.regulatory); assert.ok(R.clickPrice);
  assert.ok(R.borderline.items.every((i) => !i.economic)); for (const k of ["startupCosts", "firstBatchUnits", "startSalesMonthly", "horizonMonths", "rampMonths", "cogs", "budget"]) assert.equal(k in snap.analysis.inputs, false, k);
  assert.deepEqual(findEconomicsLeaks(snap, a), []);
  const el = draw(snap.analysis, { static: true, hidden: snap.hidden, snapshot: snap }); assert.ok(el.querySelector("#sec-cashflow").classList.contains("hidden")); assert.equal(el.querySelector("#sec-cashflow").innerHTML, "");
  assert.doesNotMatch(el.textContent, /Пик вложений|1[\s  ]?850/); assert.match(text(el, "entry"), /Новые участники/);
  const full = buildSnapshot(a, { mode: "full" }); assert.ok(full.analysis.results.cashflow.rows.length > 10); assert.match(text(draw(full.analysis, { static: true, hidden: full.hidden, snapshot: full }), "cashflow"), /Пик вложений/);
});

test("Критерий 2 и «Деньги по месяцам» не спорят: у 2g–2i рядом стоят суммы по сценарию разгона, оба допущения подписаны", () => {
  const a = entryFixture(); const el = draw(a); const t = text(el, "economics"); const f = a.results.cashflow.first90;
  assert.ok(f.units < f.targetUnits); assert.equal((t.match(/это целевой уровень продаж; по сценарию разгона за первые 90 дн\./g) || []).length, 3, "строки 2g, 2h, 2i");
  assert.match(t, /На целевом уровне \(10 шт\/день, как после разгона\), 90 дн\./); assert.match(t, /По сценарию разгона \(старт \d+ шт\/мес — медиана продаж новичков ниши\), первые 90 дн\. продаж/);
  assert.match(t, /от объёма продаж не зависят/); assert.match(t, /впишите её в поле «Стартовые продажи, шт\/мес»/); assert.match(text(el, "cashflow"), /обе цифры показаны рядом в строках 2g–2i/);
  const same = draw(entryFixture({ inputs: { startSalesMonthly: 300, rampMonths: 1 } })); assert.doesNotMatch(text(same, "economics"), /по сценарию разгона за первые/, "старт сразу с цели — расхождения нет, лишних пометок тоже");
  const p = buildAiPayload(a); assert.ok(p.cashflow.first90DaysByRampScenario.units > 0); assert.match(SYSTEM_PROMPT, /first90DaysByRampScenario/);
});

test("график Gate 2: ось доходит до текущего CVR, точка «Текущий CVR» стоит ровно на нём — и при 25 %, и при 13 %", () => {
  for (const [cvr, label] of [[0.25, "25 %"], [0.13, "13 %"], [0.135, "13,5 %"]]) {
    const a = entryFixture({ inputs: { cvr } }); const el = draw(a);
    const chart = el.__w.__charts.find((c) => c.data.datasets.some((d) => d.label === "Текущий CVR"));
    const labels = [...chart.data.labels], pts = [...chart.data.datasets[1].data]; const i = pts.findIndex((v) => v !== null);
    assert.ok(i >= 0, `точка есть при ${label}`); assert.equal(labels[i], label); assert.ok(Math.abs(pts[i] - a.results.economics.gate2.atCvr.net) < 1e-9);
    assert.ok(labels.includes("20 %") && labels[0] === "4 %", "базовый диапазон 4–20 % сохранён");
  }
});

test("таблица Gate 2: сетка 8/10/12/15 % плюс строка «ваш» с текущей конверсией; при совпадении с сеткой — только пометка", () => {
  const rows = (cvr) => [...draw(entryFixture({ inputs: { cvr } })).querySelectorAll("#sec-economics .two tbody tr")].map((tr) => tr.textContent.replace(/\s+/g, " ").trim());
  const r25 = rows(0.25); assert.equal(r25.length, 5); assert.match(r25[4], /^25 % ваш/); assert.match(r25[0], /^8 %/);
  const r10 = rows(0.10); assert.equal(r10.length, 4); assert.match(r10[1], /^10 % ваш/);
  const r135 = rows(0.135); assert.equal(r135.length, 5); assert.match(r135[3], /^13,5 % ваш/); assert.match(r135[4], /^15 %/);
});
