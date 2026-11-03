// Отпечаток результатов расчёта для тестов совместимости: новые возможности не должны менять то, что ядро считало раньше.
//  • spec 003 (ценовой диапазон), подсказка CVR: при пустом диапазоне результаты те же, что до появления фильтра;
//  • spec 005 (вход в нишу): стоп-вопрос о бюджете НАМЕРЕННО переведён на помесячный сценарий, поэтому `budget` и зависящий от него `verdict`
//    из отпечатка исключены (их поведение проверяют budget.test.js и cashflow.test.js). Всё остальное обязано совпадать с расчётом до spec 005.
//  • spec 019 (концентрация ниши): НАМЕРЕННО меняет подпункт 1f — он мерил долю топ-5 БРЕНДОВ (зелёный в 1 нише из 65)
//    и стал мерить концентрацию ниши. Меняется value/status/source/unit/threshold у 1f и, как следствие, okCount Критерия 1.
//    Новые ПОЛЯ концентрации и летаргии из отпечатка исключены — они добавочные и на прежний расчёт не влияют.
//  • spec 016 (своя марка Amazon или вендор): НАМЕРЕННО меняет 1e и ось «конкуренция» там, где в нише продаёт Amazon:
//    раньше любой такой листинг валил 1e и снимал 2 балла, теперь это зависит от того, чей это бренд и какая у него доля.
//    Отпечаток фикстуры обновлён (в ней Amazon Basics); на нишах без Amazon отпечатки прежние.
// Новые поля и метки времени в отпечаток не входят. Контрольные значения сняты на коде ДО spec 005 (коммит 06ec78a).
import { createHash } from "node:crypto";

export function stripNew(results) {
  const r = JSON.parse(JSON.stringify(results));
  delete r.computedAt; delete r.methodologyVersion; delete r.priceBand; delete r.cvrHint;
  for (const s of r.priceSegments?.segments || []) delete s.selected;
  delete r.budget; delete r.verdict;
  for (const k of ["entry", "cashflow", "clickPrice", "borderline", "regulatory", "dataNotes", "config", "configScope", "amazon", "priceConfig", "sourceOverlap", "hero", "patentsToChecklist", "stage3"]) delete r[k];
  if (r.competition) { delete r.competition.amazonAsins; delete r.competition.amazonListings; delete r.competition.amazonRevenueShare; delete r.competition.own; delete r.competition.incumbent;
    // spec 019: добавочные поля — концентрация, поясняющие числа и летаргия. На то, что ядро считало раньше, они не влияют.
    delete r.competition.hhi; delete r.competition.top5ListingShare; delete r.competition.listingCount; delete r.competition.lethargyRevenueShare;
    for (const b of r.competition.brands || []) { delete b.reviewsSum; delete b.reviewsShare; delete b.lethargy; delete b.lethargyLabel; } } // own/incumbent — новые поля (spec «я уже в нише»), на прежние расчёты не влияют
  return r;
}
export const resultsHash = (results) => createHash("sha256").update(JSON.stringify(stripNew(results))).digest("hex").slice(0, 16);
