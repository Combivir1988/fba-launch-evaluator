// Деньги по месяцам (spec 005): вместо одной суммы «две партии + реклама» — сценарий с разгоном продаж, дозаказом партий и рекламой.
// Правила сценария:
//  • месяц 0 — оплата первой партии и стартовых расходов; продажи начинаются, когда партия дошла (срок поставки, округлённый до месяцев);
//  • продажи растут линейно от стартового уровня до цели за rampMonths месяцев продаж;
//  • партия оплачивается целиком при заказе по полной себестоимости (товар + доставка); с продаж себестоимость НЕ вычитается второй раз;
//  • дозаказ — в начале месяца, если «склад + в пути» не покрывает спрос на срок поставки + 1 месяц; партия заказывается, только если успеет прийти до конца горизонта;
//  • поступления = продажи × (цена − комиссия − FBA); реклама = продажи × доля PPC × CPC ÷ CVR; до планки отзывов CVR ниже (× newListingCvrFactor);
//  • «деньги вернулись» — месяц, после которого итог нарастающим больше не уходит в минус.
const num = (v) => (v === null || v === undefined || v === "" || Number.isNaN(Number(v)) ? null : Number(v));
const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const pos = (v, d) => (isNum(v) && v > 0 ? v : d);

/**
 * @param {object} inputs — поля анализа (price уже «эффективная»: введённая или медиана 1b; cpc — введённый или из Cerebro)
 * @param {object} th — пороги (th.cashflow, th.budget)
 * @param {object} ctx { cohortSalesMedian, reviewThreshold }
 */
