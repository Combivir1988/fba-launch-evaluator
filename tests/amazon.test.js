// spec 012: Amazon как продавец — детекция по листингам вида, область (ниша / диапазон), режимы порога, ручной ответ, вердикт, отпечатки.
import test from "node:test";
import assert from "node:assert/strict";
import { newAnalysis } from "../shared/analysis.js";
import { compute } from "../shared/compute.js";
import { amazonPresence, isAmazonSeller, amazonBrandKind } from "../shared/amazon.js";
import { thresholdOverrides } from "../shared/thresholds.js";
import { fixtureAnalysis } from "./helpers/fixture-analysis.js";
import { resultsHash } from "./helpers/results-hash.js";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";

const asin = (i) => "B0" + String(i).padStart(8, "0");
function xrayWithAmazon() {
  const asins = Array.from({ length: 12 }, (_, i) => ({ asin: asin(i + 1), title: "t" + i, brand: "Br" + (i % 4), price: 20 + i * 10, asinRevenue: (12 - i) * 5000, asinSales: 100, reviews: 200, rating: 4.4, seller: i === 7 ? "Amazon.com" : "Seller" + i, fulfillment: i === 9 ? "Amazon" : "FBA" }));
  return { asins, flags: { rowsTotal: 12, hasAsinSales: true, duplicatesDropped: 0, amazonSells: true }, columns: {} };
}
const withXray = (over = {}) => { const a = newAnalysis({ niche: "x", coreKeyword: "x" }); a.aggregates.xray = xrayWithAmazon(); Object.assign(a.inputs, { price: 30, cogs: 5, cpc: 1 }, over.inputs || {}); a.thresholds = over.thresholds || {}; a.results = compute(a); return a; };

test("isAmazonSeller: Seller или Fulfillment = Amazon / Amazon.com", () => {
  assert.equal(isAmazonSeller({ seller: "Amazon.com" }), true); assert.equal(isAmazonSeller({ seller: "x", fulfillment: "Amazon" }), true); assert.equal(isAmazonSeller({ seller: "AmazonBasics Store" }), false); assert.equal(isAmazonSeller({}), false);
});

test("spec 016: Amazon продаёт чужие бренды с малой долей — это обычные конкуренты, не No-Go", () => {
  const a = withXray(); const R = a.results;
  assert.deepEqual(R.competition.amazonAsins, [asin(8), asin(10)]); assert.ok(R.competition.amazonRevenueShare > 0 && R.competition.amazonRevenueShare < 0.2);
  assert.equal(R.amazon.present, true); assert.equal(R.amazon.count, 2);
  assert.equal(R.amazon.level, "watch", "вендор Br3 держит ~19 % — зона внимания");
  assert.equal(R.amazon.ownBrands.length, 0); assert.ok(R.amazon.vendors.length > 0);
  assert.equal(R.amazon.blocks, false, "вендор ниже порога доминации вердикт не блокирует");
  assert.notEqual(R.verdict.decisiveGate, "Amazon в нише");
  const noAmz = newAnalysis({ niche: "x", coreKeyword: "x" }); noAmz.aggregates.xray = { ...xrayWithAmazon(), asins: xrayWithAmazon().asins.map((x, i) => ({ ...x, seller: "S" + i, fulfillment: "FBA" })) };
  Object.assign(noAmz.inputs, { price: 30, cogs: 5, cpc: 1 }); noAmz.results = compute(noAmz);
  assert.equal(R.criterion1.items["1e"].status, noAmz.results.criterion1.items["1e"].status, "1e определяется долей лидера, как и без Amazon");
  assert.match(R.criterion1.items["1e"].note, /смотрите внимательно/);
  // тот же отчёт, но Amazon продаёт самый мелкий бренд: это обычный конкурент
  const small = xrayWithAmazon(); small.asins = small.asins.map((x, i) => (i === 11 ? { ...x, brand: "TinyVendor", seller: "Amazon", fulfillment: "FBA" } : { ...x, seller: "S" + i, fulfillment: "FBA" })); // 1,3 % выручки
  const b = newAnalysis({ niche: "x", coreKeyword: "x" }); b.aggregates.xray = small; Object.assign(b.inputs, { price: 30, cogs: 5, cpc: 1 }); b.results = compute(b);
  assert.equal(b.results.amazon.level, "normal"); assert.equal(b.results.amazon.blocks, false);
  assert.match(b.results.criterion1.items["1e"].note, /\u043e\u0431\u044b\u0447\u043d\u044b\u0435 \u043a\u043e\u043d\u043a\u0443\u0440\u0435\u043d\u0442\u044b/);
});

