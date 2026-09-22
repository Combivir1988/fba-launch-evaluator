// Снимок дашборда для публичной ссылки (spec 002, US3; контракт — specs/002-team-accounts-sharing/contracts/share-snapshot.md).
// Чистая функция: сервер строит снимок при создании/обновлении ссылки, тесты проверяют его на реальных фикстурах.
// Режим "no_economics" УДАЛЯЕТ закупочную экономику из данных (а не прячет в интерфейсе): того, чего нет в ответе сервера,
// нельзя достать ни из исходника страницы, ни из скачанного HTML (FR-025, SC-006).

export const SNAPSHOT_VERSION = 1;
export const HIDDEN_NOTE = "экономика скрыта автором";
const ECON_INPUTS = ["cogs", "cogsConfirmed", "shippingPerUnit", "referralPct", "fbaFee", "cvr", "ppcShare", "targetAcos", "unitsPerDay", "productionDays", "shippingDays", "receivingDays", "adsReserve", "budget", "manualOverrides", "horizonMonths", "rampMonths", "startSalesMonthly", "firstBatchUnits", "startupCosts"];
// Лексика закупочной экономики: предложение AI с таким словом удаляется целиком.
const ECON_WORDS = /себестоим|cogs|марж|прибыл|\broi\b|окупаем|бюджет|закуп|парти[ийяею]|\bacos\b|\btacos\b|юнит.?эконом|unit.?econom|\bnet\b|наценк|landed|лендед|fba.?fee|комисси/i;
const ECON_GATE = /^(gate1|gate2|budget)$|gate ?1|gate ?2|критери[йя] ?2|критери[йя] ?6|эконом|бюджет/i;

const clone = (o) => (o === undefined ? undefined : JSON.parse(JSON.stringify(o)));
const isNum = (v) => typeof v === "number" && Number.isFinite(v);

/** Разбить текст на предложения: граница — знак конца предложения, за которым идёт пробел или конец строки (десятичная точка «4.37» — не граница). */
function sentences(text) { return String(text).split(/(?<=[.!?;…])\s+|\n+/).filter((x) => x.trim()); }

/** Все «закупочные» числа исходного анализа — для страховочной проверки. money: суммы в $, ratio: доли (маржа, ROI, CVR безубыточности). */
export function collectEconomicsValues(analysis) {
  const money = new Set(), ratio = new Set();
  const inp = analysis?.inputs || {}, e = analysis?.results?.economics || {}, b = analysis?.results?.budget || {};
  const addM = (v) => { if (isNum(v) && Math.abs(v) >= 0.01) money.add(Math.abs(v)); };
  const addR = (v) => { if (isNum(v) && Math.abs(v) >= 0.001) ratio.add(Math.abs(v)); };
  [inp.cogs, inp.shippingPerUnit, inp.fbaFee, inp.adsReserve, inp.budget].forEach(addM);
  [e.cogs, e.gate1?.net0, e.gate1?.landed, e.gate1?.condProfit, b.landed, b.batchCost, b.twoBatches, b.adsReserve, b.need, b.needTwoBatches, b.budget, b.gap, inp.startupCosts].forEach(addM);
  const cf = analysis?.results?.cashflow || {}; // помесячные деньги (spec 005): пик, итоги и строки сценария
  [cf.peak, cf.endCum, cf.stockValueEnd, cf.landed, cf.first90?.revenue, cf.first90?.ads, cf.first90?.profit].forEach(addM);
  for (const row of cf.rows || []) [row.orderCost, row.payout, row.ads, row.net, row.cum].forEach(addM);
  [e.gate1?.margin0, e.gate1?.roi, e.gate1?.condMargin, e.roi, e.marginNoAds, e.marginWithAds, b.markup].forEach(addR);
  for (const row of e.gate2?.byCvr || []) for (const [k, v] of Object.entries(row || {})) { if (/net|profit|spend|cost|ads/i.test(k)) addM(v); if (/margin|roi|acos/i.test(k)) addR(v); }
  for (const [k, v] of Object.entries(e.gate2?.atCvr || {})) { if (/net|profit|spend|cost|ads/i.test(k)) addM(v); if (/margin|roi|acos/i.test(k)) addR(v); }
  for (const it of Object.values(e.criterion2 || {})) { if (isNum(it?.value)) (Math.abs(it.value) <= 5 ? addR : addM)(it.value); }
  return { money: [...money], ratio: [...ratio] };
}

const reEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const group = (intStr, sep) => intStr.replace(/\B(?=(\d{3})+(?!\d))/g, sep);
/** Регулярное выражение, которое находит значение в привычных форматах: 12.5 · 12,5 · 12.50 · 1250 · 1 250 · 1,250 · $13 · 43 %. */
export function valuePatterns({ money = [], ratio = [] }) {
  const alts = new Set();
  const dec = (s) => { alts.add(reEsc(s)); if (s.includes(".")) alts.add(reEsc(s.replace(".", ","))); };
  for (const v of money) {
    const two = v.toFixed(2), int = String(Math.round(v));
    if (!Number.isInteger(v)) { dec(two); if (v >= 100) dec(v.toFixed(1)); }
    else dec(two);
    if (v >= 1000) for (const sep of [" ", " ", " ", ","]) { alts.add(reEsc(group(int, sep))); alts.add(reEsc(group(int, sep) + two.slice(two.indexOf(".")))); }
    if (v >= 100) alts.add(int);
    else if (Math.round(v) >= 1) { alts.add("\\$\\s?" + int + "(?![\\d.,])"); alts.add(int + "\\s?\\$"); } // малые целые — только рядом со знаком $
  }
  for (const v of ratio) {
    const pct = v * 100;
    for (const s of new Set([String(Math.round(pct)), pct.toFixed(1), pct.toFixed(1).replace(".", ","), pct.toFixed(2), pct.toFixed(2).replace(".", ",")])) alts.add(reEsc(s) + "[\\s  ]?%");
    if (!Number.isInteger(v * 100)) { dec(v.toFixed(3)); dec(v.toFixed(4)); }
  }
  if (!alts.size) return null;
  return new RegExp("(?<![\\d.,])(?:" + [...alts].join("|") + ")(?!\\d)", "i");
}

/** Убрать из текста предложения с лексикой экономики и/или с «закупочными» числами. → { text, removed } */
function scrubText(text, { lexicon, valueRe }) {
  let removed = 0;
  const kept = sentences(text).filter((s) => { const bad = (lexicon && ECON_WORDS.test(s)) || (valueRe && valueRe.test(s)); if (bad) removed++; return !bad; });
  return { text: kept.join(" ").trim(), removed };
}

function walkStrings(node, fn, path = []) {
  if (Array.isArray(node)) { for (let i = 0; i < node.length; i++) { if (typeof node[i] === "string") node[i] = fn(node[i], [...path, i]); else walkStrings(node[i], fn, [...path, i]); } return; }
  if (node && typeof node === "object") for (const k of Object.keys(node)) { if (typeof node[k] === "string") node[k] = fn(node[k], [...path, k]); else walkStrings(node[k], fn, [...path, k]); }
}

/** Числовые поля, совпавшие с «закупочным» значением (характерным: нецелым или ≥ 100), обнуляются. */
function distinctive(v) { return isNum(v) && (!Number.isInteger(v) || Math.abs(v) >= 100); }
function walkNumbers(node, fn, path = []) {
  if (Array.isArray(node)) { node.forEach((v, i) => { if (isNum(v)) node[i] = fn(v, [...path, i]); else walkNumbers(v, fn, [...path, i]); }); return; }
  if (node && typeof node === "object") for (const k of Object.keys(node)) { if (isNum(node[k])) node[k] = fn(node[k], [...path, k]); else walkNumbers(node[k], fn, [...path, k]); }
}
function econNumberSet(source) { const { money, ratio } = collectEconomicsValues(source); return new Set([...money, ...ratio].filter(distinctive)); }

