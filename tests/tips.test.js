// spec 006: подсказки при наведении — словарь пояснений, разметка названий, поведение всплывающей подсказки, панель ввода.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import { entryFixture } from "./helpers/entry-fixture.js";
import { fixtureAnalysis } from "./helpers/fixture-analysis.js";
import { withConfig } from "./helpers/config-fixture.js";
import { buildSnapshot, findEconomicsLeaks } from "../shared/share-snapshot.js";
import { compute } from "../shared/compute.js";

const RENDER = readFileSync(new URL("../public/js/render.js", import.meta.url), "utf8");
function makeWindow(html = `<!doctype html><html><body><div id="d"></div></body></html>`) {
  const dom = new JSDOM(html, { pretendToBeVisual: true, runScripts: "outside-only" });
  const w = dom.window; w.matchMedia = () => ({ matches: false }); w.HTMLCanvasElement.prototype.getContext = () => ({});
  class Chart { constructor() {} destroy() {} } Chart.defaults = { color: "", borderColor: "", font: {}, plugins: { legend: { labels: {} } } }; w.Chart = Chart;
  w.eval(RENDER); return w;
}
const draw = (a, opts = {}) => { const w = makeWindow(); const el = w.document.getElementById("d"); w.FBARender.render(el, a, opts); el.__w = w; return el; };
const tipOf = (el, sel, text) => [...el.querySelectorAll(sel + " [data-tip], " + sel + "[data-tip]")].find((x) => x.textContent.trim().startsWith(text))?.getAttribute("data-tip");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const AI = { verdict: "rework", summary: "s", decisiveGate: "Gate 2", criterion1Summary: "c", gates: [{ gate: "gate1", status: "pass", reasoning: "r" }], nextSteps: ["a"], risks: ["r"], pricingPackComment: "p",
  differentiation: [{ hypothesis: "h", evidence: "e", specRequirement: "s" }], recommendations: [{ priority: "high", title: "t", text: "x" }], model: "m", createdAt: "2026-09-20T10:00:00Z" };
const PATENTS = { status: "unsure", summary: "s", feature: "f", candidatesTotal: 1, items: [{ number: "US1", url: "https://patents.google.com/patent/US1", title: "t", risk: "med", relevance: 0.5, claimed: "c", overlap: "o", designAround: "d" }],
  queries: [{ q: "q", url: "https://patents.google.com/?q=q", purpose: "p" }], nextSteps: ["n"], disclaimer: "d", createdAt: "2026-09-20T10:00:00Z" };

test("SC-001: на полном анализе пояснения есть у секций, плиток, пунктов 1a–1h и 2a–2k, столбцов, статусов — не меньше 90", () => {
  const a = entryFixture(); const el = draw(a);
  const n = el.querySelectorAll("[data-tip]").length; assert.ok(n >= 90, "элементов с пояснением: " + n);
  assert.match(tipOf(el, "#sec-overview", "Adj. SV"), /Скорректированный поисковый объём/); assert.match(tipOf(el, "#sec-cashflow", "Пик вложений"), /Максимальная сумма/);
  assert.match(tipOf(el, "#sec-entry h2", "Вход в нишу"), /Реально ли новому листингу/); assert.match(tipOf(el, "#sec-entry", "Нужная доля кликов"), /цель продаж/);
  assert.equal(el.querySelectorAll("#sec-criterion1 .gate [data-tip].has-tip:not(.chip):not(.status)").length, 8, "все восемь пунктов Критерия 1");
  assert.equal(el.querySelectorAll("#sec-economics tbody td.has-tip").length, 11, "все одиннадцать пунктов Критерия 2");
  assert.equal(el.querySelectorAll("#sec-challenger tbody td.has-tip").length, 8); assert.equal(el.querySelectorAll("#sec-scorecard tbody td:first-child [data-tip], #sec-scorecard tbody td:first-child[data-tip]").length, 5);
  assert.match(tipOf(el, "#sec-cashflow th", "Отзывы"), /программы Vine/, "уточнение для секции важнее общего"); assert.match(tipOf(el, "#sec-entry th", "Отзывы"), /все оценки по Xray/);
  assert.match(tipOf(el, "#sec-cashflow th", "Поступления"), /Себестоимость здесь не вычитается/);
  assert.ok([...el.querySelectorAll(".status[data-tip]")].length > 10); assert.equal(el.querySelector(".status[data-tip]").hasAttribute("tabindex"), false, "статусы не засоряют обход клавишей Tab");
  const h2 = el.querySelector("#sec-entry h2"); assert.equal(h2.hasAttribute("data-tip"), false, "помечается текст названия, а не вся строка заголовка"); assert.equal(h2.querySelector("span.has-tip").getAttribute("tabindex"), "0");
  assert.equal(el.querySelectorAll("#sec-entry [title], #sec-competitors th[title], #sec-challenger .chip[title]").length, 0, "прежние системные title переведены в общее оформление");
  assert.match(el.querySelector("#sec-entry h2 .chip[data-tip]").getAttribute("data-tip"), /не откалиброваны/);
  assert.match(tipOf(el, "#sec-quick", "CVR"), /Какая доля кликов превратится в покупки/); assert.match(tipOf(el, "#sec-quick", "Шт/день"), /цель продаж/i);
  assert.doesNotMatch(el.querySelector("#sec-overview").textContent, /Скорректированный поисковый объём/, "пояснения не попадают в текст страницы");
});

