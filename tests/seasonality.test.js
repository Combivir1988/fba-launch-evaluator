// spec 026 — сезонность по длительности. ВОРОТА SC-001, SC-002, SC-003.
//
// Подпункт 1g мерил «лучшая неделя против худшей»: на 66 живых нишах это давало ok 1 · warn 14 · fail 51.
// Замер показал, что короток не провал, а ПИК: ровно одна неделя в пределах 90 % от пика у 24 ниш из 66,
// и правило брало неделю Чёрной пятницы за норму, объявляя остальной год просадкой.
//
// Тесты написаны ДО реализации и проверяются подлогом (задачи T041–T046):
//   • вернуть (пик − минимум)/пик        → падает SC-001 (и только она);
//   • поставить minRun = 1               → падает SC-001 ТОЛЬКО на короткой истории;
//   • seasonDownFail = 0.95              → падает SC-002 на летнем товаре;
//   • seasonDownOk = 0.0001              → падает SC-002 на «группа ok не единична»;
//   • делить долю на 52                  → падает SC-003 на короткой истории.
import { test } from "node:test";
import assert from "node:assert/strict";
import { seasonality, monthsLabel } from "../shared/seasonality.js";
import { criterion1 } from "../shared/criterion1.js";
import { DEFAULT_THRESHOLDS, mergeThresholds, thresholdOverrides } from "../shared/thresholds.js";

// ---------- вспомогательное ----------

/** Недельный ряд с датами: понедельники подряд от заданного дня. */
function weeks(values, start = "2025-01-06") {
  const d0 = new Date(start + "T00:00:00Z");
  return values.map((sv, i) => {
    const d = new Date(d0.getTime() + i * 7 * 86400000);
    return { date: d.toISOString().slice(0, 10), sv };
  });
}
const flat = (n, v = 1000) => Array(n).fill(v);

/** Подпункт 1g целиком — через criterion1, чтобы подлог в criterion1.js ронял именно эти ворота. */
function sub1g(trends, th = DEFAULT_THRESHOLDS) {
  const r = criterion1({
    xray: null, cerebro: null, poe: { trends },
    inputs: {}, thresholds: th, competition: null, traffic: null,
  });
  return r.items["1g"];
}
const statusOf = (trends, th) => sub1g(trends, th).status;

// ---------- SC-001: одноразовый всплеск ничего не решает ----------

test("SC-001a: на полной истории одна неделя втрое выше и одна мёртвая неделя не меняют статус", () => {
  const base = flat(52);
  const before = statusOf(weeks(base));
  assert.equal(before, "ok", "ровный спрос обязан быть «ок»: именно этого не хватало 19 ровным нишам из 31");

  assert.equal(statusOf(weeks([...base, 3000])), before, "одна неделя Чёрной пятницы не делает год просадкой");
  assert.equal(statusOf(weeks([...base, 200])), before, "одна мёртвая неделя между Рождеством и Новым годом — не сезонность");
  assert.equal(statusOf(weeks([3000, ...base])), before, "всплеск в начале ряда ведёт себя так же, как в конце");

  // то же на уровне чисел: всплеск не создаёт просадок, мёртвая неделя не дотягивает до просадки
  const s = seasonality(weeks([...base, 3000]), { lowOf: 0.7, minRun: 2, minWeeks: 8 });
  assert.equal(s.dips, 0);
  assert.equal(s.downShare, 0);
  assert.equal(s.depth, 0);
  assert.deepEqual(s.months, []);
});

test("SC-001b: тот же инвариант на КОРОТКОЙ истории — 11 недель плюс одна мёртвая", () => {
  const base = flat(11);
  const before = statusOf(weeks(base));
  assert.equal(before, "ok");

  // Без правила «просадка не короче двух недель» это 1/12 = 8,3 % — выше порога ok, и статус бы перевернулся.
  assert.equal(statusOf(weeks([...base, 200])), before,
    "на короткой истории одна мёртвая неделя весит 8,3 % — правило minRun обязано её не считать");

  const s = seasonality(weeks([...base, 200]), { lowOf: 0.7, minRun: 2, minWeeks: 8 });
  assert.equal(s.weeks, 12);
  assert.equal(s.dips, 0, "одиночная слабая неделя просадкой не является");
  assert.equal(s.downShare, 0);
});

// ---------- SC-002: настоящая сезонность остаётся fail ----------

