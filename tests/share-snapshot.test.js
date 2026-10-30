import { test } from "node:test";
import assert from "node:assert/strict";
import { fixtureAnalysis } from "./helpers/fixture-analysis.js";
import { buildSnapshot, findEconomicsLeaks, findStage3Leaks, stripStage3, collectEconomicsValues, valuePatterns, HIDDEN_NOTE } from "../shared/share-snapshot.js";
import { buildAiPayload } from "../shared/ai-payload.js";
import { mockVerdict } from "../server/mock-verdict.js";

/** Анализ с AI-блоком, в тексте которого закупочные числа встречаются во всех привычных написаниях. */
function analysisWithAi() {
  const a = fixtureAnalysis();
  const e = a.results.economics, b = a.results.budget;
  const ai = mockVerdict(buildAiPayload(a));
  const pct = (v) => Math.round(v * 100);
  ai.summary += ` Ниша интересна по спросу. При COGS $${a.inputs.cogs} маржа ${pct(e.gate1.margin0)} % выглядит рабочей. Лидер держит рейтинг 4.6 и 2 310 отзывов.`;
  ai.recommendations.push({ priority: "high", title: "Проверить бюджет", text: `Две партии потребуют ${Math.round(b.need).toLocaleString("ru-RU")} $ при бюджете ${b.budget}. Усилить главное фото.` });
  ai.recommendations.push({ priority: "med", title: "Упаковка", text: `Сделать набор из 10 штук. Чистыми выходит ${e.gate1.net0.toFixed(2).replace(".", ",")} на единицу; это обсуждается отдельно.` });
  ai.risks.push(`ROI ${pct(e.roi ?? e.gate1.roi)}% держится только при текущей ставке`, "Сезонная просадка спроса зимой");
  ai.nextSteps.push("Запросить образцы у трёх поставщиков");
  a.ai = { ...ai, model: "mock", createdAt: "2026-09-19T10:00:00.000Z" };
  return a;
}

test("полный режим: без сырых ключей Cerebro и внутреннего id, остальное как в документе; размер ≤ 250 KB", () => {
  const a = analysisWithAi();
  const s = buildSnapshot(a, { mode: "full", preparedBy: "Анна Коваль", snapshotAt: "2026-09-19T12:00:00.000Z" });
  assert.equal(s.type, "fba-launch-evaluator/share"); assert.equal(s.mode, "full"); assert.equal(s.preparedBy, "Анна Коваль"); assert.deepEqual(s.hidden, []); assert.equal(s.redactions, 0);
  assert.equal(s.analysis.aggregates.cerebro.keywords, undefined); assert.equal(s.analysis.aggregates.cerebro.keywordCount, a.aggregates.cerebro.keywords.length);
  assert.notEqual(s.analysis.id, a.id);
  { const want = JSON.parse(JSON.stringify(a.results)); delete want.stage3; // этап 3 наружу не отдаётся (spec 017)
    assert.deepEqual(s.analysis.results, want); assert.equal(s.analysis.results.stage3, undefined); } assert.deepEqual(s.analysis.inputs, JSON.parse(JSON.stringify(a.inputs))); assert.deepEqual(s.analysis.ai, JSON.parse(JSON.stringify(a.ai)));
  assert.ok(s.analysis.aggregates.poe && s.analysis.aggregates.xray.asins.length > 50);
  const kb = JSON.stringify(s).length / 1024; assert.ok(kb < 250, `снимок ${kb.toFixed(0)} KB`);
  assert.ok(a.aggregates.cerebro.keywords.length > 1000, "исходный анализ не изменён");
});

test("no_economics: закупочные данные удалены из входов и результатов", () => {
  const a = analysisWithAi();
  const s = buildSnapshot(a, { mode: "no_economics", preparedBy: "Анна" });
  assert.deepEqual(s.hidden, ["economics", "budget", "cashflow"]); assert.ok(s.redactions > 0);
  const A = s.analysis;
  for (const k of ["cogs", "shippingPerUnit", "fbaFee", "referralPct", "budget", "adsReserve", "cvr", "ppcShare", "unitsPerDay", "manualOverrides"]) assert.equal(k in A.inputs, false, "inputs." + k);
  assert.equal(A.inputs.price, a.inputs.price, "цена — рыночная величина, остаётся");
  assert.equal(A.results.economics, undefined); assert.equal(A.results.budget, undefined);
  assert.deepEqual(Object.keys(A.results.effective).sort(), ["cpc", "cpcFromCerebro", "cpcSource", "price", "priceFromMedian"]);
  assert.equal(A.results.scorecard.axes.economics.note, HIDDEN_NOTE); assert.equal(typeof A.results.scorecard.axes.economics.score, "number");
  assert.equal(A.results.challenger.items["2"].note, HIDDEN_NOTE); assert.equal(A.results.challenger.items["6"].note, HIDDEN_NOTE);
  assert.equal(A.results.challenger.items["6"].status, a.results.challenger.items["6"].status, "статус критерия остаётся");
  assert.equal(A.results.verdict.ceiling, a.results.verdict.ceiling); assert.ok(A.results.criterion1 && A.results.competition && A.results.traffic);
  assert.equal(a.inputs.cogs, 4.37, "исходный анализ не изменён"); assert.ok(a.results.economics);
});