test("FR-008: осиротевших пояснений нет — каждое привязано к элементу хотя бы в одном из типовых анализов", () => {
  const used = new Set(); let tips;
  const variants = [entryFixture(), fixtureAnalysis(), fixtureAnalysis({ inputs: { priceMin: 20, priceMax: 60, manualOverrides: { "1c": { value: 5000, note: "" } } } }), entryFixture({ withXray: false }), entryFixture({ inputs: { cogs: null } }), entryFixture({ inputs: { unitsPerDay: 0 } })];
  const withAi = entryFixture(); withAi.ai = AI; withAi.patents = PATENTS; withAi.niche = "antibacterial baby teether"; withAi.results = compute(withAi); variants.push(withAi);
  const cer = fixtureAnalysis(); cer.coreKeyword = "bike tube"; delete cer.aggregates.poe; cer.inputs.clusterKeywords = cer.aggregates.cerebro.keywords.slice(0, 12).map((k) => k.phrase); cer.results = compute(cer); variants.push(cer); // трафик по Cerebro, без POE
  const sqp = fixtureAnalysis(); sqp.sources.sqp = { fileName: "sqp.csv", rows: 3 }; variants.push(sqp);
  variants.push(withConfig(entryFixture())); const band = withConfig(entryFixture()); band.inputs.priceMin = 10; band.inputs.priceMax = 40; band.results = compute(band); variants.push(band); // этап 2: конфигурация, диапазон и ТЗ
  for (const a of variants) { const el = draw(a); tips = el.__w.FBARender.tips; for (const k of tips.used) used.add(k); }
  const RARE = new Set(["Конкуренты", "Цена ниши", "SQP", "ПРОКСИ POE", "Срок"]); // показываются только в редких состояниях (нет ни одного отчёта и т. п.)
  const orphans = [...Object.keys(tips.TIPS), ...Object.keys(tips.KEY_TIPS)].filter((k) => !used.has(k) && !RARE.has(k));
  assert.deepEqual(orphans, [], "пояснения без элемента — название в интерфейсе изменилось?");
  for (const [k, v] of [...Object.entries(tips.TIPS), ...Object.entries(tips.KEY_TIPS), ...Object.entries(tips.INPUT_TIPS), ...Object.entries(tips.SIDE_TIPS)]) { assert.ok(v.length >= 20 && v.length <= 330, `${k}: ${v.length} знаков`); assert.ok(!/<\/?script/i.test(v)); }
});