test("SC-002a: летний товар (26 недель нормы, 26 на 30 %) — «не ок»", () => {
  const trends = weeks([...flat(26, 1000), ...flat(26, 300)]);
  const it = sub1g(trends);
  assert.equal(it.status, "fail", "полгода на трети спроса — это сезонность, и подпункт обязан это сказать");

  const s = seasonality(trends, { lowOf: 0.7, minRun: 2, minWeeks: 8 });
  assert.equal(s.weeks, 52);
  assert.equal(s.normal, 650, "медиана ряда из двух уровней");
  assert.equal(s.downWeeks, 26);
  assert.equal(s.dips, 1);
  assert.equal(s.longest, 26);
  assert.ok(Math.abs(s.downShare - 0.5) < 1e-9);
  assert.ok(Math.abs(s.depth - (650 - 300) / 650) < 1e-9, "глубина — средняя по неделям внутри просадки");
});

test("SC-002b: подпункт не становится зелёным для всех — на наборе есть и ok, и fail", () => {
  const cases = [
    flat(52),                                  // ровная
    [...flat(26, 1000), ...flat(26, 300)],     // летний товар
    [...flat(40, 1000), ...flat(12, 200)],     // мёртвый квартал
    [...flat(50, 1000), 3000, 3000],           // ровная с праздничным всплеском
    [...flat(46, 1000), ...flat(6, 400)],      // короткий низкий сезон
    [...flat(50, 1000), 200, 200],             // две слабые недели из 52 — это НЕ сезонность
  ];
  const got = cases.map((v) => statusOf(weeks(v)));
  assert.ok(got.includes("ok"), "группа «ок» не может быть пустой: иначе подпункт снова ничего не различает");
  assert.ok(got.includes("fail"), "группа «не ок» не может быть пустой: иначе послабление просто врёт в другую сторону");
  assert.ok(got.filter((x) => x === "ok").length >= 2, "«ок» не единична");
  // Ровный ряд даёт ровно 0 и остаётся «ок» при ЛЮБОМ положительном пороге — на нём одном
  // вырождение «ок» не поймать. Поэтому гарантия именно такая: две слабые недели из 52 (3,8 %)
  // — это меньше месяца в году, и подпункт обязан называть это «ок».
  assert.equal(statusOf(weeks([...flat(50, 1000), 200, 200])), "ok",
    "две недели из 52 — не сезонность; если это «не ок», порог «ок» затянут до бессмыслицы");
});

// ---------- SC-003: короткая история не судится и не умножается ----------

test("SC-003a: история короче минимума — «нет данных» с названной причиной, не «не ок»", () => {
  const it = sub1g(weeks(flat(6)));
  assert.equal(it.status, "na", "шесть недель — не повод отказывать нише");
  assert.match(it.note, /истори/i, "причина обязана быть названа словами");

  assert.equal(seasonality(weeks(flat(6)), { lowOf: 0.7, minRun: 2, minWeeks: 8 }).reason, "short_history");
});

test("SC-003b: доля считается от фактической длины истории, а не от 52 недель", () => {
  const trends = weeks([...flat(10), 200, 200]);
  const s = seasonality(trends, { lowOf: 0.7, minRun: 2, minWeeks: 8 });
  assert.equal(s.weeks, 12);
  assert.equal(s.downWeeks, 2);
  assert.ok(Math.abs(s.downShare - 2 / 12) < 1e-9, "2/12 = 16,7 %, а не 2/52 = 3,8 %");

  assert.equal(sub1g(trends).status, "warn", "16,7 % попадает в полосу «погранично» (8 %…20 %)");
});

// ---------- единицы расчёта ----------

test("две просадки: доля суммарная, месяцы — от самой длинной", () => {
  // 8 недель вниз (февраль–март), норма, 4 недели вниз (сентябрь), остальное норма
  const vals = [...flat(5), ...flat(8, 200), ...flat(22), ...flat(4, 200), ...flat(13)];
  assert.equal(vals.length, 52);
  const s = seasonality(weeks(vals), { lowOf: 0.7, minRun: 2, minWeeks: 8 });
  assert.equal(s.dips, 2);
  assert.equal(s.longest, 8);
  assert.equal(s.downWeeks, 12);
  assert.ok(Math.abs(s.downShare - 12 / 52) < 1e-9);
  assert.equal(s.months.length, 2, "месяцы берутся от отрезка длиной 8, а не от обоих");
  assert.ok(s.monthsLabel.length > 0);
  assert.equal(sub1g(weeks(vals)).status, "fail");
});

test("период просадки называется по-русски: «август», «с октября по март»", () => {
  assert.equal(monthsLabel(["08", "08"]), "август");
  assert.equal(monthsLabel(["10", "03"]), "с октября по март", "«по» требует винительного падежа, а не родительного");
  assert.equal(monthsLabel(["04", "06"]), "с апреля по июнь");
  assert.equal(monthsLabel([]), "", "без просадок период не называется вовсе");
});

