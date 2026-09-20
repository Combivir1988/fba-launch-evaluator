/* FBA Launch Evaluator — рендер дашборда. Классический скрипт (window.FBARender), без import:
   тот же код инлайнится в автономный HTML-экспорт. Требует Chart.js (window.Chart). */
(function () {
  "use strict";
  const VLABEL = { go: "Go", go_conditional: "Go, условно", rework: "Доработка", no_go: "No-Go" };
  const STATUS_LABEL = { ok: "OK", warn: "ПОГРАНИЧНО", fail: "НЕ OK", na: "нет данных", pending: "ожидает", pass: "PASS", rework: "ДОРАБОТКА", no_go: "NO-GO" };
  const KIND_ICON = { confirmed: "🟢", assumed: "🟡", decided: "🔵", unknown: "⚪" };
  const SRC_LABEL = { xray: "Xray", cerebro: "Cerebro", poe: "POE", proxy: "ПРОКСИ POE", manual: "вручную", sqp: "SQP" };

  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const isNum = (v) => typeof v === "number" && Number.isFinite(v);
  const fmtN = (v, d = 0) => (isNum(v) ? v.toLocaleString("ru-RU", { maximumFractionDigits: d, minimumFractionDigits: d }) : "—");
  const fmtMoney = (v, d = 0) => (isNum(v) ? (v < 0 ? "−" : "") + "$" + Math.abs(v).toLocaleString("ru-RU", { maximumFractionDigits: d, minimumFractionDigits: d }) : "—");
  const fmtK = (v) => (!isNum(v) ? "—" : Math.abs(v) >= 1e6 ? "$" + (v / 1e6).toFixed(2) + "M" : Math.abs(v) >= 1e3 ? "$" + Math.round(v / 1e3) + "k" : "$" + Math.round(v));
  const fmtPct = (v, d = 0) => (isNum(v) ? (v * 100).toLocaleString("ru-RU", { maximumFractionDigits: d, minimumFractionDigits: d }) + " %" : "—");
  const fmtDate = (iso) => (iso ? new Date(iso).toLocaleString("ru-RU", { dateStyle: "medium", timeStyle: "short" }) : "—");
  const st = (s) => `<span class="status ${esc(s)}">${esc(STATUS_LABEL[s] || s)}</span>`;
  const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const series = () => ["--s1", "--s2", "--s3", "--s4", "--s5", "--s6", "--s7", "--s8"].map(cssVar);

  // ---------- charts ----------
  function chartDefaults() {
    if (!window.Chart) return;
    const C = window.Chart;
    C.defaults.color = cssVar("--text-2");
    C.defaults.borderColor = cssVar("--grid");
    C.defaults.font.family = cssVar("--font") || "system-ui, sans-serif";
    C.defaults.font.size = 12;
    C.defaults.plugins.legend.labels.boxWidth = 10;
    C.defaults.plugins.legend.labels.boxHeight = 10;
    C.defaults.animation = matchMedia("(prefers-reduced-motion: reduce)").matches ? false : { duration: 250 };
    C.defaults.maintainAspectRatio = false;
  }
  function chartFail(canvas, msg) {
    const box = canvas.closest(".chartbox") || canvas.parentElement;
    if (box) box.innerHTML = `<div class="notice fail" style="height:100%;display:flex;align-items:center;justify-content:center;text-align:center">${esc(msg)}</div>`;
  }
  function mkChart(container, id, cfg) {
    const canvas = container.querySelector(`#${id}`);
    if (!canvas) return null;
    if (!window.Chart) { chartFail(canvas, "Chart.js не загрузился (vendor/chart.umd.js) — проверьте блокировщик скриптов и консоль браузера (F12)"); return null; }
    container.__charts = container.__charts || {};
    if (container.__charts[id]) { try { container.__charts[id].destroy(); } catch {} }
    try {
      const ctx = canvas.getContext("2d");
      if (!ctx) { chartFail(canvas, "Браузер не даёт 2D-контекст canvas (расширение приватности / аппаратное ускорение)"); return null; }
      const ch = new window.Chart(ctx, cfg);
      container.__charts[id] = ch;
      // страховка: если контейнер ещё не имел размера на момент создания — перерисовать
      requestAnimationFrame(() => { try { if (!ch.width || !ch.height) ch.resize(); } catch {} });
      return ch;
    } catch (e) {
      console.error("chart", id, e);
      chartFail(canvas, "График не отрисован: " + (e?.message || e));
      return null;
    }
  }
  const grid = { color: cssVar("--grid") };
  const tooltipMoney = (d) => (ctx) => `${ctx.dataset.label ? ctx.dataset.label + ": " : ""}${fmtMoney(ctx.parsed.y ?? ctx.parsed.x, d)}`;

  // ---------- sections ----------
  // ---------- ценовой диапазон анализа (spec 003) ----------
  const bandOf = (R) => (R.priceBand?.active ? R.priceBand : null);
  const inBandR = (price, b) => !b || (isNum(price) && (b.min === null || price >= b.min) && (b.max === null || price <= b.max));
  const shareWord = (b) => (b.weightLabel === "revenue" ? "выручки ниши" : "кликов ниши");
  function bandNote(R, o) {
    const pb = R.priceBand; if (!pb) return "";
    if (pb.valid === false) return o.static ? "" : `<div class="notice bandnote">Ценовой диапазон не применён: ${esc(pb.error || "некорректные границы")}. Анализ посчитан по всей нише.</div>`;
    if (!pb.active) return "";
    const warn = [];
    if (pb.sample === "insufficient") warn.push(`в диапазоне меньше минимума листингов — конкурентные показатели диапазона не считаются («нет данных»)`);
    else if (pb.sample === "small") warn.push(`малая выборка — доли брендов и медианы в диапазоне ненадёжны`);
    if (pb.myPriceOutside) warn.push("цена вашего товара вне заданного диапазона");
    return `<div class="notice info bandnote"><b>Анализ сужен до цен ${esc(pb.label)}:</b> ${fmtN(pb.inCount)} из ${fmtN(pb.totalCount)} листингов${isNum(pb.revenueShare) ? `, ${fmtPct(pb.revenueShare)} ${shareWord(pb)}` : ""}${pb.noPrice ? `; без цены в отчёте — ${fmtN(pb.noPrice)}` : ""}. Конкуренты, бренды, отзывы и критерии 3–8 — по диапазону; спрос по ключам, сезонность и размер рынка (1a) — по всей нише.${warn.length ? ` <b>Внимание:</b> ${esc(warn.join("; "))}.` : ""}</div>`;
  }
  const bandChip = (R, kind) => (bandOf(R) ? (kind === "band" ? ` <span class="chip band" title="Посчитано только по листингам ценового диапазона ${esc(R.priceBand.label)}">в диапазоне</span>` : ' <span class="chip whole" title="Поисковый спрос и размер рынка не делятся по цене — показатель по всей нише">вся ниша</span>') : "");

  function mergedNote(A) {
    const m = A.aggregates?.poe?.merged; if (!m) return "";
    return `<div class="notice info bandnote"><b>POE объединён из ${m.count} ниш:</b> ${m.niches.map((n) => `${esc(n.title)} — ${fmtPct(n.weight)}`).join(" · ")}. Товаров без дублей ${fmtN(m.asinsTotal)} (общих ${fmtN(m.overlapAsins)}), запросов ${fmtN(m.termsTotal)} (общих ${fmtN(m.overlapTerms)}). Доли кликов, конверсия клика и новички посчитаны по общему рынку; что сложено, а что взято приближённо — в секции «Вход в нишу» → «Особенности данных POE».</div>`;
  }
  function secHero(A, R, o) {
    const ai = A.ai; const v = ai?.verdict || R.verdict.ceiling;
    const srcs = ["xray", "cerebro", "poe", "sqp"].filter((k) => A.sources?.[k]).map((k) => { const m = A.sources[k]; return `<span class="chip" title="${esc(k === "poe" && m.parts?.length > 1 ? m.parts.map((p) => p.nicheTitle || p.fileName).join(" + ") : m.fileName || "")}">${SRC_LABEL[k]}${k === "poe" && m.parts?.length > 1 ? ` · ${m.parts.length} ниш(и)` : ""} · ${fmtN(m.rows)} ${k === "xray" || k === "poe" ? "ASIN" : "строк"}${m.duplicatesDropped ? ` · дублей удалено ${m.duplicatesDropped}` : ""}</span>`; }).join(" ");
    const snap = o.snapshot ? `<div class="notice info snapnote">Подготовил(а): <b>${esc(o.snapshot.preparedBy || "—")}</b> · снимок от ${fmtDate(o.snapshot.snapshotAt)} · только чтение${o.snapshot.mode === "no_economics" ? " · закупочная экономика скрыта автором" : ""}</div>` : "";
    return `${snap}<div class="hero">
      <div><h1>${esc(A.niche || "Без названия")}</h1>
        <div class="meta">Ключ: <b>${esc(A.coreKeyword || "—")}</b> · ${esc(A.marketplace || "US")} · расчёт ${fmtDate(R.computedAt)} · методология ${esc(R.methodologyVersion || "")}</div>
        <div class="chips" style="margin-top:.4rem">${srcs || '<span class="chip na">файлы не загружены</span>'}</div>
        <p class="muted" style="margin-top:.4rem">${esc(R.gate0.note)}</p>${mergedNote(A)}${bandNote(R, o)}</div>
      <div class="verdict ${esc(v)}"><div class="k muted">${ai ? "Вердикт AI" + (ai.adjustedByRules ? " (скорректирован правилами)" : "") : "Потолок по правилам"}</div>
        <div class="big">${esc(VLABEL[v])}</div>
        <div class="muted">Критерий 1: <b>${R.criterion1.okCount} из 8</b> · решающий: ${esc(ai?.decisiveGate || R.verdict.decisiveGate || "—")}</div>
        ${ai?.staleSince ? '<div class="notice" style="margin-top:.4rem">Входные данные изменились после AI-анализа — вердикт может устареть.</div>' : ""}</div></div>`;
  }

  function secOverview(A, R) {
    const c = R.criterion1.items, poe = A.aggregates?.poe, comp = R.competition, tr = R.traffic, sc = R.scorecard;
    const lp = poe?.launchPotential || {};
    const t = (k, v, s, cls = "") => `<div class="tile ${cls}"><div class="k">${k}</div><div class="v">${v}</div><div class="s">${s || ""}</div></div>`;
    return `<h2>Обзор</h2><div class="tiles">
      ${t("Выручка ниши", fmtK(c["1a"].value) + "/мес", (SRC_LABEL[c["1a"].source] || "нет данных") + (bandOf(R) ? ` · в диапазоне ${isNum(c["1a"].bandValue) ? fmtK(c["1a"].bandValue) + " (" + fmtPct(c["1a"].bandShare) + ")" : fmtPct(c["1a"].bandShare) + " кликов"}` : ""), c["1a"].status)}
      ${t("Средняя цена" + bandChip(R, "band"), fmtMoney(c["1b"].value, 2), c["1b"].source === "xray" ? "медиана проверенных" : SRC_LABEL[c["1b"].source] || "", c["1b"].status)}
      ${t("Adj. SV" + bandChip(R, "whole"), fmtN(c["1c"].value) + "/мес", SRC_LABEL[c["1c"].source] || "", c["1c"].status)}
      ${t("Отзывы (ср. / мед.)" + bandChip(R, "band"), `${fmtN(c["1d"].value)} / ${fmtN(c["1d"].median)}`, (c["1d"].source === "poe" ? "POE: только с текстом · " : "") + "барьер: " + (comp.reviewBarrier.tier === "moat" ? "непробиваем" : comp.reviewBarrier.tier === "medium" ? "средний" : comp.reviewBarrier.tier === "breakable" ? "пробиваем" : "—"), c["1d"].status)}
      ${t("Top brand" + bandChip(R, "band"), fmtPct(c["1e"].value), esc(comp.topBrand || ""), c["1e"].status)}
      ${t("Топ-5 брендов" + bandChip(R, "band"), fmtPct(c["1f"].value), comp.source === "xray" ? "доля выручки" : "click share", c["1f"].status)}
      ${poe ? t("SV ниши T360", fmtN(poe.nicheSummary.searchVolumeT360), "рост за год " + fmtPct(poe.nicheSummary.searchVolumeGrowthT360), "") : ""}
      ${poe ? t("Товары / бренды", `${fmtN(lp.productCount?.current)} / ${fmtN(lp.brandCount?.current)}`, `продавцов ${fmtN(lp.sellingPartnerCount?.current)}`, "") : ""}
      ${tr.poeConcentration ? t("Спонсорских", fmtPct(tr.poeConcentration.sponsoredPct), tr.poeConcentration.flags.adWar ? "рекламная война" : "доля товаров с PPC", tr.poeConcentration.flags.adWar ? "warn" : "") : ""}
      ${tr.poeConcentration ? t("Конверсия поиска", fmtPct(tr.poeConcentration.searchConv, 1), tr.poeConcentration.flags.unmetDemand ? "< 1 % — спрос не удовлетворён" : "взвешенная по SV", tr.poeConcentration.flags.unmetDemand ? "warn" : "") : ""}
      ${tr.poeConcentration && isNum(tr.poeConcentration.returnRate) ? t("Возвраты", fmtPct(tr.poeConcentration.returnRate, 1), "returnRateT360", "") : ""}
      ${t("Критерий 1", `${R.criterion1.okCount}/8`, R.criterion1.redItems.length ? "красные: " + R.criterion1.redItems.join(", ") : R.criterion1.pass ? "пройден" : "ниже порога", R.criterion1.pass ? "ok" : "fail")}
      ${t("Scorecard", isNum(sc.total) ? Math.round(sc.total) + " %" : "—", sc.band ? ({ go_priority: "Go priority", go: "Go", rework: "Доработка", no_go: "No-Go" }[sc.band]) + (sc.weakest ? " · слабая ось: " + axisName(sc.weakest) : "") : "", sc.band === "no_go" ? "fail" : sc.band === "rework" ? "warn" : sc.band ? "ok" : "na")}
    </div>`;
  }
  const axisName = (k) => ({ market: "Market", competition: "Competition", economics: "Economics", brandFit: "Brand-fit", opRisk: "Op. risk" }[k] || k);

  function secCriterion1(A, R) {
    const c1 = R.criterion1;
    const rows = Object.entries(c1.items).map(([k, it]) => {
      const val = it.value === null ? "—" : it.pct ? fmtPct(it.value, 1) : k === "1a" ? fmtK(it.value) : k === "1b" ? fmtMoney(it.value, 2) : fmtN(it.value, k === "1h" ? 0 : 0);
      return `<div class="gate ${esc(it.status)}"><div class="id">${k}</div><div>${esc(NAMES1[k])} ${it.source ? `<span class="chip src">${esc(SRC_LABEL[it.source] || it.source)}</span>` : ""}${bandOf(R) ? bandChip(R, it.inBand ? "band" : "whole") : ""}</div>
        <div class="val">${val}</div><div class="thr muted">${esc(it.threshold)}</div><div>${st(it.status)}</div>
        ${it.note ? `<div class="note">${esc(it.note)}</div>` : ""}${k === "1a" && bandOf(R) ? `<div class="note">Статус — по всей нише (порог описывает размер рынка). В диапазоне ${esc(R.priceBand.label)}: <b>${isNum(it.bandValue) ? fmtK(it.bandValue) + "/мес — " : ""}${fmtPct(it.bandShare)} ${shareWord(R.priceBand)}</b> (справочно).</div>` : ""}</div>`;
    }).join("");
    return `<h2>Критерий 1 — Рыночный контекст <span class="chip ${c1.pass ? "ok" : "fail"}">${c1.okCount} из 8 · ${c1.label}</span></h2>
      <div>${rows}</div>
      <div class="verdict ${c1.pass ? "go" : "rework"}" style="margin-top:.7rem"><b>${c1.okCount} из 8 зелёных</b> (порог ${c1.passCount}; в счёт идут только чёткие OK — пограничные не считаются).
      ${c1.redItems.length ? " Красные: " + c1.redItems.join(", ") + "." : ""} ${c1.proxyCount ? ` ${c1.proxyCount} метрик(и) — прокси POE, требуют сверки по Xray/Cerebro.` : ""} ${c1.naCount ? ` Нет данных: ${c1.naCount}.` : ""}</div>`;
  }
  const NAMES1 = { "1a": "Niche Revenue", "1b": "Средняя цена (медиана проверенных)", "1c": "Adj. SV главного ключа", "1d": "Отзывы по нише (барьер)", "1e": "Доминация бренда / Amazon", "1f": "Top-5 БРЕНДОВ", "1g": "Сезонность (просадка SV)", "1h": "Успешность запусков" };

  function secQuick(A, R, o) {
    if (o.static) return "";
    const inp = A.inputs, eff = R.effective;
    return `<h2>Живая экономика <span class="chip">двигайте ползунки — пересчёт мгновенный, без AI</span></h2><div class="quick-sliders noprint">
      ${sl("price", "Цена, $", eff.price, 5, 200, 0.5, (v) => fmtMoney(v, 2))}
      ${sl("cogs", "COGS, $", inp.cogs ?? 0, 0, 100, 0.25, (v) => fmtMoney(v, 2))}
      ${sl("cpc", "CPC, $", eff.cpc ?? 0, 0, 6, 0.05, (v) => fmtMoney(v, 2))}
      ${sl("cvr", "CVR, %", inp.cvr, 0.03, 0.30, 0.005, (v) => fmtPct(v, 1), 100)}
      ${sl("ppcShare", "Доля PPC, %", inp.ppcShare, 0, 1, 0.05, (v) => fmtPct(v), 100)}
      ${sl("unitsPerDay", "Шт/день", inp.unitsPerDay, 1, 100, 1, (v) => fmtN(v))}
    </div>`;
  }
  function secEconomics(A, R, o) {
    const e = R.economics, inp = A.inputs;
    const sliders = "";
    if (e.pending) return `<h2>Экономика <span class="chip pending">ожидает COGS</span></h2>${sliders}
      <div class="notice info">Критерий 2 (2a–2k) и критерий 6 пусты (⚪), пока менеджер не введёт цену и COGS от поставщика. AI не заполняет их оценками. Введите COGS в панели «Экономика» — Gate 1/2 посчитаются мгновенно.</div>`;
    const g1 = e.gate1, g2 = e.gate2;
    // 2g–2i считаются на ЦЕЛЕВОМ уровне продаж; рядом — те же 90 дней по сценарию разгона из «Денег по месяцам», чтобы две секции не спорили.
    const f90 = R.cashflow && !R.cashflow.pending ? R.cashflow.first90 : null, ramped = f90 && Math.round(f90.units) < Math.round(f90.targetUnits);
    const scen90 = (k) => { const val = f90 && ramped ? { "2g": f90.ads, "2h": f90.revenue, "2i": f90.profit }[k] : undefined; return val === undefined ? "" : ` — это целевой уровень продаж; по сценарию разгона за первые ${f90.days} дн.: <b>${fmtMoney(val)}</b>`; };
    const c2rows = Object.entries(e.criterion2).map(([k, v]) => `<tr><td><b>${k}</b> ${esc(NAMES2[k])}</td><td class="num">${fmtC2(k, v.value)}</td><td>${st(v.status)}</td><td class="muted">${esc(v.note || "")}${k === "2c" && R.cvrHint?.note ? "; " + esc(R.cvrHint.note) : ""}${scen90(k)}</td></tr>`).join("");
    const s2 = e.criterion2Summary;
    return `<h2>Экономика — Gate 1 / Gate 2 <span class="chip ${g1.status === "pass" ? "ok" : g1.status === "rework" ? "warn" : "fail"}">Gate 1 ${STATUS_LABEL[g1.status]}</span><span class="chip ${g2.status === "pass" ? "ok" : g2.status === "rework" ? "warn" : g2.status === "pending" ? "pending" : "fail"}">Gate 2 ${STATUS_LABEL[g2.status]}</span></h2>
      ${sliders}
      <div class="cards">
        <div class="card ${g1.status === "pass" ? "ok" : g1.status === "rework" ? "warn" : "fail"}"><h4>Gate 1 — без рекламы</h4><div class="big">${fmtMoney(g1.net0, 2)}/юнит</div>
          <div>маржа <b>${fmtPct(g1.margin0, 1)}</b> ${g1.condMargin ? "✓" : "✗"} · профит ${g1.condProfit ? "✓" : "✗"}</div><div class="muted">${esc(g1.note || `порог: маржа > 30 % и профит > $15`)}</div></div>
        <div class="card ${e.roiHint === "ok" ? "ok" : e.roiHint === "suspicious" || e.roiHint === "low" ? "warn" : "fail"}"><h4>ROI (net / landed COGS)</h4><div class="big">${fmtPct(e.roi)}</div>
          <div class="muted">${{ ok: "≥ 150 % — норма", low: "100–150 % — ниже порога 150 %", loss: "< 100 % — убыток", suspicious: "> 200 % — перепроверь данные" }[e.roiHint] || ""}</div></div>
        <div class="card ${g2.status === "pass" ? "ok" : g2.status === "rework" ? "warn" : g2.status === "pending" ? "pending" : "fail"}"><h4>Gate 2 — стресс-тест рекламы</h4>
          <div class="big">${g2.atCvr ? fmtMoney(g2.atCvr.net, 2) : "—"}/юнит</div><div>при CVR ${fmtPct(inp.cvr, 1)}, CPC ${fmtMoney(g2.cpc, 2)}, PPC ${fmtPct(g2.ppcShare)} · ACOS ${g2.atCvr ? fmtPct(g2.atCvr.acos) : "—"}</div>
          <div class="muted">безубыточный CVR: <b>${fmtPct(e.breakEvenCvr, 1)}</b> · PASS если Net > 0 при CVR ≤ 12 %</div></div>
        <div class="card"><h4>Маржа без / с рекламой</h4><div class="big">${fmtPct(e.marginNoAds, 1)} → ${fmtPct(e.marginWithAds, 1)}</div><div class="muted">разные вещи — показываем оба (Amazon Calculator vs реальный PPC-сплит)</div></div>
      </div>
      <div class="two" style="margin-top:.8rem">
        <div><h4>Net after ads по CVR</h4><div class="chartbox short"><canvas id="ch-gate2"></canvas></div></div>
        <div class="tablewrap"><table><thead><tr><th>CVR</th><th class="num">Ad cost/юнит</th><th class="num">Net after ads</th><th class="num">ACOS</th></tr></thead><tbody>
          ${g2.byCvr.map((r) => `<tr><td>${fmtPct(r.cvr)}</td><td class="num">${fmtMoney(r.adCost * g2.ppcShare, 2)}</td><td class="num" style="color:${r.net > 0 ? "var(--ok)" : "var(--fail)"}"><b>${fmtMoney(r.net, 2)}</b></td><td class="num">${fmtPct(r.acos)}</td></tr>`).join("")}</tbody></table>
          <p class="muted" style="font-size:.8rem">Ad cost = CPC / CVR × доля PPC. Кейс Jitsu: в дешёвых сегментах критичен абсолютный доллар профита.</p></div>
      </div>
      <h3 style="margin-top:1rem">Критерий 2 — детальная экономика <span class="chip ${s2.pass ? "ok" : s2.pending ? "pending" : "fail"}">${s2.okCount} из 11 · 2f/2j/2k ${s2.mandatoryOk ? "OK" : "не все OK"}</span></h3>
      <div class="tablewrap"><table><thead><tr><th>Показатель</th><th class="num">Значение</th><th>Статус</th><th>Примечание</th></tr></thead><tbody>${c2rows}</tbody></table></div>
      <p class="muted" style="font-size:.8rem"><b>На целевом уровне</b> (${fmtN(inp.unitsPerDay)} шт/день, как после разгона), ${s2.period.days} дн.: ${fmtN(s2.period.units)} шт, реклама ${fmtMoney(s2.period.adSpend)}, выручка ${fmtMoney(s2.period.revenue)}, прибыль ${fmtMoney(s2.period.totalProfit)}.${f90 && ramped ? ` <b>По сценарию разгона</b> (старт ${fmtN(R.cashflow.startSales)} шт/мес — ${{ input: "задан вами", cohort: "медиана продаж новичков ниши", zero: "с нуля, данных о новичках нет" }[R.cashflow.startSource]}), первые ${f90.days} дн. продаж: ${fmtN(f90.units)} шт, реклама ${fmtMoney(f90.ads)}, выручка ${fmtMoney(f90.revenue)}, прибыль ${fmtMoney(f90.profit)}. Статусы Критерия 2, прибыль на юнит, ROI и маржа от объёма продаж не зависят — различаются только эти суммы. Чтобы сценарий стартовал сразу с цели, впишите её в поле «Стартовые продажи, шт/мес».` : ""}</p>`;
  }
  const NAMES2 = { "2a": "Цена продажи", "2b": "COGS", "2c": "Конверсия", "2d": "Bid/CPC", "2e": "PPC/органика", "2f": "Чистая прибыль/юнит", "2g": "Всего потрачено (реклама)", "2h": "Revenue", "2i": "Всего прибыли", "2j": "% ROI", "2k": "% Маржинальность" };
  const fmtC2 = (k, v) => (["2c", "2e", "2j", "2k"].includes(k) ? fmtPct(v, 1) : fmtMoney(v, 2));
  function sl(key, label, val, min, max, step, fmt, scale = 1) {
    const v = isNum(val) ? val : min;
    return `<div class="slider"><label>${label}</label><input type="range" data-quick="${key}" data-scale="${scale}" min="${min * scale}" max="${max * scale}" step="${step * scale}" value="${v * scale}" aria-label="${label}"><output>${fmt(v)}</output></div>`;
  }
  function drawEconomics(container, R) {
    const g2 = R.economics.gate2; if (!g2?.byCvr?.length) return;
    const xs = []; for (let c = 0.04; c <= 0.2001; c += 0.01) xs.push(+c.toFixed(2));
    const net0 = R.economics.gate1.net0;
    const ys = xs.map((c) => net0 - (g2.cpc / c) * g2.ppcShare);
    const [s1, s2] = series();
    mkChart(container, "ch-gate2", { type: "line", data: { labels: xs.map((c) => Math.round(c * 100) + " %"), datasets: [
      { label: "Net after ads, $/юнит", data: ys, borderColor: s1, backgroundColor: s1, borderWidth: 2, pointRadius: 0, tension: .2 },
      { label: "Текущий CVR", data: xs.map((c) => (Math.abs(c - Math.round(g2.atCvr.cvr * 100) / 100) < 1e-9 ? g2.atCvr.net : null)), borderColor: s2, backgroundColor: s2, pointRadius: 6, pointHoverRadius: 8, showLine: false },
    ] }, options: { plugins: { legend: { display: true }, tooltip: { callbacks: { label: tooltipMoney(2) } } }, scales: { x: { grid, title: { display: true, text: "CVR" } }, y: { grid, ticks: { callback: (v) => fmtMoney(v) } } } } });
  }

  function secBudget(A, R) {
    const b = R.budget, q = b.quickScreen;
    const ans = { ok: "Да", warn: "Почти", fail: "Нет", na: "Нет данных" };
    const qs = Object.values(q).map((x) => `<div class="card ${esc(x.status)}"><div>${st(x.status)} <b>${ans[x.status] || ""}</b></div><div style="margin-top:.3rem">${esc(x.text)}</div>${x.detail ? `<div class="muted" style="font-size:.85rem">${esc(x.detail)}</div>` : ""}</div>`).join("");
    return `<h2>Бюджет первой закупки и стоп-вопросы <span class="chip ${b.status === "ok" ? "ok" : b.status === "fail" ? "fail" : b.status === "warn" ? "warn" : "na"}">${b.status === "pending" ? "нужен COGS" : b.status === "unknown" ? "укажите бюджет" : STATUS_LABEL[b.status]}</span></h2>
      ${b.pending ? '<div class="notice info">Введите COGS — партия, помесячный сценарий и пик вложений посчитаются автоматически.</div>' : `<div class="cards">
        <div class="card"><h4>Партия</h4><div class="big">${fmtMoney(b.batchCost)}</div><div class="muted">${fmtMoney(b.landed, 2)} × ${fmtN(b.batchUnits)} шт (${b.leadDays} дн: производство + доставка + приёмка)</div></div>
        ${b.basis === "cash" ? `<div class="card"><h4>Пик вложений</h4><div class="big">${fmtMoney(b.need)}</div><div class="muted">по сценарию «Деньги по месяцам»; справочно, ${b.batches} партии ${fmtMoney(b.twoBatches)} + реклама ${fmtMoney(b.adsReserve)} = ${fmtMoney(b.needTwoBatches)}</div></div>` : `<div class="card"><h4>Нужно всего</h4><div class="big">${fmtMoney(b.need)}</div><div class="muted">${b.batches} партии ${fmtMoney(b.twoBatches)} + реклама ${fmtMoney(b.adsReserve)}</div></div>`}
        <div class="card ${b.status === "ok" ? "ok" : b.status === "fail" ? "fail" : b.status === "warn" ? "warn" : "na"}"><h4>Бюджет</h4><div class="big">${fmtMoney(b.budget)}</div><div class="muted">${isNum(b.gap) ? (b.gap >= 0 ? "запас " : "дефицит ") + fmtMoney(Math.abs(b.gap)) : "не указан"}</div></div>
        <div class="card"><h4>Наценка</h4><div class="big">${isNum(b.markup) ? b.markup.toFixed(1) + "×" : "—"}</div><div class="muted">дешёвый товар — 5×, дорогой — 3.3×</div></div></div>`}
      <h3 style="margin-top:.9rem">Четыре стоп-вопроса</h3><p class="muted" style="font-size:.85rem">Любой ответ «Нет» — дальше можно не анализировать. Красная карточка = «Нет», жёлтая = на грани, серая = не хватает данных.</p><div class="cards">${qs}</div>`;
  }

  function secTraffic(A, R) {
    const tr = R.traffic; if (!tr.source) return `<h2>Трафик по ключам</h2><div class="empty">Загрузите Cerebro (или POE) — распределение трафика и Adj. SV.</div>`;
    const multi = Boolean(tr.multiAsin); const hasSales = tr.cluster.some((k) => isNum(k.keywordSales));
    const rows = tr.cluster.slice(0, 25).map((k) => `<tr><td>${esc(k.phrase)}</td><td class="num">${fmtN(k.sv)}</td>${hasSales ? `<td class="num">${fmtN(k.keywordSales)}</td>` : ""}${multi ? `<td class="num">${isNum(k.rankingCompetitors) ? k.rankingCompetitors : "—"}${isNum(k.competitorRankAvg) ? ` <small class="muted">(ср. ${fmtN(k.competitorRankAvg)})</small>` : ""}</td>` : ""}<td class="num">${isNum(k.svTrend) ? (k.svTrend > 0 ? "+" : "") + fmtN(k.svTrend) + " %" : "—"}</td><td class="num">${isNum(k.bid) ? fmtMoney(k.bid, 2) : "—"}</td><td class="num">${isNum(k.competingProducts) ? (k.competingIsBound ? ">" : "") + fmtN(k.competingProducts) : "—"}</td><td class="num">${isNum(k.abaClickShare) ? fmtN(k.abaClickShare, 1) + (tr.source === "poe" ? "" : " %") : "—"}</td></tr>`).join("");
    const pc = tr.poeConcentration;
    return `<h2>Трафик по ключам${bandChip(R, "whole")} <span class="chip ${tr.status === "ok" ? "ok" : tr.status === "fail" ? "fail" : "warn"}">${tr.source === "cerebro" ? "Cerebro" : "POE"} · ${STATUS_LABEL[tr.status]}</span></h2>
      <div class="tiles">
        <div class="tile"><div class="k">SV core</div><div class="v">${fmtN(tr.svCore)}</div><div class="s">/мес</div></div>
        <div class="tile"><div class="k">Adj. SV</div><div class="v">${fmtN(tr.adjSv)}</div><div class="s">core + 0.4 × Σ кластера (${tr.clusterCount})</div></div>
        <div class="tile ${tr.top2Share > 0.8 ? "fail" : "ok"}"><div class="k">Доля топ-2 ключей</div><div class="v">${fmtPct(tr.top2Share)}</div><div class="s">> 80 % — плохо</div></div>
        <div class="tile ${isNum(tr.relevantCount) && tr.relevantCount >= 30 ? "ok" : "warn"}"><div class="k">Релевантных ключей</div><div class="v">${fmtN(tr.relevantCount)}</div><div class="s">нужно ≥ 30 (SV ≥ ${fmtN(tr.minSv ?? 100)})</div></div>
        ${isNum(tr.clusterSales) && tr.clusterSales > 0 ? `<div class="tile"><div class="k">Продаж по кластеру</div><div class="v">${fmtN(tr.clusterSales)}</div><div class="s">Keyword Sales, шт/мес</div></div>` : ""}
        ${isNum(tr.groups) ? `<div class="tile ${tr.groups >= 3 ? "ok" : "warn"}"><div class="k">Групп ключей</div><div class="v">${tr.groups}</div><div class="s">нужно ≥ 3</div></div>` : ""}
        ${pc ? `<div class="tile ${pc.flags.top20Heavy ? "warn" : ""}"><div class="k">Топ-20 продуктов (клики)</div><div class="v">${fmtPct(pc.top20Products)}</div><div class="s">топ-5 продуктов ${fmtPct(pc.top5Products)}</div></div>` : ""}
      </div>
      <div class="stack" style="margin-top:.8rem"><div class="chartbox tall"><canvas id="ch-kw"></canvas></div>
      <div class="tablewrap"><table class="kwtable"><thead><tr><th>Запрос</th><th class="num">SV/мес</th>${hasSales ? '<th class="num" title="Keyword Sales — продаж/мес по ключу (продают ключи, не объём)">Продаж/мес</th>' : ""}${multi ? '<th class="num" title="Сколько из заданных в Cerebro конкурентов ранжируются по фразе">Конкур. в топе</th>' : ""}<th class="num">Тренд</th><th class="num">Bid</th><th class="num">Конкур. товаров</th><th class="num">${tr.source === "poe" ? "Click share" : "ABA click %"}</th></tr></thead><tbody>${rows}</tbody></table>${multi ? `<p class="muted" style="font-size:.8rem">Cerebro по нескольким ASIN: в кластер автоматически попадают фразы, по которым ранжируются ≥ ${esc(String(A.inputs.clusterMinCompetitors ?? 3))} конкурентов (правило отбора), SV ≥ ${fmtN(tr.minSv)}.</p>` : ""}</div></div>`;
  }
  function drawTraffic(container, R) {
    const tr = R.traffic; if (!tr.cluster?.length) return;
    const top = tr.cluster.slice(0, 15);
    mkChart(container, "ch-kw", { type: "bar", data: { labels: top.map((k) => k.phrase), datasets: [{ label: "SV/мес", data: top.map((k) => k.sv), backgroundColor: series()[0], borderRadius: 4, barPercentage: .7 }] },
      options: { indexAxis: "y", plugins: { legend: { display: false } }, scales: { x: { grid, ticks: { callback: (v) => fmtN(v) } }, y: { grid: { display: false }, ticks: { autoSkip: false, font: { size: 11 } } } } } });
  }

  function secCompetitors(A, R) {
    const comp = R.competition;
    if (!comp.source && bandOf(R)) return `<h2>Конкурентная карта${bandChip(R, "band")}</h2><div class="empty">В ценовом диапазоне ${esc(R.priceBand.label)} — ${fmtN(R.priceBand.inCount)} из ${fmtN(R.priceBand.totalCount)} листингов: этого мало, чтобы считать доли брендов и барьер отзывов. Расширьте диапазон в панели (раздел 5) или сбросьте его.</div>`;
    if (!comp.source) return `<h2>Конкуренты</h2><div class="empty">Загрузите Xray (или POE) — доли брендов, барьер отзывов, топ-20 ASIN.</div>`;
    const my = new Set((A.inputs.myAsins || []).map((s) => s.toUpperCase())); const myBrand = (A.inputs.myBrand || "").toLowerCase();
    const xr = A.aggregates?.xray?.asins; const poe = A.aggregates?.poe?.asinMetrics;
    let rows = "";
    if (xr?.length) {
      const ex = new Set((A.inputs.excludedBrands || []).map((b) => b.toLowerCase()));
      const top = xr.filter((a) => !ex.has(a.brand.toLowerCase()) && inBandR(a.price, bandOf(R))).sort((a, b) => (b.asinRevenue ?? 0) - (a.asinRevenue ?? 0)).slice(0, 20);
      rows = `<thead><tr><th>#</th><th>Бренд</th><th>ASIN / товар</th><th class="num">Цена</th><th class="num">Продажи</th><th class="num">Выручка</th><th class="num">Отзывы</th><th class="num">★</th><th>Создан</th></tr></thead><tbody>` +
        top.map((a, i) => `<tr class="${my.has(a.asin) || (myBrand && a.brand.toLowerCase() === myBrand) ? "mine" : ""} ${i === 0 ? "leader" : ""}"><td>${i + 1}</td><td>${esc(a.brand)}</td><td><a href="${esc(a.url)}" target="_blank" rel="noopener">${a.asin}</a><br><small class="muted">${esc(a.title.slice(0, 70))}</small></td><td class="num">${fmtMoney(a.price, 2)}</td><td class="num">${fmtN(a.asinSales)}</td><td class="num">${fmtK(a.asinRevenue)}</td><td class="num">${fmtN(a.reviews)}</td><td class="num">${isNum(a.rating) ? a.rating.toFixed(1) : "—"}</td><td>${esc(a.creationDate || "—")}</td></tr>`).join("") + "</tbody>";
    } else if (poe?.length) {
      rows = `<thead><tr><th>#</th><th>Бренд</th><th>ASIN / товар</th><th class="num">Цена</th><th class="num">Click share</th><th class="num" title="POE считает только отзывы с текстом — в Xray (все оценки) число больше">Отзывы с текстом</th><th class="num">★</th><th title="В POE это может быть дата всей вариации, а не конкретного ASIN">Запуск (вариации)</th></tr></thead><tbody>` +
        poe.filter((a) => inBandR(a.price, bandOf(R))).slice(0, 20).map((a, i) => `<tr class="${my.has(a.asin) || (myBrand && a.brand.toLowerCase() === myBrand) ? "mine" : ""} ${i === 0 ? "leader" : ""}"><td>${i + 1}</td><td>${esc(a.brand)}</td><td><a href="https://www.amazon.com/dp/${a.asin}" target="_blank" rel="noopener">${a.asin}</a><br><small class="muted">${esc(a.title.slice(0, 70))}</small></td><td class="num">${fmtMoney(a.price, 2)}</td><td class="num">${fmtPct(a.clickShareT360, 1)}</td><td class="num">${fmtN(a.reviews)}</td><td class="num">${isNum(a.rating) ? a.rating.toFixed(1) : "—"}</td><td>${esc(a.launchDate || "—")}</td></tr>`).join("") + "</tbody>";
    }
    const rb = comp.reviewBarrier;
    const cont = comp.contaminationCandidates?.length ? `<div class="notice" style="margin-top:.6rem">Возможная cross-category contamination (бренды из Xray, которых нет в POE): ${comp.contaminationCandidates.slice(0, 8).map((c) => `<b>${esc(c.brand)}</b> (${fmtPct(c.share)})`).join(", ")} — проверьте и исключите в панели «Исключить бренды».</div>` : "";
    const pb = bandOf(R), wh = pb?.whole;
    const cmpTile = (k, inBandVal, wholeVal) => `<div class="tile"><div class="k">${k}</div><div class="v">${inBandVal}</div><div class="s">во всей нише: <b>${wholeVal}</b></div></div>`;
    const cmp = wh ? `<h4 style="margin:.8rem 0 0">В диапазоне ${esc(pb.label)} против всей ниши</h4><div class="bandcmp">
        ${cmpTile("Доля лидера", fmtPct(comp.topBrandShare, 1), `${fmtPct(wh.topBrandShare, 1)}${wh.topBrand && wh.topBrand !== comp.topBrand ? " (" + esc(wh.topBrand) + ")" : ""}`)}
        ${cmpTile("Топ-5 брендов", fmtPct(comp.top5Share), fmtPct(wh.top5Share))}
        ${cmpTile("Медиана цены", fmtMoney(R.criterion1.items["1b"].value, 2), fmtMoney(wh.priceMedian, 2))}
        ${cmpTile("Отзывы (ср. / мед.)", `${fmtN(rb.avg)} / ${fmtN(rb.median)}`, `${fmtN(wh.reviewsAvg)} / ${fmtN(wh.reviewsMedian)}`)}
      </div>` : "";
    return `<h2>Конкурентная карта${bandChip(R, "band")} <span class="chip ${comp.dominant ? "fail" : "ok"}">${comp.dominant ? "доминирующий бренд" : "без доминации"}</span>${comp.amazonSells ? '<span class="chip fail">Amazon продаёт сам</span>' : ""}</h2>
      <div class="tiles">
        <div class="tile ${comp.dominant ? "fail" : "ok"}"><div class="k">Лидер</div><div class="v">${esc(comp.topBrand || "—")}</div><div class="s">${fmtPct(comp.topBrandShare, 1)} ${comp.source === "xray" ? "выручки" : "кликов"}</div></div>
        <div class="tile ${rb.tier === "moat" ? "fail" : rb.tier === "medium" ? "warn" : "ok"}"><div class="k">Отзывов у лидера</div><div class="v">${fmtN(rb.leaderReviews)}</div><div class="s">${rb.tier === "moat" ? "> 2000 — практически непробиваем" : rb.tier === "medium" ? "500–2000 — нужен дифференциатор + Vine" : rb.tier === "breakable" ? "< 500 — пробиваемый ров" : "—"}</div></div>
        <div class="tile"><div class="k">Игроков с ≥100 отзывов</div><div class="v">${fmtN(comp.playersOver100)}</div><div class="s">брендов с долей > 10 %: ${fmtN(comp.brandsOver10pct)}</div></div>
        <div class="tile"><div class="k">Топ-5 / топ-10 / топ-20</div><div class="v">${fmtPct(comp.top5Share)}</div><div class="s">${fmtPct(comp.top10Share)} / ${fmtPct(comp.top20Share)}</div></div>
      </div>${cmp}
      <div class="stack" style="margin-top:.8rem"><div class="chartbox tall"><canvas id="ch-brands"></canvas></div>
      <div class="tablewrap" style="max-height:420px;overflow:auto"><table>${rows}</table></div></div>${cont}
      ${my.size || myBrand ? '<p class="muted" style="font-size:.8rem">Строки, подсвеченные жёлтым — ваш бренд/ASIN. При оценке «нового входа» он считается инкумбентом, как и остальные.</p>' : ""}`;
  }
  function drawCompetitors(container, R) {
    const top = R.competition.brands.slice(0, 10); if (!top.length) return;
    const [s1, s2] = series();
    mkChart(container, "ch-brands", { type: "bar", data: { labels: top.map((b) => b.brand), datasets: [{ label: R.competition.source === "xray" ? "Доля выручки" : "Click share", data: top.map((b) => b.share * 100), backgroundColor: top.map((b, i) => (i === 0 && R.competition.dominant ? s2 : s1)), borderRadius: 4, barPercentage: .7 }] },
      options: { indexAxis: "y", plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => fmtN(c.parsed.x, 1) + " %" } } }, scales: { x: { grid, ticks: { callback: (v) => v + " %" } }, y: { grid: { display: false } } } } });
  }

  function clickPriceBlock(R) {
    const cp = R.clickPrice; if (!cp) return "";
    const gap = (v) => (isNum(v) ? `${v > 0 ? "+" : "−"}${fmtPct(Math.abs(v))}` : "—"); const hot = (f) => (cp.flags.includes(f) ? "warn" : "");
    const warn = [];
    if (cp.flags.includes("avg")) warn.push(`обычная средняя ${fmtMoney(cp.simpleAvg, 2)} отличается на ${gap(cp.avgGap)}: её тянут товары, на которые почти не кликают`);
    if (cp.flags.includes("myPrice")) warn.push(`ваша цена ${fmtMoney(cp.myPrice, 2)} ${cp.myPriceGap > 0 ? "выше" : "ниже"} на ${fmtPct(Math.abs(cp.myPriceGap))} — проверьте, что это осознанное позиционирование`);
    if (cp.flags.includes("band")) warn.push(`выбранный ценовой диапазон ${cp.band.label} не включает цену, по которой кликают покупатели`);
    return `<div class="tiles" style="margin-bottom:.7rem">
      <div class="tile"><div class="k">Цена по кликам покупателей</div><div class="v">${fmtMoney(cp.value, 2)}</div><div class="s">взвешена долей кликов, ${fmtN(cp.n)} товаров POE</div></div>
      <div class="tile ${hot("avg")}"><div class="k">Обычная средняя / медиана</div><div class="v">${fmtMoney(cp.simpleAvg, 2)}</div><div class="s">медиана ${fmtMoney(cp.median, 2)} · средняя ${gap(cp.avgGap)} к цене по кликам</div></div>
      ${isNum(cp.reference) ? `<div class="tile ${hot("reference")}"><div class="k">Медиана проверенных (1b)</div><div class="v">${fmtMoney(cp.reference, 2)}</div><div class="s">${gap(cp.referenceGap)} к цене по кликам</div></div>` : ""}
      ${isNum(cp.myPrice) ? `<div class="tile ${hot("myPrice")}"><div class="k">Ваша цена</div><div class="v">${fmtMoney(cp.myPrice, 2)}</div><div class="s">${gap(cp.myPriceGap)} к цене по кликам</div></div>` : ""}
    </div>${warn.length ? `<div class="notice" style="margin-bottom:.7rem">${esc(warn.join("; "))}.</div>` : ""}<p class="muted" style="font-size:.8rem;margin-top:-.3rem">Цены POE — средние за 360 дней, а не сегодняшние. Порог расхождения ${fmtPct(cp.gapLimit)}.</p>`;
  }
  function secPricing(A, R, o) {
    const ps = R.priceSegments; if (!ps) return R.clickPrice ? `<h2>Цена ниши</h2>${clickPriceBlock(R)}` : "";
    const pick = (sg) => (o?.static ? "" : ` <button type="button" class="seg-pick noprint" data-band-min="${sg.min}" data-band-max="${sg.max}" title="Считать конкурентов только в этом ценовом сегменте">выбрать</button>`);
    return `<h2>Ценовые сегменты${bandChip(R, "whole")}</h2>${clickPriceBlock(R)}<div class="two"><div class="chartbox short"><canvas id="ch-price"></canvas></div>
      <div class="tablewrap"><table><thead><tr><th>Сегмент</th><th class="num">Диапазон</th><th class="num">Доля товаров</th><th class="num">Доля ${ps.weightLabel === "revenue" ? "выручки" : "кликов"}</th></tr></thead><tbody>
      ${ps.segments.map((s) => `<tr class="${s.selected ? "seg-selected" : ""}"><td>${s.name}${s.selected ? ' <span class="chip band">выбран</span>' : ""}${pick(s)}</td><td class="num">${fmtMoney(s.min, 0)}–${fmtMoney(s.max, 0)}</td><td class="num">${fmtPct(s.itemsShare)}</td><td class="num">${fmtPct(s.weightShare)}</td></tr>`).join("")}</tbody></table>
      <p class="muted" style="font-size:.8rem">Сегмент с большой долей ${ps.weightLabel === "revenue" ? "выручки" : "кликов"} при малой доле товаров — недообслужен; проверяйте концентрацию бренда ВНУТРИ сегмента перед выбором цены${o?.static ? "" : " — кнопка «выбрать» сузит анализ конкурентов до этого сегмента"}.</p></div></div>`;
  }
  function drawPricing(container, R) {
    const ps = R.priceSegments; if (!ps) return; const [s1, s2] = series();
    mkChart(container, "ch-price", { type: "bar", data: { labels: ps.segments.map((s) => `${s.name} (${fmtMoney(s.min)}–${fmtMoney(s.max)})`), datasets: [
      { label: "Доля товаров", data: ps.segments.map((s) => s.itemsShare * 100), backgroundColor: s1, borderRadius: 4 },
      { label: ps.weightLabel === "revenue" ? "Доля выручки" : "Доля кликов", data: ps.segments.map((s) => s.weightShare * 100), backgroundColor: s2, borderRadius: 4 }] },
      options: { plugins: { tooltip: { callbacks: { label: (c) => c.dataset.label + ": " + fmtN(c.parsed.y, 1) + " %" } } }, scales: { x: { grid: { display: false } }, y: { grid, ticks: { callback: (v) => v + " %" } } } } });
  }

  function secTrend(A, R) {
    const tr = A.aggregates?.poe?.trends; if (!tr?.length) return "";
    const g = R.criterion1.items["1g"];
    return `<h2>Сезонность и тренд (POE, ${tr.length} недель)${bandChip(R, "whole")} <span class="chip ${g.status}">просадка ${fmtPct(g.value)}</span></h2>
      <div class="charts2"><div><h4>Поисковый объём, нед.</h4><div class="chartbox short"><canvas id="ch-sv"></canvas></div></div>
      <div><h4>Топ-5 брендов, click share</h4><div class="chartbox short"><canvas id="ch-top5"></canvas></div></div>
      <div><h4>Средняя цена, $</h4><div class="chartbox short"><canvas id="ch-pr"></canvas></div></div></div>
      <p class="muted" style="font-size:.8rem">${esc(g.note || "")}. Amazon SV приоритетнее Google Trends.</p>`;
  }
  function drawTrend(container, A) {
    const tr = A.aggregates?.poe?.trends; if (!tr?.length) return; const [s1, s2, s3] = series();
    const labels = tr.map((t) => t.date.slice(2));
    const line = (id, data, color, fmt) => mkChart(container, id, { type: "line", data: { labels, datasets: [{ data, borderColor: color, backgroundColor: color, borderWidth: 2, pointRadius: 0, tension: .25 }] },
      options: { plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => fmt(c.parsed.y) } } }, scales: { x: { grid: { display: false }, ticks: { maxTicksLimit: 8 } }, y: { grid, ticks: { callback: fmt } } } } });
    line("ch-sv", tr.map((t) => t.sv), s1, (v) => fmtN(v));
    line("ch-top5", tr.map((t) => (isNum(t.top5Brand) ? t.top5Brand * 100 : null)), s2, (v) => fmtN(v, 0) + " %");
    line("ch-pr", tr.map((t) => t.price), s3, (v) => fmtMoney(v, 0));
  }

  function secStructure(A, R) {
    const lp = A.aggregates?.poe?.launchPotential; if (!lp) return "";
    const F = [["productCount", "Товары"], ["brandCount", "Бренды"], ["sellingPartnerCount", "Продавцы"], ["newProductsLaunchedT360", "Запусков за 360 дн"], ["successfulLaunchesT360", "Успешных запусков"], ["avgReviewCount", "Средн. отзывов"], ["avgReviewRating", "Средн. рейтинг"], ["sponsoredProductsPercentage", "Спонсорских, %"], ["top5BrandsClickShare", "Топ-5 брендов, click %"], ["top5ProductsClickShare", "Топ-5 продуктов, click %"], ["top20ProductsClickShare", "Топ-20 продуктов, click %"], ["avgProductPrice", "Средняя цена, $"], ["avgOOSRate", "OOS rate, %"], ["primeProductsPercentage", "Prime, %"]];
    const pct = (k) => /Percentage|ClickShare|OOSRate/.test(k);
    const f = (k, v) => (!isNum(v) ? "—" : pct(k) ? fmtPct(v, 0) : k === "avgProductPrice" ? fmtMoney(v, 2) : fmtN(v, k === "avgReviewRating" ? 2 : 0));
    const d = (a, b) => (isNum(a) && isNum(b) && b !== 0 ? `<small class="muted">(${a > b ? "+" : ""}${fmtN(((a - b) / b) * 100)} %)</small>` : "");
    return `<h2>Структура ниши: сейчас / квартал назад / год назад</h2><div class="tablewrap"><table><thead><tr><th>Показатель</th><th class="num">Сейчас</th><th class="num">Квартал назад</th><th class="num">Год назад</th></tr></thead><tbody>
      ${F.filter(([k]) => lp[k]).map(([k, n]) => `<tr><td>${n}</td><td class="num"><b>${f(k, lp[k].current)}</b></td><td class="num">${f(k, lp[k].qoq)} ${d(lp[k].current, lp[k].qoq)}</td><td class="num">${f(k, lp[k].yoy)} ${d(lp[k].current, lp[k].yoy)}</td></tr>`).join("")}</tbody></table></div>`;
  }

  function secReviews(A, R) {
    const p = A.aggregates?.poe?.pdr; if (!p || (!p.negative.length && !p.positive.length)) return "";
    const li = (t) => `<tr><td>${esc(t.topic)}</td><td class="num">${fmtN(t.pct, 1)} %</td><td class="muted"><small>${t.verbatims.map(esc).join(" · ")}</small></td></tr>`;
    return `<h2>Тональность отзывов (POE) <span class="chip fail">негатив</span><span class="chip ok">позитив</span></h2>
      <div class="chartbox tall"><canvas id="ch-rev"></canvas></div>
      <div class="two" style="margin-top:.8rem"><div class="tablewrap"><h4>Негатив — готовые ТЗ-требования</h4><table><tbody>${p.negative.map(li).join("")}</tbody></table></div>
      <div class="tablewrap"><h4>Позитив — что не сломать</h4><table><tbody>${p.positive.map(li).join("")}</tbody></table></div></div>
      ${p.returns?.length ? `<p class="muted" style="font-size:.8rem">Причины возвратов: ${p.returns.slice(0, 6).map((r) => `${esc(r.topic)} ${fmtN(r.pct, 1)} %`).join(" · ")}</p>` : ""}`;
  }
  function drawReviews(container, A) {
    const p = A.aggregates?.poe?.pdr; if (!p) return;
    const neg = p.negative.slice(0, 8), pos = p.positive.slice(0, 8);
    const labels = [...new Set([...neg.map((t) => t.topic), ...pos.map((t) => t.topic)])];
    const nm = Object.fromEntries(neg.map((t) => [t.topic, t.pct])), pm = Object.fromEntries(pos.map((t) => [t.topic, t.pct]));
    mkChart(container, "ch-rev", { type: "bar", data: { labels, datasets: [
      { label: "Негатив, % упоминаний", data: labels.map((l) => -(nm[l] || 0)), backgroundColor: cssVar("--neg"), borderRadius: 4, stack: "s" },
      { label: "Позитив, % упоминаний", data: labels.map((l) => pm[l] || 0), backgroundColor: cssVar("--pos"), borderRadius: 4, stack: "s" }] },
      options: { indexAxis: "y", plugins: { tooltip: { callbacks: { label: (c) => c.dataset.label + ": " + fmtN(Math.abs(c.parsed.x), 1) + " %" } } }, scales: { x: { grid, stacked: true, ticks: { callback: (v) => Math.abs(v) + " %" } }, y: { stacked: true, grid: { display: false }, ticks: { autoSkip: false } } } } });
  }


  // ---------- вход в нишу: трафик, новички, отзывы (spec 005) ----------
  const REACH_LABEL = { ok: "достижимо", warn: "на пределе", fail: "выше достигнутого", na: "нет данных" };
  const months = (v) => (!isNum(v) ? "—" : v === 0 ? "сразу" : v < 1 ? "меньше месяца" : fmtN(v, 1) + " мес");
  function secEntry(A, R) {
    const E = R.entry; if (!E || !E.available) return "";
    const per = E.salesPerClickPct, co = E.cohort, rc = E.reach, rv = E.reviews;
    const tile = (k, v, s2, cls = "") => `<div class="tile ${cls}"><div class="k">${k}</div><div class="v">${v}</div><div class="s">${s2 || ""}</div></div>`;
    const traffic = per.ok ? `<div class="tiles">
        ${tile("Продаж на 1 % кликов ниши", fmtN(per.median) + " шт/мес", `середина ниши ${fmtN(per.p25)}–${fmtN(per.p75)} · по ${fmtN(per.n)} товарам из обоих отчётов`)}
        ${rc.ok ? tile("Нужная доля кликов", fmtPct(rc.requiredShare, 1), `под цель ${fmtN(rc.targetMonthly)} шт/мес · разброс ${fmtPct(rc.requiredLow, 1)}–${fmtPct(rc.requiredHigh, 1)}`, rc.status) : tile("Нужная доля кликов", "—", esc(rc.reason || ""))}
        ${rc.ok ? tile("Товаров с такой долей", `${fmtN(rc.productsWithShare)} из ${fmtN(rc.productsTotal)}`, `лидер ${fmtPct(rc.leaderShare, 1)}${isNum(rc.bestNewcomerShare) ? " · лучший новичок " + fmtPct(rc.bestNewcomerShare, 1) : ""}`) : ""}
        ${rc.ok ? tile("Оценка", REACH_LABEL[rc.status], esc(rc.note) + (isNum(rc.okUpToPerDay) ? ` · «достижимо» до ${fmtN(rc.okUpToPerDay, 1)} шт/день${isNum(rc.warnUpToPerDay) ? `, «на пределе» до ${fmtN(rc.warnUpToPerDay, 1)}` : ""}` : ""), rc.status) : ""}
      </div>${per.fallbackT360 ? `<p class="muted" style="font-size:.8rem">У ${fmtN(per.fallbackT360)} товар(ов) нет доли кликов за 90 дней — взята годовая.</p>` : ""}`
      : `<div class="empty">Продажи на 1 % кликов не посчитаны: ${esc(per.reason || "нет данных")}.</div>`;
    const ex = co.excluded || {}; const exParts = [[ex.tooOld, "старше " + co.maxAgeMonths + " мес"], [ex.lowShare, "доля ниже равномерной"], [ex.tooYoung, "моложе " + co.minAgeMonths + " мес"], [ex.inherited, "унаследованные отзывы"], [ex.noDate, "нет даты"]].filter(([n]) => n).map(([n, l]) => `${fmtN(n)} — ${l}`);
    const revLabel = co.reviewsSource === "poe" ? "отзывов с текстом (POE)" : "всех оценок (Xray)";
    const cohort = co.population ? `<h3 style="margin-top:1rem">Новые участники <span class="chip ${co.ok ? "ok" : "na"}">${fmtN(co.size)} из ${fmtN(co.population)} товаров</span></h3>
      <p class="muted" style="font-size:.85rem">Кто вошёл в нишу за последние два года и уже заметен покупателям: возраст от ${co.minAgeMonths} до ${co.maxAgeMonths} месяцев и доля ${co.basis === "revenue" ? "выручки" : "кликов"} не ниже равномерной (${fmtPct(co.uniformShare, 1)}). Отсеяно: ${exParts.join("; ") || "никого"}.${co.ageFilterSkipped ? " Все листинги отчёта моложе ${co.minAgeMonths} месяцев — нижняя граница возраста не применялась." : ""}${co.ageFromPoe ? ` У ${fmtN(co.ageFromPoe)} товар(ов) возраст взят из POE — это может быть дата всей вариации.` : ""}${co.inheritedChecked ? "" : " Проверка на унаследованные отзывы не выполнена — нужны продажи из Xray."}</p>
      ${co.ok ? `<div class="tiles">
        ${tile("Продажи новичков", isNum(co.salesMedian) ? fmtN(co.salesMedian) + " шт/мес" : "—", isNum(co.salesMedian) ? `медиана; разброс ${fmtN(co.salesP25)}–${fmtN(co.salesP75)} · стартовый уровень для сценария` : "нужен Xray с продажами")}
        ${tile("Отзывы новичков", fmtN(co.reviewsMedian), "медиана, " + revLabel)}
        ${tile("Доля кликов новичков", fmtPct(co.shareMedian, 1), `медиана · у лучшего ${fmtPct(co.bestShare, 1)}`)}
      </div>
      <div class="tablewrap" style="margin-top:.6rem;max-height:320px;overflow:auto"><table><thead><tr><th>Бренд</th><th>ASIN</th><th class="num">Возраст</th><th class="num">Доля</th><th class="num">Продажи/мес</th><th class="num">Отзывы</th></tr></thead><tbody>
        ${co.members.map((m) => `<tr><td>${esc(m.brand)}</td><td><a href="https://www.amazon.com/dp/${esc(m.asin)}" target="_blank" rel="noopener">${esc(m.asin)}</a></td><td class="num">${fmtN(m.ageMonths, 1)} мес${m.ageSource === "poe" ? ' <small class="muted" title="дата из POE — возможно, дата вариации">POE</small>' : ""}</td><td class="num">${fmtPct(m.share, 1)}</td><td class="num">${fmtN(m.sales)}</td><td class="num">${fmtN(m.reviews)}</td></tr>`).join("")}</tbody></table></div>`
      : `<div class="empty">${esc(co.reason || "")}</div>`}` : "";
    const reviews = rv.ok ? `<h3 style="margin-top:1rem">Срок до планки отзывов</h3><div class="tiles">
        ${tile("Планка", fmtN(rv.threshold), rv.thresholdFrom === "cohort" ? "медиана новичков, " + (rv.source === "poe" ? "отзывов с текстом" : "всех оценок") : "медиана ниши — когорты новичков нет")}
        ${tile("У лидера", fmtN(rv.leaderReviews), "догонять нужно не его, а тех, кто недавно вошёл и продаёт")}
        ${rv.vineOnly ? tile("Срок", "сразу", `планка закрывается программой Vine (${fmtN(rv.vineReviews)} отзывов)`, "ok") : `${tile("При целевых продажах", months(rv.atTarget?.months), isNum(rv.atTarget?.salesMonthly) ? fmtN(rv.atTarget.salesMonthly) + " шт/мес" : "цель не задана")}
        ${tile("При продажах новичков", months(rv.atCohort?.months), isNum(rv.atCohort?.salesMonthly) ? fmtN(rv.atCohort.salesMonthly) + " шт/мес — реалистичнее на старте" : "нет продаж новичков (нужен Xray)")}`}
      </div><p class="muted" style="font-size:.8rem">(планка − ${fmtN(rv.vineReviews)} отзывов Vine) ÷ ${fmtPct(rv.reviewRate, 1)} покупателей с отзывом ÷ продажи в месяц.${rv.reviewRateAssumed ? " Доля покупателей с отзывом — допущение, меняется в панели «Экономика»." : ""}</p>` : "";
    const notes = (R.dataNotes || []).length ? `<details style="margin-top:.8rem"><summary class="muted">Особенности данных POE (${R.dataNotes.length})</summary><ul style="font-size:.85rem">${R.dataNotes.map((n) => `<li>${esc(n.text)}${n.items ? " " + n.items.map((g) => `<span class="chip" title="Xray ${esc(g.xray)} · POE ${esc(g.poe)}">${esc(g.asin)} · ${fmtN(g.days)} дн</span>`).join(" ") : ""}</li>`).join("")}</ul></details>` : "";
    return `<h2>Вход в нишу: трафик, новички, отзывы${bandChip(R, "whole")} ${rc.ok ? `<span class="chip ${rc.status}">${REACH_LABEL[rc.status]}</span><span class="chip" title="Пороги оценки достижимости пока не откалиброваны на реальных нишах — на вердикт она не влияет">порог предварительный</span>` : ""}</h2>
      <p class="muted" style="font-size:.85rem">Хватит ли внимания покупателей под вашу цель продаж и как живут те, кто зашёл сюда недавно. Считается по всем товарам отчётов, без ценового диапазона: клики покупателей по цене не делятся.</p>
      ${traffic}${cohort}${reviews}${notes}`;
  }

  // ---------- деньги по месяцам (spec 005) ----------
  function secCashflow(A, R) {
    const c = R.cashflow; if (!c) return "";
    if (c.pending) return `<h2>Деньги по месяцам <span class="chip pending">ожидает данных</span></h2><div class="notice info">${esc(c.reason || "")}.</div>`;
    const bud = R.budget?.budget; const fit = isNum(bud) ? (bud >= c.peak ? "ok" : bud >= c.peak * 0.85 ? "warn" : "fail") : "";
    const rows = c.rows.map((r) => `<tr class="${r.stockout ? "leader" : ""}"><td>${r.month}${r.sellingMonth ? ` <small class="muted">продажи ${r.sellingMonth}</small>` : ""}</td><td class="num">${r.ordered ? fmtN(r.ordered) : ""}${r.arrived ? ` <small class="muted">пришло ${fmtN(r.arrived)}</small>` : ""}</td><td class="num">${r.orderCost + r.startup ? fmtMoney(-(r.orderCost + r.startup)) : ""}</td><td class="num">${r.demand ? fmtN(r.sold) + (r.stockout ? ' <span class="chip fail">нет в наличии</span>' : "") : ""}</td><td class="num">${r.payout ? fmtMoney(r.payout) : ""}</td><td class="num">${r.ads ? fmtMoney(-r.ads) : ""}</td><td class="num">${fmtMoney(r.net)}</td><td class="num" style="color:${r.cum >= 0 ? "var(--ok)" : "var(--fail)"}"><b>${fmtMoney(r.cum)}</b></td><td class="num">${fmtN(r.stockEnd)}</td><td class="num">${r.sellingMonth ? fmtN(r.reviews) : ""}</td></tr>`).join("");
    return `<h2>Деньги по месяцам <span class="chip ${c.paybackMonth !== null ? "ok" : "fail"}">${c.paybackMonth !== null ? "возврат в месяце " + c.paybackMonth : "за " + (c.rows.length - 1) + " мес не возвращаются"}</span></h2>
      <div class="cards">
        <div class="card ${fit}"><h4>Пик вложений</h4><div class="big">${fmtMoney(c.peak)}</div><div class="muted">месяц ${c.peakMonth ?? 0}${isNum(bud) ? ` · бюджет ${fmtMoney(bud)}` : " · укажите бюджет в панели"}</div></div>
        <div class="card"><h4>Партий / штук</h4><div class="big">${fmtN(c.batches)} / ${fmtN(c.unitsPurchased)}</div><div class="muted">первая ${fmtN(c.firstBatchUnits)} шт × ${fmtMoney(c.landed, 2)} · срок поставки ${fmtN(c.leadDays)} дн ≈ ${fmtN(c.leadMonths)} мес</div></div>
        <div class="card ${c.paybackMonth !== null ? "ok" : "fail"}"><h4>Деньги вернулись</h4><div class="big">${c.paybackMonth !== null ? "месяц " + c.paybackMonth : "нет"}</div><div class="muted">${c.paybackMonth !== null ? "после него итог больше не уходит в минус" : "на горизонте сценария итог остаётся в минусе"}</div></div>
        <div class="card"><h4>Итог на конец</h4><div class="big">${fmtMoney(c.endCum)}</div><div class="muted">плюс товар на складе: ${fmtN(c.stockUnitsEnd)} шт на ${fmtMoney(c.stockValueEnd)} по себестоимости${c.stockoutMonths ? ` · месяцев без товара: ${c.stockoutMonths}` : ""}</div></div>
      </div>
      <div class="stack" style="margin-top:.8rem"><div class="chartbox"><canvas id="ch-cash"></canvas></div>
      <div class="tablewrap" style="max-height:420px;overflow:auto"><table class="cashtable"><thead><tr><th>Месяц</th><th class="num">Заказ, шт</th><th class="num">Оплата партии</th><th class="num">Продано</th><th class="num">Поступления</th><th class="num">Реклама</th><th class="num">За месяц</th><th class="num">Итог</th><th class="num">Склад</th><th class="num">Отзывы</th></tr></thead><tbody>${rows}</tbody></table></div></div>
      <p class="muted" style="font-size:.8rem">Поступления — выручка минус комиссия Amazon и FBA. Себестоимость списывается один раз, при оплате партии, и с продаж повторно не вычитается. Допущения сценария: ${esc(c.assumptions.join("; "))}. Горизонт, разгон, первая партия и стартовые расходы задаются в панели «Экономика и бюджет». Критерий 2 считает свои 90 дней на целевом уровне продаж; здесь продажи идут по разгону — обе цифры показаны рядом в строках 2g–2i.</p>`;
  }
  function drawCashflow(container, R) {
    const c = R.cashflow; if (!c || c.pending) return; const [s1, s2] = series();
    mkChart(container, "ch-cash", { type: "bar", data: { labels: c.rows.map((r) => "мес " + r.month), datasets: [
      { type: "line", label: "Итог нарастающим", data: c.rows.map((r) => r.cum), borderColor: s2, backgroundColor: s2, borderWidth: 2, pointRadius: 2, tension: .2 },
      { type: "bar", label: "За месяц", data: c.rows.map((r) => r.net), backgroundColor: s1, borderRadius: 4, barPercentage: .7 }] },
      options: { plugins: { tooltip: { callbacks: { label: tooltipMoney(0) } } }, scales: { x: { grid: { display: false } }, y: { grid, ticks: { callback: (v) => fmtMoney(v) } } } } });
  }

  // ---------- пограничные значения (spec 005) ----------
  function secBorderline(A, R) {
    const b = R.borderline; if (!b) return "";
    if (!b.items.length) return `<h2>Пограничные значения <span class="chip ok">нет</span></h2><p class="muted">Ни один показатель не подошёл к своему порогу ближе чем на ${fmtPct(b.limit)} — оценки устойчивы к погрешности данных.</p>`;
    return `<h2>Пограничные значения <span class="chip warn">${b.items.length}</span></h2>
      <p class="muted" style="font-size:.85rem">Показатели в пределах ${fmtPct(b.limit)} от порога. Порог режет резко, а данные — оценки с погрешностью: эти решения стоит перепроверить по второму источнику, прежде чем на них опираться.</p>
      <div class="tablewrap"><table><tbody>${b.items.map((i) => `<tr><td>${st(i.side === "pass" ? "ok" : "warn")}</td><td><b>${esc(i.label)}</b></td><td>${esc(i.text)}</td></tr>`).join("")}</tbody></table></div>`;
  }

  // ---------- регуляторные триггеры (spec 005) ----------
  function regulatoryBlock(R) {
    const g = R.regulatory; if (!g) return "";
    const head = `<h3 style="margin-top:1rem">Регуляторные триггеры <span class="chip ${g.triggers.length ? "warn" : "na"}">${g.triggers.length ? g.triggers.length + " — проверить" : "не найдено"}</span><span class="chip warn" title="Подсказка по словам, не юридический вывод">допущение</span></h3>`;
    if (!g.triggers.length) return `${head}<p class="muted" style="font-size:.85rem">По словам ниши, заголовкам (${fmtN(g.checked.titles)}) и запросам (${fmtN(g.checked.terms)}) триггеров не найдено. Это не значит, что рисков нет: проверьте требования категории Amazon вручную.</p>`;
    const rows = g.triggers.map((t) => `<tr><td><b>${esc(t.agency)}</b><br><span class="chip ${t.kind === "claim" ? "pending" : "warn"}" title="${t.kind === "claim" ? "Требование следует из обещания в листинге — от обещания можно отказаться" : "Требование следует из самого типа товара"}">${t.kind === "claim" ? "обещание" : "тип товара"}</span></td><td><b>${esc(t.title)}</b><br><span class="muted" style="font-size:.85rem">${esc(t.meaning)}</span></td><td><small>${t.words.map((w) => `<span class="chip">${esc(w)}</span>`).join(" ")}<br><span class="muted">${[t.where.head ? "в названии ниши / главном ключе" : "", t.where.titles ? `в ${fmtN(t.where.titles)} заголовках (${fmtPct(t.where.titleShare)})` : "", t.where.terms ? `в ${fmtN(t.where.terms)} запросах` : ""].filter(Boolean).join(" · ")}</span></small></td></tr>`).join("");
    return `${head}<div class="tablewrap"><table><thead><tr><th>Ведомство</th><th>Что это значит для входа</th><th>Где сработало</th></tr></thead><tbody>${rows}</tbody></table></div><p class="muted" style="font-size:.8rem">${esc(g.note)}</p>`;
  }

  function secChallenger(A, R) {
    const ch = R.challenger;
    const KIND = { confirmed: ["ok", "данные"], assumed: ["warn", "допущение"], decided: ["pending", "решение"], unknown: ["na", "нет данных"] };
    const rows = Object.entries(ch.items).map(([k, it]) => { const kd = KIND[it.kind] || KIND.unknown; return `<tr><td><b>${k}</b>${it.mandatory ? ' <span class="chip fail" title="обязателен зелёным">обяз.</span>' : ""}</td><td>${esc(it.title)}</td><td>${st(it.status)}</td><td><span class="chip ${kd[0]}" title="Основание статуса: данные — прямые данные по нише; допущение — прокси/AI-скан; решение — ваш план, не факт">${kd[1]}</span></td><td class="muted">${esc(it.note || "")}</td></tr>`; }).join("");
    return `<h2>Критерии 1–8 против доминирующего игрока <span class="chip ${ch.active ? (ch.pass ? "ok" : ch.pending ? "pending" : "fail") : "na"}">${ch.active ? `${ch.greenCount} из 8 зелёных по данным · обязательные 6/8 ${ch.mandatoryOk ? "OK" : "не OK"}` : "справочно"}</span></h2>
      <p class="muted">${esc(ch.note)}. Правило: входить при ≥ 6 из 8 зелёных, критерии 6 и 8 обязательны. В счёт «N из 8» идут только зелёные статусы, подтверждённые данными (колонка «Основание»: не допущение и не решение).</p>
      ${!ch.gate4Discussed ? '<div class="notice">Gate 4 не обсуждён: патентный поиск не отмечен (панель «Риски», поле «Патенты / FTO»).</div>' : ""}
      <div class="tablewrap"><table><thead><tr><th>#</th><th>Критерий</th><th>Статус</th><th>Основание</th><th>Комментарий</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  }

  const RISK = { high: ["fail", "высокий"], med: ["warn", "средний"], low: ["ok", "низкий"], none: ["na", "нет"] };
  function secPatents(A, R, o) {
    const P = A.patents;
    const btn = o.static ? "" : `<div class="row noprint" style="margin:.5rem 0"><button data-action="patents" style="flex:0 0 auto">${P ? "🔄 Повторить патентный скан" : "🔎 Патентный скан (AI + Google Patents)"}</button>${o.selectedPatentModel ? `<span class="chip" title="Модель для патентного скана">${esc(o.selectedPatentModel)}</span> <a href="#" data-action="settings" class="muted" style="font-size:.8rem">изменить</a>` : ""}<span class="muted" id="patents-status"></span></div>`;
    if (!P) return `<h2>Патенты / FTO (критерий 8, Gate 4) <span class="chip na">не проверено</span></h2>${btn}<p class="muted">AI формирует запросы к Google Patents по типу товара и вашей ключевой фиче, читает независимые claims найденных патентов и оценивает пересечение с ТЗ. Результат — предварительный скрининг (🟡 допущение), не юридическое заключение. Укажите фичу для проверки в панели «Риски и compliance» → «Ключевая фича для патентного скана».</p>`;
    const cls = P.status === "conflict" ? "fail" : P.status === "unsure" ? "warn" : "ok";
    const label = { conflict: "есть красные флаги", unsure: "требует проверки", clear: "явных пересечений нет" }[P.status] || P.status;
    const rows = (P.items || []).map((x) => `<tr class="${x.risk === "high" ? "leader" : ""}"><td><a href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.number)}</a>${x.pending ? ' <span class="chip warn" title="заявка, ещё не выдана">заявка</span>' : ""}${x.expired ? ' <span class="chip na">истёк</span>' : ""}<br><small class="muted">${esc(x.title || "")}${x.assignee ? " · " + esc(x.assignee) : ""}</small></td><td>${st(RISK[x.risk]?.[0] || "na")} <small>${esc(RISK[x.risk]?.[1] || x.risk)}</small><br><small class="muted">релев. ${fmtPct(x.relevance)}</small></td><td>${esc(x.claimed)}</td><td>${esc(x.overlap)}</td><td>${esc(x.designAround)}</td><td class="num"><small>${esc(x.priorityDate || "—")}<br>до ${esc(x.expiryEstimate || "—")}</small></td></tr>`).join("");
    return `<h2>Патенты / FTO (критерий 8, Gate 4) <span class="chip ${cls}">AI-скан: ${label}</span>${o.patentsRunning ? '<span class="chip pending">обновляется…</span>' : ""}</h2>${btn}${o.patentsRunning ? '<div class="notice info" style="margin:.4rem 0">Идёт новый патентный скан — ниже предыдущий результат.</div>' : ""}
      <div class="verdict ${cls === "fail" ? "no_go" : cls === "warn" ? "go_conditional" : "go"}"><div><b>${esc(P.summary)}</b></div>
        <div class="muted" style="margin-top:.3rem">Проверялась фича: ${esc(P.feature || "тип товара")} · кандидатов найдено ${fmtN(P.candidatesTotal)}, оценено ${(P.items || []).length} · ${esc(P.model || "")} · ${fmtDate(P.createdAt)}</div></div>
      <div class="tablewrap" style="margin-top:.7rem"><table><thead><tr><th>Патент</th><th>Риск</th><th>Что защищает независимый claim</th><th>Пересечение с нашим ТЗ</th><th>Design-around</th><th class="num">Приоритет / срок</th></tr></thead><tbody>${rows || '<tr><td colspan="6" class="empty">кандидатов не найдено</td></tr>'}</tbody></table></div>
      <div class="two" style="margin-top:.7rem"><div><h4>Запросы (проверить вручную в Google Patents)</h4><div class="chips">${(P.queries || []).map((q) => `<a class="chip" href="${esc(q.url)}" target="_blank" rel="noopener" title="${esc(q.purpose)}">${esc(q.q)}</a>`).join("")}</div>${P.concepts?.length ? `<p class="muted" style="font-size:.85rem">Патентуемые признаки ТЗ: ${P.concepts.map(esc).join("; ")}</p>` : ""}</div>
      <div class="textcol"><h4>Следующие шаги</h4><ol>${(P.nextSteps || []).map((s) => `<li>${esc(s)}</li>`).join("")}</ol><p class="muted" style="font-size:.85rem"><b>Design patents:</b> ${esc(P.designPatentNote || "")}${P.designHits?.length ? ` Найдено по названию: ${P.designHits.slice(0, 5).map((d) => `<a href="${esc(d.url)}" target="_blank" rel="noopener">${esc(d.number)}</a>`).join(", ")}.` : ""}</p></div></div>
      <div class="notice" style="margin-top:.6rem">${esc(P.disclaimer)} Подтвердить статус: панель «Риски и compliance» → «Патенты / FTO».</div>`;
  }

  function secScorecard(A, R) {
    const sc = R.scorecard;
    const rows = Object.entries(sc.axes).map(([k, a]) => `<tr><td>${axisName(k)} <small class="muted">${Math.round(sc.weights[k] * 100)} %</small></td><td class="num"><b>${isNum(a.score) ? a.score.toFixed(1) : "—"}</b></td><td class="muted">${esc(a.note)}</td></tr>`).join("");
    return `<h2>Scorecard (5 осей) <span class="chip ${sc.band === "no_go" ? "fail" : sc.band === "rework" ? "warn" : sc.band ? "ok" : "na"}">${isNum(sc.total) ? Math.round(sc.total) + " %" : "—"}</span></h2>
      <div class="two"><div class="chartbox"><canvas id="ch-radar"></canvas></div>
      <div class="tablewrap"><table><thead><tr><th>Ось</th><th class="num">0–10</th><th>Комментарий</th></tr></thead><tbody>${rows}</tbody></table>
      <p class="muted" style="font-size:.8rem">80–100 Go priority · 60–79 Go (проверить слабую ось) · 40–59 Доработка · < 40 No-Go. ${sc.complete ? "" : "Экономика не заполнена — итог нормирован по заполненным осям."}</p></div></div>`;
  }
  function drawScorecard(container, R) {
    const sc = R.scorecard; const keys = Object.keys(sc.axes); const s1 = series()[0];
    mkChart(container, "ch-radar", { type: "radar", data: { labels: keys.map(axisName), datasets: [{ label: "Балл", data: keys.map((k) => sc.axes[k].score ?? 0), borderColor: s1, backgroundColor: s1 + "33", borderWidth: 2, pointRadius: 4, pointBackgroundColor: s1 }] },
      options: { plugins: { legend: { display: false } }, scales: { r: { min: 0, max: 10, ticks: { stepSize: 2, backdropColor: "transparent" }, grid, angleLines: grid, pointLabels: { color: cssVar("--text-2") } } } } });
  }

  function secReconciliation(A, R) {
    const rec = R.reconciliation; if (!rec?.length) return "";
    return `<h2>Сверка источников</h2><div class="tablewrap"><table><thead><tr><th>Метрика</th><th class="num">A</th><th class="num">B</th><th class="num">Расхождение</th><th>Вывод</th></tr></thead><tbody>
      ${rec.map((x) => `<tr><td>${esc(x.metric)}</td><td class="num">${esc(x.a.src)}: <b>${fmtAny(x.a.value, x.metric)}</b></td><td class="num">${esc(x.b.src)}: <b>${fmtAny(x.b.value, x.metric)}</b></td><td class="num">${fmtPct(x.deltaPct)}</td><td>${st(x.level === "noise" ? "ok" : x.level === "borderline" ? "warn" : "fail")} <small class="muted">${x.level === "noise" ? "шум — можно усреднять" : x.level === "borderline" ? "берём консервативную цифру" : "не усреднять — разные метрики/прокси/contamination"}</small></td></tr>`).join("")}</tbody></table></div>`;
  }
  const fmtAny = (v, m) => (/\$/.test(m) ? (m.includes("/мес") ? fmtK(v) : fmtMoney(v, 2)) : /доля/i.test(m) ? fmtPct(v, 1) : fmtN(v));

  function secAi(A, R, o) {
    const ai = A.ai;
    const sel = o.selectedModel ? `<span class="chip" title="Модель для AI-вердикта">${esc(o.selectedModel)}</span> <a href="#" data-action="settings" class="muted" style="font-size:.8rem">изменить в Настройках</a>` : "";
    const btns = o.static ? "" : `<div class="row noprint" style="margin:.5rem 0"><button class="primary" data-action="ai" style="flex:0 0 auto">${ai ? "🔄 Повторить AI-анализ" : "✨ Запустить AI-анализ"}</button>${sel}<span class="muted" id="ai-status"></span></div><div id="ai-progress" class="ai-progress hidden"></div>`;
    if (!ai) return `<h2>AI-вердикт и рекомендации</h2>${btns}<div class="empty">AI получает только агрегаты дашборда (не файлы) и возвращает вердикт, обоснование по гейтам, гипотезы дифференциации и шаги. Вердикт не может быть мягче правил.</div>`;
    const gates = (ai.gates || []).map((g) => `<tr><td><b>${esc(GATE_NAMES[g.gate] || g.gate)}</b></td><td>${st(g.status === "pass" ? "ok" : g.status === "fail" ? "fail" : g.status === "rework" ? "warn" : "na")}</td><td>${esc(g.reasoning)}</td></tr>`).join("");
    const diff = (ai.differentiation || []).map((d) => `<div class="card"><h4>${esc(d.hypothesis)}</h4><div class="muted" style="font-size:.85rem">Основание: ${esc(d.evidence)}</div><div style="margin-top:.3rem"><b>ТЗ:</b> ${esc(d.specRequirement)}</div></div>`).join("");
    const recs = (ai.recommendations || []).map((r) => `<div class="rec ${esc(r.priority)}"><h4>${{ high: "🔴", med: "🟠", low: "🟢" }[r.priority] || ""} ${esc(r.title)}</h4><div>${esc(r.text)}</div></div>`).join("");
    const refreshing = o.aiRunning ? '<div class="notice info" style="margin:.4rem 0">Идёт новый AI-анализ — ниже предыдущий результат; он будет заменён после завершения.</div>' : "";
    return `<h2>AI-вердикт и рекомендации <span class="chip">${esc(ai.model || "")}</span>${ai.adjustedByRules ? '<span class="chip warn">скорректирован правилами</span>' : ""}${o.aiRunning ? '<span class="chip pending">обновляется…</span>' : ""}</h2>${btns}${refreshing}<div style="${o.aiRunning ? "opacity:.45;pointer-events:none" : ""}">
      <div class="verdict ${esc(ai.verdict)}"><div class="big">${esc(VLABEL[ai.verdict])}</div>${ai.adjustedByRules ? `<div class="muted">${esc(ai.adjustmentNote)}</div>` : ""}<p>${esc(ai.summary)}</p><p><b>Решающий гейт:</b> ${esc(ai.decisiveGate)}</p><p><b>Критерий 1:</b> ${esc(ai.criterion1Summary)}</p></div>
      <div class="two" style="margin-top:.8rem"><div class="tablewrap"><h4>Гейты</h4><table><tbody>${gates}</tbody></table></div>
      <div class="textcol"><h4>Следующие шаги</h4><ol>${(ai.nextSteps || []).map((s) => `<li>${esc(s)}</li>`).join("")}</ol>${ai.pricingPackComment ? `<h4>Цена / комплектация</h4><p>${esc(ai.pricingPackComment)}</p>` : ""}${ai.risks?.length ? `<h4>Риски</h4><ul>${ai.risks.map((r) => `<li>${esc(r)}</li>`).join("")}</ul>` : ""}</div></div>
      ${diff ? `<h4 style="margin-top:.8rem">Гипотезы дифференциации</h4><div class="cards">${diff}</div>` : ""}
      ${recs ? `<h4 style="margin-top:.8rem">Рекомендации</h4>${recs}` : ""}
      <p class="muted" style="font-size:.75rem">${fmtDate(ai.createdAt)} · ${esc(ai.provider || "")} ${esc(ai.model || "")} · токены: вход ${fmtN(ai.usage?.input)} (кэш ${fmtN(ai.usage?.cacheRead)}), выход ${fmtN(ai.usage?.output)}${isNum(ai.usage?.cost) ? " · стоимость $" + ai.usage.cost.toFixed(4) : ""} · ${isNum(ai.durationMs) ? Math.round(ai.durationMs / 1000) + " с" : ""}${ai.staleSince ? " · ⚠ входные данные менялись после анализа" : ""}</p></div>`;
  }
  const GATE_NAMES = { gate0: "Gate 0 — данные", gate1: "Gate 1 — экономика", gate2: "Gate 2 — реклама", gate3: "Gate 3 — конкуренция", gate4: "Gate 4 — патенты", criterion1: "Критерий 1", traffic: "Трафик", budget: "Бюджет", scorecard: "Scorecard" };

  function secChecklist(A, R) {
    const c = A.inputs.checklist || {};
    const yes = (b) => (b ? '<span class="status fail">да</span>' : '<span class="status ok">нет</span>');
    return `<h2>Чеклист рисков и compliance</h2><div class="tablewrap"><table><tbody>
      <tr><td>Закрытая категория</td><td>${yes(c.gatedCategory)}</td><td>Опасные товары</td><td>${yes(c.dangerousGoods)}</td></tr>
      <tr><td>Сертификаты</td><td>${esc(c.certificates || "—")}</td><td>Amazon продаёт сам</td><td>${yes(R.competition.amazonSells)} <small class="muted">${R.competition.amazonSellsSource === "user" ? "вручную" : R.competition.amazonSellsSource === "xray" ? "по Xray (Seller)" : "авто"}</small></td></tr>
      <tr><td>Патенты / FTO</td><td>${esc({ none: "не проверял", clear: "не найдено", design_around: "design-around", unsure: "нужен юрист", conflict: "конфликт" }[c.patentSearch] || "—")}</td><td>Торговая марка</td><td>${esc({ none: "не проверял", free: "свободна", conflict: "занята" }[c.trademarkSearch] || "—")}</td></tr>
      <tr><td>Склейка отзывов</td><td>${yes(c.reviewMergingSuspected)}</td><td>Купоны/дилы</td><td>${esc(c.couponsDealsSaturation || "—")}</td></tr>
      <tr><td>Тест дизайна</td><td>${isNum(c.designTestScore) ? c.designTestScore + " % " + (c.designTestScore >= 30 ? "✓" : "✗ (< 30 %)") : "—"}</td><td>Жизненный цикл</td><td>${isNum(c.lifecycleMonths) ? c.lifecycleMonths + " мес " + (c.lifecycleMonths >= 25 ? "✓" : "✗ (< 25)") : "—"}</td></tr>
      <tr><td>Листингов в выдаче</td><td>${isNum(c.listingsInSearch) ? fmtN(c.listingsInSearch) + (c.listingsInSearch > 3000 ? " — высокая конкуренция" : "") : "—"}</td><td></td><td></td></tr></tbody></table></div>${regulatoryBlock(R)}`;
  }

  function secConclusion(A, R) {
    const v = R.verdict;
    return `<h2>Выводы по правилам</h2><div class="verdict ${esc(v.ceiling)}"><div class="big">Потолок: ${esc(VLABEL[v.ceiling])}</div><div>Решающий: <b>${esc(v.decisiveGate || "—")}</b></div>
      <ul>${v.reasons.length ? v.reasons.map((r) => `<li>${esc(r)}</li>`).join("") : "<li>Все гейты пройдены.</li>"}</ul></div>`;
  }


  // ---------- подсказки при наведении (spec 006) ----------
  // Пояснения — общие определения без цифр анализа: безопасны для публичной ссылки и автономного HTML.
  // Ключ — текст названия в интерфейсе (без чипов и без хвоста в скобках); "секция|название" — уточнение для одной секции.
  const TIPS = {
    // секции
    "Обзор": "Главные цифры ниши одним взглядом. Цвет плитки — статус показателя по порогам методики.",
    "Критерий 1 — Рыночный контекст": "Восемь рыночных показателей ниши (1a–1h). Нужно минимум 6 чётких «OK»; пограничные значения в счёт не идут.",
    "Живая экономика": "Ползунки для быстрых «а что, если»: меняете цену, себестоимость, CPC, конверсию или цель продаж — все расчёты обновляются сразу, без AI.",
    "Экономика — Gate 1 / Gate 2": "Два обязательных теста юнит-экономики: Gate 1 — прибыль без рекламы, Gate 2 — выживает ли прибыль после расходов на рекламу.",
    "Экономика": "Юнит-экономика товара. Считается только из чисел менеджера: без цены и себестоимости от поставщика раздел пуст.",
    "Бюджет первой закупки и стоп-вопросы": "Сколько денег нужно на запуск и четыре вопроса, любой ответ «нет» на которые останавливает анализ.",
    "Деньги по месяцам": "Помесячный сценарий запуска: оплата партий, разгон продаж, реклама и остаток денег. Показывает, сколько денег максимум будет вложено и когда они вернутся.",
    "Трафик по ключам": "Поисковый спрос: по каким запросам покупатели находят товар, насколько трафик сосредоточен в одном-двух ключах и сколько стоит клик.",
    "Вход в нишу: трафик, новички, отзывы": "Реально ли новому листингу сюда зайти: какая доля кликов покупателей нужна под вашу цель продаж и как живут те, кто вошёл недавно.",
    "Конкурентная карта": "Кто делит выручку ниши: доли брендов, лидер, барьер отзывов и 20 самых продаваемых товаров.",
    "Конкуренты": "Кто делит выручку ниши. Загрузите Xray или POE.",
    "Ценовые сегменты": "Ниша, разбитая на три равные по числу товаров ценовые группы. Сегмент, где доля выручки заметно больше доли товаров, — недообслужен.",
    "Цена ниши": "По какой цене в нише реально покупают.",
    "Сезонность и тренд": "Недельная динамика поиска, концентрации брендов и цены за последний год по данным Amazon (POE).",
    "Структура ниши: сейчас / квартал назад / год назад": "Как меняется ниша: число товаров и брендов, запуски, отзывы, доля рекламы. Рост числа продавцов при падении спроса — плохой знак.",
    "Тональность отзывов": "О чём покупатели пишут в отзывах по всей нише. Негативные темы — готовые требования к вашему товару.",
    "Патенты / FTO": "Предварительная проверка: не защищена ли патентом ваша ключевая фича. FTO (freedom to operate) — право продавать, не нарушая чужих патентов. Это скрининг, не заключение юриста.",
    "Критерии 1–8 против доминирующего игрока": "Дополнительная проверка, когда у одного бренда больше четверти ниши: можно ли его потеснить. Нужно 6 из 8 зелёных, критерии 6 и 8 обязательны.",
    "Scorecard": "Сводная оценка ниши в процентах по пяти осям с весами: рынок, конкуренция, экономика, соответствие бренду, операционный риск. От 60 % — Go.",
    "Сверка источников": "Один и тот же показатель из разных отчётов. Расхождение до 10 % — шум, 10–30 % — берём осторожную цифру, больше 30 % — источники меряют разное, усреднять нельзя.",
    "Пограничные значения": "Показатели, которые отстоят от своего порога не больше чем на 15 %. Данные — оценки с погрешностью, поэтому такие решения стоит перепроверить.",
    "Чеклист рисков и compliance": "Юридические и операционные риски, которые менеджер отмечает сам, плюс автоматические регуляторные триггеры по словам ниши.",
    "Выводы по правилам": "Максимальный вердикт, который допускают формальные правила методики, и причины ограничений. AI не может поставить вердикт мягче.",
    "AI-вердикт и рекомендации": "AI получает только итоговые цифры дашборда (не файлы) и объясняет картину словами: вердикт, гейты, гипотезы отличия, следующие шаги.",
    // заголовки внутри секций
    "Критерий 2 — детальная экономика": "Одиннадцать показателей экономики на горизонте 90 дней. Нужно 8 «OK», при этом прибыль на юнит, ROI и маржа с рекламой обязательны.",
    "Четыре стоп-вопроса": "Быстрый отсев: бюджет, ROI ≥ 150 %, выручка первой страницы ≥ $500 тыс. в месяц, возможность отличиться. Любое «нет» — дальше можно не анализировать.",
    "Новые участники": "Листинги возрастом от 2 до 24 месяцев, которые уже заметны покупателям. Их продажи и отзывы — реалистичный ориентир для вашего старта.",
    "Срок до планки отзывов": "Сколько месяцев уйдёт, чтобы набрать столько отзывов, сколько у недавних новичков: (планка − отзывы Vine) ÷ доля покупателей с отзывом ÷ продажи в месяц.",
    "Регуляторные триггеры": "Слова в названии ниши, заголовках и запросах, за которыми стоят требования ведомств США. Подсказка, что проверить до заказа партии, — не юридический вывод.",
    "Gate 1 — без рекламы": "Прибыль с одной штуки до рекламы: цена − себестоимость − доставка − комиссия Amazon − FBA. Проходит при марже выше 30 % и прибыли выше $15 (для товаров дешевле $25 — марже выше 40 %).",
    "ROI": "Прибыль с единицы без рекламы, делённая на полную себестоимость (товар + доставка). Норма — от 150 %; выше 200 % — повод перепроверить данные.",
    "Gate 2 — стресс-тест рекламы": "Остаётся ли прибыль после рекламы. Реклама на одну продажу = CPC ÷ конверсия × доля продаж через рекламу. Тест пройден, если прибыль положительна при конверсии 12 % и ниже.",
    "Маржа без / с рекламой": "Две разные цифры: маржа из калькулятора Amazon и маржа после реальных расходов на рекламу. Решения принимают по второй.",
    "Net after ads по CVR": "Прибыль с одной штуки после рекламы при разной конверсии. Точка — ваша текущая конверсия.",
    "Партия": "Сколько штук и денег нужно на одну партию: продажи в день × срок поставки (производство + доставка + приёмка Amazon).",
    "Нужно всего": "Две партии плюс резерв на рекламу — правило методики, чтобы не остаться без товара после запуска.",
    "Пик вложений": "Максимальная сумма, которая одновременно будет вложена в товар и рекламу до того, как продажи начнут её возвращать. С ней сравнивается ваш бюджет.",
    "Бюджет": "Ваши деньги на запуск. Дефицит до 15 % от потребности считается допустимым («почти»).",
    "Наценка": "Цена продажи, делённая на полную себестоимость. Ориентир: дешёвому товару нужна наценка около 5×, дорогому хватает 3,3×.",
    "Партий / штук": "Сколько партий сценарий закупил за горизонт и сколько штук всего. Партии дозаказываются заранее, чтобы товар не закончился.",
    "Деньги вернулись": "Первый месяц, после которого накопленный итог больше не уходит в минус — даже в месяцы оплаты следующих партий.",
    "Итог на конец": "Накопленный денежный результат в последний месяц сценария. Товар, оставшийся на складе, в него не входит и показан отдельно по себестоимости.",
    "Поисковый объём, нед.": "Сколько раз в неделю покупатели искали запросы ниши. По перепаду между пиком и минимумом считается сезонность (1g).",
    "Топ-5 брендов, click share": "Какая доля кликов достаётся пяти крупнейшим брендам. Рост линии — ниша концентрируется.",
    "Средняя цена, $": "Средняя цена продаж в нише по неделям. Устойчивое падение — признак ценовой войны.",
    "Негатив — готовые ТЗ-требования": "Темы жалоб и доля отзывов, где они встречаются. Частая системная жалоба — готовое требование к вашему товару.",
    "Позитив — что не сломать": "За что покупатели хвалят товары ниши. Эти свойства при доработке нельзя ухудшить.",
    "Гейты": "Статусы гейтов считает приложение по правилам; AI только объясняет их словами.",
    "Следующие шаги": "Один–три конкретных действия, которые закроют главные пробелы в данных или рисках.",
    "Гипотезы дифференциации": "Идеи отличия товара, выведенные из жалоб покупателей, с измеримым требованием для технического задания.",
    "Рекомендации": "Советы AI по приоритету: красные — сделать до решения о запуске.",
    "Цена / комплектация": "Соображения AI о цене и размере упаковки с опорой на проверенных конкурентов.",
    "Риски": "Что может сломать запуск: от экономики до требований ведомств.",
    "Запросы": "Поисковые запросы, которыми AI искал патенты. Их можно открыть и проверить вручную.",
    "Потолок по правилам": "Самый мягкий вердикт, который допускают правила методики при текущих данных. После AI-анализа здесь появится вердикт AI — он не может быть мягче.",
    "Вердикт AI": "Вердикт модели. Если он оказался мягче правил, приложение понижает его до допустимого и помечает это.",
    // плитки обзора
    "Выручка ниши": "Сумма месячной выручки всех товаров отчёта Xray (1a). Порог — $500 тыс. в месяц. По одному POE это грубая оценка, которая сильно занижает.",
    "Средняя цена": "Медиана цены «проверенных» конкурентов — с сотней отзывов и больше (1b). От $30 — хорошо, $25–30 — погранично.",
    "Adj. SV": "Скорректированный поисковый объём: запросы главного ключа плюс 40 % от суммы остальных ключей кластера (1c). Порог — 3 000 в месяц.",
    "competitors|Отзывы": "Сколько отзывов у товара; в сравнении с нишей — среднее и медиана по товарам.",
    "entry|Отзывы": "Сколько отзывов у листинга: все оценки по Xray, а без него — отзывы с текстом по POE.",
    "Отзывы": "Среднее и медиана числа отзывов у товаров ниши (1d). Среднее искажают гиганты, поэтому смотрите и на медиану. Меньше 300 — барьер низкий.",
    "Top brand": "Доля крупнейшего бренда (1e). От 25 % бренд считается доминирующим, и включаются критерии 3–8.",
    "Топ-5 брендов": "Доля пяти крупнейших брендов вместе (1f). Меньше 45 % — рынок раздроблен, больше 65 % — поделён.",
    "SV ниши T360": "Сколько раз за последние 360 дней покупатели искали запросы этой ниши (данные Amazon POE).",
    "Товары / бренды": "Сколько товаров и брендов Amazon относит к нише.",
    "Спонсорских": "Доля товаров ниши, которые рекламируются. Выше 80 % — рекламная война, клики дорогие.",
    "Конверсия поиска": "Какая доля поисков заканчивается покупкой. Ниже 1 % — покупатели не находят то, что ищут: спрос не удовлетворён.",
    "Возвраты": "Доля возвратов по нише за 360 дней. Высокая доля съедает маржу и указывает на проблему качества.",
    "Критерий 1": "Сколько из восьми рыночных показателей зелёные. Порог — 6 из 8.",
    // трафик
    "SV core": "Сколько раз в месяц ищут главный ключ.",
    "Доля топ-2 ключей": "Какая часть всего поискового объёма приходится на два самых крупных запроса. Больше 80 % — весь трафик держится на двух ключах, это риск.",
    "Релевантных ключей": "Сколько запросов с заметным объёмом подходят вашему товару. Нужно не меньше 30.",
    "Продаж по кластеру": "Сколько штук в месяц продаётся по ключам кластера (Keyword Sales из Cerebro). Продают ключи, а не объём поиска.",
    "Групп ключей": "Сколько смысловых групп запросов ведут к товару. Нужно не меньше трёх — тогда трафик не зависит от одной формулировки.",
    "Топ-20 продуктов": "Какая доля кликов достаётся двадцати самым кликаемым товарам. Выше 70 % — новичку мало что остаётся.",
    "Запрос": "Поисковая фраза покупателя.",
    "SV/мес": "Сколько раз в месяц ищут эту фразу.",
    "Тренд": "Изменение поискового объёма за последние месяцы.",
    "Bid": "Рекомендованная ставка за клик в рекламе Amazon по этой фразе. Ставка главного ключа подставляется как CPC по умолчанию.",
    "Конкур. товаров": "Сколько товаров Amazon показывает по этой фразе.",
    "Click share": "Доля кликов покупателей, которая достаётся товару или запросу внутри ниши.",
    "ABA click %": "Доля кликов трёх самых кликаемых товаров по фразе (Amazon Brand Analytics). Чем выше, тем труднее пробиться.",
    // конкуренты
    "Лидер": "Бренд с наибольшей долей выручки (или кликов, если загружен только POE).",
    "Отзывов у лидера": "«Ров» лидера: до 500 отзывов его можно догнать, 500–2 000 — нужен сильный отличительный признак и программа Vine, больше — органически почти недостижимо.",
    "Игроков с ≥100 отзывов": "Сколько брендов уже закрепились в нише.",
    "Топ-5 / топ-10 / топ-20": "Доля выручки у пяти, десяти и двадцати крупнейших брендов.",
    "Доля лидера": "Доля крупнейшего бренда внутри выбранного ценового диапазона и во всей нише.",
    "Медиана цены": "Цена «посередине»: половина товаров дешевле, половина дороже.",
    "Бренд": "Бренд из отчёта. Свой бренд подсвечивается, если указан в панели.",
    "ASIN / товар": "Идентификатор товара на Amazon — ссылка открывает листинг.",
    "Цена": "Текущая цена по Xray; по POE — средняя за 360 дней.",
    "Продажи": "Оценка продаж в штуках за месяц (Helium 10 Xray).",
    "Выручка": "Оценка выручки за месяц (Helium 10 Xray).",
    "★": "Средний рейтинг товара.",
    "Создан": "Дата создания листинга по Xray — по ней считается возраст товара.",
    // цены
    "Сегмент": "Entry — дешёвая треть товаров, Mid — средняя, Premium — дорогая.",
    "Диапазон": "Границы цен сегмента.",
    "Доля товаров": "Какая часть товаров ниши попадает в сегмент.",
    "Доля выручки": "Какая часть выручки ниши приходится на сегмент. Больше доли товаров — сегмент недообслужен.",
    "Доля кликов": "Какая часть кликов покупателей приходится на сегмент.",
    "Цена по кликам покупателей": "Цена ниши, взвешенная долей кликов: дорогой товар, на который никто не кликает, её не завышает. Это цена, которую покупатели реально рассматривают.",
    "Обычная средняя / медиана": "Простое среднее и медиана цен — каждый товар с одинаковым весом, даже если его никто не покупает.",
    "Медиана проверенных": "Медиана цены конкурентов с сотней отзывов и больше — показатель 1b.",
    "Ваша цена": "Цена из панели. Сильное отклонение от цены по кликам должно быть осознанным: премиум или демпинг.",
    // вход в нишу
    "Продаж на 1 % кликов ниши": "Сколько штук в месяц приносит один процент кликов покупателей. Считается по товарам, которые есть и в Xray (продажи), и в POE (доля кликов); показана медиана.",
    "Нужная доля кликов": "Ваша цель продаж в месяц, делённая на продажи на 1 % кликов. Столько внимания покупателей придётся отвоевать.",
    "Товаров с такой долей": "У скольких товаров ниши уже есть доля кликов не меньше нужной вам. Ноль — такой доли нет ни у кого, цель нереалистична.",
    "Оценка": "Сравнение нужной доли кликов с долями новичков ниши. Порог предварительный и на вердикт не влияет.",
    "Продажи новичков": "Медианные продажи недавно вошедших листингов — реалистичный уровень первых месяцев. С него стартует сценарий «Деньги по месяцам».",
    "Отзывы новичков": "Медиана отзывов у недавно вошедших листингов — планка, которую реально нужно догнать.",
    "Доля кликов новичков": "Сколько кликов ниши получают недавно вошедшие листинги: медиана и лучший результат.",
    "Планка": "Сколько отзывов нужно набрать, чтобы выглядеть не хуже недавних новичков.",
    "У лидера": "Отзывы самого крупного бренда — для сравнения. Догонять нужно не его.",
    "Срок": "За сколько месяцев набирается планка отзывов.",
    "При целевых продажах": "Срок до планки, если сразу продавать столько, сколько задано целью «Продаж в день».",
    "При продажах новичков": "Срок до планки при продажах, как у недавних новичков, — реалистичнее для первых месяцев.",
    "Возраст": "Сколько месяцев листингу: по дате создания из Xray, а без неё — по дате запуска из POE.",
    "Доля": "Доля кликов покупателей ниши, которую получает товар.",
    "Продажи/мес": "Оценка продаж в штуках за месяц по Xray.",
    // деньги по месяцам
    "Месяц": "Месяц от оплаты первой партии. «Продажи N» — какой по счёту месяц продаж.",
    "Заказ, шт": "Сколько штук заказано в этом месяце и сколько пришло на склад из прошлых заказов.",
    "Оплата партии": "Оплата заказанной партии по полной себестоимости (товар + доставка), в нулевом месяце — вместе со стартовыми расходами.",
    "Продано": "Сколько штук продано. «Нет в наличии» — товара не хватило на весь спрос месяца.",
    "Поступления": "Выручка минус комиссия Amazon и сбор FBA. Себестоимость здесь не вычитается — она уже оплачена вместе с партией.",
    "Реклама": "Расходы на рекламу: продажи × доля продаж через рекламу × CPC ÷ конверсия. Пока отзывов меньше планки, конверсия снижена.",
    "За месяц": "Поступления минус реклама и оплаты этого месяца.",
    "Итог": "Накопленный результат с начала. Самое глубокое отрицательное значение — пик вложений.",
    "Склад": "Остаток товара на конец месяца, штук.",
    "cashflow|Отзывы": "Сколько отзывов накоплено: отзывы программы Vine плюс доля покупателей, оставляющих отзыв.",
    // критерии, scorecard, сверка, патенты, регуляторика
    "Основание": "На чём держится статус: «данные» — прямые данные ниши, «допущение» — оценка или AI-скан, «решение» — ваш план. В счёт идут только «данные».",
    "Market": "Рынок: размер ниши, спрос, сезонность, успешность запусков, структура трафика. Вес 25 %.",
    "Competition": "Конкуренция: концентрация брендов, барьер отзывов, доминирующий бренд, Amazon как продавец. Вес 25 %.",
    "Economics": "Экономика: Gate 1, Gate 2 и ROI. Без себестоимости ось не учитывается. Вес 25 %.",
    "Brand-fit": "Насколько товар подходит вашему бренду и компетенциям. Задаётся вручную в панели «Риски». Вес 15 %.",
    "Op. risk": "Операционный риск: сертификаты, опасные грузы, патенты, короткий жизненный цикл. 10 — риск низкий. Вес 10 %.",
    "Расхождение": "Разница между двумя источниками относительно большего из значений.",
    "Вывод": "Что делать с расхождением: усреднить, взять осторожную цифру или разбираться, почему источники меряют разное.",
    "Риск": "Оценка AI, насколько патент пересекается с вашим товаром. Высокий — до проверки патентным поверенным входить нельзя.",
    "Что защищает независимый claim": "Суть главного пункта формулы патента — именно он определяет, что запрещено повторять.",
    "Пересечение с нашим ТЗ": "Какие признаки вашего товара совпадают с защищённым в патенте.",
    "Design-around": "Как изменить конструкцию, чтобы не попасть под патент.",
    "Приоритет / срок": "Дата приоритета и примерная дата окончания действия. Истёкший патент не опасен.",
    "Ведомство": "Кто регулирует: FDA — еда, косметика, медизделия; EPA — средства против вредителей и микробов; CPSC — безопасность, детские товары; FCC — электроника и радио.",
    "Что это значит для входа": "Какие документы, испытания или ограничения следуют из требования.",
    "Где сработало": "Какие слова и где найдены: в названии ниши, в заголовках конкурентов или в поисковых запросах.",
    "structure|Успешных запусков": "Сколько новых товаров за год вышли на устойчивые продажи. Делится на число запусков в показателе 1h.",
    "structure|Запусков за 360 дн": "Сколько новых товаров появилось в нише за год.",
    "structure|OOS rate, %": "Как часто товары ниши отсутствуют в наличии. Высокое значение — поставщики не справляются со спросом.",
    "structure|Спонсорских, %": "Доля товаров, которые рекламируются. Выше 80 % — рекламная война.",
    "structure|Топ-5 продуктов, click %": "Доля кликов пяти самых кликаемых товаров (не брендов).",
    "structure|Prime, %": "Доля товаров с доставкой Prime — почти всегда это FBA.",
    // статусы и источники
    "OK": "Показатель в хорошей зоне и идёт в счёт.",
    "ПОГРАНИЧНО": "Между хорошей и плохой зоной. В счёт «N из 8» не идёт.",
    "НЕ OK": "Показатель в плохой зоне.",
    "нет данных": "Для расчёта не хватает файла или поля. Это не «плохо», а «неизвестно».",
    "ожидает": "Ждёт ввода менеджера — обычно цены и себестоимости.",
    "Xray": "Helium 10 Xray: товары первой страницы выдачи с продажами, выручкой, отзывами.",
    "Cerebro": "Helium 10 Cerebro: поисковые запросы, по которым ранжируются конкуренты, с объёмами и ставками.",
    "POE": "Amazon Product Opportunity Explorer: данные самого Amazon о нише — клики, запросы, тренды, отзывы.",
    "ПРОКСИ POE": "Грубая оценка по данным POE вместо точного отчёта Helium 10. Требует сверки.",
    "вручную": "Значение введено менеджером в панели «Ручные метрики» и заменяет расчётное.",
    "SQP": "Search Query Performance из Brand Analytics: показы, клики и покупки по запросам — для рынка и для вашего ASIN.",
    // таблица Gate 2
    "CVR": "Конверсия: какая доля кликов заканчивается покупкой.",
    "Ad cost/юнит": "Расход на рекламу в пересчёте на одну проданную штуку: CPC ÷ конверсия × доля продаж через рекламу.",
    "Net after ads": "Прибыль с одной штуки после рекламы.",
    "ACOS": "Расходы на рекламу в процентах от цены продажи.",
  };
  // Пункты с номерами: Критерий 1 (1a–1h), Критерий 2 (2a–2k), критерии 1–8 (k1–k8).
  const KEY_TIPS = {
    "1a": "Размер ниши: сумма месячной выручки товаров первой страницы. Порог — $500 тыс. в месяц: в маленькой нише не хватит места.",
    "1b": "Медиана цены конкурентов с сотней отзывов и больше. От $30 — хорошо: в дешёвом товаре реклама съедает прибыль.",
    "1c": "Спрос: запросы главного ключа плюс 40 % остальных ключей кластера. Порог — 3 000 в месяц.",
    "1d": "Барьер входа по отзывам: среднее по нише. Меньше 300 — догнать реально, больше 1 000 — нет.",
    "1e": "Есть ли хозяин ниши: доля крупнейшего бренда должна быть ниже 25 %, и Amazon не должен продавать сам.",
    "1f": "Концентрация: доля пяти крупнейших брендов (не товаров). Меньше 45 % — хорошо.",
    "1g": "Сезонность: насколько недельный поиск падает от пика к минимуму за год. Меньше 30 % — продажи ровные.",
    "1h": "Какая доля новых товаров за год вышла на устойчивые продажи. От 30 % — новичкам здесь удаётся закрепиться.",
    "2a": "Ваша цена продажи. Сверяется с медианой проверенных конкурентов: отклонение больше 30 % — красный.",
    "2b": "Себестоимость производства от поставщика. Зелёная только после подтверждения котировкой.",
    "2c": "Конверсия клика в покупку. Для нового листинга реалистично 8–15 %.",
    "2d": "Цена клика в рекламе. Берётся из рекомендованной ставки главного ключа или вводится вручную.",
    "2e": "Какая доля продаж идёт через рекламу. На старте обычно около 70 %.",
    "2f": "Чистая прибыль с одной штуки после рекламы. Обязательный показатель.",
    "2g": "Расходы на рекламу за 90 дней на целевом уровне продаж — как после разгона. В примечании рядом — те же 90 дней по сценарию разгона из «Денег по месяцам».",
    "2h": "Выручка за 90 дней на целевом уровне продаж — как после разгона. В примечании рядом — те же 90 дней по сценарию разгона.",
    "2i": "Прибыль за 90 дней после рекламы на целевом уровне продаж. В примечании рядом — те же 90 дней по сценарию разгона, где первые месяцы продажи ниже, а реклама дороже.",
    "2j": "Прибыль после рекламы, делённая на вложенное (товар + реклама). Порог — 20 %. Обязательный показатель.",
    "2k": "Прибыль после рекламы, делённая на выручку. Порог — 25 %. Обязательный показатель.",
    "k1": "Итог Критерия 1 — рыночный контекст, 6 из 8.",
    "k2": "Итог Критерия 2 — экономика с рекламой.",
    "k3": "Лояльность к бренду: какую долю поиска составляют запросы с именем бренда. Меньше 5 % — покупатели выбирают товар, а не марку.",
    "k4": "Уязвимость лидера: есть ли у него системная жалоба покупателей, которую можно закрыть своим товаром.",
    "k5": "Многоигровое поле: три и больше брендов с заметной долей — значит, в нише уживаются несколько игроков.",
    "k6": "Запас экономики против лидера: выдержите ли вы его цену и рекламное давление. Обязательный критерий.",
    "k7": "Дифференциация: измеримое отличие, которое закрывает жалобу из критерия 4.",
    "k8": "Патентный ландшафт: очевидное улучшение может быть запатентовано. Обязательный критерий.",
  };
  // Поля панели и ползунки: ключ — имя поля (data-input / data-check / data-field / data-axis / data-quick) или "#id".
  const INPUT_TIPS = {
    niche: "Рабочее название анализа — под ним он хранится в истории. По словам названия ищутся и регуляторные триггеры.",
    coreKeyword: "Главный поисковый запрос товара: тот, по которому первая страница Amazon на 80 % состоит из таких же товаров. Не самый объёмный, а самый точный.",
    myBrand: "Если вы уже продаёте в этой нише — укажите бренд: он подсветится в таблицах.",
    myAsins: "Ваши ASIN в этой нише, через запятую.",
    evaluateAsNewEntrant: "Включено — ваш бренд считается таким же конкурентом, как остальные (оценка нового входа). Выключено — рекомендации формулируются как «усилить позицию».",
    priceMin: "Нижняя граница цен, в которых вы собираетесь продавать. Конкуренты дешевле в расчёт не попадут.",
    priceMax: "Верхняя граница цен. Конкуренты дороже в расчёт не попадут. Спрос и размер рынка всегда считаются по всей нише.",
    price: "Цена, по которой вы будете продавать. Пусто — берётся медиана проверенных конкурентов.",
    cogs: "Себестоимость одной штуки у поставщика. Главное число экономики — без него гейты не считаются. AI его не придумывает.",
    shippingPerUnit: "Доставка от поставщика до склада Amazon в пересчёте на одну штуку.",
    fbaFee: "Сбор Amazon за хранение, сборку и доставку одной штуки. Возьмите из калькулятора FBA или колонки Fees в Xray.",
    referralPct: "Комиссия Amazon с продажи. В большинстве категорий 15 %.",
    cpc: "Цена одного клика в рекламе. Пусто — берётся рекомендованная ставка главного ключа из Cerebro.",
    cogsConfirmed: "Отметьте, когда цена получена от поставщика письменно. До этого себестоимость считается оценкой.",
    cvr: "Какая доля кликов превратится в покупки. 10 % — допущение; подсказка под ползунком показывает конверсию по данным ниши.",
    ppcShare: "Какая доля продаж приходит из платной рекламы. На старте обычно 70 %, со временем снижается.",
    unitsPerDay: "Ваша цель продаж. От неё зависят размер партии, деньги по месяцам и доля кликов, которую придётся отвоевать.",
    productionDays: "Сколько дней поставщик делает партию.",
    shippingDays: "Сколько дней партия едет до склада Amazon.",
    receivingDays: "Сколько дней Amazon принимает товар на складе. Обычно около 15.",
    adsReserve: "Деньги, отложенные на рекламу. В помесячном сценарии учитываются, только если цена клика неизвестна.",
    budget: "Сколько денег у вас есть на запуск. Сравнивается с пиком вложений.",
    horizonMonths: "Сколько месяцев продаж просчитывать в сценарии «Деньги по месяцам». По умолчанию 12.",
    rampMonths: "За сколько месяцев продажи вырастут от стартового уровня до цели. По умолчанию 6.",
    startSalesMonthly: "С каких продаж стартует новый листинг. Пусто — медиана продаж новичков ниши, а без данных — разгон с нуля.",
    firstBatchUnits: "Размер первой партии. Пусто — продажи за срок поставки, как принято в методике.",
    startupCosts: "Всё, что платится до первой продажи: фото, образцы, инспекция, Vine, регистрация марки.",
    reviewRate: "Какая доля покупателей оставляет отзыв. 2 % — допущение; если знаете по своим товарам — впишите.",
    vineReviews: "Сколько отзывов даст программа Amazon Vine в первый месяц. Максимум 30.",
    canDifferentiate: "Стоп-вопрос: есть ли у вас измеримое отличие от конкурентов. «Нет» означает No-Go.",
    gatedCategory: "Категория, где для продажи нужно одобрение Amazon.",
    dangerousGoods: "Товар попадает под правила опасных грузов (батареи, аэрозоли, горючее) — дороже хранение и доставка.",
    amazonSells: "Если в нише продаёт сам Amazon, конкурировать с ним почти невозможно. «Авто» определяет это по колонке Seller в Xray.",
    reviewMergingSuspected: "Конкуренты объединяют отзывы разных товаров в один листинг — признак нечестной ниши.",
    certificates: "Нужны ли сертификаты для продажи. Снижает оценку операционного риска.",
    patentSearch: "Итог вашей патентной проверки. Пока «не проверял», вердикт не поднимется выше «Go, условно».",
    trademarkSearch: "Свободно ли название будущего бренда (проверка в USPTO).",
    couponsDealsSaturation: "Сколько товаров в выдаче продаются с купонами и скидками. «Массово» — идёт борьба ценой.",
    designTestScore: "Результат опроса целевой аудитории (PickFu и подобные): доля голосов за ваш дизайн против конкурентов. Нужно от 30 %.",
    lifecycleMonths: "Сколько месяцев такой товар остаётся актуальным. Меньше 25 — риск не успеть окупиться.",
    listingsInSearch: "Сколько листингов Amazon показывает по главному ключу. Больше 3 000 — высокая конкуренция.",
    patentFeature: "Опишите по-английски главную особенность вашего товара — именно её AI будет искать в патентах.",
    brandFit: "Насколько товар подходит вашему бренду и опыту, от 0 до 10. Ось scorecard с весом 15 %.",
    opRisk: "Операционный риск от 0 до 10, где 10 — низкий. «Авто» считает его из галочек чеклиста.",
    "#kw-minsv": "Запросы с объёмом ниже порога не попадают в кластер автоматически.",
    "#kw-mincomp": "Для Cerebro по нескольким ASIN: фраза релевантна, если по ней ранжируется не меньше стольких конкурентов.",
    "#op-auto": "Считать операционный риск автоматически из галочек чеклиста.",
  };
  const SIDE_TIPS = {
    "Ниша": "Название анализа и главный поисковый запрос товара.",
    "Файлы": "Отчёты Helium 10 (Xray, Cerebro), JSON из POE и, если есть, SQP. Разбираются в браузере; на сервере хранится только результат разбора.",
    "Ключи кластера": "Какие запросы считать вашими. От выбора зависят Adj. SV и оценка трафика.",
    "Исключить бренды": "Бренды из соседней категории, случайно попавшие в отчёт. Исключённые не участвуют в выручке и долях.",
    "Ценовой диапазон анализа": "Сузить анализ конкурентов до цен, в которых вы собираетесь продавать.",
    "Экономика и бюджет": "Ваши числа: цена, себестоимость, сборы, реклама, сроки, бюджет и параметры помесячного сценария.",
    "Риски и compliance": "Чеклист рисков, патентный скан и ручные статусы критериев 3–8.",
    "Ручные метрики Критерия 1": "Заменить расчётное значение показателя своим — например, если есть более точный источник.",
  };

  const usedTips = new Set();
  function labelText(el) {
    const c = el.cloneNode(true); c.querySelectorAll(".chip, small, button, .status, input, output, select, a").forEach((x) => x.remove());
    return c.textContent.replace(/\s+/g, " ").trim().split(" (")[0].replace(/[:：]$/, "").trim();
  }
  function setTip(el, text, focusable) { el.setAttribute("data-tip", text); el.classList.add("has-tip"); if (focusable && !el.hasAttribute("tabindex")) el.setAttribute("tabindex", "0"); }
  /** Помечает только сам текст названия (а не всю строку заголовка): оборачивает первый текстовый узел. */
  function tipOnText(el, text) {
    const node = [...el.childNodes].find((n) => n.nodeType === 3 && n.textContent.trim());
    if (!node) return setTip(el, text, true);
    const span = el.ownerDocument.createElement("span"); span.textContent = node.textContent.replace(/\s+$/, ""); el.replaceChild(span, node); if (/\s$/.test(node.textContent)) span.after(" "); setTip(span, text, true);
  }
  function annotate(root, sectionId) {
    if (!root || !root.querySelectorAll) return;
    const find = (label) => { for (const k of [sectionId + "|" + label, label]) if (TIPS[k]) { usedTips.add(k); return TIPS[k]; } return null; };
    root.querySelectorAll("[title]").forEach((el) => { if (el.matches("label, th, .chip, small, span, summary") && !el.hasAttribute("data-tip")) { setTip(el, el.getAttribute("title"), false); el.removeAttribute("title"); } });
    root.querySelectorAll(".gate").forEach((g) => { const k = g.querySelector(".id")?.textContent.trim(), name = g.children[1]; if (KEY_TIPS[k] && name && !name.querySelector("[data-tip]")) { usedTips.add(k); tipOnText(name, KEY_TIPS[k]); } });
    if (sectionId === "economics") root.querySelectorAll("tbody td:first-child").forEach((td) => { const k = td.querySelector("b")?.textContent.trim(); if (KEY_TIPS[k] && /^2[a-k]$/.test(k)) { usedTips.add(k); setTip(td, KEY_TIPS[k], true); } });
    if (sectionId === "challenger") root.querySelectorAll("tbody tr").forEach((tr) => { const k = "k" + (tr.querySelector("td b")?.textContent.trim() || ""), td = tr.children[1]; if (KEY_TIPS[k] && td) { usedTips.add(k); setTip(td, KEY_TIPS[k], true); } });
    const labelled = "h2, h3, h4, .tile .k, .verdict .k, th" + (sectionId === "scorecard" || sectionId === "structure" ? ", tbody td:first-child" : "");
    root.querySelectorAll(labelled).forEach((el) => { if (el.hasAttribute("data-tip") || el.querySelector("[data-tip].has-tip:not(.chip)")) return; const t = find(labelText(el)); if (t) tipOnText(el, t); });
    root.querySelectorAll(".status, .chip.src").forEach((el) => { if (el.hasAttribute("data-tip")) return; const t = find(el.textContent.trim()); if (t) setTip(el, t, false); });
    annotateInputs(root);
  }
  /** Подписи полей: ключ — имя поля управляющего элемента. Работает и для панели ввода, и для ползунков в дашборде. */
  function annotateInputs(root) {
    if (!root || !root.querySelectorAll) return;
    root.querySelectorAll("[data-input], [data-check], [data-field], [data-axis], [data-quick], #kw-minsv, #kw-mincomp, #op-auto").forEach((c) => {
      const key = c.dataset.input || c.dataset.check || c.dataset.field || c.dataset.axis || c.dataset.quick, text = INPUT_TIPS[key] || INPUT_TIPS["#" + c.id]; if (!text) return;
      const label = (c.id && root.querySelector(`label[for="${c.id}"]`)) || c.closest("label") || c.closest(".slider")?.querySelector("label"); if (!label) return;
      label.removeAttribute("title"); setTip(label, text, false); usedTips.add("input:" + (key || "#" + c.id));
    });
    root.querySelectorAll("details > summary").forEach((s) => { if (s.hasAttribute("data-tip") || s.querySelector("[data-tip]")) return; const t = SIDE_TIPS[labelText(s).replace(/^\d+\.\s*/, "")]; if (t) tipOnText(s, t); });
  }

  /** Одна всплывающая подсказка на документ: position:fixed, поэтому её не обрезают прокручиваемые таблицы; держится в пределах экрана. */
  function initTips() {
    const doc = document; if (doc.__fbaTips || !doc.body) return; doc.__fbaTips = true;
    const box = doc.createElement("div"); box.className = "tipbox"; box.setAttribute("role", "tooltip"); box.id = "fba-tipbox"; box.hidden = true; doc.body.appendChild(box);
    let cur = null, timer = 0, shownAt = 0;
    const hide = () => { clearTimeout(timer); if (cur) cur.removeAttribute("aria-describedby"); cur = null; box.hidden = true; };
    const place = (el) => {
      const r = el.getBoundingClientRect(), vw = doc.documentElement.clientWidth || window.innerWidth || 1024, vh = window.innerHeight || 768, m = 8;
      box.style.maxWidth = Math.min(340, vw - 2 * m) + "px"; box.style.left = "0px"; box.style.top = "0px";
      const b = box.getBoundingClientRect(); let left = Math.min(Math.max(m, r.left), Math.max(m, vw - b.width - m)); let top = r.bottom + 6; if (top + b.height > vh - m && r.top - b.height - 6 >= m) top = r.top - b.height - 6;
      box.style.left = Math.round(left) + "px"; box.style.top = Math.round(Math.max(m, top)) + "px";
    };
    const show = (el) => { clearTimeout(timer); const text = el.getAttribute("data-tip"); if (!text) return hide(); if (cur && cur !== el) cur.removeAttribute("aria-describedby"); cur = el; shownAt = Date.now(); box.textContent = text; box.hidden = false; el.setAttribute("aria-describedby", box.id); place(el); };
    const target = (e) => (e.target && e.target.closest ? e.target.closest("[data-tip]") : null);
    doc.addEventListener("mouseover", (e) => { const el = target(e); if (!el) return hide(); if (el === cur) return; clearTimeout(timer); timer = setTimeout(() => { if (doc.contains(el)) show(el); }, 120); });
    doc.addEventListener("mouseleave", hide);
    doc.addEventListener("focusin", (e) => { const el = target(e); if (el && el === e.target) show(el); });
    doc.addEventListener("focusout", hide);
    doc.addEventListener("click", (e) => { const el = target(e); if (el && !e.target.closest("input, select, textarea, button, a")) show(el); else hide(); });
    doc.addEventListener("keydown", (e) => { if (e.key === "Escape") hide(); });
    // Переход клавишей Tab сам прокручивает страницу к элементу: сразу после показа подсказку не прячем, а переставляем на новое место.
    window.addEventListener("scroll", () => { if (cur && Date.now() - shownAt < 400 && doc.contains(cur)) place(cur); else hide(); }, true); window.addEventListener("resize", hide);
    doc.__fbaTipsHide = () => { if (cur && !doc.contains(cur)) hide(); };
  }

  const SECTIONS = [
    ["hero", secHero], ["overview", secOverview], ["criterion1", secCriterion1], ["quick", secQuick], ["economics", secEconomics, drawEconomics], ["budget", secBudget], ["cashflow", secCashflow, drawCashflow],
    ["traffic", secTraffic, drawTraffic], ["entry", secEntry], ["competitors", secCompetitors, drawCompetitors], ["pricing", secPricing, drawPricing],
    ["trend", secTrend, (c, R, A) => drawTrend(c, A)], ["structure", secStructure], ["reviews", secReviews, (c, R, A) => drawReviews(c, A)],
    ["patents", secPatents], ["challenger", secChallenger], ["scorecard", secScorecard, drawScorecard], ["reconciliation", secReconciliation], ["borderline", secBorderline], ["checklist", secChecklist], ["conclusion", secConclusion], ["ai", secAi],
  ];
  const ECON_DEPENDENT = ["hero", "overview", "economics", "budget", "cashflow", "entry", "pricing", "borderline", "challenger", "scorecard", "conclusion", "ai"];

  function render(container, A, opts = {}) {
    chartDefaults(); initTips();
    const R = A.results; if (!R) { container.innerHTML = '<div class="panel section empty">Нет результатов — загрузите файлы или введите данные.</div>'; return; }
    container.classList.add("dash");
    container.innerHTML = SECTIONS.map(([id]) => `<section class="panel section" data-section="${id}" id="sec-${id}"></section>`).join("");
    for (const [id] of SECTIONS) fill(container, id, A, R, opts);
  }
  function fill(container, id, A, R, opts) {
    const def = SECTIONS.find((s) => s[0] === id); if (!def) return;
    const el = container.querySelector(`#sec-${id}`); if (!el) return;
    if ((opts.hidden || []).includes(id)) { el.classList.add("hidden"); el.innerHTML = ""; return; } // секция скрыта автором ссылки: данных для неё в снимке нет
    const html = def[1](A, R, opts);
    if (!html) { el.classList.add("hidden"); return; }
    el.classList.remove("hidden"); el.innerHTML = html;
    try { annotate(el, id); if (document.__fbaTipsHide) document.__fbaTipsHide(); } catch (e) { console.error("tips", id, e); }
    if (def[2]) try { def[2](container, R, A); } catch (e) { console.error("chart", id, e); }
  }
  function update(container, A, opts = {}, ids = ECON_DEPENDENT) {
    if (!container.querySelector("[data-section]")) return render(container, A, opts);
    const R = A.results; if (!R) return;
    for (const id of ids) fill(container, id, A, R, opts);
  }
  function destroy(container) { for (const c of Object.values(container.__charts || {})) { try { c.destroy(); } catch {} } container.__charts = {}; }

  window.FBARender = { render, update, destroy, fill, annotate, annotateInputs, initTips, tips: { TIPS, KEY_TIPS, INPUT_TIPS, SIDE_TIPS, used: usedTips }, ECON_DEPENDENT, fmt: { fmtN, fmtMoney, fmtK, fmtPct, fmtDate }, VLABEL };
})();
