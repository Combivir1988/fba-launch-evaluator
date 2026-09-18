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
  out.quickScreen = {
    budgetFit: { status: out.status === "ok" ? "ok" : out.status === "fail" ? "fail" : out.status === "warn" ? "warn" : "na", text: "Продукт подходит под бюджет (две партии + реклама)" },
    roi150: { status: roi === null ? "na" : roi >= th.economics.roiOk ? "ok" : roi >= th.economics.roiLoss ? "warn" : "fail", text: "ROI ≥ 150 % при средней цене продажи", value: roi },
    revenue500k: { status: ctx.revenueStatus === "fail" && ctx.revenueSource === "proxy" ? "warn" : (ctx.revenueStatus ?? "na"),
      text: ctx.revenueSource === "proxy" ? "Выручка первой страницы ≥ $500 000/мес (по прокси POE — систематически занижена, сверить по Xray)" : "Выручка первой страницы ≥ $500 000/мес", value: ctx.revenueMonthly ?? null },
    differentiation: { status: inputs.canDifferentiate === "yes" ? "ok" : inputs.canDifferentiate === "no" ? "fail" : "na", text: "Есть чем отстроиться от конкурентов" },
  };
  const q = Object.values(out.quickScreen);
  out.quickScreenStatus = q.some((x) => x.status === "fail") ? "fail" : q.some((x) => x.status === "na") ? "incomplete" : q.some((x) => x.status === "warn") ? "warn" : "ok";
  return out;
}
