// Отпечаток результатов расчёта для теста совместимости (spec 003, SC-002): при пустом ценовом диапазоне
// результаты должны совпадать с тем, что ядро считало ДО появления фильтра. Новые поля и метки времени из отпечатка исключены.
import { createHash } from "node:crypto";

export function stripNew(results) {
  const r = JSON.parse(JSON.stringify(results));
  delete r.computedAt; delete r.methodologyVersion; delete r.priceBand;
  for (const s of r.priceSegments?.segments || []) delete s.selected;
  return r;
}
export const resultsHash = (results) => createHash("sha256").update(JSON.stringify(stripNew(results))).digest("hex").slice(0, 16);
