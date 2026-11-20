// Spec 027: текст о том, что операция уже идёт и прогон ЧУЖОЙ.
// Вынесен отдельно, чтобы ворота SC-004 проверяли сам текст, а не рисование страницы.
//
// Молчать об этом нельзя: человек решил бы, что прогон его, и не понял бы, почему результат
// посчитан не по его параметрам (другая модель, другая схема полей, другой охват).

/** @param {{startedBy?: string, startedAt?: number, differs?: Array<{what:string,mine:string,theirs:string}>}} j */
export function joinedNote(j, now = Date.now()) {
  const mins = Math.max(0, Math.round((now - (j?.startedAt || now)) / 60000));
  const who = j?.startedBy || "другой пользователь";
  const when = mins < 1 ? "только что" : `${mins} мин назад`;
  const d = Array.isArray(j?.differs) ? j.differs : [];
  // Пустой список — нормальное и частое значение. Несуществующее расхождение не выдумываем (FR-011).
  const diff = d.length
    ? ` Параметры расходятся: ${d.map((x) => `${x.what} — у вас «${x.mine}», в работе «${x.theirs}»`).join("; ")}.`
    : " Параметры совпадают.";
  return `Эту операцию ${when} запустил(а) ${who} — идёт один прогон на всех, вы видите его ход.${diff} Отмена прервёт работу и у ${who}.`;
}
