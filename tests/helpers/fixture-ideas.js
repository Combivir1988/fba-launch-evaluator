// Spec 021: наборы для тестов отбора. Возраст у контрольных элементов — ровно сутки,
// поэтому приведённый показатель равен самому значению и контрольные числа читаются глазами.
const DAY_MS = 86_400_000;

export const NOW = Date.parse("2026-11-12T12:00:00Z");

/** Элемент возрастом ageDays суток. value === null — показателя площадка не дала. */
export function ideaItem(id, value, ageDays = 1, extra = {}) {
  return {
    externalId: String(id),
    url: "https://example.invalid/" + id,
    title: "item " + id,
    value,
    publishedAt: ageDays === null ? null : new Date(NOW - ageDays * DAY_MS).toISOString(),
    ...extra,
  };
}

/** Контрольная выборка из contracts/ranking.md: медиана 3. */
export const CONTROL_METRICS = [1, 1, 2, 2, 3, 3, 4, 5, 30];
export const controlSample = () => CONTROL_METRICS.map((v, i) => ideaItem("c" + i, v));

/** Та же выборка с добавленным выбросом: медиана обязана остаться 3 (устойчивость медианы, D3). */
export const controlSamplePlusOutlier = () => [...controlSample(), ideaItem("c-outlier", 3000)];

/** Элементы без показателя и без возраста — ни в фон, ни в кандидаты. */
export const noMetricItems = () => [
  ideaItem("no-value", null),
  ideaItem("no-value-undef", undefined),
  ideaItem("no-age", 500, null),
];

/** Краудфандинг: цель есть, цель ноль, цели нет вовсе. */
export const crowdfundingSample = () => [
  ...CONTROL_METRICS.map((v, i) => ideaItem("k" + i, v, 1, { pledged: v * 10, goal: v * 10 })),
  ideaItem("k-rich", 30, 1, { pledged: 5000, goal: 1000 }),       // цель перебрана в 5 раз
  ideaItem("k-poor", 30, 1, { pledged: 100, goal: 1000 }),        // быстро растёт, но цель далеко
  ideaItem("k-zero-goal", 30, 1, { pledged: 5000, goal: 0 }),     // делить нельзя
  ideaItem("k-no-goal", 30, 1, { pledged: 5000 }),                // цели нет вовсе
];

/** Элементы старше окна сопоставимости — в фон не берутся. */
export const staleItems = () => [
  ideaItem("old-1", 10_000, 200),
  ideaItem("old-2", 20_000, 365),
  ideaItem("old-3", 30_000, 500),
];