test("spec 016: собственная марка Amazon — No-Go при любой доле", () => {
  const x = xrayWithAmazon(); x.asins[7] = { ...x.asins[7], brand: "Amazon Basics" };
  const a = newAnalysis({ niche: "x", coreKeyword: "x" }); a.aggregates.xray = x; Object.assign(a.inputs, { price: 30, cogs: 5, cpc: 1 }); a.results = compute(a);
  const R = a.results;
  assert.equal(R.amazon.level, "own"); assert.deepEqual(R.amazon.ownBrands.map((b) => b.brand), ["Amazon Basics"]);
  assert.equal(R.amazon.blocks, true); assert.equal(R.verdict.ceiling, "no_go"); assert.equal(R.verdict.decisiveGate, "Amazon в нише");
  assert.match(R.verdict.reasons[0], /собственная марка Amazon \(Amazon Basics\)/);
  assert.equal(R.criterion1.items["1e"].status, "fail");
});

test("spec 016: вендор с долей выше 60 % — No-Go; 15–60 % — «смотреть внимательно», вердикт не блокируется", () => {
  // один бренд забирает почти всю выручку, и его продаёт Amazon
  const big = (share) => { const n = 12; const asins = Array.from({ length: n }, (_, i) => ({ asin: asin(i + 1), title: "t" + i, brand: i === 0 ? "BigVendor" : "Br" + i, price: 20 + i, asinRevenue: i === 0 ? share : (1 - share) / (n - 1), asinSales: 10, reviews: 50, rating: 4.4, seller: i === 0 ? "Amazon" : "S" + i, fulfillment: "FBA" }));
    const a = newAnalysis({ niche: "x", coreKeyword: "x" }); a.aggregates.xray = { asins, flags: { rowsTotal: n, hasAsinSales: true, duplicatesDropped: 0, amazonSells: true }, columns: {} };
    Object.assign(a.inputs, { price: 30, cogs: 5, cpc: 1 }); a.results = compute(a); return a.results; };
  const dom = big(0.72);
  assert.equal(dom.amazon.level, "dominant"); assert.equal(dom.amazon.blocks, true);
  assert.equal(dom.verdict.decisiveGate, "Amazon в нише"); assert.match(dom.verdict.reasons[0], /BigVendor \u0434\u0435\u0440\u0436\u0438\u0442 7\d %/);
  const watch = big(0.2); // лидер ниже порога 25 %, поэтому видно именно влияние Amazon
  assert.equal(watch.amazon.level, "watch"); assert.equal(watch.amazon.blocks, false);
  assert.notEqual(watch.verdict.decisiveGate, "Amazon в нише");
  assert.equal(watch.criterion1.items["1e"].status, "warn", "в зоне внимания 1e пограничный");
  assert.match(watch.criterion1.items["1e"].note, /\u0441\u043c\u043e\u0442\u0440\u0438\u0442\u0435 \u0432\u043d\u0438\u043c\u0430\u0442\u0435\u043b\u044c\u043d\u043e/);
});

test("spec 016: отгрузка AMZ — это тоже «продаёт Amazon», а FBA и MFN — нет", () => {
  assert.equal(isAmazonSeller({ fulfillment: "AMZ" }), true);
  assert.equal(isAmazonSeller({ seller: "", fulfillment: "AMZ" }), true);
  assert.equal(isAmazonSeller({ seller: "Acme Store", fulfillment: "FBA" }), false);
  assert.equal(isAmazonSeller({ seller: "Acme Store", fulfillment: "MFN" }), false);
  assert.equal(amazonBrandKind("AmazonBasics"), "own"); assert.equal(amazonBrandKind("Amazon Essentials"), "own");
  assert.equal(amazonBrandKind("Solimo"), "own"); assert.equal(amazonBrandKind("Yankee Candle"), "vendor"); assert.equal(amazonBrandKind(""), "vendor");
});