export function cashflow(inputs, th, ctx = {}) {
  const t = th.cashflow;
  const price = num(inputs.price), cogs = num(inputs.cogs), ship = num(inputs.shippingPerUnit) ?? 0, referral = num(inputs.referralPct) ?? 0.15, fba = num(inputs.fbaFee) ?? 0;
  const cpc = num(inputs.cpc), cvr = pos(num(inputs.cvr), 0.10), ppc = num(inputs.ppcShare) ?? 0.70, perDay = num(inputs.unitsPerDay) ?? 0;
  const leadDays = (num(inputs.productionDays) ?? 30) + (num(inputs.shippingDays) ?? 30) + (num(inputs.receivingDays) ?? th.budget.receivingDays);
  const horizon = Math.round(pos(num(inputs.horizonMonths), t.horizonMonths)), ramp = Math.max(1, Math.round(pos(num(inputs.rampMonths), t.rampMonths)));
  const startup = Math.max(0, num(inputs.startupCosts) ?? 0), adsReserve = Math.max(0, num(inputs.adsReserve) ?? 0);
  const rateIn = num(inputs.reviewRate), vineIn = num(inputs.vineReviews);
  const reviewRate = pos(rateIn, t.reviewRate), vine = isNum(vineIn) && vineIn >= 0 ? vineIn : t.vineReviews;
  const out = { pending: true, reason: null, rows: [], horizonMonths: horizon, rampMonths: ramp, leadDays, leadMonths: null, targetMonthly: perDay * 30, startSales: null, startSource: null,
    firstBatchUnits: null, landed: null, peak: null, peakMonth: null, batches: 0, unitsPurchased: 0, unitsSold: 0, paybackMonth: null, endCum: null, stockUnitsEnd: null, stockValueEnd: null,
    stockoutMonths: 0, cpcMissing: cpc === null, adsReserveUsed: 0, startupCosts: startup, reviewThreshold: isNum(ctx.reviewThreshold) ? ctx.reviewThreshold : null, reviewsReachedMonth: null, assumptions: [] };
  if (price === null || price <= 0 || cogs === null) { out.reason = "введите цену и COGS — без себестоимости помесячный сценарий не строится"; return out; }
  if (!(perDay > 0)) { out.reason = "задайте цель продаж (штук в день)"; return out; }
  out.pending = false;
  const landed = cogs + ship, payoutUnit = price - price * referral - fba, target = perDay * 30;
  const L = Math.max(1, Math.round(leadDays / 30)); const T = L + horizon - 1; // последний месяц сценария (продажи идут в месяцы L…T)
  out.landed = landed; out.leadMonths = L;

  // стартовый уровень продаж: ввод менеджера → медиана продаж новичков ниши → 0
  const startIn = num(inputs.startSalesMonthly);
  if (isNum(startIn) && startIn >= 0) { out.startSales = Math.min(startIn, target); out.startSource = "input"; }
  else if (isNum(ctx.cohortSalesMedian) && ctx.cohortSalesMedian > 0) { out.startSales = Math.min(ctx.cohortSalesMedian, target); out.startSource = "cohort"; }
  else { out.startSales = 0; out.startSource = "zero"; }
  const demand = (m) => { if (m < L || m > T) return 0; const k = m - L + 1; if (ramp <= 1) return target;
    // известен стартовый уровень — первый месяц продаж идёт на нём; не известен — разгон с нуля, первый месяц = цель ÷ rampMonths
    const f = out.startSource === "zero" ? k / ramp : (k - 1) / (ramp - 1); return out.startSales + (target - out.startSales) * Math.min(1, f); };
  const demandSum = (from, to) => { let s = 0; for (let j = from; j <= to; j++) s += demand(j); return s; };

  const firstIn = num(inputs.firstBatchUnits);
  out.firstBatchUnits = Math.max(1, Math.round(isNum(firstIn) && firstIn > 0 ? firstIn : perDay * leadDays)); // по умолчанию — продажи за срок поставки

  let stock = 0, cum = 0, minCum = 0, cumSold = 0; const arrivals = new Map();
  const order = (m, qty) => { arrivals.set(m + L, (arrivals.get(m + L) || 0) + qty); out.batches++; out.unitsPurchased += qty; return qty * landed; };
  for (let m = 0; m <= T; m++) {
    const row = { month: m, sellingMonth: m >= L ? m - L + 1 : null, arrived: arrivals.get(m) || 0, ordered: 0, orderCost: 0, startup: 0, demand: demand(m), sold: 0, stockout: false, revenue: 0, payout: 0, ads: 0, cvr: null, net: 0, cum: 0, stockEnd: 0, reviews: 0 };
    stock += row.arrived; arrivals.delete(m);
    if (m === 0) { row.ordered = out.firstBatchUnits; row.orderCost = order(0, row.ordered); row.startup = startup + (out.cpcMissing ? adsReserve : 0); out.adsReserveUsed = out.cpcMissing ? adsReserve : 0; }
    else {
      const onOrder = [...arrivals.values()].reduce((s, q) => s + q, 0), position = stock + onOrder;
      if (m + L <= T && position < demandSum(m, m + L)) {
        const leftover = Math.max(0, position - demandSum(m, m + L - 1));
        const qty = Math.ceil(demandSum(m + L, Math.min(T, m + 2 * L)) - leftover);
        if (qty > 0) { row.ordered = qty; row.orderCost = order(m, qty); }
      }
    }
    if (row.demand > 0) {
      row.sold = Math.min(row.demand, stock); row.stockout = row.sold < row.demand - 1e-9; if (row.stockout) out.stockoutMonths++;
      stock -= row.sold; row.revenue = row.sold * price; row.payout = row.sold * payoutUnit;
      const reviewsBefore = (m > L ? vine : 0) + reviewRate * cumSold; // отзывы Vine появляются к концу первого месяца продаж
      const young = isNum(out.reviewThreshold) && reviewsBefore < out.reviewThreshold;
      row.cvr = cvr * (young ? t.newListingCvrFactor : 1);
      row.ads = cpc === null ? 0 : (row.sold * ppc * cpc) / row.cvr;
      cumSold += row.sold;
    }
    row.reviews = (m >= L ? vine : 0) + reviewRate * cumSold;
    if (out.reviewsReachedMonth === null && isNum(out.reviewThreshold) && m >= L && row.reviews >= out.reviewThreshold) out.reviewsReachedMonth = m;
    row.net = row.payout - row.ads - row.orderCost - row.startup; cum += row.net; row.cum = cum; row.stockEnd = stock;
    if (cum < minCum) { minCum = cum; out.peakMonth = m; }
    out.rows.push(row);
  }
  out.unitsSold = cumSold; out.peak = -minCum; out.endCum = cum; out.stockUnitsEnd = stock; out.stockValueEnd = stock * landed;
  // месяц возврата: первый месяц, начиная с которого итог нарастающим неотрицателен до конца горизонта
  let pay = null; for (let i = out.rows.length - 1; i >= 1; i--) { if (out.rows[i].cum >= 0) pay = out.rows[i].month; else break; }
  out.paybackMonth = pay;

  out.assumptions.push(`разгон продаж за ${ramp} мес. от ${Math.round(out.startSales)} шт/мес (${{ input: "задано вручную", cohort: "медиана продаж новичков ниши", zero: "данных о новичках нет — с нуля" }[out.startSource]}) до ${Math.round(target)} шт/мес`);
  out.assumptions.push(`срок поставки ${leadDays} дн. ≈ ${L} мес.; партия оплачивается целиком при заказе`);
  out.assumptions.push(out.cpcMissing ? `CPC неизвестен — реклама по месяцам не посчитана${adsReserve ? `, резерв на рекламу $${Math.round(adsReserve)} списан в месяце 0` : ""}` : `реклама = продажи × доля PPC ${Math.round(ppc * 100)} % × CPC ÷ CVR${isNum(out.reviewThreshold) ? `; до планки ${Math.round(out.reviewThreshold)} отзывов CVR × ${t.newListingCvrFactor}` : ""}${adsReserve ? "; резерв на рекламу в сценарий не добавляется — реклама уже посчитана по месяцам" : ""}`);
  out.assumptions.push("выплаты Amazon приходят с задержкой до двух недель и хранение на складе не учтены — держите запас сверх пика");
  return out;
}
