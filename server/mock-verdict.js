// Демонстрационный вердикт для MOCK_AI=1 (e2e без ключа). Строится из детерминированных результатов.
export function mockVerdict(payload) {
  const ceiling = payload?.rulesVerdict?.ceiling || "rework";
  const c1 = payload?.criterion1 || {};
  const neg = payload?.poe?.reviews?.negative?.[0];
  const top = payload?.competition?.topBrand;
  return {
    verdict: ceiling,
    decisiveGate: payload?.rulesVerdict?.decisiveGate || "Gate 0",
    summary: `[MOCK] Демонстрационный вердикт без обращения к Claude. Потолок по правилам: ${ceiling}. Критерий 1: ${c1.okCount ?? "?"} из 8. ${payload?.priceBand ? `Конкуренция оценена в ценовом диапазоне ${payload.priceBand.label} (${payload.priceBand.listingsInBand} из ${payload.priceBand.listingsTotal} листингов). ` : ""}${top ? `Лидер${payload?.priceBand ? " диапазона" : " ниши"} — ${top}.` : ""} Для реального анализа задайте ANTHROPIC_API_KEY и отключите MOCK_AI.`,
    criterion1Summary: `Критерий 1: ${c1.okCount ?? "?"} из 8 зелёных${c1.redItems?.length ? `, красные: ${c1.redItems.join(", ")}` : ""}.`,
    gates: [
      { gate: "gate0", status: payload?.gate0?.level === "full" ? "pass" : "insufficient_data", reasoning: payload?.gate0?.note || "" },
      { gate: "criterion1", status: c1.pass ? "pass" : "fail", reasoning: `${c1.okCount ?? "?"} из 8 при пороге 6` },
      { gate: "gate1", status: payload?.economics?.pending ? "insufficient_data" : payload.economics.gate1.status === "pass" ? "pass" : payload.economics.gate1.status === "rework" ? "rework" : "fail", reasoning: payload?.economics?.pending ? "COGS не введён" : `net/юнит $${payload.economics.gate1.net0}, маржа ${Math.round(payload.economics.gate1.margin0 * 100)} %` },
      { gate: "gate2", status: payload?.economics?.pending ? "insufficient_data" : payload.economics.gate2.status === "pass" ? "pass" : payload.economics.gate2.status === "rework" ? "rework" : "fail", reasoning: payload?.economics?.pending ? "COGS не введён" : `Net after ads при CVR 12 %: $${payload.economics.gate2.byCvr?.[2]?.net}` },
      { gate: "gate4", status: payload?.challenger?.gate4Discussed ? "pass" : "insufficient_data", reasoning: payload?.challenger?.gate4Discussed ? "патентный поиск отмечен" : "патенты не проверены" },
    ],
    differentiation: neg ? [{ hypothesis: `Закрыть жалобу «${neg.topic}» (${neg.pct} % негативных упоминаний)`, evidence: `POE nichePdr: ${neg.verbatims?.[0] || neg.topic}`, specRequirement: "Измеримое требование ТЗ — сформулировать после анализа отзывов лидера" }] : [],
    recommendations: [
      { priority: "high", title: "Заполнить экономику", text: "Получить котировку COGS у поставщика и заполнить Критерий 2 — без него вердикт не выше «Доработка»." },
      { priority: "med", title: "Сверить прокси POE по Xray/Cerebro", text: "Если 1a/1c помечены как прокси — загрузить Xray и Cerebro для точных значений." },
      { priority: "low", title: "Патентный поиск", text: "USPTO / Google Patents по ключевым конкурентам — закрыть Gate 4." },
    ],
    risks: ["Это демонстрационный ответ (MOCK_AI=1), не аналитика модели.", ...(payload?.regulatory?.triggers || []).map((t) => `${t.agency}: ${t.title} — проверить требования (подсказка по словам ниши, не юридический вывод).`),
      ...(payload?.entry?.reach?.status === "fail" ? [`Нужная доля кликов ${Math.round((payload.entry.reach.requiredClickShare || 0) * 1000) / 10} % выше того, чего достигли новички ниши (оценка предварительная).`] : []),
      ...(payload?.cashflow && payload.cashflow.paybackMonth === null ? ["По помесячному сценарию деньги на горизонте не возвращаются."] : [])],
    pricingPackComment: payload?.criterion1?.items?.["1b"]?.value ? `Медиана цены проверенных конкурентов $${payload.criterion1.items["1b"].value}.` : "Нет данных о цене.",
    nextSteps: ["Заполнить COGS/CPC и пересчитать Gate 1–2", "Загрузить недостающие файлы (Xray/Cerebro/POE)", "Провести патентный поиск"],
  };
}
