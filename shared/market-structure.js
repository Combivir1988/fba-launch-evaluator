// Структура рынка (spec 020): один вывод из двух направлений и текущего уровня концентрации.
//
// Важное ограничение источников. Уровень концентрации (spec 019) считается по ТЕКУЩЕМУ срезу
// листингов и истории не имеет — строить по нему динамику нельзя в принципе. Направление берётся
// только из отчёта ниши, где у каждого показателя есть значения «сейчас», «квартал назад» и «год назад».
// Поэтому без такого отчёта вывод не делается вовсе: лучше молчать, чем выдумать направление.

const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** Насколько изменение считать значимым, а не шумом измерения. */
const DEMAND_FLAT = 0.05;      // рост поиска в пределах ±5 % за год — стояние на месте
const CONC_FLAT = 0.02;        // доля топ-5 сдвинулась меньше чем на 2 п.п. — не движение
const FRAGMENTED = 1500;       // та же граница, что и у подпункта концентрации

/**
 * @param {object} p { poe, competition }
 * @param {object} th пороги
 */
export function marketStructure(p, th) {
  const level = num(p?.competition?.hhi);
  const out = { verdict: null, text: null, note: null, demandDirection: null, concentrationDirection: null, concentrationLevel: level };

  const poe = p?.poe;
  const sv = num(poe?.nicheSummary?.searchVolumeGrowthT360);
  const top5 = poe?.launchPotential?.top5BrandsClickShareT360;
  const now = num(top5?.current), yearAgo = num(top5?.yoy);

  if (sv === null || now === null || yearAgo === null) {
    out.note = poe
      ? "В отчёте ниши нет значений за год — направление спроса и концентрации посчитать не из чего, вывод не делается."
      : "Отчёт ниши не загружен. Уровень концентрации виден, а направления — нет: оно считается только по истории, и выдумывать его нельзя.";
    return out;
  }

  const dDelta = now - yearAgo;
  out.demandDirection = { value: sv, label: sv > DEMAND_FLAT ? "спрос растёт" : sv < -DEMAND_FLAT ? "спрос падает" : "спрос стоит на месте" };
  out.concentrationDirection = { value: dDelta, now, yearAgo,
    label: dDelta > CONC_FLAT ? "концентрация растёт" : dDelta < -CONC_FLAT ? "концентрация падает" : "концентрация не меняется" };

  const растёт = sv > DEMAND_FLAT, падает = sv < -DEMAND_FLAT;
  const сжимается = dDelta > CONC_FLAT, расходится = dDelta < -CONC_FLAT;

  if (падает) {
    out.verdict = "shrinking";
    out.text = "Спрос в нише падает. Входить можно только с явным отличием и коротким сроком возврата денег: место освобождается не потому, что его уступают, а потому, что рынок уходит.";
  } else if (растёт && расходится) {
    out.verdict = "room";
    out.text = "Спрос растёт, а доля крупнейших марок снижается — место для входа есть: рынок прибавляет быстрее, чем лидеры успевают его занимать.";
  } else if (растёт && сжимается) {
    out.verdict = "consolidating";
    out.text = "Спрос растёт, но доля крупнейших марок тоже — лидеры забирают прирост себе. Подвинуть их дороже: нужен заметный повод выбрать вас, а не просто присутствие.";
  } else if (level !== null && level < FRAGMENTED) {
    out.verdict = "fragmented";
    out.text = "Рынок сильно раздроблен: свободное место есть, но лояльности мало и цену будут ронять. Выигрывает не тот, кто зашёл, а тот, кто удержал отличие.";
  } else {
    out.verdict = "steady";
    out.text = "Спрос и расстановка сил почти не меняются. Доля достаётся не за счёт роста рынка, а отнимается у конкретных конкурентов — значит нужен повод выбрать вас вместо них.";
  }
  return out;
}
