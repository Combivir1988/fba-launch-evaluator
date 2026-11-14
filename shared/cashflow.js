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
  const vineIn = num(inputs.vineReviews);
  // spec 022, D6: долю с отзывом здесь НЕ СЧИТАЕМ — она приходит контекстом уже разрешённой
  // (ручной ввод → когорта ниши → умолчание). Свой расчёт разошёлся бы со сроком до планки отзывов.
  const reviewRate = pos(num(ctx.reviewRate), pos(num(inputs.reviewRate), t.reviewRate));
  const vine = isNum(vineIn) && vineIn >= 0 ? vineIn : t.vineReviews;
  const out = { pending: true, reason: null, rows: [], horizonMonths: horizon, rampMonths: ramp, leadDays, leadMonths: null, targetMonthly: perDay * 30, startSales: null, startSource: null, startCappedFrom: null,
    firstBatchUnits: null, landed: null, peak: null, peakMonth: null, batches: 0, unitsPurchased: 0, unitsSold: 0, paybackMonth: null, endCum: null, stockUnitsEnd: null, stockValueEnd: null,
    stockoutMonths: 0, cpcMissing: cpc === null, adsReserveUsed: 0, startupCosts: startup, reviewThreshold: isNum(ctx.reviewThreshold) ? ctx.reviewThreshold : null, reviewsReachedMonth: null, first90: null, assumptions: [],
    // spec 020: возвраты, сценарии и точка дозаказа
    lossRate: 0, unitsShipped: 0, scenarios: [], hungriest: null, scenariosDiffer: false, budgetGap: null, reorder: null };
  if (price === null || price <= 0 || cogs === null) { out.reason = "введите цену и COGS — без себестоимости помесячный сценарий не строится"; return out; }
  if (!(perDay > 0)) { out.reason = "задайте цель продаж (штук в день)"; return out; }
  out.pending = false;
  const landed = cogs + ship, payoutUnit = price - price * referral - fba, target = perDay * 30;

  // spec 020: возвращённый товар списывается, значит на ту же цель по ПРОДАННЫМ единицам
  // нужно отгрузить и закупить больше. Доля возвратов приходит контекстом из экономики;
  // если она неизвестна — потерь нет и всё считается ровно как раньше (SC-002).
  const rRet = num(ctx.returnRate);
  const lossRate = rRet === null ? 0 : Math.min(0.95, Math.max(0, rRet * (1 - (th.economics?.resalableShare ?? 0))));
  const shipFactor = 1 / (1 - lossRate);
  out.lossRate = lossRate;
  out.reviewRateSource = ctx.reviewRateSource ?? null; // откуда взялась доля с отзывом (spec 022)
  const L = Math.max(1, Math.round(leadDays / 30)); const T = L + horizon - 1; // последний месяц сценария (продажи идут в месяцы L…T)
  out.landed = landed; out.leadMonths = L;

  // стартовый уровень продаж: ввод менеджера → медиана продаж новичков ниши → 0
  const startIn = num(inputs.startSalesMonthly);
  // ВАЖНО: ограничение целью меняет не только число, но и ОТКУДА оно взялось. Прежде источник
  // оставался «медиана новичков» даже когда медиана была выше цели и число приходило из цели:
  // при цели 30 шт/мес и медиане когорты 386 подпись гласила «старт 30 — медиана продаж новичков».
  // Число из цели, подпись от когорты — читатель думал, что новички продают по 30.
  const cap = (v, src) => (v > target ? { startSales: target, startSource: "target", cappedFrom: { value: v, source: src } } : { startSales: v, startSource: src, cappedFrom: null });
  const picked = isNum(startIn) && startIn >= 0 ? cap(startIn, "input")
    : isNum(ctx.cohortSalesMedian) && ctx.cohortSalesMedian > 0 ? cap(ctx.cohortSalesMedian, "cohort")
    : { startSales: 0, startSource: "zero", cappedFrom: null };
  out.startSales = picked.startSales; out.startSource = picked.startSource; out.startCappedFrom = picked.cappedFrom;
  const demand = (m) => { if (m < L || m > T) return 0; const k = m - L + 1; if (ramp <= 1) return target;
    // известен стартовый уровень — первый месяц продаж идёт на нём; не известен — разгон с нуля, первый месяц = цель ÷ rampMonths
    const f = out.startSource === "zero" ? k / ramp : (k - 1) / (ramp - 1); return out.startSales + (target - out.startSales) * Math.min(1, f); };
  const demandSum = (from, to) => { let s = 0; for (let j = from; j <= to; j++) s += demand(j); return s; };

  const firstIn = num(inputs.firstBatchUnits);
  out.firstBatchUnits = Math.max(1, Math.round(isNum(firstIn) && firstIn > 0 ? firstIn : perDay * leadDays * shipFactor)); // по умолчанию — ОТГРУЗКА за срок поставки

  let stock = 0, cum = 0, minCum = 0, cumSold = 0; const arrivals = new Map();
  const order = (m, qty) => { arrivals.set(m + L, (arrivals.get(m + L) || 0) + qty); out.batches++; out.unitsPurchased += qty; return qty * landed; };
  for (let m = 0; m <= T; m++) {
    const row = { month: m, sellingMonth: m >= L ? m - L + 1 : null, arrived: arrivals.get(m) || 0, ordered: 0, orderCost: 0, startup: 0, demand: demand(m), sold: 0, stockout: false, revenue: 0, payout: 0, ads: 0, cvr: null, net: 0, cum: 0, stockEnd: 0, reviews: 0 };
    stock += row.arrived; arrivals.delete(m);
    if (m === 0) { row.ordered = out.firstBatchUnits; row.orderCost = order(0, row.ordered); row.startup = startup + (out.cpcMissing ? adsReserve : 0); out.adsReserveUsed = out.cpcMissing ? adsReserve : 0; }
    else {
      const onOrder = [...arrivals.values()].reduce((s, q) => s + q, 0), position = stock + onOrder;
      if (m + L <= T && position < demandSum(m, m + L) * shipFactor) {
        const leftover = Math.max(0, position - demandSum(m, m + L - 1) * shipFactor);
        const qty = Math.ceil(demandSum(m + L, Math.min(T, m + 2 * L)) * shipFactor - leftover);
        if (qty > 0) { row.ordered = qty; row.orderCost = order(m, qty); }
      }
    }
    if (row.demand > 0) {
      // со склада уходит ОТГРУЗКА, а продажей остаётся её часть: возвращённые единицы списываются.
      const canShip = stock / shipFactor;
      row.sold = Math.min(row.demand, canShip); row.stockout = row.sold < row.demand - 1e-9; if (row.stockout) out.stockoutMonths++;
      row.shipped = row.sold * shipFactor; row.returned = row.shipped - row.sold;
      stock -= row.shipped; out.unitsShipped += row.shipped;
      row.revenue = row.sold * price;
      // возвращённая единица: цену вернули покупателю, комиссию вернули нам, сбор за отправку остался уплаченным.
      row.payout = row.sold * payoutUnit - row.returned * fba;
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
  // Первые месяцы продаж на горизонте Критерия 2 (90 дней): те же показатели 2g–2i, но по сценарию разгона, а не на целевом уровне.
  // Прибыль здесь «по отгрузке» (продано × прибыль с единицы − реклама), чтобы сравнивалась с 2i; деньги партий — в пике вложений.
  const pm = Math.max(1, Math.round((th.economics?.periodDays ?? 90) / 30)), firstRows = out.rows.filter((r) => r.sellingMonth && r.sellingMonth <= pm);
  const fUnits = firstRows.reduce((a, r) => a + r.sold, 0), fAds = firstRows.reduce((a, r) => a + r.ads, 0);
  out.first90 = { months: pm, days: pm * 30, units: fUnits, revenue: fUnits * price, ads: fAds, profit: fUnits * (payoutUnit - landed) - fAds, targetUnits: target * pm };
  // месяц возврата: первый месяц, начиная с которого итог нарастающим неотрицателен до конца горизонта
  let pay = null; for (let i = out.rows.length - 1; i >= 1; i--) { if (out.rows[i].cum >= 0) pay = out.rows[i].month; else break; }
  out.paybackMonth = pay;

  // ---------- сценарии продаж (spec 020) ----------
  // Три прогона той же модели с разной скоростью разгона; цель общая — её задаёт менеджер.
  // Замер 2026-11-12: самый глубокий пик у БЫСТРОГО роста, а не у медленного. Медленные продажи
  // означают более редкие и меньшие дозаказы, поэтому денег им нужно МЕНЬШЕ.
  // Денег не хватает не когда продажи провалились, а когда они пошли.
  if (!ctx.scenarioOnly) {
    const own = { key: "base", rampMonths: ramp, peak: out.peak, peakMonth: out.peakMonth, paybackMonth: out.paybackMonth, batches: out.batches, unitsPurchased: out.unitsPurchased };
    const side = (key, factor) => {
      const r = cashflow({ ...inputs, rampMonths: Math.max(1, Math.round(ramp * factor)) }, th, { ...ctx, scenarioOnly: true });
      return { key, rampMonths: r.rampMonths, peak: r.peak, peakMonth: r.peakMonth, paybackMonth: r.paybackMonth, batches: r.batches, unitsPurchased: r.unitsPurchased };
    };
    out.scenarios = [side("slow", t.slowFactor), own, side("fast", t.fastFactor)];
    out.hungriest = out.scenarios.reduce((a, b) => (b.peak > a.peak ? b : a)).key;
    // Замер на 56 живых анализах 2026-11-12: три сценария реально различаются только в 32 из них.
    // В остальных пик задаёт ПЕРВАЯ партия (её размер от скорости разгона не зависит), и три строки
    // выглядят одинаково. Честнее сказать это словами, чем показывать видимость выбора.
    const uniq = (f) => new Set(out.scenarios.map(f)).size;
    out.scenariosDiffer = uniq((x) => Math.round(x.peak)) > 1 || uniq((x) => x.paybackMonth) > 1;

    // Предупреждение считается по ВСЕМ сценариям: проверять только медленный значило бы молчать
    // про самый вероятный способ остаться без денег.
    const budget = num(inputs.budget);
    const worst = out.scenarios.find((x) => x.key === out.hungriest);
    out.budgetGap = isNum(budget) && budget > 0 && worst.peak > budget
      ? { scenario: worst.key, need: worst.peak, budget, amount: worst.peak - budget } : null;
  }

  // ---------- точка дозаказа ----------
  // Считается от всей цепочки поставки, а не от остатка: решение принимают за недели до того,
  // как покупатели увидят, что товара мало.
  out.reorder = leadDays > 0
    ? { days: leadDays + t.safetyDays, units: Math.round(perDay * (leadDays + t.safetyDays) * shipFactor), leadDays, safetyDays: t.safetyDays, note: null }
    : { days: null, units: null, leadDays, safetyDays: t.safetyDays, note: "срок поставки не задан — точку дозаказа считать не от чего" };

  out.assumptions.push(`разгон продаж за ${ramp} мес. от ${Math.round(out.startSales)} шт/мес (${{ input: "задано вручную", cohort: "медиана продаж новичков ниши", zero: "данных о новичках нет — с нуля", target: "это и есть цель: " + (out.startCappedFrom?.source === "cohort" ? "новички ниши продают больше (" + Math.round(out.startCappedFrom.value) + " шт/мес), и разгона не требуется" : "введённый старт (" + Math.round(out.startCappedFrom?.value ?? 0) + " шт/мес) выше цели") }[out.startSource]}) до ${Math.round(target)} шт/мес`);
  out.assumptions.push(`срок поставки ${leadDays} дн. ≈ ${L} мес.; партия оплачивается целиком при заказе`);
  out.assumptions.push(out.cpcMissing ? `CPC неизвестен — реклама по месяцам не посчитана${adsReserve ? `, резерв на рекламу $${Math.round(adsReserve)} списан в месяце 0` : ""}` : `реклама = продажи × доля PPC ${Math.round(ppc * 100)} % × CPC ÷ CVR${isNum(out.reviewThreshold) ? `; до планки ${Math.round(out.reviewThreshold)} отзывов CVR × ${t.newListingCvrFactor}` : ""}${adsReserve ? "; резерв на рекламу в сценарий не добавляется — реклама уже посчитана по месяцам" : ""}`);
  out.assumptions.push("выплаты Amazon приходят с задержкой до двух недель и хранение на складе не учтены — держите запас сверх пика");
  return out;
}
