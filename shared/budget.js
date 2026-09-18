// Бюджет первой закупки (урок 08) и четыре стоп-вопроса (урок 07).
const num = (v) => (v === null || v === undefined || v === "" || Number.isNaN(Number(v)) ? null : Number(v));

export function budget(inputs, th, ctx = {}) {
  const cogs = num(inputs.cogs), ship = num(inputs.shippingPerUnit) ?? 0, units = num(inputs.unitsPerDay) ?? 0;
  const prod = num(inputs.productionDays) ?? 30, shipDays = num(inputs.shippingDays) ?? 30, recv = num(inputs.receivingDays) ?? th.budget.receivingDays;
  const adsReserve = num(inputs.adsReserve) ?? 0, bud = num(inputs.budget);
  const price = num(inputs.price);
  const out = { pending: cogs === null, landed: null, leadDays: prod + shipDays + recv, batchUnits: null, batchCost: null, batches: th.budget.batches, twoBatches: null, adsReserve, need: null, budget: bud, gap: null, status: "pending", markup: null };
  if (cogs !== null) {
    out.landed = cogs + ship;
    out.batchUnits = units * out.leadDays;
    out.batchCost = out.landed * out.batchUnits;
    out.twoBatches = out.batchCost * th.budget.batches;
    out.need = out.twoBatches + adsReserve;
    out.markup = price && out.landed > 0 ? price / out.landed : null;
    if (bud === null) out.status = "unknown";
    else { out.gap = bud - out.need; out.status = out.gap >= 0 ? "ok" : out.gap >= -0.15 * out.need ? "warn" : "fail"; }
  }
  // Стоп-вопросы урока 07
  const roi = ctx.roi ?? null;
  const $ = (v) => (typeof v === "number" ? "$" + Math.round(v).toLocaleString("ru-RU") : "—");
  const pct = (v) => (typeof v === "number" ? Math.round(v * 100) + " %" : "—");
  const bStatus = out.status === "ok" ? "ok" : out.status === "fail" ? "fail" : out.status === "warn" ? "warn" : "na";
  const bDetail = out.pending ? "введите COGS — нужна себестоимость партии"
    : bud === null ? `нужно ${$(out.need)} на две партии + рекламу — укажите свой бюджет`
    : out.gap >= 0 ? `нужно ${$(out.need)}, бюджет ${$(bud)} — запас ${$(out.gap)}`
    : `нужно ${$(out.need)}, бюджет ${$(bud)} — дефицит ${$(-out.gap)} (${Math.round((-out.gap / out.need) * 100)} % от потребности${out.status === "warn" ? ", в пределах допуска 15 %" : ", допуск 15 %"})`;
  const rStatus = roi === null ? "na" : roi >= th.economics.roiOk ? "ok" : roi >= th.economics.roiLoss ? "warn" : "fail";
  const rDetail = roi === null ? "введите цену и COGS" : `ROI ${pct(roi)} ${roi >= th.economics.roiOk ? "≥" : "<"} ${pct(th.economics.roiOk)}${roi < th.economics.roiLoss ? " — убыток (< 100 %)" : roi < th.economics.roiOk ? " — прибыль есть, но ниже порога" : ""}`;
  const vStatus = ctx.revenueStatus === "fail" && ctx.revenueSource === "proxy" ? "warn" : (ctx.revenueStatus ?? "na");
  const vDetail = ctx.revenueMonthly == null ? "нет данных о выручке — загрузите Xray" : `${$(ctx.revenueMonthly)}/мес ${ctx.revenueMonthly >= th.criterion1.nicheRevenueMonthly ? "≥" : "<"} ${$(th.criterion1.nicheRevenueMonthly)}${ctx.revenueSource === "proxy" ? " — по прокси POE (систематически занижена, сверить по Xray)" : ""}`;
  const dStatus = inputs.canDifferentiate === "yes" ? "ok" : inputs.canDifferentiate === "no" ? "fail" : "na";
  const dDetail = inputs.canDifferentiate === "yes" ? "да — есть измеримое отличие" : inputs.canDifferentiate === "no" ? "нет — без отстройки не заходим" : "ответьте в панели «Экономика и бюджет» → «Могу отстроиться?»";
  out.quickScreen = {
    budgetFit: { status: bStatus, text: "Хватает ли бюджета на две партии + рекламу?", detail: bDetail, value: out.gap },
    roi150: { status: rStatus, text: "ROI ≥ 150 % при средней цене продажи?", detail: rDetail, value: roi },
    revenue500k: { status: vStatus, text: "Выручка первой страницы ≥ $500 000/мес?", detail: vDetail, value: ctx.revenueMonthly ?? null },
    differentiation: { status: dStatus, text: "Есть чем отстроиться от конкурентов?", detail: dDetail },
  };
  const q = Object.values(out.quickScreen);
  out.quickScreenStatus = q.some((x) => x.status === "fail") ? "fail" : q.some((x) => x.status === "na") ? "incomplete" : q.some((x) => x.status === "warn") ? "warn" : "ok";
  return out;
}