test("граница принадлежит норме: неделя ровно на пороге слабой не считается", () => {
  const vals = [...flat(50, 1000), 700, 700]; // 700 === 1000 × 0,7
  const s = seasonality(weeks(vals), { lowOf: 0.7, minRun: 2, minWeeks: 8 });
  assert.equal(s.dips, 0, "сравнение строгое: ровно на границе — ещё норма");
  const below = seasonality(weeks([...flat(50, 1000), 699, 699]), { lowOf: 0.7, minRun: 2, minWeeks: 8 });
  assert.equal(below.dips, 1, "на единицу ниже границы — уже просадка");
});

test("пропуски не считаются ни слабыми неделями, ни нормой", () => {
  const trends = weeks(flat(20));
  trends[5].sv = null; trends[6].sv = null;
  const s = seasonality(trends, { lowOf: 0.7, minRun: 2, minWeeks: 8 });
  assert.equal(s.weeks, 18, "пропуски выброшены и из расчёта, и из длины истории");
  assert.equal(s.dips, 0);
});

test("нулевой ряд не делится на ноль и честно говорит, что судить не по чему", () => {
  assert.equal(seasonality(weeks(flat(20, 0)), { lowOf: 0.7, minRun: 2, minWeeks: 8 }).reason, "no_demand");
  assert.equal(sub1g(weeks(flat(20, 0))).status, "na");
});

test("ручной ответ человека главнее вычисленного", () => {
  const trends = weeks([...flat(26, 1000), ...flat(26, 300)]);
  const r = criterion1({
    xray: null, cerebro: null, poe: { trends },
    inputs: { manualOverrides: { "1g": { value: 0.02 } } }, // человек вводит ЗНАЧЕНИЕ, а не статус
    thresholds: DEFAULT_THRESHOLDS, competition: null, traffic: null,
  });
  assert.equal(r.items["1g"].status, "ok");
  assert.equal(r.items["1g"].source, "manual");
});

test("пороги читаются из набора, а не зашиты в код", () => {
  const trends = weeks([...flat(44), ...flat(8, 200)]); // 8/52 = 15,4 %
  assert.equal(statusOf(trends), "warn", "при умолчаниях 15,4 % — погранично");
  const strict = mergeThresholds({ criterion1: { seasonDownFail: 0.10 } });
  assert.equal(statusOf(trends, strict), "fail", "с более строгим порогом те же данные дают «не ок»");
});

// ---------- D9: старый личный набор не применяется с НОВЫМ смыслом ----------

test("spec 026 D9: старый ключ seasonOk не переносится и не подменяет смысл нового порога", () => {
  // Переименование порогов — ЗАЩИТА, а не косметика. Оставь мы имя `seasonOk`, личный набор
  // с `seasonOk: 0.25` («размах между крайностями 25 % — норма») молча начал бы означать
  // «четверть года в просадках — это нормально»: то же имя при другом смысле.
  // Проверка T036 делалась вручную и сторожа после себя не оставила — вот он.
  const old = { criterion1: { seasonOk: 0.25, seasonFail: 0.6, seasonDownOk: 0.05 } };

  // 1. Сохранение набора выбрасывает ключ, которого нет в умолчаниях (`thresholds.js`: dv === undefined → continue).
  const saved = thresholdOverrides(old);
  assert.deepEqual(saved, { criterion1: { seasonDownOk: 0.05 } },
    "в наборе обязан остаться только известный ключ; старые имена выбрасываются при сохранении");

  // 2. Загрузка набора, где ТОЛЬКО старые ключи, не трогает новые пороги — они из умолчаний.
  const onlyOld = { criterion1: { seasonOk: 0.25, seasonFail: 0.6 } };
  assert.deepEqual(thresholdOverrides(onlyOld), {}, "набор из одних старых имён сохраняется пустым");
  const t = mergeThresholds(onlyOld);
  assert.equal(t.criterion1.seasonDownOk, DEFAULT_THRESHOLDS.criterion1.seasonDownOk);
  assert.equal(t.criterion1.seasonDownFail, DEFAULT_THRESHOLDS.criterion1.seasonDownFail,
    "подкрутка старой величины не смеет применяться к новой — величины несопоставимы");

  // 3. И решение подпункта от старого набора не зависит: 8 недель из 52 — это 15,4 %, то есть «погранично»
  //    при умолчаниях. Если бы seasonFail: 0.6 как-то дотянулся, статус был бы «ок».
  assert.equal(statusOf(weeks([...flat(44), ...flat(8, 200)]), t), "warn");
});