test("режим «учитывать в общей картине»: вердикт не блокируется даже собственной маркой Amazon", () => {
  const x = xrayWithAmazon(); x.asins[7] = { ...x.asins[7], brand: "Amazon Basics" };
  const a = newAnalysis({ niche: "x", coreKeyword: "x" }); a.aggregates.xray = x; a.thresholds = { amazon: { mode: "consider" } };
  Object.assign(a.inputs, { price: 30, cogs: 5, cpc: 1 }); a.results = compute(a);
  const R = a.results;
  assert.equal(R.amazon.level, "own"); assert.equal(R.amazon.blocks, false);
  assert.notEqual(R.verdict.decisiveGate, "Amazon в нише"); assert.equal(R.competition.amazonSells, true);
  assert.equal(R.criterion1.items["1e"].status, "fail", "в 1e своя марка Amazon остаётся НЕ OK");
});

test("область «мой ценовой диапазон»: вне коридора Amazon не виден, внутри доля вендоров выше; без диапазона — вся ниша с пометкой", () => {
  const out = withXray({ thresholds: { amazon: { scope: "band" } }, inputs: { priceMin: 20, priceMax: 60 } }); // Amazon: цены 90 и 110
  assert.equal(out.results.amazon.scope, "band"); assert.equal(out.results.amazon.present, false); assert.equal(out.results.amazon.presentNiche, true); assert.equal(out.results.amazon.blocks, false); assert.equal(out.results.competition.amazonSells, false, "1e в диапазоне без Amazon");
  const inn = withXray({ thresholds: { amazon: { scope: "band" } }, inputs: { priceMin: 80, priceMax: 120 } }); assert.equal(inn.results.amazon.present, true); assert.match(inn.results.amazon.scopeLabel, /в ценовом диапазоне \$80–\$120/);
  assert.equal(inn.results.amazon.level, "watch", "в узком коридоре доля вендоров выше: 25 % против 19 % по всей нише"); assert.equal(inn.results.amazon.blocks, false);
  const nob = withXray({ thresholds: { amazon: { scope: "band" } } }); assert.equal(nob.results.amazon.scope, "niche"); assert.match(nob.results.amazon.note, /диапазон не задан/); assert.equal(nob.results.amazon.blocks, false, "по всей нише вендоры не доминируют");
});

test("ручной ответ чеклиста главнее автоопределения", () => {
  const no = withXray({ inputs: { checklist: { amazonSells: "no" } } }); assert.equal(no.results.amazon.present, false); assert.equal(no.results.amazon.blocks, false); assert.equal(no.results.amazon.source, "user");
  const a = newAnalysis({ niche: "y" }); a.aggregates.xray = { ...xrayWithAmazon(), asins: xrayWithAmazon().asins.map((x) => ({ ...x, seller: "s", fulfillment: "FBA" })) }; a.inputs.checklist.amazonSells = "yes"; a.results = compute(a);
  assert.equal(a.results.amazon.present, true); assert.equal(a.results.amazon.count, 0); assert.equal(a.results.verdict.ceiling, "no_go"); assert.match(a.results.verdict.reasons[0], /Amazon продаёт сам \(по всей нише\)/);
});

test("amazonPresence: без Xray — не найден; пороги-строки проходят в наборы", () => {
  const p = amazonPresence({ whole: { amazonSells: false, amazonAsins: [] }, th: {} }); assert.equal(p.present, false); assert.equal(p.blocks, false); assert.equal(p.mode, "block");
  assert.deepEqual(thresholdOverrides({ amazon: { mode: "consider", scope: "niche", junk: "x" } }), { amazon: { mode: "consider" } });
});

