// Spec 021 — склейка одной вещи, найденной на разных площадках (D10).
//
// ПРАВИЛО: ложная склейка ХУЖЕ дубля. Склеив две разные вещи, раздел ПРЯЧЕТ одну из них,
// и человек не узнает, что она была. Дубль он просто отмахнёт. Поэтому правило консервативное:
// только совпадение ссылки или ПОЛНОЕ совпадение нормализованного названия. Похожесть не используется.

/** Буквы и цифры остаются, остальное схлопывается. Цифры НЕ выбрасываются: «11 speed» и «12 speed» —
 *  разные вещи, и именно цифра их различает. */
export function normalizeTitle(s) {
  return String(s ?? "")
    .toLowerCase()
    .normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** Метки источника перехода к делу не относятся и у одной и той же ссылки бывают разными. */
const TRACKING = /^(utm_|fbclid$|gclid$|ref$|ref_|igshid$|si$)/i;

/**
 * Ссылка приводится к сравнимому виду. Строка запроса НЕ выбрасывается: у видео опознаватель
 * живёт именно в ней, и выбросив её, мы склеили бы между собой все ролики площадки разом.
 */
export function normalizeUrl(u) {
  const raw = String(u ?? "").trim();
  if (!raw) return "";
  let url;
  try { url = new URL(raw); } catch { return raw.toLowerCase().replace(/\/+$/, ""); }
  const host = url.host.toLowerCase().replace(/^www\./, "");
  const path = url.pathname.replace(/\/+$/, "") || "/";
  const params = [...url.searchParams.entries()]
    .filter(([k]) => !TRACKING.test(k))
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => k + "=" + v);
  return host + path + (params.length ? "?" + params.join("&") : "");
}

/** Две записи — одна вещь ⟺ совпала ссылка ИЛИ совпало нормализованное название ЦЕЛИКОМ. */
export function sameThing(a, b) {
  const ua = normalizeUrl(a?.url), ub = normalizeUrl(b?.url);
  if (ua && ub && ua === ub) return true;
  const ta = normalizeTitle(a?.title), tb = normalizeTitle(b?.title);
  // Слишком короткое название склеивать нельзя: «набор» совпадёт с «набор» у чего угодно.
  if (ta && tb && ta === tb && ta.length >= 8) return true;
  return false;
}

/**
 * Группирует записи в вещи. Внутри группы — исходные записи; платформы перечисляются.
 * Неуверенные случаи остаются РАЗНЫМИ группами: лишний дубль дешевле спрятанной вещи.
 */
export function groupCandidates(items) {
  const groups = [];
  for (const it of items ?? []) {
    const g = groups.find((grp) => grp.items.some((x) => sameThing(x, it)));
    if (g) { g.items.push(it); if (!g.platforms.includes(it.platform)) g.platforms.push(it.platform); }
    else groups.push({ items: [it], platforms: [it.platform].filter(Boolean) });
  }
  return groups.map((g) => ({
    ...g.items[0],
    platforms: g.platforms,
    // Отношение к фону у разных площадок считается от разных фонов и НЕ складывается:
    // показываем наибольшее и помним, что оно про свой раздел.
    ratio: Math.max(...g.items.map((x) => Number(x.ratio) || 0)),
    alsoOn: g.items.slice(1),
  }));
}
