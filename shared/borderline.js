// Пограничные значения (spec 005): показатели, которые отличаются от своего порога не больше чем на borderline.pct (15 %).
// Порог делит «OK / не OK» резко, а данные — оценки с погрешностью: рядом с порогом решение нельзя считать твёрдым.
const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const fmt = {
  money: (v) => "$" + v.toLocaleString("ru-RU", { maximumFractionDigits: Math.abs(v) < 100 ? 2 : 0 }),
  pct: (v) => (v * 100).toLocaleString("ru-RU", { maximumFractionDigits: 1 }) + " %",
  num: (v) => v.toLocaleString("ru-RU", { maximumFractionDigits: 1 }),
};

/**
 * Кандидаты: { id, label, value, threshold, unit, better: "higher"|"lower", pass, fail, economic }
 *  pass — что означает сторона «лучше порога», fail — «хуже порога» (короткие слова для фразы).
 */
function candidates(R, th) {
  const out = []; const c1 = R.criterion1?.items || {}, t1 = th.criterion1, e = R.economics, te = th.economics, tr = R.traffic, tt = th.traffic;
  const add = (o) => { if (isNum(o.value) && isNum(o.threshold) && o.threshold !== 0) out.push({ pass: "OK", fail: "не OK", economic: false, ...o }); };
  const v1 = (k) => (c1[k]?.source === "manual" || isNum(c1[k]?.value) ? c1[k].value : null);
  add({ id: "1a", label: "1a — выручка ниши в месяц", value: v1("1a"), threshold: t1.nicheRevenueMonthly, unit: "money", better: "higher" });
  add({ id: "1b", label: "1b — цена ниши", value: v1("1b"), threshold: t1.priceOk, unit: "money", better: "higher", fail: "погранично" });
  add({ id: "1b-low", label: "1b — цена ниши (нижняя граница)", value: v1("1b"), threshold: t1.priceWarn, unit: "money", better: "higher", pass: "погранично" });
  add({ id: "1c", label: "1c — Adj. SV главного ключа", value: v1("1c"), threshold: t1.adjSv, unit: "num", better: "higher" });
  add({ id: "1d", label: "1d — среднее число отзывов в нише", value: v1("1d"), threshold: t1.reviewsOk, unit: "num", better: "lower", fail: "погранично" });
  add({ id: "1d-high", label: "1d — среднее число отзывов (верхняя граница)", value: v1("1d"), threshold: t1.reviewsFail, unit: "num", better: "lower", pass: "погранично" });
  add({ id: "1e", label: "1e — доля бренда-лидера", value: v1("1e"), threshold: t1.topBrandShare, unit: "pct", better: "lower" });
  add({ id: "1f", label: "1f — доля топ-5 брендов", value: v1("1f"), threshold: t1.top5Ok, unit: "pct", better: "lower", fail: "погранично" });
  add({ id: "1f-high", label: "1f — доля топ-5 брендов (верхняя граница)", value: v1("1f"), threshold: t1.top5Fail, unit: "pct", better: "lower", pass: "погранично" });
  add({ id: "1g", label: "1g — сезонная просадка", value: v1("1g"), threshold: t1.seasonOk, unit: "pct", better: "lower", fail: "погранично" });
  add({ id: "1g-high", label: "1g — сезонная просадка (верхняя граница)", value: v1("1g"), threshold: t1.seasonFail, unit: "pct", better: "lower", pass: "погранично" });
  add({ id: "1h", label: "1h — успешность запусков", value: v1("1h"), threshold: t1.launchOk, unit: "pct", better: "higher", fail: "погранично" });
  if (e && !e.pending) {
    add({ id: "g1-margin", label: "Gate 1 — маржа без рекламы", value: e.gate1?.margin0, threshold: e.cheapSegment ? te.cheapMarginMin : te.marginMin, unit: "pct", better: "higher", pass: "условие выполнено", fail: "условие не выполнено", economic: true });
    if (!e.cheapSegment) add({ id: "g1-profit", label: "Gate 1 — прибыль на юнит", value: e.gate1?.net0, threshold: te.profitMin, unit: "money", better: "higher", pass: "условие выполнено", fail: "условие не выполнено", economic: true });
    add({ id: "roi", label: "ROI без рекламы (стоп-вопрос)", value: e.roi, threshold: te.roiOk, unit: "pct", better: "higher", pass: "да", fail: "почти / нет", economic: true });
    add({ id: "g2-cvr", label: "Gate 2 — безубыточный CVR", value: e.breakEvenCvr, threshold: te.cvrPassMax, unit: "pct", better: "lower", pass: "PASS", fail: "ДОРАБОТКА", economic: true });
    const c2 = e.criterion2 || {};
    if (c2["2j"]?.status !== "pending") add({ id: "2j", label: "2j — ROI с рекламой", value: c2["2j"]?.value, threshold: te.roiAdsMin, unit: "pct", better: "higher", economic: true });
    if (c2["2k"]?.status !== "pending") add({ id: "2k", label: "2k — маржинальность с рекламой", value: c2["2k"]?.value, threshold: te.marginAdsMin, unit: "pct", better: "higher", economic: true });
  }
  if (tr?.source) {
    add({ id: "top2", label: "Доля топ-2 ключей в трафике", value: tr.top2Share, threshold: tt.top2ShareMax, unit: "pct", better: "lower" });
    if (tr.source === "cerebro") add({ id: "relevant", label: "Релевантных ключей", value: tr.relevantCount, threshold: tt.relevantMin, unit: "num", better: "higher" });
  }
  const lr = R.competition?.reviewBarrier?.leaderReviews;
  add({ id: "moat", label: "Отзывы лидера — ров пробиваем", value: lr, threshold: th.reviewsMoat.breakable, unit: "num", better: "lower", pass: "пробиваем", fail: "средний барьер" });
  add({ id: "moat-high", label: "Отзывы лидера — средний барьер", value: lr, threshold: th.reviewsMoat.medium, unit: "num", better: "lower", pass: "средний барьер", fail: "непробиваем" });
  const b = R.budget;
  if (b && isNum(b.budget) && isNum(b.need)) add({ id: "budget", label: b.basis === "cash" ? "Бюджет против пика вложений" : "Бюджет против двух партий", value: b.budget, threshold: b.need, unit: "money", better: "higher", pass: "хватает", fail: "не хватает", economic: true });
  const sc = R.scorecard;
  if (isNum(sc?.total)) for (const [k, name] of [["go", "Go"], ["rework", "Доработка"], ["goPriority", "Go priority"]]) add({ id: "score-" + k, label: `Scorecard — граница «${name}»`, value: sc.total / 100, threshold: th.scorecard.bands[k] / 100, unit: "pct", better: "higher", pass: `${name} и выше`, fail: `ниже ${name}` });
  const rc = R.entry?.reach, co = R.entry?.cohort;
  if (rc?.ok && co?.ok) add({ id: "reach", label: "Нужная доля кликов против новичков ниши", value: rc.requiredShare, threshold: co.shareP75, unit: "pct", better: "lower", pass: "достижимо", fail: "на пределе" });
  return out;
}

