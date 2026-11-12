// Spec 021 — отбор кандидатов радара товарных идей.
//
// Чистое ядро: сети не знает, времени не знает. «Сейчас» приходит аргументом, иначе
// тесты зависели бы от дня запуска.
//
// ВАЖНО: на расчёт ниши этот файл не влияет — compute() его не вызывает. Он лежит в shared/
// потому, что считается и в браузере, и в тестах (D6). Цена решения названа: новый файл здесь
// меняет признак версии методики и вызывает ОДИН полный пересчёт итогов раздела «Статистика».

const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const DAY_MS = 86_400_000;

/** Медиана, а не среднее (D3): выбросы здесь норма, и один виральный элемент поднял бы
 *  среднее так, что отбор выключился бы на весь раздел. */
export function median(nums) {
  const a = [...nums].sort((x, y) => x - y);
  if (!a.length) return null;
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

/** Возраст элемента в сутках. null — площадка даты не сказала. */
export function ageDaysOf(item, now) {
  const t = Date.parse(item?.publishedAt ?? "");
  if (!Number.isFinite(t)) return null;
  const d = (now - t) / DAY_MS;
  return d >= 0 ? d : 0; // будущая дата — считаем нулевым возрастом, а не отрицательным
}

/**
 * Приведённый к возрасту показатель — скорость, а не накопленное.
 * Просмотры накапливаются: сравнение сырых величин систематически топит свежее,
 * то есть ровно то, ради чего радар существует, и делает это тихо.
 *
 * ПРАВИЛО ОТСУТСТВИЯ: нет показателя или нет возраста — null. Элемент НЕ кандидат и НЕ ноль.
 * Подстановка нуля означала бы «вещь никому не интересна», что противоположно «мы не знаем».
 */
export function metricOf(item, now, th) {
  const v = item?.value;
  if (!isNum(v) || v < 0) return null;
  const age = ageDaysOf(item, now);
  if (age === null) return null;
  return v / Math.max(age, th.minAgeDays);
}

/** Доля от цели для краудфандинга. Обе величины — в своей валюте проекта, поэтому их отношение
 *  осмысленно, в отличие от сравнения собранных сумм между проектами. */
export function goalRatioOf(item) {
  const { pledged, goal } = item ?? {};
  if (!isNum(pledged) || !isNum(goal) || goal <= 0) return null; // деления на ноль и «бесконечно успешного проекта» быть не должно
  return pledged / goal;
}

/**
 * Отбор по одной выборке одного раздела.
 *
 * Фон считается из элементов ЭТОЙ ЖЕ выборки — поэтому канал на две тысячи и канал на два
 * миллиона дают кандидатов оба (ворота SC-003). Общий порог выключил бы маленький источник,
 * а именно в маленьких раньше всего видно новое.
 *
 * @param items        элементы одного обхода: { externalId, url, title, value, publishedAt, pledged?, goal? }
 * @param now          момент обхода, мс
 * @param thresholds   полный набор порогов; берётся группа ideas
 * @param thresholdMult своя кратность раздела; не задана — из порогов
 * @param requireGoalRatio второе условие краудфандинга
 * @param expectsFresh запрос нёс фильтр по дате — значит выборка почти без свежего означает,
 *                     что фильтр не применился, а не что раздел тихий
 */
export function rankSample(items, { now, thresholds, thresholdMult, requireGoalRatio = false, expectsFresh = false } = {}) {
  const th = thresholds?.ideas ?? {};
  const mult = isNum(thresholdMult) ? thresholdMult : th.thresholdMult;
  const list = Array.isArray(items) ? items : [];

  const rows = list.map((it) => {
    const ageDays = ageDaysOf(it, now);
    const metric = metricOf(it, now, th);
    const goalRatio = goalRatioOf(it);
    const inWindow = ageDays !== null && ageDays <= th.compareWindowDays;
    return { ...it, ageDays, metric, goalRatio, inWindow, ratio: null, candidate: false };
  });

  const seen = rows.length;
  const noMetric = rows.filter((r) => r.metric === null).length;
  const sample = rows.filter((r) => r.metric !== null && r.inWindow);
  const dated = rows.filter((r) => r.ageDays !== null);
  const freshShare = dated.length ? sample.length / dated.length : 0;

  const out = (reason, background = null) => ({
    background, sampleSize: sample.length, seen, passed: 0, noMetric,
    outOfWindow: rows.filter((r) => r.ageDays !== null && !r.inWindow).length,
    freshShare, thresholdMult: mult, reason, items: rows,
  });

  // Выборка почти без свежего при запросе с фильтром по дате — фильтр не применился.
  // Замер 2026-11-12: без фильтра внутри окна оказалось НОЛЬ роликов из семнадцати,
  // и источник был бы мёртв навсегда, выглядя при этом исправным.
  if (expectsFresh && dated.length && freshShare < th.freshShareMin) return out("window_degenerate");

  // Без фона «выделяется» не определено. Показывать всё подряд в таком случае запрещено.
  if (sample.length < th.minSample) return out("no_background");

  const background = median(sample.map((r) => r.metric));

  // Больше половины раздела без движения: фон вырожден, сравнивать не с чем.
  if (!(background > 0)) return out("background_zero", background);

  let passed = 0;
  for (const r of rows) {
    if (r.metric === null) continue;
    r.ratio = r.metric / background;
    // Кандидатами становятся только элементы ИЗ ОКНА. Иначе лучший за всё время пост канала
    // проходил бы отбор каждые сутки до скончания века: его скорость выше, чем у свежих,
    // просто потому, что он успел собрать своё. Отношение считаем и показываем всё равно.
    if (!r.inWindow) continue;
    const byRatio = r.ratio >= mult;
    const byGoal = !requireGoalRatio || (r.goalRatio !== null && r.goalRatio >= th.goalRatioMin);
    if (byRatio && byGoal) { r.candidate = true; passed++; }
  }

  return { ...out(null, background), passed, background };
}
