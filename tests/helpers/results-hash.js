// Отпечаток результатов расчёта для тестов совместимости: новые возможности не должны менять то, что ядро считало раньше.
//  • spec 003 (ценовой диапазон), подсказка CVR: при пустом диапазоне результаты те же, что до появления фильтра;
//  • spec 005 (вход в нишу): стоп-вопрос о бюджете НАМЕРЕННО переведён на помесячный сценарий, поэтому `budget` и зависящий от него `verdict`
//    из отпечатка исключены (их поведение проверяют budget.test.js и cashflow.test.js). Всё остальное обязано совпадать с расчётом до spec 005.
// Новые поля и метки времени в отпечаток не входят. Контрольные значения сняты на коде ДО spec 005 (коммит 06ec78a).
import { createHash } from "node:crypto";

export function stripNew(results) {
  const r = JSON.parse(JSON.stringify(results));
  delete r.computedAt; delete r.methodologyVersion; delete r.priceBand; delete r.cvrHint;
  for (const s of r.priceSegments?.segments || []) delete s.selected;
  delete r.budget; delete r.verdict;
  for (const k of ["entry", "cashflow", "clickPrice", "borderline", "regulatory", "dataNotes", "config"]) delete r[k];
  return r;
}
export const resultsHash = (results) => createHash("sha256").update(JSON.stringify(stripNew(results))).digest("hex").slice(0, 16);
