// Подложка для ворот SC-003 (spec 018): документ, у которого СОХРАНЁННЫЙ вердикт заведомо расходится с пересчитанным.
// Повторяет живой случай: spec 016 переписал правило по Amazon, а снимок в core.results остался от старого правила.
// На живых данных 2026-11-02 так разошлись 16 анализов: сохранено «No-Go · Amazon в нише», пересчёт даёт «Доработка».
import { fixtureAnalysis } from "./fixture-analysis.js";
import { compute } from "../../shared/compute.js";

const isAmazon = (a) => /amazon/i.test(a.brand || "") || /amazon/i.test(a.seller || "");

/** Пересчёт даёт «rework · Критерий 1», в core.results лежит «no_go · Amazon в нише». */
export function staleAnalysis(overrides = {}) {
  const a = fixtureAnalysis();
  a.aggregates.xray.asins = a.aggregates.xray.asins.filter((x) => !isAmazon(x)); // листингов Amazon в нише больше нет — блокировка не срабатывает
  Object.assign(a.inputs, { price: 39, cogs: 4.37, cpc: 0.6 }, overrides.inputs || {});
  a.results = compute(a);
  // снимок от прежней методики: сам факт «Amazon продаёт» давал No-Go
  a.results.verdict = { ceiling: "no_go", decisiveGate: "Amazon в нише",
    reasons: ["Amazon продаёт сам (по всей нише: 3 листинга): собственная марка Amazon (Amazon Basics)"] };
  return a;
}

/** Что обязан дать пересчёт текущей методикой — вынесено сюда, чтобы подложка и ожидание не разъезжались. */
export const STALE_EXPECTED = { ceiling: "rework", decisiveGate: "Критерий 1", storedCeiling: "no_go" };