test("отпечатки прежних расчётов не меняются (вердикт в отпечаток не входит; в фикстуре Amazon есть — и это блокирует)", () => {
  const a = fixtureAnalysis(); assert.equal(typeof a.results.amazon.present, "boolean"); assert.equal(resultsHash(a.results), "e510013b00b3961d");
  if (a.results.amazon.present) { assert.ok(["own", "dominant", "watch", "normal"].includes(a.results.amazon.level)); assert.ok(a.results.competition.amazonAsins.length > 0);
    if (a.results.amazon.blocks) assert.equal(a.results.verdict.decisiveGate, "Amazon в нише"); }
});

function draw(a) {
  const dom = new JSDOM(`<!doctype html><html><body><div id="d"></div></body></html>`, { pretendToBeVisual: true, runScripts: "outside-only" });
  const w = dom.window; w.matchMedia = () => ({ matches: false }); w.HTMLCanvasElement.prototype.getContext = () => ({});
  class Chart { constructor() {} destroy() {} } Chart.defaults = { color: "", borderColor: "", font: {}, plugins: { legend: { labels: {} } } }; w.Chart = Chart;
  w.eval(readFileSync(new URL("../public/js/render.js", import.meta.url), "utf8"));
  const el = w.document.getElementById("d"); w.FBARender.render(el, a, {}); return el;
}

test("карточки листингов Amazon: что именно он продаёт, со ссылками и долей выручки", () => {
  const R = withXray().results;
  const L = R.competition.amazonListings;
  assert.equal(L.length, 2);
  assert.deepEqual(L.map((l) => l.asin), [asin(8), asin(10)], "по убыванию выручки");
  assert.deepEqual(L.map((l) => l.by), ["seller", "fulfillment"], "видно, продавец это или отгрузка");
  assert.equal(L[0].brand, "Br3"); assert.equal(L[0].price, 90); assert.ok(L[0].share > 0 && L[0].share < 0.1);
  assert.deepEqual(R.amazon.listings, L, "в amazon.listings те же карточки, что в competition");
});

test("блок в «Конкурентной карте»: ссылки на листинги Amazon, признак и режим порога", () => {
  const el = draw(withXray()); const sec = el.querySelector("#sec-competitors"); const t = sec.textContent.replace(/\s+/g, " ");
  assert.match(t, /Amazon продаёт сам по всей нише/); assert.match(t, /смотрите внимательно/);
  assert.match(t, /чужие бренды \(вендоры\)/); assert.match(t, /Доля ниши/); assert.match(t, /Тренд/);
  assert.match(t, /тренд не посчитан/, "без POE так и написано");
  const links = [...sec.querySelectorAll("a[href*='/dp/']")].map((a) => a.getAttribute("href"));
  for (const id of [asin(8), asin(10)]) assert.ok(links.some((h) => h.endsWith("/dp/" + id)), "ссылка на " + id);
  assert.match(t, /продавец/); assert.match(t, /отгрузка/);
  const own = xrayWithAmazon(); own.asins[7] = { ...own.asins[7], brand: "Amazon Basics" };
  const oa = newAnalysis({ niche: "x", coreKeyword: "x" }); oa.aggregates.xray = own; Object.assign(oa.inputs, { price: 30, cogs: 5, cpc: 1 }); oa.results = compute(oa);
  const ot = draw(oa).querySelector("#sec-competitors").textContent.replace(/\s+/g, " ");
  assert.match(ot, /собственная марка Amazon/); assert.match(ot, /решающий гейт: вердикт No-Go/);
  const manual = newAnalysis({ niche: "x", coreKeyword: "x" }); // Amazon в отчёте нет, но менеджер отметил его в чеклисте
  const clean2 = xrayWithAmazon(); clean2.asins = clean2.asins.map((a) => ({ ...a, seller: "Seller", fulfillment: "FBA" }));
  manual.aggregates.xray = clean2; Object.assign(manual.inputs, { price: 30, cogs: 5, cpc: 1, checklist: { amazonSells: "yes" } }); manual.results = compute(manual);
  assert.match(draw(manual).querySelector("#sec-competitors").textContent.replace(/\s+/g, " "), /Отмечено вручную в чеклисте/, "без листингов блок честно говорит, откуда факт");
  const clean = fixtureAnalysis(); assert.ok(!clean.results.amazon.present || draw(clean).querySelector("#sec-competitors").textContent.includes("Amazon"));
});
