// Детерминированный «потолок» вердикта по гейтам и согласование с AI-вердиктом (FR-015).
export const RANK = { go: 3, go_conditional: 2, rework: 1, no_go: 0 };
export const VERDICT_LABEL = { go: "Go", go_conditional: "Go, условно", rework: "Доработка", no_go: "No-Go" };

const lower = (a, b) => (RANK[a] <= RANK[b] ? a : b);

export function gate0(p) {
  const { xray, cerebro, poe } = p;
  const missing = [];
  if (!xray?.asins?.length) missing.push("Xray");
  if (!cerebro?.keywords?.length) missing.push("Cerebro");
  const level = xray?.asins?.length && cerebro?.keywords?.length ? "full" : (xray?.asins?.length || cerebro?.keywords?.length) ? "partial" : poe ? "poe_only" : "none";
  return { level, missing, poe: Boolean(poe), note: level === "full" ? "Xray + Cerebro загружены — Gate 1–2 считаются точно" : level === "poe_only" ? "Только POE: Критерий 1 по прокси, Gate 1–2 — недостаточно данных для точного расчёта" : level === "none" ? "Нет данных — введите метрики вручную или загрузите файлы" : `Не хватает: ${missing.join(", ")} — часть метрик по прокси`, };
}

/** Потолок вердикта по правилам скилла. */
export function verdictCeiling(r) {
  const reasons = [];
  let v = "go";
  let decisive = null;
  const eco = r.economics, c1 = r.criterion1, ch = r.challenger;

  if (eco?.gate1?.status === "no_go") { v = "no_go"; decisive ??= "Gate 1"; reasons.push("Gate 1 провален: маржа и профит/юнит ниже порогов"); }
  if (eco?.gate2?.status === "no_go") { v = "no_go"; decisive ??= "Gate 2"; reasons.push("Gate 2 провален: Net after ads < 0 даже при CVR 15 %"); }
  if (ch?.active && ch.items["6"]?.status === "fail") { v = "no_go"; decisive ??= "Критерий 6"; reasons.push("Критерий 6 (запас экономики) красный — обязательный"); }
  if (ch?.items["8"]?.status === "fail") { v = "no_go"; decisive ??= "Критерий 8"; reasons.push("Критерий 8 (патент/FTO) красный — обязательный"); }
  if (r.budget?.quickScreenStatus === "fail") { v = lower(v, "no_go"); decisive ??= "Стоп-вопросы (урок 07)"; reasons.push("Один из четырёх стоп-вопросов урока 07 — «нет»"); }

  if (r.gate0?.level === "none") { v = lower(v, "rework"); decisive ??= "Gate 0"; reasons.push("Gate 0: данных нет"); }
  if (r.gate0?.level === "poe_only" || r.gate0?.level === "partial") { v = lower(v, "rework"); decisive ??= "Gate 0"; reasons.push("Gate 0: недостаточно данных для точных Gate 1–2 (нужны Xray + Cerebro)"); }
  if (!eco || eco.pending) { v = lower(v, "rework"); decisive ??= "Критерий 2"; reasons.push("Экономика не заполнена (COGS) — вердикт не может быть выше «Доработка»"); }
  if (c1 && !c1.pass) { v = lower(v, "rework"); decisive ??= "Критерий 1"; reasons.push(`Критерий 1 ниже порога: ${c1.okCount} из 8 (нужно ≥ ${c1.passCount})`); }
  if (ch?.active && ch.pass === false && !ch.pending) { v = lower(v, "rework"); decisive ??= "Критерии 3–8"; reasons.push(`Gate 3: ${ch.greenCount} из 8 зелёных или обязательные 6/8 не зелёные`); }
  if (eco?.gate1?.status === "rework" || eco?.gate2?.status === "rework") { v = lower(v, "go_conditional"); decisive ??= eco.gate2.status === "rework" ? "Gate 2" : "Gate 1"; reasons.push("Экономика на грани (ДОРАБОТКА по Gate 1/2) — только «Go, условно» с планом закрытия"); }
  if (ch && !ch.gate4Discussed) { v = lower(v, "go_conditional"); decisive ??= "Gate 4"; reasons.push("Gate 4 (патенты/FTO) не обсуждён"); }
  if (r.scorecard?.band === "no_go") { v = lower(v, "rework"); reasons.push("Scorecard < 40 %"); }
  else if (r.scorecard?.band === "rework") { v = lower(v, "go_conditional"); reasons.push("Scorecard 40–59 % — слабая ось"); }

  if (v === "go" && !decisive) decisive = "все гейты пройдены";
  return { ceiling: v, decisiveGate: decisive, reasons };
}

/** Согласование AI-вердикта с потолком правил. */
export function reconcile(ai, ceilingInfo) {
  if (!ai) return null;
  const raw = ai.verdict;
  const ceiling = ceilingInfo.ceiling;
  const adjusted = RANK[raw] > RANK[ceiling];
  return { ...ai, aiVerdictRaw: raw, verdict: adjusted ? ceiling : raw, adjustedByRules: adjusted,
    adjustmentNote: adjusted ? `AI предложил «${VERDICT_LABEL[raw]}», правила ограничили до «${VERDICT_LABEL[ceiling]}»: ${ceilingInfo.reasons[0] || ceilingInfo.decisiveGate}` : null };
}