test("no_economics: тексты AI чистятся по предложениям — экономика уходит, остальное остаётся", () => {
  const a = analysisWithAi();
  const ai = buildSnapshot(a, { mode: "no_economics" }).analysis.ai;
  assert.equal(ai.verdict, a.ai.verdict);
  assert.match(ai.summary, /Ниша интересна по спросу/); assert.match(ai.summary, /рейтинг 4\.6 и 2 310 отзывов/); assert.doesNotMatch(ai.summary, /COGS|марж/i);
  for (const g of ai.gates) if (/gate1|gate2/.test(g.gate)) assert.equal(g.reasoning, HIDDEN_NOTE); else assert.notEqual(g.reasoning, HIDDEN_NOTE);
  assert.deepEqual(ai.gates.map((g) => g.status), a.ai.gates.map((g) => g.status), "статусы гейтов не меняются");
  const budgetRec = ai.recommendations.find((r) => r.title === "Проверить бюджет" || r.title === HIDDEN_NOTE);
  assert.match(budgetRec.text, /Усилить главное фото/); assert.doesNotMatch(budgetRec.text, /парти|бюджет/i);
  const pack = ai.recommendations.find((r) => r.title === "Упаковка"); assert.match(pack.text, /набор из 10 штук/); assert.doesNotMatch(pack.text, /Чистыми/);
  assert.ok(ai.risks.includes("Сезонная просадка спроса зимой")); assert.ok(!ai.risks.some((r) => /ROI/i.test(r)));
  assert.ok(ai.nextSteps.includes("Запросить образцы у трёх поставщиков"));
});

test("SC-006: ни одно закупочное значение не встречается в снимке ни в каком написании", () => {
  const a = analysisWithAi();
  const full = buildSnapshot(a, { mode: "full" }); const red = buildSnapshot(a, { mode: "no_economics" });
  assert.ok(findEconomicsLeaks(full, a).length > 5, "в полном режиме значения есть — проверка не слепая");
  assert.deepEqual(findEconomicsLeaks(red, a), []);
  const { aggregates, ...rest } = red.analysis; const text = JSON.stringify(rest);
  const e = a.results.economics, b = a.results.budget;
  for (const needle of ["4.37", "4,37", "5.41", "1.13", "18750", "18 750", String(Math.round(b.need)), e.gate1.net0.toFixed(2), e.gate1.net0.toFixed(2).replace(".", ","), String(e.gate1.margin0), String(e.roi ?? e.gate1.roi)])
    assert.equal(text.includes(needle), false, `в снимке осталось «${needle}»`);
  assert.doesNotMatch(text, /"cogs"|"budget":\s*\d|"margin0"|"net0"|"batchCost"/);
});

test("valuePatterns: форматы чисел и отсутствие ложных срабатываний на рыночные числа", () => {
  const re = valuePatterns({ money: [4.37, 18750, 12], ratio: [0.4312] });
  for (const hit of ["COGS 4.37", "4,37 $", "бюджет 18750", "18 750 $", "18,750.00", "18 750", "$12 за штуку", "12 $", "маржа 43 %", "43%", "43.1 %", "43,12 %", "0.4312"]) assert.ok(re.test(hit), hit);
  for (const miss of ["рейтинг 4.6", "24.37", "4.375", "118750", "12 ключей", "в 2012 году", "SV 143 000", "доля 0.5"]) assert.equal(re.test(miss), false, miss);
  assert.equal(valuePatterns({ money: [], ratio: [] }), null);
  const v = collectEconomicsValues(fixtureAnalysis()); assert.ok(v.money.includes(4.37) && v.money.includes(18750) && v.ratio.length >= 2);
});

test("анализ без AI, патентов и экономики; ошибки входа", () => {
  const a = fixtureAnalysis({ inputs: { cogs: null, budget: null } });
  const s = buildSnapshot(a, { mode: "no_economics" });
  assert.equal(s.analysis.ai, null); assert.equal(s.analysis.patents, null); assert.deepEqual(findEconomicsLeaks(s, a), []);
  assert.throws(() => buildSnapshot({}, {}), /нечем делиться/); assert.throws(() => buildSnapshot(a, { mode: "secret" }), /режим/);
});

