import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeVerdict } from "../shared/verdict-normalize.js";
import { validateVerdict } from "../shared/validate-verdict.js";
import { VERDICT_SCHEMA } from "../server/claude.js";

const payload = {
  rulesVerdict: { ceiling: "no_go", decisiveGate: "Стоп-вопросы", reasons: ["Один из четырёх стоп-вопросов — «нет»"] },
  criterion1: { okCount: 4, redItems: ["1b", "1e", "1g"] },
  gateStatuses: { gate0: { status: "pass", fact: "Xray + Cerebro" }, gate1: { status: "rework", fact: "маржа 37 %" }, gate2: { status: "pass", fact: "net $8.20" }, gate3: { status: "fail", fact: "4/8" }, gate4: { status: "insufficient_data", fact: "патенты не проверены" }, criterion1: { status: "fail", fact: "4 из 8" }, traffic: { status: "pass", fact: "Adj. SV 12000" }, budget: { status: "fail", fact: "дефицит $2300" }, scorecard: { status: "pass", fact: "61 %" } },
};

test("normalizeVerdict: ответ слабой модели (как у nvidia) без summary/decisiveGate и без поля gate → валиден по схеме", () => {
  const weak = { verdict: "no_go", gates: [
    { status: "pass", reasoning: "Gate0: данные полные (Xray+Cerebro), нет пропусков." },
    { status: "rework", reasoning: "Gate1: маржа 37.2%, net $11.12/юнит…" },
    { status: "pass", reasoning: "Gate2: при CVR 12% net after ads $8.20 >0" },
    { status: "fail", reasoning: "Gate3: Критерий1 4/8" },
    { status: "insufficient_data", reasoning: "Gate4: патентный/FTO риск не оценён" } ],
    nextSteps: ["Поднять цену до ≥$30", "Снизить COGS", "Увеличить бюджет до $12,300 и провести патентный поиск"] };
  const n = normalizeVerdict(weak, payload);
  const v = validateVerdict(n, VERDICT_SCHEMA);
  assert.ok(v.ok, v.errors.join("; "));
  assert.equal(n.gates.find((g) => g.gate === "gate1").status, "rework");
  assert.equal(n.gates.length, 9, "недостающие гейты (traffic/budget/scorecard/criterion1) добраны из gateStatuses");
  assert.equal(n.gates.find((g) => g.gate === "budget").reasoning, "дефицит $2300");
  assert.match(n.decisiveGate, /Стоп-вопросы/);
  assert.match(n.criterion1Summary, /4 из 8/);
  assert.ok(n.summary.length > 10);
  assert.deepEqual(n.differentiation, []); assert.deepEqual(n.recommendations, []); assert.deepEqual(n.risks, []);
});

test("normalizeVerdict: словарь gates, русские статусы, строки вместо объектов, лишние поля", () => {
  const raw = { verdict: "Доработка", gates: { gate1: { status: "OK", reasoning: "ok" }, traffic: "трафика хватает" }, recommendations: ["сделать A", { priority: "высокий", title: "B", text: "делать B" }], differentiation: ["гипотеза"], risks: [{ text: "риск" }], nextSteps: "один шаг", extra: 1 };
  const n = normalizeVerdict(raw, payload);
  assert.ok(validateVerdict(n, VERDICT_SCHEMA).ok);
  assert.equal(n.verdict, "rework");
  assert.equal(n.gates.find((g) => g.gate === "gate1").status, "pass");
  assert.equal(n.gates.find((g) => g.gate === "traffic").reasoning, "трафика хватает");
  assert.equal(n.recommendations[1].priority, "high");
  assert.equal(n.differentiation[0].hypothesis, "гипотеза");
  assert.deepEqual(n.nextSteps, ["один шаг"]);
  assert.equal("extra" in n, false);
});

test("normalizeVerdict: правильный ответ не портится", () => {
  const good = { verdict: "go", decisiveGate: "все гейты пройдены", summary: "S", criterion1Summary: "C", gates: [{ gate: "gate1", status: "pass", reasoning: "r" }], differentiation: [{ hypothesis: "h", evidence: "e", specRequirement: "s" }], recommendations: [{ priority: "low", title: "t", text: "x" }], risks: ["r"], pricingPackComment: "p", nextSteps: ["a", "b"] };
  const n = normalizeVerdict(good, payload);
  assert.equal(n.summary, "S"); assert.equal(n.gates.find((g) => g.gate === "gate1").reasoning, "r"); assert.deepEqual(n.nextSteps, ["a", "b"]);
});
