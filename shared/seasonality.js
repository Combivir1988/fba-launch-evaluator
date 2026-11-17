// spec 026: сезонность — это не размах между лучшей и худшей неделей, а ВРЕМЯ, которое ниша
// проводит ниже своего обычного спроса.
//
// Прежняя мера `(пик − минимум) / пик` давала на 66 живых нишах ok 1 · warn 14 · fail 51 — то есть
// не различала ничего. Замер показал, почему: короток не провал, а САМ ПИК. Недель в пределах 90 %
// от пика — медиана 2,5, ровно одна у 24 ниш из 66; пик выше годовой медианы в 1,83 раза; пики
// приходятся на декабрь (13 ниш) и ноябрь (11) — Чёрная пятница и Рождество. Правило брало неделю
// распродажи за норму и объявляло остальной год просадкой: у медианной ниши 42 недели из 52 лежат
// ниже 70 % пика.
//
// Относительно ОБЫЧНОГО уровня ниши ровны: ниже 70 % медианы не опускается 31 ниша из 66.
//
// Модуль возвращает только ЧИСЛА. Статус выносит criterion1.js — так пороги и измерение
// не перемешиваются, а ворота пишутся против чистой функции.
import { median } from "./num.js";

const MONTHS_IN = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];
const MONTHS_NOM = ["январь", "февраль", "март", "апрель", "май", "июнь", "июль", "август", "сентябрь", "октябрь", "ноябрь", "декабрь"];
const isNum = (v) => typeof v === "number" && Number.isFinite(v);

/**
 * Сезонность недельного ряда.
 * @param {Array<{date: string, sv: number|null}>} trends — недельные точки поискового объёма
 * @param {{lowOf?: number, minRun?: number, minWeeks?: number}} opts
 * @returns {object} числа сезонности либо `{ reason }`, если судить не по чему
 */
export function seasonality(trends, { lowOf = 0.7, minRun = 2, minWeeks = 8 } = {}) {
  const points = (Array.isArray(trends) ? trends : []).filter((p) => isNum(p?.sv)).slice(-52);
  const weeks = points.length;

  // Правило отсутствия: короткую историю НЕ судим и не растягиваем до года (FR-012, ворота SC-003).
  if (weeks < minWeeks) return { reason: "short_history", weeks };

  const sv = points.map((p) => p.sv);
  const normal = median(sv);
  // Весь ряд нулевой: делить не на что, и «сезонности нет» было бы неправдой — мы просто не знаем.
  if (!isNum(normal) || normal <= 0) return { reason: "no_demand", weeks };

  // Граница ПРИНАДЛЕЖИТ норме: сравнение строгое. Неделя ровно на пороге слабой не считается.
  const low = sv.map((v) => v < normal * lowOf);

  // Склейка подряд идущих слабых недель. Отрезки короче minRun отбрасываются ЦЕЛИКОМ и не входят
  // ни в долю, ни в глубину, ни в число просадок: одиночная слабая неделя — не сезон.
  // Без этого правила одна мёртвая неделя на истории в 11 недель весила бы 8,3 % и переворачивала
  // статус, то есть дефект, который спека чинит, просто переехал бы на короткие ряды.
  const dipsArr = [];
  for (let i = 0; i < weeks;) {
    if (!low[i]) { i++; continue; }
    let j = i;
    while (j < weeks && low[j]) j++;
    if (j - i >= minRun) dipsArr.push([i, j - 1]);
    i = j;
  }

  const downWeeks = dipsArr.reduce((s, [i, j]) => s + (j - i + 1), 0);
  const longestDip = dipsArr.length ? dipsArr.reduce((b, x) => (x[1] - x[0] > b[1] - b[0] ? x : b)) : null;

  // Глубина — СРЕДНЯЯ по неделям внутри просадок, а не самая глубокая неделя: вся работа посвящена
  // уходу от мер, которые решает одна неделя, и держать такую меру в соседнем числе было бы
  // противоречием в одном абзаце отчёта. На живых данных медианы обеих мер совпадают (31 %).
  let depth = 0;
  if (downWeeks) {
    let acc = 0;
    for (const [i, j] of dipsArr) for (let k = i; k <= j; k++) acc += (normal - sv[k]) / normal;
    depth = acc / downWeeks;
  }

  // Период — месяцы САМОЙ ДЛИННОЙ просадки. Перечислять все месяцы со слабыми неделями нельзя:
  // в худшем случае выходит список из семи, который человек не читает.
  const months = longestDip ? [points[longestDip[0]].date.slice(5, 7), points[longestDip[1]].date.slice(5, 7)] : [];

  return {
    weeks,
    normal,
    lowOf,
    downWeeks,
    downShare: downWeeks / weeks, // от ФАКТИЧЕСКОЙ длины истории, не от 52 (FR-011)
    dips: dipsArr.length,
    longest: longestDip ? longestDip[1] - longestDip[0] + 1 : 0,
    depth,
    months,
    monthsLabel: monthsLabel(months),
  };
}

/** Короткая фраза о периоде: «август» или «с июня по сентябрь». Пусто, если просадок нет. */
export function monthsLabel(months) {
  if (!Array.isArray(months) || months.length !== 2) return "";
  const a = Number(months[0]) - 1, b = Number(months[1]) - 1;
  if (!MONTHS_NOM[a] || !MONTHS_NOM[b]) return "";
  return a === b ? MONTHS_NOM[a] : `с ${MONTHS_IN[a]} по ${MONTHS_NOM[b]}`;
}
