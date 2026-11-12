// Наборы чисел для проверки учёта возвратов (spec 020).
// Тождество формулы проверяется не на одном случае: ошибка в общей формуле может
// случайно совпасть с правильным ответом на одном наборе и разойтись на другом.

/** Базовый ввод экономики: всё, кроме доли возвратов. */
export function econInputs(over = {}) {
  return { price: 25, cogs: 4, shippingPerUnit: 1, fbaFee: 5, referralPct: 0.15,
    cpc: 1, cvr: 0.10, ppcShare: 0.7, targetAcos: 0.3, unitsPerDay: 10, ...over };
}

/**
 * Наборы для тождества: при resalableShare = 0 и returnFee = 0
 * стоимость возвратов обязана равняться r × price × (1 − referral).
 * Контрольный пример из contracts/formulas.md — первый.
 */
export const IDENTITY_CASES = [
  { label: "контрольный из контракта", price: 25, referralPct: 0.15, returnRate: 0.08, expect: 1.70 },
  { label: "дешёвый товар, высокая комиссия", price: 12, referralPct: 0.20, returnRate: 0.05, expect: 0.48 },
  { label: "дорогой товар, низкие возвраты", price: 89.99, referralPct: 0.08, returnRate: 0.012, expect: 0.9934896 },
  { label: "высокие возвраты", price: 34.5, referralPct: 0.15, returnRate: 0.22, expect: 6.45150 },
  { label: "нулевые возвраты", price: 25, referralPct: 0.15, returnRate: 0, expect: 0 },
];

/** Крайние случаи доли возвратов. */
export const EDGE_RATES = {
  unknown: null,        // неизвестна — НЕ ноль
  zero: 0,              // ровно ноль — всё как раньше
  suspicious: 0.6,      // выше порога подозрительности
  ruinous: 0.9,         // прибыль обязана уйти в минус
};

/** Вход, у которого маржа стоит у нижней границы Gate 1: сюда и бьют возвраты. */
export function nearEdgeInputs(over = {}) {
  // net0 = 25 − 4.2 − 1 − 3.75 − 8.3 = 7.75 → маржа 31 %, порог 30 %
  return econInputs({ price: 25, cogs: 4.2, shippingPerUnit: 1, fbaFee: 8.3, referralPct: 0.15, ...over });
}