test("spec 017: этап 3 не уходит в снимок — ни документ листинга, ни расчёт, ни ключи", () => {
  const a = analysisWithAi();
  a.listing = { draft: { title: "Stainless Steel Dog Bowl Set for Large Breeds", highlights: "Dishwasher safe, non-slip base",
    bullets: ["Holds 32 ounces of water without spilling"], description: "Secret internal description", backendTerms: "puppy feeder gift" }, editedAt: "2026-10-27T10:00:00.000Z", model: "mock" };
  const R = a.results.stage3;
  assert.ok(R && R.keywords.items.length > 0, "в самом анализе этап 3 посчитан");

  for (const mode of ["full", "no_economics"]) {
    const s = buildSnapshot(a, { mode, preparedBy: "Анна" });
    assert.equal(s.analysis.listing, undefined, mode + ": документа листинга нет");
    assert.equal(s.analysis.results.stage3, undefined, mode + ": расчёта этапа 3 нет");
    assert.deepEqual(findStage3Leaks(s, a), [], mode + ": ловушка молчит");
    const text = JSON.stringify(s);
    assert.equal(text.includes("Secret internal description"), false, mode + ": текста карточки в файле снимка нет");
    assert.equal(text.includes("Stainless Steel Dog Bowl Set"), false, mode + ": тайтла в файле снимка нет");
  }
  assert.ok(a.listing && a.results.stage3, "исходный анализ не изменён");

  // Автономный HTML кладёт в файл ВЕСЬ документ анализа — там этап 3 тоже должен быть вырезан, а не спрятан вкладкой.
  const forHtml = stripStage3(JSON.parse(JSON.stringify(a)));
  assert.equal(forHtml.listing, undefined);
  assert.equal(forHtml.results.stage3, undefined);
  assert.equal(JSON.stringify(forHtml).includes("Secret internal description"), false);
  assert.ok(a.listing.draft.description === "Secret internal description", "исходный документ не тронут");
});

test("ловушка этапа 3 ловит утечку, если её когда-нибудь сломают", () => {
  const a = analysisWithAi();
  a.listing = { draft: { title: "Stainless Steel Dog Bowl Set for Large Breeds", bullets: [], description: "", highlights: "", backendTerms: "" } };
  a.results = a.results; // расчёт уже содержит stage3
  const bad = buildSnapshot(a, { mode: "full", preparedBy: "Анна" });
  bad.analysis.listing = JSON.parse(JSON.stringify(a.listing)); // имитируем регресс
  bad.analysis.results.stage3 = JSON.parse(JSON.stringify(a.results.stage3));
  const leaks = findStage3Leaks(bad, a);
  assert.ok(leaks.includes("analysis.listing") && leaks.includes("results.stage3"), JSON.stringify(leaks));
  assert.ok(leaks.some((x) => x.startsWith("listing.title")), "текст карточки тоже назван");
});

test("no_economics: потолок себестоимости и реклама на единицу — тоже закупочная экономика, в ссылку не идут", async () => {
  const { entryFixture } = await import("./helpers/entry-fixture.js");
  const { withConfig } = await import("./helpers/config-fixture.js");
  const { compute } = await import("../shared/compute.js");
  const a = withConfig(entryFixture());
  a.inputs = { ...a.inputs, cogs: 4.37, shippingPerUnit: 1.13, fbaFee: 5.41, cpc: 0.9, referralPct: 0.15 };
  a.results = compute(a);
  assert.ok(a.results.priceConfig.cogsCeiling > 0 && a.results.priceConfig.adCostPerUnit > 0, "в приложении потолок считается");

  const full = buildSnapshot(a, { mode: "full" }).analysis.results.priceConfig;
  assert.ok(full.cogsCeiling > 0, "полная ссылка показывает всё, как в приложении");

  const red = buildSnapshot(a, { mode: "no_economics" }).analysis.results.priceConfig;
  // по потолку читатель узнал бы, сколько автор может платить за товар — это ровно то, что режим прячет
  for (const k of ["cogsCeiling", "cogsCeilingParts", "adCostPerUnit", "marginMin", "cogsCeilingMissing"]) assert.equal(k in red, false, "priceConfig." + k);
  assert.equal(red.economicsHidden, true, "интерфейс объясняет пропуск, а не рисует пустоту");
  assert.equal(red.market, full.market, "рыночная цена аналогов — не закупочная экономика, остаётся");
  assert.equal(red.entry, full.entry); assert.equal(red.ceiling, full.ceiling);
});
