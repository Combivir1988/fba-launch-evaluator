import { test } from "node:test";
import assert from "node:assert/strict";
import { verdictCeiling, reconcile, gateStatuses } from "../shared/verdict-rules.js";

const okC1 = { pass: true, okCount: 7, passCount: 6 };
const eco = (g1, g2) => ({ pending: false, gate1: { status: g1 }, gate2: { status: g2 } });
const ch = (o = {}) => ({ active: false, pass: null, pending: false, gate4Discussed: true, items: { 6: { status: "ok" }, 8: { status: "ok" } }, ...o });
const base = { gate0: { level: "full" }, criterion1: okC1, economics: eco("pass", "pass"), challenger: ch(), budget: { quickScreenStatus: "ok" }, scorecard: { band: "go" } };

test("Все гейты пройдены → Go", () => {
  const v = verdictCeiling(base);
  assert.equal(v.ceiling, "go");
});

test("Gate 2 провален → No-Go, решающий Gate 2", () => {
  const v = verdictCeiling({ ...base, economics: eco("pass", "no_go") });
  assert.equal(v.ceiling, "no_go");
  assert.equal(v.decisiveGate, "Gate 2");
});

test("Критерий 1 ниже порога → максимум Доработка", () => {
  const v = verdictCeiling({ ...base, criterion1: { pass: false, okCount: 5, passCount: 6 } });
  assert.equal(v.ceiling, "rework");
});

test("Gate 1 ДОРАБОТКА → максимум Go условно; Gate 4 не обсуждён → Go условно", () => {
  assert.equal(verdictCeiling({ ...base, economics: eco("rework", "pass") }).ceiling, "go_conditional");
  assert.equal(verdictCeiling({ ...base, challenger: ch({ gate4Discussed: false, items: { 6: { status: "ok" }, 8: { status: "na" } } }) }).ceiling, "go_conditional");
});

test("Критерий 8 красный → No-Go даже при зелёной экономике", () => {
  const v = verdictCeiling({ ...base, challenger: ch({ active: true, pass: false, items: { 6: { status: "ok" }, 8: { status: "fail" } } }) });
  assert.equal(v.ceiling, "no_go");
  assert.equal(v.decisiveGate, "Критерий 8");
});

test("Без COGS → не выше Доработки; только POE → Доработка", () => {
  assert.equal(verdictCeiling({ ...base, economics: { pending: true } }).ceiling, "rework");
  assert.equal(verdictCeiling({ ...base, gate0: { level: "poe_only" } }).ceiling, "rework");
});

test("reconcile: AI-вердикт выше потолка понижается с флагом", () => {
  const ceil = verdictCeiling({ ...base, economics: eco("pass", "no_go") });
  const r = reconcile({ verdict: "go", summary: "x" }, ceil);
  assert.equal(r.verdict, "no_go");
  assert.equal(r.adjustedByRules, true);
  assert.equal(r.aiVerdictRaw, "go");
  const r2 = reconcile({ verdict: "rework" }, verdictCeiling(base));
  assert.equal(r2.adjustedByRules, false, "AI строже правил — не трогаем");
});


test("gateStatuses детерминированы; reconcile перетирает статусы AI, сохраняя reasoning", () => {
  const results = { ...base, traffic: { source: "cerebro", status: "ok", adjSv: 5000, top2Share: 0.5, relevantCount: 40, groups: 4 }, budget: { status: "unknown", need: 12300, budget: null, quickScreenStatus: "incomplete" },
    challenger: ch({ items: { 6: { status: "ok" }, 8: { status: "warn", kind: "assumed", note: "AI-скан" } } }), scorecard: { band: "go", total: 61, weakest: "economics" } };
  const g = gateStatuses(results);
  assert.equal(g.traffic.status, "pass");
  assert.equal(g.budget.status, "insufficient_data", "бюджет не указан — единственный честный «нет данных»");
  assert.match(g.budget.fact, /бюджет не указан/);
  assert.equal(g.gate4.status, "rework", "AI-скан = допущение → доработка, не «нет данных»");
  assert.equal(g.scorecard.status, "pass");
  const ai = { verdict: "go", gates: [{ gate: "traffic", status: "insufficient_data", reasoning: "Нет данных по группам" }, { gate: "gate4", status: "insufficient_data", reasoning: "только скан" }] };
  const r = reconcile(ai, verdictCeiling(results), results);
  const tr = r.gates.find((x) => x.gate === "traffic");
  assert.equal(tr.status, "pass"); assert.match(tr.reasoning, /Нет данных по группам/); assert.match(tr.reasoning, /исправлен правилами/);
  assert.equal(r.gates.find((x) => x.gate === "budget").status, "insufficient_data");
  assert.equal(r.gates.length, 9, "все 9 гейтов присутствуют даже если AI их не вернул");
});
