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

  function secHero(A, R, o) {
    const ai = A.ai; const v = ai?.verdict || R.verdict.ceiling;
    const srcs = ["xray", "cerebro", "poe", "sqp"].filter((k) => A.sources?.[k]).map((k) => { const m = A.sources[k]; return `<span class="chip" title="${esc(m.fileName || "")}">${SRC_LABEL[k]} · ${fmtN(m.rows)} ${k === "xray" || k === "poe" ? "ASIN" : "строк"}${m.duplicatesDropped ? ` · дублей удалено ${m.duplicatesDropped}` : ""}</span>`; }).join(" ");
    const snap = o.snapshot ? `<div class="notice info snapnote">Подготовил(а): <b>${esc(o.snapshot.preparedBy || "—")}</b> · снимок от ${fmtDate(o.snapshot.snapshotAt)} · только чтение${o.snapshot.mode === "no_economics" ? " · закупочная экономика скрыта автором" : ""}</div>` : "";
    return `${snap}<div class="hero">
      <div><h1>${esc(A.niche || "Без названия")}</h1>
        <div class="meta">Ключ: <b>${esc(A.coreKeyword || "—")}</b> · ${esc(A.marketplace || "US")} · расчёт ${fmtDate(R.computedAt)} · методология ${esc(R.methodologyVersion || "")}</div>
        <div class="chips" style="margin-top:.4rem">${srcs || '<span class="chip na">файлы не загружены</span>'}</div>
        <p class="muted" style="margin-top:.4rem">${esc(R.gate0.note)}</p>${bandNote(R, o)}</div>
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
    const c2rows = Object.entries(e.criterion2).map(([k, v]) => `<tr><td><b>${k}</b> ${esc(NAMES2[k])}</td><td class="num">${fmtC2(k, v.value)}</td><td>${st(v.status)}</td><td class="muted">${esc(v.note || "")}${k === "2c" && R.cvrHint?.note ? "; " + esc(R.cvrHint.note) : ""}</td></tr>`).join("");
    const s2 = e.criterion2Summary;
    return `<h2>Экономика — Gate 1 / Gate 2 <span class="chip ${g1.status === "pass" ? "ok" : g1.status === "rework" ? "warn" : "fail"}">Gate 1 ${STATUS_LABEL[g1.status]}</span><span class="chip ${g2.status === "pass" ? "ok" : g2.status === "rework" ? "warn" : g2.status === "pending" ? "pending" : "fail"}">Gate 2 ${STATUS_LABEL[g2.status]}</span></h2>
      ${sliders}
      <div class="cards">
        <div class="card ${g1.status === "pass" ? "ok" : g1.status === "rework" ? "warn" : "fail"}"><h4>Gate 1 — без рекламы</h4><div class="big">${fmtMoney(g1.net0, 2)}/юнит</div>
          <div>маржа <b>${fmtPct(g1.margin0, 1)}</b> ${g1.condMargin ? "✓" : "✗"} · профит ${g1.condProfit ? "✓" : "✗"}</div><div class="muted">${esc(g1.note || `порог: маржа > 30 % и профит > $15`)}</div></div>
        <div class="card ${e.roiHint === "ok" ? "ok" : e.roiHint === "suspicious" || e.roiHint === "low" ? "warn" : "fail"}"><h4>ROI (net / landed COGS)</h4><div class="big">${fmtPct(e.roi)}</div>
          <div class="muted">${{ ok: "≥ 150 % — норма (урок 07)", low: "100–150 % — ниже порога 150 %", loss: "< 100 % — убыток", suspicious: "> 200 % — перепроверь данные (урок 10)" }[e.roiHint] || ""}</div></div>
        <div class="card ${g2.status === "pass" ? "ok" : g2.status === "rework" ? "warn" : g2.status === "pending" ? "pending" : "fail"}"><h4>Gate 2 — стресс-тест рекламы</h4>
          <div class="big">${g2.atCvr ? fmtMoney(g2.atCvr.net, 2) : "—"}/юнит</div><div>при CVR ${fmtPct(inp.cvr, 1)}, CPC ${fmtMoney(g2.cpc, 2)}, PPC ${fmtPct(g2.ppcShare)} · ACOS ${g2.atCvr ? fmtPct(g2.atCvr.acos) : "—"}</div>
          <div class="muted">безубыточный CVR: <b>${fmtPct(e.breakEvenCvr, 1)}</b> · PASS если Net > 0 при CVR ≤ 12 %</div></div>
        <div class="card"><h4>Маржа без / с рекламой</h4><div class="big">${fmtPct(e.marginNoAds, 1)} → ${fmtPct(e.marginWithAds, 1)}</div><div class="muted">разные вещи — показываем оба (Amazon Calculator vs реальный PPC-сплит)</div></div>
      </div>
      <div class="two" style="margin-top:.8rem">
        <div><h4>Net after ads по CVR</h4><div class="chartbox short"><canvas id="ch-gate2"></canvas></div></div>
        <div class="tablewrap"><table><thead><tr><th>CVR</th><th class="num">Ad cost/юнит</th><th class="num">Net after ads</th><th class="num">ACOS</th></tr></thead><tbody>
          ${g2.byCvr.map((r) => `<tr><td>${fmtPct(r.cvr)}</td><td class="num">${fmtMoney(r.adCost * g2.ppcShare, 2)}</td><td class="num" style="color:${r.net > 0 ? "var(--ok)" : "var(--fail)"}"><b>${fmtMoney(r.net, 2)}</b></td><td class="num">${fmtPct(r.acos)}</td></tr>`).join("")}</tbody></table>
          <p class="muted" style="font-size:.8rem">Ad cost = CPC / CVR × доля PPC. Урок Jitsu: в дешёвых сегментах критичен абсолютный доллар профита.</p></div>
      </div>
      <h3 style="margin-top:1rem">Критерий 2 — детальная экономика <span class="chip ${s2.pass ? "ok" : s2.pending ? "pending" : "fail"}">${s2.okCount} из 11 · 2f/2j/2k ${s2.mandatoryOk ? "OK" : "не все OK"}</span></h3>
      <div class="tablewrap"><table><thead><tr><th>Показатель</th><th class="num">Значение</th><th>Статус</th><th>Примечание</th></tr></thead><tbody>${c2rows}</tbody></table></div>
      <p class="muted" style="font-size:.8rem">Горизонт ${s2.period.days} дн.: ${fmtN(s2.period.units)} шт, реклама ${fmtMoney(s2.period.adSpend)}, выручка ${fmtMoney(s2.period.revenue)}, прибыль ${fmtMoney(s2.period.totalProfit)}.</p>`;
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
        <div class="card"><h4>Наценка</h4><div class="big">${isNum(b.markup) ? b.markup.toFixed(1) + "×" : "—"}</div><div class="muted">дешёвый товар — 5×, дорогой — 3.3× (урок 08)</div></div></div>`}
      <h3 style="margin-top:.9rem">Четыре стоп-вопроса (урок 07)</h3><p class="muted" style="font-size:.85rem">Любой ответ «Нет» — дальше можно не анализировать (урок 07). Красная карточка = «Нет», жёлтая = на грани, серая = не хватает данных.</p><div class="cards">${qs}</div>`;
  }

  function secTraffic(A, R) {
    const tr = R.traffic; if (!tr.source) return `<h2>Трафик по ключам</h2><div class="empty">Загрузите Cerebro (или POE) — распределение трафика и Adj. SV.</div>`;
    const multi = Boolean(tr.multiAsin); const hasSales = tr.cluster.some((k) => isNum(k.keywordSales));
    const rows = tr.cluster.slice(0, 25).map((k) => `<tr><td>${esc(k.phrase)}</td><td class="num">${fmtN(k.sv)}</td>${hasSales ? `<td class="num">${fmtN(k.keywordSales)}</td>` : ""}${multi ? `<td class="num">${isNum(k.rankingCompetitors) ? k.rankingCompetitors : "—"}${isNum(k.competitorRankAvg) ? ` <small class="muted">(ср. ${fmtN(k.competitorRankAvg)})</small>` : ""}</td>` : ""}<td class="num">${isNum(k.svTrend) ? (k.svTrend > 0 ? "+" : "") + fmtN(k.svTrend) + " %" : "—"}</td><td class="num">${isNum(k.bid) ? fmtMoney(k.bid, 2) : "—"}</td><td class="num">${isNum(k.competingProducts) ? (k.competingIsBound ? ">" : "") + fmtN(k.competingProducts) : "—"}</td><td class="num">${isNum(k.abaClickShare) ? fmtN(k.abaClickShare, 1) + (tr.source === "poe" ? "" : " %") : "—"}</td></tr>`).join("");
    const pc = tr.poeConcentration;
    return `<h2>Трафик по ключам (урок 09)${bandChip(R, "whole")} <span class="chip ${tr.status === "ok" ? "ok" : tr.status === "fail" ? "fail" : "warn"}">${tr.source === "cerebro" ? "Cerebro" : "POE"} · ${STATUS_LABEL[tr.status]}</span></h2>
      <div class="tiles">
        <div class="tile"><div class="k">SV core</div><div class="v">${fmtN(tr.svCore)}</div><div class="s">/мес</div></div>
        <div class="tile"><div class="k">Adj. SV</div><div class="v">${fmtN(tr.adjSv)}</div><div class="s">core + 0.4 × Σ кластера (${tr.clusterCount})</div></div>
        <div class="tile ${tr.top2Share > 0.8 ? "fail" : "ok"}"><div class="k">Доля топ-2 ключей</div><div class="v">${fmtPct(tr.top2Share)}</div><div class="s">> 80 % — плохо</div></div>
        <div class="tile ${isNum(tr.relevantCount) && tr.relevantCount >= 30 ? "ok" : "warn"}"><div class="k">Релевантных ключей</div><div class="v">${fmtN(tr.relevantCount)}</div><div class="s">нужно ≥ 30 (SV ≥ ${fmtN(tr.minSv ?? 100)})</div></div>
        ${isNum(tr.clusterSales) && tr.clusterSales > 0 ? `<div class="tile"><div class="k">Продаж по кластеру</div><div class="v">${fmtN(tr.clusterSales)}</div><div class="s">Keyword Sales, шт/мес (урок 15)</div></div>` : ""}
        ${isNum(tr.groups) ? `<div class="tile ${tr.groups >= 3 ? "ok" : "warn"}"><div class="k">Групп ключей</div><div class="v">${tr.groups}</div><div class="s">нужно ≥ 3</div></div>` : ""}
        ${pc ? `<div class="tile ${pc.flags.top20Heavy ? "warn" : ""}"><div class="k">Топ-20 продуктов (клики)</div><div class="v">${fmtPct(pc.top20Products)}</div><div class="s">топ-5 продуктов ${fmtPct(pc.top5Products)}</div></div>` : ""}
      </div>
      <div class="stack" style="margin-top:.8rem"><div class="chartbox tall"><canvas id="ch-kw"></canvas></div>
      <div class="tablewrap"><table class="kwtable"><thead><tr><th>Запрос</th><th class="num">SV/мес</th>${hasSales ? '<th class="num" title="Keyword Sales — продаж/мес по ключу (урок 15: продают ключи, не объём)">Продаж/мес</th>' : ""}${multi ? '<th class="num" title="Сколько из заданных в Cerebro конкурентов ранжируются по фразе">Конкур. в топе</th>' : ""}<th class="num">Тренд</th><th class="num">Bid</th><th class="num">Конкур. товаров</th><th class="num">${tr.source === "poe" ? "Click share" : "ABA click %"}</th></tr></thead><tbody>${rows}</tbody></table>${multi ? `<p class="muted" style="font-size:.8rem">Cerebro по нескольким ASIN: в кластер автоматически попадают фразы, по которым ранжируются ≥ ${esc(String(A.inputs.clusterMinCompetitors ?? 3))} конкурентов (правило курса), SV ≥ ${fmtN(tr.minSv)}.</p>` : ""}</div></div>`;
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
      <p class="muted" style="font-size:.8rem">Поступления — выручка минус комиссия Amazon и FBA. Себестоимость списывается один раз, при оплате партии, и с продаж повторно не вычитается. Допущения сценария: ${esc(c.assumptions.join("; "))}. Горизонт, разгон, первая партия и стартовые расходы задаются в панели «Экономика и бюджет».</p>`;
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
      <div><h4>Следующие шаги</h4><ol>${(P.nextSteps || []).map((s) => `<li>${esc(s)}</li>`).join("")}</ol><p class="muted" style="font-size:.85rem"><b>Design patents:</b> ${esc(P.designPatentNote || "")}${P.designHits?.length ? ` Найдено по названию: ${P.designHits.slice(0, 5).map((d) => `<a href="${esc(d.url)}" target="_blank" rel="noopener">${esc(d.number)}</a>`).join(", ")}.` : ""}</p></div></div>
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
      <div><h4>Следующие шаги</h4><ol>${(ai.nextSteps || []).map((s) => `<li>${esc(s)}</li>`).join("")}</ol>${ai.pricingPackComment ? `<h4>Цена / комплектация</h4><p>${esc(ai.pricingPackComment)}</p>` : ""}${ai.risks?.length ? `<h4>Риски</h4><ul>${ai.risks.map((r) => `<li>${esc(r)}</li>`).join("")}</ul>` : ""}</div></div>
      ${diff ? `<h4 style="margin-top:.8rem">Гипотезы дифференциации</h4><div class="cards">${diff}</div>` : ""}
      ${recs ? `<h4 style="margin-top:.8rem">Рекомендации</h4>${recs}` : ""}
      <p class="muted" style="font-size:.75rem">${fmtDate(ai.createdAt)} · ${esc(ai.provider || "")} ${esc(ai.model || "")} · токены: вход ${fmtN(ai.usage?.input)} (кэш ${fmtN(ai.usage?.cacheRead)}), выход ${fmtN(ai.usage?.output)}${isNum(ai.usage?.cost) ? " · стоимость $" + ai.usage.cost.toFixed(4) : ""} · ${isNum(ai.durationMs) ? Math.round(ai.durationMs / 1000) + " с" : ""}${ai.staleSince ? " · ⚠ входные данные менялись после анализа" : ""}</p></div>`;
  }
  const GATE_NAMES = { gate0: "Gate 0 — данные", gate1: "Gate 1 — экономика", gate2: "Gate 2 — реклама", gate3: "Gate 3 — конкуренция", gate4: "Gate 4 — патенты", criterion1: "Критерий 1", traffic: "Трафик", budget: "Бюджет", scorecard: "Scorecard" };

  function secChecklist(A, R) {
    const c = A.inputs.checklist || {};
    const yes = (b) => (b ? '<span class="status fail">да</span>' : '<span class="status ok">нет</span>');
    return `<h2>Чеклист рисков и compliance</h2><div class="tablewrap"><table><tbody>
      <tr><td>Закрытая категория (урок 03)</td><td>${yes(c.gatedCategory)}</td><td>Опасные товары</td><td>${yes(c.dangerousGoods)}</td></tr>
      <tr><td>Сертификаты</td><td>${esc(c.certificates || "—")}</td><td>Amazon продаёт сам</td><td>${yes(R.competition.amazonSells)} <small class="muted">${R.competition.amazonSellsSource === "user" ? "вручную" : R.competition.amazonSellsSource === "xray" ? "по Xray (Seller)" : "авто"}</small></td></tr>
      <tr><td>Патенты / FTO (урок 13)</td><td>${esc({ none: "не проверял", clear: "не найдено", design_around: "design-around", unsure: "нужен юрист", conflict: "конфликт" }[c.patentSearch] || "—")}</td><td>Торговая марка</td><td>${esc({ none: "не проверял", free: "свободна", conflict: "занята" }[c.trademarkSearch] || "—")}</td></tr>
      <tr><td>Склейка отзывов (урок 14)</td><td>${yes(c.reviewMergingSuspected)}</td><td>Купоны/дилы (урок 11)</td><td>${esc(c.couponsDealsSaturation || "—")}</td></tr>
      <tr><td>Тест дизайна (урок 12)</td><td>${isNum(c.designTestScore) ? c.designTestScore + " % " + (c.designTestScore >= 30 ? "✓" : "✗ (< 30 %)") : "—"}</td><td>Жизненный цикл (урок 09)</td><td>${isNum(c.lifecycleMonths) ? c.lifecycleMonths + " мес " + (c.lifecycleMonths >= 25 ? "✓" : "✗ (< 25)") : "—"}</td></tr>
      <tr><td>Листингов в выдаче (урок 05)</td><td>${isNum(c.listingsInSearch) ? fmtN(c.listingsInSearch) + (c.listingsInSearch > 3000 ? " — высокая конкуренция" : "") : "—"}</td><td></td><td></td></tr></tbody></table></div>${regulatoryBlock(R)}`;
  }

  function secConclusion(A, R) {
    const v = R.verdict;
    return `<h2>Выводы по правилам</h2><div class="verdict ${esc(v.ceiling)}"><div class="big">Потолок: ${esc(VLABEL[v.ceiling])}</div><div>Решающий: <b>${esc(v.decisiveGate || "—")}</b></div>
      <ul>${v.reasons.length ? v.reasons.map((r) => `<li>${esc(r)}</li>`).join("") : "<li>Все гейты пройдены.</li>"}</ul></div>`;
  }

  const SECTIONS = [
    ["hero", secHero], ["overview", secOverview], ["criterion1", secCriterion1], ["quick", secQuick], ["economics", secEconomics, drawEconomics], ["budget", secBudget], ["cashflow", secCashflow, drawCashflow],
    ["traffic", secTraffic, drawTraffic], ["entry", secEntry], ["competitors", secCompetitors, drawCompetitors], ["pricing", secPricing, drawPricing],
    ["trend", secTrend, (c, R, A) => drawTrend(c, A)], ["structure", secStructure], ["reviews", secReviews, (c, R, A) => drawReviews(c, A)],
    ["patents", secPatents], ["challenger", secChallenger], ["scorecard", secScorecard, drawScorecard], ["reconciliation", secReconciliation], ["borderline", secBorderline], ["checklist", secChecklist], ["conclusion", secConclusion], ["ai", secAi],
  ];
  const ECON_DEPENDENT = ["hero", "overview", "economics", "budget", "cashflow", "entry", "pricing", "borderline", "challenger", "scorecard", "conclusion", "ai"];

  function render(container, A, opts = {}) {
    chartDefaults();
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
    if (def[2]) try { def[2](container, R, A); } catch (e) { console.error("chart", id, e); }
  }
  function update(container, A, opts = {}, ids = ECON_DEPENDENT) {
    if (!container.querySelector("[data-section]")) return render(container, A, opts);
    const R = A.results; if (!R) return;
    for (const id of ids) fill(container, id, A, R, opts);
  }
  function destroy(container) { for (const c of Object.values(container.__charts || {})) { try { c.destroy(); } catch {} } container.__charts = {}; }

  window.FBARender = { render, update, destroy, fill, ECON_DEPENDENT, fmt: { fmtN, fmtMoney, fmtK, fmtPct, fmtDate }, VLABEL };
})();
