// Подсказка под полем COGS: сколько можно платить за товар, чтобы осталась целевая маржа (spec 013).
// Чистая функция — чтобы правило проверялось тестом, а не глазами в браузере.
//
// 2026-11-14. Потолок считался ТОЛЬКО от цены аналогов такой же конфигурации и об этом молчал. На живом разборе
// цена аналогов была $29,99, а человек планировал $65 — подсказка писала «маржа 30 % недостижима даже при
// бесплатном товаре», пока соседний блок показывал маржу 44,2 % и Gate 1 PASS. Текст не менялся ни при цене
// от $30 до $200 (маржа 6,5 % → 66,0 %), ни при COGS от $2 до $40: он отвечал на другой вопрос и не говорил, на какой.
// Теперь подсказка отвечает про цену, по которой считается экономика, и ВСЕГДА называет её. Цена аналогов
// осталась — но как отдельная новость: «вы планируете дороже, чем берут аналоги», а не как молчаливое основание.
const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const money = (v) => "$" + Math.abs(v).toFixed(2);

/**
 * @param {object|null} pc results.priceConfig
 * @param {number|null} cogs введённая себестоимость
 * @returns {{ level: "ok"|"over"|"none", text: string }|null} null — показывать нечего
 */
export function cogsHint(pc, cogs) {
  // Условие появления прежнее: подсказка живёт при блоке «Цена вашей конфигурации» и без него смысла не имеет.
  if (!pc || !isNum(pc.cogsCeiling)) return null;
  const own = pc.cogsCeilingAtPrice;
  const usingOwn = Boolean(own && isNum(own.ceiling));
  const src = usingOwn ? own : { price: pc.market, ceiling: pc.cogsCeiling, afterAds: pc.cogsCeilingAfterAds, marginMin: pc.marginMin };
  const ceil = src.ceiling;
  const basis = `маржа ${Math.round((src.marginMin ?? 0.3) * 100)} % ${src.afterAds ? "после рекламы" : "без рекламы (Gate 1)"}`;
  const at = isNum(src.price) ? (usingOwn ? ` при вашей цене ${money(src.price)}` : ` при цене аналогов такой конфигурации ${money(src.price)}`) : "";
  // Цена аналогов — не основание потолка, а отдельный факт: продавать дороже можно сознательно, и об этом стоит знать.
  const gap = usingOwn && isNum(pc.market) && isNum(src.price) && src.price > 0 && Math.abs(pc.market - src.price) / src.price > 0.10
    ? ` · аналоги такой конфигурации берут ${money(pc.market)}` : "";
  const miss = pc.cogsCeilingMissing?.length ? ` · не задано: ${pc.cogsCeilingMissing.join(", ")} — потолок завышен` : "";
  if (ceil <= 0) return { level: "none", text: `потолок не сходится:${at} ${basis} недостижима даже при бесплатном товаре (не хватает ${money(ceil)})${gap}${miss}` };
  if (isNum(cogs) && cogs > ceil) return { level: "over", text: `выше потолка на ${money(cogs - ceil)}: нужно ≤ ${money(ceil)}${at}, чтобы осталась ${basis}${gap}${miss}` };
  return { level: "ok", text: `потолок ≤ ${money(ceil)}${at} — ${basis}${gap}${miss}` };
}
