// Подсказка под полем COGS: потолок закупочной цены из «Цены вашей конфигурации» (spec 013).
// Чистая функция — чтобы правило «сколько можно платить за товар» проверялось тестом, а не глазами в браузере.
const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const money = (v) => "$" + Math.abs(v).toFixed(2);

/**
 * @param {object|null} pc results.priceConfig
 * @param {number|null} cogs введённая себестоимость
 * @returns {{ level: "ok"|"over"|"none", text: string }|null} null — показывать нечего
 */
export function cogsHint(pc, cogs) {
  if (!pc || !isNum(pc.cogsCeiling)) return null;
  const ceil = pc.cogsCeiling;
  const basis = `маржа ${Math.round((pc.marginMin ?? 0.3) * 100)} % ${pc.cogsCeilingAfterAds ? "после рекламы" : "без рекламы (Gate 1)"}`;
  const miss = pc.cogsCeilingMissing?.length ? ` · не задано: ${pc.cogsCeilingMissing.join(", ")} — потолок завышен` : "";
  if (ceil <= 0) return { level: "none", text: `потолок не сходится: ${basis} недостижима даже при бесплатном товаре (не хватает ${money(ceil)})${miss}` };
  if (isNum(cogs) && cogs > ceil) return { level: "over", text: `выше потолка на ${money(cogs - ceil)}: нужно ≤ ${money(ceil)}, чтобы осталась ${basis}${miss}` };
  return { level: "ok", text: `потолок ≤ ${money(ceil)} — ${basis}${miss}` };
}
