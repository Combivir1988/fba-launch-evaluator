// Нормализация ответа модели под схему AIVerdict: слабые модели теряют поля/структуру.
// Всё, что можно вывести детерминированно (статусы гейтов, решающий гейт, сводка Критерия 1), берём из payload.
const GATE_KEYS = ["gate0", "gate1", "gate2", "gate3", "gate4", "criterion1", "traffic", "budget", "scorecard"];
const GATE_ALIASES = [[/gate\s*0|данн/i, "gate0"], [/gate\s*1|эконом/i, "gate1"], [/gate\s*2|реклам/i, "gate2"], [/gate\s*3|конкурен/i, "gate3"], [/gate\s*4|патент|fto/i, "gate4"], [/критерий\s*1|criterion\s*1/i, "criterion1"], [/трафик|traffic/i, "traffic"], [/бюджет|budget/i, "budget"], [/scorecard|скоркард/i, "scorecard"]];
const STATUS_MAP = { pass: "pass", ok: "pass", passed: "pass", rework: "rework", warn: "rework", warning: "rework", partial: "rework", fail: "fail", failed: "fail", no_go: "fail", "not_ok": "fail", insufficient_data: "insufficient_data", na: "insufficient_data", unknown: "insufficient_data", none: "insufficient_data", not_applicable: "not_applicable", n_a: "not_applicable" };
const VERDICTS = { go: "go", go_conditional: "go_conditional", "go условно": "go_conditional", conditional: "go_conditional", rework: "rework", доработка: "rework", no_go: "no_go", nogo: "no_go", "no-go": "no_go" };
const str = (v, d = "") => (typeof v === "string" ? v : v == null ? d : typeof v === "object" ? JSON.stringify(v) : String(v));
const arr = (v) => (Array.isArray(v) ? v : v == null ? [] : [v]);

export function normalizeVerdict(raw, payload = {}) {
  if (!raw || typeof raw !== "object") return raw;
  const o = { ...raw };
  const gs = payload.gateStatuses || {};
  const rv = payload.rulesVerdict || {};
  // verdict
  const v = String(o.verdict ?? "").toLowerCase().trim().replace(/\s+/g, "_");
  o.verdict = VERDICTS[v] || VERDICTS[v.replace(/_/g, " ")] || (["go", "go_conditional", "rework", "no_go"].includes(rv.ceiling) ? rv.ceiling : "rework");
  // gates: массив объектов с gate/status/reasoning; допускаем объект-словарь и отсутствующие gate
  let gates = Array.isArray(o.gates) ? o.gates : o.gates && typeof o.gates === "object" ? Object.entries(o.gates).map(([gate, g]) => (typeof g === "object" ? { gate, ...g } : { gate, reasoning: str(g) })) : [];
  gates = gates.map((g, i) => {
    if (!g || typeof g !== "object") g = { reasoning: str(g) };
    let gate = str(g.gate || g.name || g.id).toLowerCase().replace(/[\s-]+/g, "");
    if (!GATE_KEYS.includes(gate)) { const text = str(g.gate) + " " + str(g.name) + " " + str(g.reasoning); gate = (GATE_ALIASES.find(([re]) => re.test(text)) || [])[1] || GATE_KEYS[i] || "gate0"; }
    const st = STATUS_MAP[String(g.status ?? "").toLowerCase().replace(/[\s-]+/g, "_")] || gs[gate]?.status || "insufficient_data";
    return { gate, status: st, reasoning: str(g.reasoning || g.reason || g.text || g.comment, gs[gate]?.fact || "") };
  });
  const seen = new Set(); gates = gates.filter((g) => (seen.has(g.gate) ? false : (seen.add(g.gate), true)));
  for (const k of GATE_KEYS) if (!seen.has(k) && gs[k]) gates.push({ gate: k, status: gs[k].status, reasoning: gs[k].fact || "" });
  o.gates = gates;
  // строки
  o.decisiveGate = str(o.decisiveGate || o.decisive || o.decisive_gate, rv.decisiveGate ? `${rv.decisiveGate}: ${(rv.reasons || [])[0] || ""}`.trim() : "");
  o.summary = str(o.summary || o.conclusion || o.overview, gates.filter((g) => g.status === "fail").map((g) => g.reasoning).join(" ") || `Вердикт: ${o.verdict}.`);
  const c1 = payload.criterion1;
  o.criterion1Summary = str(o.criterion1Summary || o.criterion1 || o.criterion1_summary, c1 ? `Критерий 1: ${c1.okCount} из 8${c1.redItems?.length ? ", красные: " + c1.redItems.join(", ") : ""}` : (gs.criterion1?.fact || ""));
  o.pricingPackComment = str(o.pricingPackComment || o.pricing || o.pricingComment, "—");
  // массивы
  o.differentiation = arr(o.differentiation).map((d) => (typeof d === "string" ? { hypothesis: d, evidence: "", specRequirement: "" } : { hypothesis: str(d?.hypothesis || d?.title), evidence: str(d?.evidence), specRequirement: str(d?.specRequirement || d?.spec || d?.requirement) })).filter((d) => d.hypothesis);
  o.recommendations = arr(o.recommendations).map((r) => (typeof r === "string" ? { priority: "med", title: r.slice(0, 80), text: r } : { priority: ["high", "med", "low"].includes(String(r?.priority).toLowerCase()) ? String(r.priority).toLowerCase() : /высок|high/i.test(str(r?.priority)) ? "high" : /низк|low/i.test(str(r?.priority)) ? "low" : "med", title: str(r?.title || r?.name, str(r?.text).slice(0, 80)), text: str(r?.text || r?.description || r?.title) })).filter((r) => r.text);
  o.risks = arr(o.risks).map((r) => str(typeof r === "object" ? r?.text || r?.title || r : r)).filter(Boolean);
  o.nextSteps = arr(o.nextSteps || o.next_steps || o.steps).map((s) => str(typeof s === "object" ? s?.text || s?.title || s : s)).filter(Boolean).slice(0, 3);
  if (!o.nextSteps.length) o.nextSteps = ["Закрыть решающий гейт: " + (o.decisiveGate || "см. правила")];
  // лишние поля убираем (additionalProperties: false)
  const allowed = ["verdict", "decisiveGate", "summary", "criterion1Summary", "gates", "differentiation", "recommendations", "risks", "pricingPackComment", "nextSteps"];
  for (const k of Object.keys(o)) if (!allowed.includes(k)) delete o[k];
  return o;
}