test("FR-002: у каждого поля, ползунка и галочки панели есть пояснение", () => {
  const w = makeWindow(readFileSync(new URL("../public/index.html", import.meta.url), "utf8").replace(/<script[\s\S]*?<\/script>/g, ""));
  const side = w.document.querySelector(".side"); w.FBARender.annotateInputs(side);
  const controls = [...side.querySelectorAll("[data-input], [data-check], [data-field], [data-axis]")]; assert.ok(controls.length >= 40, "полей в панели: " + controls.length);
  const missing = controls.filter((c) => { const label = (c.id && side.querySelector(`label[for="${c.id}"]`)) || c.closest("label"); return !label?.getAttribute("data-tip"); }).map((c) => c.dataset.input || c.dataset.check || c.dataset.field || c.dataset.axis);
  assert.deepEqual(missing, []);
  assert.match(side.querySelector('label[for="f-cogs"]').getAttribute("data-tip"), /Себестоимость одной штуки/); assert.equal(side.querySelectorAll("label[title]").length, 0);
  assert.equal(side.querySelectorAll("details > summary [data-tip]").length, 9, "все девять разделов панели"); assert.equal(side.querySelector('label[for="f-cogs"]').hasAttribute("tabindex"), false);
});

test("FR-004/FR-005: подсказка показывается по наведению, фокусу и касанию; скрывается по Esc, уходу и перерисовке секции", async () => {
  const a = entryFixture(); const el = draw(a); const w = el.__w, doc = w.document; const box = doc.getElementById("fba-tipbox");
  assert.ok(box && box.hidden && box.getAttribute("role") === "tooltip"); assert.equal(doc.querySelectorAll(".tipbox").length, 1);
  const label = [...el.querySelectorAll("#sec-overview .tile .k [data-tip]")].find((x) => x.textContent.startsWith("Adj. SV"));
  label.dispatchEvent(new w.MouseEvent("mouseover", { bubbles: true })); assert.equal(box.hidden, true, "небольшая задержка — подсказка не мигает при проводке мышью"); await sleep(180);
  assert.equal(box.hidden, false); assert.match(box.textContent, /Скорректированный поисковый объём/); assert.equal(label.getAttribute("aria-describedby"), "fba-tipbox"); assert.match(box.style.left, /px$/);
  doc.body.dispatchEvent(new w.MouseEvent("mouseover", { bubbles: true })); assert.equal(box.hidden, true); assert.equal(label.hasAttribute("aria-describedby"), false);
  label.dispatchEvent(new w.FocusEvent("focusin", { bubbles: true })); assert.equal(box.hidden, false, "с клавиатуры — сразу"); doc.dispatchEvent(new w.KeyboardEvent("keydown", { key: "Escape", bubbles: true })); assert.equal(box.hidden, true);
  label.dispatchEvent(new w.MouseEvent("click", { bubbles: true })); assert.equal(box.hidden, false, "касание"); doc.body.dispatchEvent(new w.MouseEvent("click", { bubbles: true })); assert.equal(box.hidden, true);
  label.dispatchEvent(new w.MouseEvent("click", { bubbles: true })); w.FBARender.update(el, a, {}); assert.equal(box.hidden, true, "секция перерисована — подсказка не зависает");
  w.FBARender.render(el, a, {}); assert.equal(doc.querySelectorAll(".tipbox").length, 1, "повторный рендер не плодит подсказки");
});

test("FR-006/SC-003: в снимке публичной ссылки подсказки работают, закупочные данные не раскрываются", () => {
  const a = entryFixture({ inputs: { startupCosts: 1850 } }); const snap = buildSnapshot(a, { mode: "no_economics", preparedBy: "t" });
  const el = draw(snap.analysis, { static: true, hidden: snap.hidden, snapshot: snap });
  assert.ok(el.querySelectorAll("[data-tip]").length >= 50); assert.equal(el.querySelectorAll("#sec-cashflow [data-tip], #sec-economics [data-tip], #sec-budget [data-tip]").length, 0, "скрытые секции пусты");
  assert.deepEqual(findEconomicsLeaks(snap, a), []);
  const glossary = new Set([...Object.values(el.__w.FBARender.tips.TIPS), ...Object.values(el.__w.FBARender.tips.KEY_TIPS)]);
  const dynamic = [...el.querySelectorAll("[data-tip]")].map((x) => x.getAttribute("data-tip")).filter((t) => !glossary.has(t));
  for (const t of dynamic) assert.doesNotMatch(t, /4[.,]37|18[\s  ]?750|1[\s  ]?850/, "в бывших title нет закупочных чисел: " + t);
});