function redactEconomics(a, source) {
  let redactions = 0;
  for (const k of ECON_INPUTS) delete a.inputs?.[k];
  const R = a.results || {};
  delete R.economics; delete R.budget; delete R.cashflow; // помесячные деньги — тоже закупочная экономика
  if (R.borderline?.items) R.borderline.items = R.borderline.items.filter((i) => !i.economic);
  if (R.effective) R.effective = { price: R.effective.price, cpc: R.effective.cpc, cpcFromCerebro: R.effective.cpcFromCerebro, cpcSource: R.effective.cpcSource, priceFromMedian: R.effective.priceFromMedian };
  if (R.scorecard?.axes?.economics) R.scorecard.axes.economics.note = HIDDEN_NOTE;
  for (const k of ["2", "6"]) { const it = R.challenger?.items?.[k]; if (it) { it.note = HIDDEN_NOTE; it.value = null; } }
  const valueRe = valuePatterns(collectEconomicsValues(source));
  if (R.verdict?.reasons) R.verdict.reasons = R.verdict.reasons.map((r) => (ECON_WORDS.test(r) || valueRe?.test(r) ? (redactions++, String(r).split(/[:—(]/)[0].trim() || HIDDEN_NOTE) : r));
  if (a.ai) {
    for (const g of a.ai.gates || []) if (ECON_GATE.test(String(g.gate || ""))) { g.reasoning = HIDDEN_NOTE; redactions++; }
    walkStrings(a.ai, (s, path) => {
      if (["verdict", "decisiveGate", "model", "provider", "createdAt", "staleSince", "jobId", "priority", "status", "gate"].includes(path[path.length - 1])) return s;
      const r = scrubText(s, { lexicon: true, valueRe }); redactions += r.removed; return r.removed ? (r.text || HIDDEN_NOTE) : s;
    });
    if (ECON_GATE.test(String(a.ai.decisiveGate || "")) && /\d/.test(a.ai.decisiveGate)) a.ai.decisiveGate = String(a.ai.decisiveGate).split(/[:—(]/)[0].trim();
    if (a.ai.payloadSnapshot) delete a.ai.payloadSnapshot;
  }
  const nums = econNumberSet(source);
  for (const key of ["results", "inputs", "ai", "patents"]) walkNumbers(a[key], (v, path) => { if (key === "inputs" && path[0] === "price") return v; if (nums.has(Math.abs(v))) { redactions++; return null; } return v; });
  // Страховка: любое оставшееся строковое поле вне исходных отчётов, где встретилось «закупочное» число, чистится по предложениям.
  if (valueRe) for (const key of ["results", "patents", "inputs"]) walkStrings(a[key], (s) => { if (!valueRe.test(s)) return s; const r = scrubText(s, { lexicon: false, valueRe }); redactions += r.removed || 1; return r.text || HIDDEN_NOTE; });
  return redactions;
}

/** mode: "full" | "no_economics". meta: { preparedBy, snapshotAt, analysisUpdatedAt } */
export function buildSnapshot(analysis, { mode = "full", preparedBy = "", snapshotAt = new Date().toISOString(), analysisUpdatedAt = null } = {}) {
  if (!analysis || typeof analysis !== "object" || !analysis.results) throw new Error("Нет рассчитанного анализа — нечем делиться");
  if (mode !== "full" && mode !== "no_economics") throw new Error("Неизвестный режим ссылки: " + mode);
  const a = clone(analysis);
  if (a.aggregates?.cerebro?.keywords) { a.aggregates.cerebro.keywordCount = a.aggregates.cerebro.keywords.length; delete a.aggregates.cerebro.keywords; } // до 4 MB, дашборду не нужны
  if (a.aggregates?.poeParts) delete a.aggregates.poeParts; // для просмотра хватает объединённого POE
  if (a.aggregates?.listings) delete a.aggregates.listings; // кэш страниц этапа 2 диаграммам не нужен
  if (a.config?.tz) { a.config = { ...a.config }; delete a.config.tz; } // ТЗ производителю в публичную ссылку не попадает (spec 010, FR-006)
  a.id = "share"; delete a.status;
  let redactions = 0; const hidden = [];
  if (mode === "no_economics") { redactions = redactEconomics(a, analysis); hidden.push("economics", "budget", "cashflow"); }
  return { type: "fba-launch-evaluator/share", schemaVersion: SNAPSHOT_VERSION, mode, preparedBy: String(preparedBy || "").slice(0, 80), snapshotAt, analysisUpdatedAt: analysisUpdatedAt || analysis.updatedAt || null, hidden, redactions, analysis: a };
}

/** Для тестов и серверной самопроверки: какие «закупочные» значения всё ещё встречаются в снимке (в идеале — пусто). */
export function findEconomicsLeaks(snapshot, sourceAnalysis) {
  const re = valuePatterns(collectEconomicsValues(sourceAnalysis)); if (!re) return [];
  const leaks = []; const { aggregates, ...rest } = snapshot.analysis || {};
  walkStrings({ rest }, (s, path) => { const m = re.exec(s); if (m) leaks.push({ path: path.slice(1).join("."), match: m[0] }); return s; });
  const nums = econNumberSet(sourceAnalysis);
  walkNumbers({ rest }, (v, path) => { if (nums.has(Math.abs(v)) && path.slice(1).join(".") !== "inputs.price") leaks.push({ path: path.slice(1).join("."), match: v }); return v; });
  return leaks;
}