export function borderline(R, th) {
  const limit = th.borderline?.pct ?? 0.15; const items = [];
  for (const c of candidates(R, th)) {
    const dist = (c.value - c.threshold) / Math.abs(c.threshold); if (Math.abs(dist) > limit) continue;
    const good = c.better === "higher" ? c.value >= c.threshold : c.value < c.threshold;
    const f = fmt[c.unit], delta = c.value !== 0 ? Math.abs(c.value - c.threshold) / Math.abs(c.value) : Math.abs(dist); // «на сколько должно измениться текущее значение»
    const dir = c.value >= c.threshold ? "снижении" : "росте";
    items.push({ id: c.id, label: c.label, value: c.value, threshold: c.threshold, unit: c.unit, distancePct: dist, side: good ? "pass" : "fail", economic: c.economic,
      text: `сейчас ${f(c.value)} — «${good ? c.pass : c.fail}»; порог ${f(c.threshold)}; ` + (delta < 0.0005 ? `значение стоит прямо на пороге — оценку «${good ? c.fail : c.pass}» даст любая погрешность данных` : `оценка сменится на «${good ? c.fail : c.pass}» при ${dir} на ${(delta * 100).toLocaleString("ru-RU", { maximumFractionDigits: 1 })} %`) });
  }
  items.sort((a, b) => Math.abs(a.distancePct) - Math.abs(b.distancePct));
  return { limit, items };
}
