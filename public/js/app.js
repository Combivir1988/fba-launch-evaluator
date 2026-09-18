// FBA Launch Evaluator — состояние приложения, привязка формы, пересчёт, история, AI, экспорт.
import { newAnalysis, migrate } from "/shared/analysis.js";
import { compute } from "/shared/compute.js";
import { DEFAULT_THRESHOLDS, mergeThresholds, METHODOLOGY_VERSION } from "/shared/thresholds.js";
import { suggestCluster, annotateKeywords } from "/shared/parse-cerebro.js";
import { toNum } from "/shared/num.js";
import { detectAndParse } from "./files.js";
import { history } from "./history.js";
import { runAi, runPatentScan, pendingJob } from "./ai.js";
import { exportAnalysisJson, exportHistoryJson, exportStandaloneHtml } from "./export.js";

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const R = () => window.FBARender;
const S = { a: newAnalysis(), token: localStorage.getItem("fba_token") || "", fromHistory: false, dirty: false, aiBusy: false, kwShowAll: false, models: [], model: localStorage.getItem("fba_model") || "", modelPatents: localStorage.getItem("fba_model_patents") || "" };
const modelAi = () => (S.models.includes(S.model) ? S.model : S.models[0] || "");
const modelPatents = () => (S.models.includes(S.modelPatents) ? S.modelPatents : modelAi());
const renderOpts = () => ({ static: false, models: S.models, selectedModel: modelAi(), selectedPatentModel: modelPatents(), aiRunning: S.aiBusy, patentsRunning: S.patBusy });
const dash = $("#dashboard");
const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
const toast = (msg, ms = 3200) => { const t = $("#toast"); t.textContent = msg; t.classList.remove("hidden"); clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.add("hidden"), ms); };
const numOrNull = (v) => (v === "" || v === null || v === undefined ? null : toNum(String(v))); // «29,9» → 29.9

// ---------- theme ----------
function applyTheme(t) { if (t) document.documentElement.setAttribute("data-theme", t); else document.documentElement.removeAttribute("data-theme"); }
applyTheme(localStorage.getItem("fba_theme") || "");
$("#theme-toggle").addEventListener("click", () => {
  const cur = document.documentElement.getAttribute("data-theme") || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  const next = cur === "dark" ? "light" : "dark"; localStorage.setItem("fba_theme", next); applyTheme(next); renderAll();
});

// ---------- сворачиваемая панель ввода ----------
function setSide(collapsed) {
  $("#tab-analysis").classList.toggle("side-collapsed", collapsed);
  $("#side-open").classList.toggle("hidden", !collapsed);
  localStorage.setItem("fba_side", collapsed ? "collapsed" : "open");
  setTimeout(() => { for (const c of Object.values(dash.__charts || {})) { try { c.resize(); } catch {} } }, 230); // графики под новую ширину
}
$("#side-toggle").addEventListener("click", () => setSide(true));
$("#side-open").addEventListener("click", () => setSide(false));
if (localStorage.getItem("fba_side") === "collapsed") setSide(true);

// ---------- tabs ----------
$$(".topbar nav button").forEach((b) => b.addEventListener("click", () => showTab(b.dataset.tab)));
function showTab(name) {
  $$(".topbar nav button").forEach((b) => b.classList.toggle("active", b.dataset.tab === name));
  for (const t of ["analysis", "history", "settings", "thresholds", "help"]) $(`#tab-${t}`).classList.toggle("hidden", t !== name);
  if (name === "settings") renderSettings();
  if (name === "history") renderHistory();
  if (name === "thresholds") renderThresholds();
}

// ---------- login ----------
async function checkToken(token) {
  try { const r = await fetch("/api/auth/check", { method: "POST", headers: { "x-app-token": token } }); return r.status; } catch { return 0; }
}
async function initLogin() {
  if (S.token) { const st = await checkToken(S.token); if (st === 204 || st === 503 || st === 0) { if (st === 503) toast("На сервере не задан APP_PASSWORD — AI недоступен"); return; } }
  $("#login").classList.remove("hidden");
}
$("#login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const pass = $("#login-pass").value; const st = await checkToken(pass);
  if (st === 204) { S.token = pass; localStorage.setItem("fba_token", pass); $("#login").classList.add("hidden"); toast("Доступ подтверждён"); }
  else if (st === 503) { $("#login-msg").textContent = "Сервер без APP_PASSWORD: AI недоступен, расчёты работают."; S.token = ""; $("#login").classList.add("hidden"); }
  else $("#login-msg").textContent = st === 0 ? "Сервер недоступен" : "Неверный пароль";
});
$("#login-skip").addEventListener("click", () => $("#login").classList.add("hidden"));

// ---------- state → form ----------
function syncForm() {
  const a = S.a, inp = a.inputs;
  const focused = document.activeElement; // не трогаем поле, которое сейчас редактируют
  $$("[data-field]").forEach((el) => { if (el !== focused) el.value = a[el.dataset.field] ?? ""; });
  $$("[data-input]").forEach((el) => {
    if (el === focused) return;
    const k = el.dataset.input; let v = inp[k];
    if (el.type === "checkbox") { el.checked = Boolean(v); return; }
    if (k === "myAsins") { el.value = (v || []).join(", "); return; }
    if (k === "myBrand" || k === "patentFeature" || k === "canDifferentiate") { el.value = v ?? ""; return; }
    const scale = Number(el.dataset.scale || 1);
    el.value = v === null || v === undefined ? "" : el.type === "range" ? v * scale : Math.round(v * scale * 1000) / 1000;
    if (el.type === "range") setOutput(el);
  });
  $$("[data-check]").forEach((el) => { const v = inp.checklist?.[el.dataset.check]; if (el.type === "checkbox") el.checked = Boolean(v); else el.value = v ?? (el.tagName === "SELECT" ? el.options[0].value : ""); });
  const bf = $('[data-axis="brandFit"]'); bf.value = inp.axisManual?.brandFit ?? 5; setOutput(bf);
  const op = $('[data-axis="opRisk"]'); const auto = inp.axisManual?.opRisk === null || inp.axisManual?.opRisk === undefined; $("#op-auto").checked = auto; op.disabled = auto; op.value = auto ? (a.results?.scorecard?.axes?.opRisk?.score ?? 8) : inp.axisManual.opRisk; setOutput(op);
  // авто-значения из выгрузок показываем в placeholder пустых полей
  const eff = a.results?.effective || {};
  const cpcEl = $("#f-cpc"); if (cpcEl) cpcEl.placeholder = eff.cpc != null && eff.cpcFromCerebro ? `авто: $${Number(eff.cpc).toFixed(2)} — ${eff.cpcSource || "Cerebro"}` : "нет Cerebro — введите CPC";
  const priceEl = $("#f-price"); if (priceEl) priceEl.placeholder = eff.priceFromMedian && eff.price != null ? `авто: $${Number(eff.price).toFixed(2)} — медиана проверенных (1b)` : "медиана 1b";
  renderFileList(); renderCluster(); renderBrandChips(); renderOverrides(); renderChallengerUser();
  $("#btn-save").textContent = S.dirty && S.fromHistory ? "💾 Сохранить ●" : "💾 Сохранить";
}
function setOutput(el) {
  const out = el.parentElement.querySelector("output"); if (!out) return;
  const v = Number(el.value); const k = el.dataset.input || el.dataset.axis || el.dataset.quick;
  out.textContent = k === "cvr" || k === "ppcShare" ? v.toFixed(k === "cvr" ? 1 : 0) + " %" : k === "price" || k === "cogs" || k === "cpc" ? "$" + v.toFixed(2) : String(v);
}

// ---------- form → state ----------
document.addEventListener("input", (e) => {
  const el = e.target;
  if (el.dataset.field) { S.a[el.dataset.field] = el.value; if (el.dataset.field === "coreKeyword") reannotateCerebro(); markDirty(); scheduleFull(); return; }
  if (el.dataset.input) { applyInput(el); markDirty(); if (el.type === "range") { setOutput(el); scheduleEcon(); } else scheduleFull(); return; }
  if (el.dataset.check) { const k = el.dataset.check; S.a.inputs.checklist[k] = el.type === "checkbox" ? el.checked : el.type === "number" ? numOrNull(el.value) : el.value; markDirty(); scheduleFull(); return; }
  if (el.dataset.axis) { S.a.inputs.axisManual[el.dataset.axis] = Number(el.value); setOutput(el); markDirty(); scheduleEcon(); return; }
  if (el.dataset.quick) { // ползунки в дашборде
    const k = el.dataset.quick; const scale = Number(el.dataset.scale || 1); S.a.inputs[k] = Number(el.value) / scale;
    const out = el.parentElement.querySelector("output"); if (out) { const v = S.a.inputs[k]; out.textContent = k === "cvr" ? (v * 100).toFixed(1) + " %" : k === "ppcShare" ? Math.round(v * 100) + " %" : k === "unitsPerDay" ? String(v) : "$" + v.toFixed(2); }
    const side = $(`.side [data-input="${k}"]`); if (side) { side.value = side.type === "range" ? S.a.inputs[k] * Number(side.dataset.scale || 1) : S.a.inputs[k]; if (side.type === "range") setOutput(side); }
    markDirty(); scheduleEcon(); return;
  }
  if (el.id === "op-auto") { S.a.inputs.axisManual.opRisk = el.checked ? null : Number($('[data-axis="opRisk"]').value); $('[data-axis="opRisk"]').disabled = el.checked; markDirty(); scheduleEcon(); }
  if (el.id === "kw-filter") renderCluster();
  if (el.id === "kw-showall") { S.kwShowAll = el.checked; renderCluster(); }
});
document.addEventListener("change", (e) => {
  const el = e.target;
  if (el.id === "set-model-ai") { S.model = el.value; localStorage.setItem("fba_model", el.value); renderSettings(); R().update(dash, S.a, renderOpts(), ["ai", "patents"]); return; }
  if (el.id === "set-model-patents") { S.modelPatents = el.value; localStorage.setItem("fba_model_patents", el.value); renderSettings(); R().update(dash, S.a, renderOpts(), ["patents"]); return; }
  if (el.dataset.kw) { const set = new Set(S.a.inputs.clusterKeywords); el.checked ? set.add(el.dataset.kw) : set.delete(el.dataset.kw); S.a.inputs.clusterKeywords = [...set]; $("#cluster-count").textContent = `(${set.size})`; markDirty(); scheduleFull(); }
  if (el.dataset.brand) { const set = new Set(S.a.inputs.excludedBrands); el.checked ? set.add(el.dataset.brand) : set.delete(el.dataset.brand); S.a.inputs.excludedBrands = [...set]; reannotateCerebro(); markDirty(); scheduleFull(); }
  if (el.dataset.ov) { const [k, f] = el.dataset.ov.split(":"); const o = (S.a.inputs.manualOverrides[k] ||= { value: null, note: "" }); if (f === "value") o.value = numOrNull(el.value); else o.note = el.value; if (o.value === null && !o.note) delete S.a.inputs.manualOverrides[k]; markDirty(); scheduleFull(); }
  if (el.dataset.ch) { const [k, f] = el.dataset.ch.split(":"); const o = (S.a.inputs.challenger[k] ||= { status: "auto", kind: "confirmed", note: "" }); o[f] = el.value; markDirty(); scheduleFull(); }
});
function applyInput(el) {
  const k = el.dataset.input;
  if (el.type === "checkbox") { S.a.inputs[k] = el.checked; return; }
  if (k === "myAsins") { S.a.inputs.myAsins = el.value.split(/[\s,;]+/).map((s) => s.trim().toUpperCase()).filter(Boolean); return; }
  if (k === "myBrand" || k === "patentFeature" || k === "canDifferentiate") { S.a.inputs[k] = el.value.trim(); return; }
  const scale = Number(el.dataset.scale || 1); const v = numOrNull(el.value); S.a.inputs[k] = v === null ? null : v / scale;
}
function markDirty() { S.dirty = true; if (S.a.ai && !S.a.ai.staleSince) S.a.ai.staleSince = new Date().toISOString(); $("#btn-save").textContent = S.fromHistory ? "💾 Сохранить ●" : "💾 Сохранить"; }

// ---------- compute / render ----------
function recompute() { S.a.results = compute(S.a); S.a.status = S.a.ai ? "ai_done" : "computed"; S.a.updatedAt = new Date().toISOString(); }
function renderAll() { recompute(); R().render(dash, S.a, renderOpts()); syncForm(); autosave(); }
function renderEcon() { recompute(); R().update(dash, S.a, renderOpts()); const op = $('[data-axis="opRisk"]'); if (op.disabled) { op.value = S.a.results.scorecard.axes.opRisk.score; setOutput(op); } autosave(); }
const scheduleFull = debounce(renderAll, 250);
let rafId = 0; function scheduleEcon() { cancelAnimationFrame(rafId); rafId = requestAnimationFrame(renderEcon); }

const autosave = debounce(async () => {
  if (S.fromHistory) return; // сохранённые из истории перезаписываются только явно (иначе «молча»)
  if (!hasContent()) return;
  try { await history.put(S.a); localStorage.setItem("fba_last", S.a.id); updateHistCount(); } catch (e) { console.warn("autosave", e); }
}, 1500);
const hasContent = () => Boolean(S.a.niche || Object.values(S.a.aggregates || {}).some(Boolean) || S.a.inputs.cogs !== null);

// ---------- files ----------
const drop = $("#drop");
["dragenter", "dragover"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add("over"); }));
["dragleave", "drop"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove("over"); }));
drop.addEventListener("drop", (e) => handleFiles([...e.dataTransfer.files]));
$("#file-btn").addEventListener("click", () => $("#file-input").click());
$("#file-input").addEventListener("change", (e) => { const files = [...e.target.files]; e.target.value = ""; handleFiles(files); }); // копия: FileList живой и очищается вместе с value
async function handleFiles(list) {
  for (const f of list) {
    try {
      const brands = S.a.aggregates.xray ? [...new Set(S.a.aggregates.xray.asins.map((a) => a.brand))] : [];
      const r = await detectAndParse(f, { coreKeyword: S.a.coreKeyword, brands });
      if (r.kind === "import") { await importDoc(r.data); continue; }
      S.a.aggregates[r.kind] = r.data; S.a.sources[r.kind] = r.meta;
      if (r.kind === "poe") { if (!S.a.niche) S.a.niche = r.data.meta.nicheTitle; if (!S.a.coreKeyword) S.a.coreKeyword = r.data.meta.nicheTitle; }
      if (r.kind === "xray") reannotateCerebro();
      if (r.kind === "cerebro") { reannotateCerebro(); if (!S.a.inputs.clusterKeywords.length) autoCluster(); }
      toast(`${r.kind.toUpperCase()}: ${r.meta.rows} ${r.kind === "xray" || r.kind === "poe" ? "ASIN" : "строк"} из ${f.name}${r.meta.duplicatesDropped ? ` (дублей удалено: ${r.meta.duplicatesDropped})` : ""}`);
    } catch (err) { console.error(err); toast("Ошибка: " + err.message, 6000); }
  }
  markDirty(); renderAll();
}
function reannotateCerebro() {
  const c = S.a.aggregates.cerebro; if (!c) return;
  const brands = S.a.aggregates.xray ? [...new Set(S.a.aggregates.xray.asins.map((a) => a.brand))] : [];
  c.keywords = annotateKeywords(c.keywords, { coreKeyword: S.a.coreKeyword, brands });
}
function autoCluster() { const c = S.a.aggregates.cerebro; if (!c) return; const th = mergeThresholds(S.a.thresholds).traffic; S.a.inputs.clusterKeywords = suggestCluster(c.keywords, { coreKeyword: S.a.coreKeyword, minSv: S.a.inputs.clusterMinSv ?? th.minSv, minCompetitors: S.a.inputs.clusterMinCompetitors ?? th.minCompetitors, limit: th.clusterLimit }); }
$("#kw-minsv").addEventListener("input", (e) => { $("#kw-minsv").parentElement.querySelector("output").textContent = e.target.value; });
$("#kw-minsv").addEventListener("change", (e) => { S.a.inputs.clusterMinSv = Number(e.target.value); autoCluster(); markDirty(); renderAll(); });
$("#kw-mincomp").addEventListener("change", (e) => { S.a.inputs.clusterMinCompetitors = Math.max(1, Number(e.target.value) || 3); autoCluster(); markDirty(); renderAll(); });
$("#kw-sort").addEventListener("change", renderCluster);
$("#kw-auto").addEventListener("click", () => { autoCluster(); markDirty(); renderAll(); });
$("#kw-none").addEventListener("click", () => { S.a.inputs.clusterKeywords = []; markDirty(); renderAll(); });
function removeSource(kind) { delete S.a.aggregates[kind]; S.a.sources[kind] = null; if (kind === "cerebro") S.a.inputs.clusterKeywords = []; markDirty(); renderAll(); }

function renderFileList() {
  const el = $("#filelist"); const labels = { xray: "Xray", cerebro: "Cerebro", poe: "POE", sqp: "SQP" };
  el.innerHTML = Object.entries(S.a.sources || {}).filter(([, v]) => v).map(([k, v]) => `<div class="filecard"><span class="tag">${labels[k]}</span><span class="muted">${esc(v.fileName || "")} · ${v.rows ?? ""} ${k === "xray" ? "ASIN" : k === "cerebro" ? "ключей" : k === "poe" ? "ASIN" : "строк"}${v.duplicatesDropped ? ` · <b title="одинаковые ASIN учтены один раз">дублей удалено: ${v.duplicatesDropped}</b>` : ""}${v.nicheTitle ? " · " + esc(v.nicheTitle) : ""}</span><button class="x" data-rm="${k}" title="Убрать">✕</button></div>`).join("") || '<div class="muted" style="font-size:.85rem">Ничего не загружено</div>';
  $$("[data-rm]", el).forEach((b) => b.addEventListener("click", () => removeSource(b.dataset.rm)));
}
function renderCluster() {
  const c = S.a.aggregates.cerebro; const det = $("#det-cluster");
  if (!c) { det.classList.add("hidden"); return; }
  det.classList.remove("hidden");
  const sel = new Set(S.a.inputs.clusterKeywords); const q = ($("#kw-filter").value || "").toLowerCase();
  const th = mergeThresholds(S.a.thresholds).traffic; const minSv = S.a.inputs.clusterMinSv ?? th.minSv;
  const multi = Boolean(c.flags?.multiAsin);
  $("#kw-multi").classList.toggle("hidden", !multi);
  if (multi) { $("#kw-mincomp").value = S.a.inputs.clusterMinCompetitors ?? th.minCompetitors; $("#kw-multi-note").textContent = `Cerebro по ${c.flags.maxCompetitors} ASIN: релевантны фразы, по которым ранжируются ≥ N конкурентов`; }
  const ms = $("#kw-minsv"); ms.value = minSv; ms.parentElement.querySelector("output").textContent = String(minSv);
  const sort = $("#kw-sort").value; const by = { sv: (k) => k.sv, sales: (k) => k.keywordSales ?? -1, comp: (k) => (k.rankingCompetitors ?? -1) * 1e6 + k.sv, rel: (k) => k.relevance * 1e7 + k.sv }[sort] || ((k) => k.sv);
  const list = c.keywords.filter((k) => (S.kwShowAll || sel.has(k.phrase) || (!k.isAsin && !k.isBranded)) && (!q || k.phrase.toLowerCase().includes(q))).sort((a, b) => by(b) - by(a)).slice(0, 400);
  $("#kwlist").innerHTML = list.map((k) => `<label><input type="checkbox" data-kw="${esc(k.phrase)}" ${sel.has(k.phrase) ? "checked" : ""}><span>${esc(k.phrase)}${k.isCore ? " ★" : ""}${k.isBranded ? ' <span class="chip warn">бренд</span>' : ""}${k.isAsin ? ' <span class="chip na">ASIN</span>' : ""}${k.sv < minSv ? ' <span class="chip na" title="ниже порога SV">low</span>' : ""}</span><span class="sv" title="SV${k.keywordSales != null ? " · продаж " + k.keywordSales : ""}${multi ? " · конкурентов " + (k.rankingCompetitors ?? "—") : ""}">${k.sv.toLocaleString("ru-RU")}${multi && k.rankingCompetitors != null ? ` <small>· ${k.rankingCompetitors}👥</small>` : ""}${k.keywordSales != null ? ` <small>· ${k.keywordSales}🛒</small>` : ""}</span></label>`).join("");
  $("#cluster-count").textContent = `(${sel.size})`;
  const total = c.keywords.length, shown = c.keywords.filter((k) => !k.isAsin && !k.isBranded).length, asins = c.keywords.filter((k) => k.isAsin).length, branded = c.keywords.filter((k) => k.isBranded).length;
  $("#kw-stats").textContent = `всего ${total.toLocaleString("ru-RU")} · скрыто ASIN ${asins}, брендовых ${branded} · показано ${Math.min(list.length, 400)}${multi ? " · multi-ASIN" : ""}`;
}
function renderBrandChips() {
  const det = $("#det-brands"); const comp = S.a.results?.competition;
  const brands = comp?.brands?.length ? comp.brands : [];
  const excluded = new Set(S.a.inputs.excludedBrands);
  const all = [...new Set([...brands.slice(0, 40).map((b) => b.brand), ...excluded])];
  if (!all.length) { det.classList.add("hidden"); return; }
  det.classList.remove("hidden");
  const cont = new Set((comp?.contaminationCandidates || []).map((c) => c.brand));
  $("#brandchips").innerHTML = all.map((b) => `<label class="chip ${excluded.has(b) ? "fail" : cont.has(b) ? "warn" : ""}"><input type="checkbox" data-brand="${esc(b)}" ${excluded.has(b) ? "checked" : ""}> ${esc(b)}${cont.has(b) ? " ?" : ""}</label>`).join("");
}
function renderOverrides() {
  const names = { "1a": "Niche Revenue, $/мес", "1b": "Средняя цена, $", "1c": "Adj. SV, /мес", "1d": "Отзывы по нише, шт", "1e": "Top brand share, доля (0.25)", "1f": "Top-5 брендов, доля", "1g": "Сезонная просадка, доля", "1h": "Успешность запусков, доля" };
  const ov = S.a.inputs.manualOverrides || {};
  $("#overrides").innerHTML = Object.entries(names).map(([k, n]) => `<div class="row" style="margin-bottom:.4rem"><div style="flex:2 1 160px"><label>${k} — ${n}</label><input type="number" step="any" data-ov="${k}:value" value="${ov[k]?.value ?? ""}" placeholder="авто: ${fmtAuto(k)}"></div><div style="flex:2 1 120px"><label>источник/заметка</label><input data-ov="${k}:note" value="${esc(ov[k]?.note ?? "")}" placeholder="скрин Cerebro…"></div></div>`).join("");
}
function fmtAuto(k) { const it = S.a.results?.criterion1?.items?.[k]; if (!it) return "—"; const v = it.autoValue ?? it.value; return typeof v === "number" ? (it.pct ? (v * 100).toFixed(1) + " %" : Math.round(v).toLocaleString("ru-RU")) : "нет данных"; }
function renderChallengerUser() {
  const items = { 3: "Лояльность к бренду", 4: "Уязвимость лидера", 5: "Многоигровое поле", 7: "Дифференциация (ТЗ)", 8: "Патент / FTO" };
  const u = S.a.inputs.challenger || {};
  $("#challenger-user").innerHTML = Object.entries(items).map(([k, n]) => { const o = u[k] || {}; return `<div class="row" style="margin-bottom:.4rem"><div style="flex:2 1 120px"><label>${k}. ${n}</label><select data-ch="${k}:status"><option value="auto" ${!o.status || o.status === "auto" ? "selected" : ""}>авто</option><option value="ok" ${o.status === "ok" ? "selected" : ""}>зелёный</option><option value="warn" ${o.status === "warn" ? "selected" : ""}>жёлтый</option><option value="fail" ${o.status === "fail" ? "selected" : ""}>красный</option></select></div><div style="flex:1 1 110px"><label>тип</label><select data-ch="${k}:kind"><option value="confirmed" ${o.kind === "confirmed" ? "selected" : ""}>🟢 подтверждено</option><option value="assumed" ${o.kind === "assumed" ? "selected" : ""}>🟡 допущение</option><option value="decided" ${o.kind === "decided" || (!o.kind && k === "7") ? "selected" : ""}>🔵 решено</option></select></div><div style="flex:3 1 160px"><label>основание</label><input data-ch="${k}:note" value="${esc(o.note || "")}" placeholder="${k === "7" ? "измеримое требование ТЗ" : "данные/ссылка"}"></div></div>`; }).join("");
}
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// ---------- AI ----------
dash.addEventListener("click", (e) => { const b = e.target.closest('[data-action="ai"]'); if (b) startAi(); const pb = e.target.closest('[data-action="patents"]'); if (pb) startPatentScan(); const sb = e.target.closest('[data-action="settings"]'); if (sb) { e.preventDefault(); showTab("settings"); } });
$("#btn-patents").addEventListener("click", () => startPatentScan());
$("#btn-ai").addEventListener("click", () => startAi());
async function startAi(resumeJobId = null) {
  if (S.aiBusy) return;
  if (!S.token) { $("#login").classList.remove("hidden"); toast("Для AI нужен пароль доступа"); return; }
  if (!S.a.results) renderAll();
  S.aiBusy = true; $("#btn-ai").disabled = true;
  const chosen = modelAi();
  if (S.a.ai) R().update(dash, S.a, renderOpts(), ["ai"]); // прежний результат затемняем, пока идёт новый
  const prog = $("#ai-progress"), status = $("#ai-status");
  if (prog) { prog.classList.remove("hidden"); prog.textContent = ""; } if (status) status.textContent = resumeJobId ? "продолжаю задачу после перезагрузки…" : `запрос… (${chosen || "модель по умолчанию"})`;
  try {
    const ai = await runAi(S.a, { token: S.token, model: chosen || undefined, resumeJobId,
      onMeta: (m) => { if (status) status.textContent = `модель ${m.model}…`; },
      onThinking: (t) => { if (prog) { prog.textContent += t; prog.scrollTop = prog.scrollHeight; } },
      onProgress: (n) => { if (status) status.textContent = `формирую ответ… ${n} симв.`; },
      onReconnect: (n) => { if (status) status.textContent = `связь прервалась — переподключаюсь (${n})… задача продолжается на сервере`; } });
    S.a.ai = ai; S.a.status = "ai_done"; S.dirty = true;
    R().update(dash, S.a, renderOpts(), ["hero", "ai"]);
    if (!S.fromHistory) { await history.put({ ...S.a, updatedAt: new Date().toISOString() }); updateHistCount(); }
    toast(ai.adjustedByRules ? "AI-вердикт получен и скорректирован правилами" : "AI-вердикт получен");
  } catch (err) {
    console.error(err);
    if (err.code === "auth") { S.token = ""; localStorage.removeItem("fba_token"); $("#login").classList.remove("hidden"); }
    if (status) status.textContent = "ошибка: " + err.message; toast("AI: " + err.message, 7000);
  } finally { S.aiBusy = false; $("#btn-ai").disabled = false; R().update(dash, S.a, renderOpts(), ["ai"]); }
}

async function startPatentScan(resumeJobId = null) {
  if (S.patBusy) return;
  if (!S.token) { $("#login").classList.remove("hidden"); toast("Для патентного скана нужен пароль доступа"); return; }
  if (!S.a.coreKeyword && !S.a.niche) return toast("Укажите нишу / главный ключ");
  if (!S.a.results) renderAll();
  S.patBusy = true; $("#btn-patents").disabled = true;
  if (S.a.patents) R().update(dash, S.a, renderOpts(), ["patents"]);
  const setStatus = (t) => { for (const el of [$("#patents-status"), $("#patents-side-status")]) if (el) el.textContent = t; };
  setStatus(resumeJobId ? "продолжаю скан после перезагрузки…" : "запуск…");
  try {
    const brands = (S.a.results?.competition?.brands || []).slice(0, 6).map((b) => b.brand);
    const hypotheses = (S.a.ai?.differentiation || []).map((d) => d.hypothesis);
    const chosen = modelPatents();
    const scan = await runPatentScan(S.a, { niche: S.a.niche, coreKeyword: S.a.coreKeyword, feature: S.a.inputs.patentFeature || "", hypotheses, brands, options: chosen ? { model: chosen } : {} },
      { token: S.token, resumeJobId, onStage: (d) => setStatus(d.text || d.stage), onReconnect: (n) => setStatus(`связь прервалась — переподключаюсь (${n})…`) });
    S.a.patents = scan; markDirty(); renderAll();
    setStatus(`готово: ${{ conflict: "есть красные флаги", unsure: "требует проверки", clear: "явных пересечений нет" }[scan.status] || scan.status}`);
    toast("Патентный скан завершён — критерий 8 получил статус «допущение»");
    document.getElementById("sec-patents")?.scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (e) { console.error(e); if (e.code === "auth") { S.token = ""; localStorage.removeItem("fba_token"); $("#login").classList.remove("hidden"); } setStatus("ошибка: " + e.message); toast("Патентный скан: " + e.message, 7000); }
  finally { S.patBusy = false; $("#btn-patents").disabled = false; R().update(dash, S.a, renderOpts(), ["patents"]); }
}

/** После загрузки анализа — продолжить незавершённые задачи (страница перезагружалась во время AI). */
function resumePendingJobs() {
  const hourAgo = Date.now() - 60 * 60 * 1000;
  const a = pendingJob.get(S.a.id, "analyze"); if (a?.jobId && a.startedAt > hourAgo && S.token) startAi(a.jobId); else if (a) pendingJob.clear(S.a.id, "analyze");
  const p = pendingJob.get(S.a.id, "patents"); if (p?.jobId && p.startedAt > hourAgo && S.token) startPatentScan(p.jobId); else if (p) pendingJob.clear(S.a.id, "patents");
}

// ---------- save / export / new ----------
$("#btn-save").addEventListener("click", async () => {
  if (!hasContent()) return toast("Нечего сохранять");
  recompute();
  if (S.fromHistory && S.dirty) {
    const overwrite = confirm("Перезаписать сохранённый анализ? «Отмена» — сохранить как новую версию.");
    if (!overwrite) { S.a = { ...S.a, id: crypto.randomUUID(), createdAt: new Date().toISOString() }; }
  }
  await history.put(S.a); localStorage.setItem("fba_last", S.a.id); S.dirty = false; S.fromHistory = true; syncForm(); updateHistCount(); toast("Сохранено в историю");
});
$("#btn-json").addEventListener("click", () => { recompute(); exportAnalysisJson(S.a); });
$("#btn-html").addEventListener("click", async () => { recompute(); try { await exportStandaloneHtml(S.a); toast("HTML-дашборд скачан"); } catch (e) { toast("Ошибка экспорта: " + e.message); } });
$("#btn-new").addEventListener("click", () => { if (S.dirty && !confirm("Начать новый анализ? Несохранённые изменения будут потеряны.")) return; loadAnalysis(newAnalysis(), false); });

function loadAnalysis(doc, fromHistory) {
  R().destroy(dash); S.a = migrate(doc); S.fromHistory = fromHistory; S.dirty = false;
  if (S.a.aggregates?.cerebro) reannotateCerebro();
  if (S.a.thresholds && Object.keys(S.a.thresholds).length) renderThresholds();
  renderAll(); showTab("analysis"); localStorage.setItem("fba_last", S.a.id);
  resumePendingJobs();
}
async function importDoc(obj) {
  if (obj.type === "fba-launch-evaluator/analysis") { const d = migrate(obj.analysis); await history.put(d); toast(`Импортирован анализ «${d.niche}»`); loadAnalysis(d, true); }
  else if (obj.type === "fba-launch-evaluator/history") { const docs = (obj.analyses || []).map(migrate); const r = await history.importMany(docs); toast(`Импорт: +${r.added} новых, ${r.updated} обновлено, ${r.skipped} пропущено`); updateHistCount(); renderHistory(); }
}

// ---------- history tab ----------
async function updateHistCount() { try { const l = await history.list(); $("#hist-count").textContent = l.length ? `(${l.length})` : ""; } catch {} }
async function renderHistory() {
  const q = ($("#hist-search").value || "").toLowerCase();
  const list = (await history.list()).filter((h) => !q || (h.niche || "").toLowerCase().includes(q) || (h.coreKeyword || "").toLowerCase().includes(q));
  const V = R().VLABEL;
  $("#histlist").innerHTML = list.map((h) => `<div class="histrow"><div><div class="t">${esc(h.niche || "Без названия")} ${h.verdict ? `<span class="status ${h.verdict}">${V[h.verdict]}</span>` : ""}${h.aiDone ? ' <span class="chip">AI</span>' : ""}</div>
    <div class="m">${new Date(h.updatedAt).toLocaleString("ru-RU")} · ключ: ${esc(h.coreKeyword || "—")} · Критерий 1: ${h.c1 ?? "—"}/8 · scorecard ${h.score != null ? Math.round(h.score) + " %" : "—"} · ${h.sources.join(", ") || "без файлов"}</div></div>
    <div class="b"><button data-open="${h.id}" class="primary">Открыть</button><button data-json="${h.id}">JSON</button><button data-del="${h.id}" class="danger">Удалить</button></div></div>`).join("") || '<div class="empty">История пуста. Сохранённые анализы появятся здесь.</div>';
  $$("[data-open]").forEach((b) => b.addEventListener("click", async () => loadAnalysis(await history.get(b.dataset.open), true)));
  $$("[data-json]").forEach((b) => b.addEventListener("click", async () => exportAnalysisJson(await history.get(b.dataset.json))));
  $$("[data-del]").forEach((b) => b.addEventListener("click", async () => { if (confirm("Удалить анализ из истории?")) { await history.delete(b.dataset.del); if (S.a.id === b.dataset.del) S.fromHistory = false; renderHistory(); updateHistCount(); } }));
}
$("#hist-search").addEventListener("input", debounce(renderHistory, 200));
$("#hist-export").addEventListener("click", async () => exportHistoryJson(await history.getAllFull()));
$("#hist-import").addEventListener("click", () => $("#hist-import-file").click());
$("#hist-import-file").addEventListener("change", async (e) => { const f = e.target.files[0]; if (!f) return; try { await importDoc(JSON.parse(await f.text())); } catch (err) { toast("Импорт: " + err.message, 6000); } e.target.value = ""; });

// ---------- settings tab ----------
const FREE_HINT = "Бесплатные :free модели: $0, но ответ 3–6 минут и слабее структура. Платные (Gemini 3.8 Flash ≈ $0.02, GPT-5.6 Sol / Claude Sonnet 5 ≈ $0.05, Opus 5 ≈ $0.10 за анализ) — после пополнения openrouter.ai/settings/credits.";
function renderSettings() {
  $("#set-provider").textContent = S.provider || "—";
  const fill = (id, cur) => { const el = $(id); el.innerHTML = S.models.map((m) => `<option value="${esc(m)}" ${m === cur ? "selected" : ""}>${esc(m)}${/:free$/.test(m) ? " — бесплатно" : ""}</option>`).join("") || '<option value="">(список моделей недоступен — сервер не отвечает)</option>'; };
  fill("#set-model-ai", modelAi()); fill("#set-model-patents", modelPatents());
  $("#set-model-hint").textContent = `AI-вердикт: ${modelAi() || "—"} · патентный скан: ${modelPatents() || "—"}. ${FREE_HINT}`;
  $("#set-login-state").textContent = S.token ? "пароль доступа сохранён в этом браузере" : "не авторизован — AI недоступен";
}
$("#set-logout").addEventListener("click", () => { S.token = ""; localStorage.removeItem("fba_token"); renderSettings(); $("#login").classList.remove("hidden"); toast("Пароль доступа удалён из браузера"); });
$("#set-theme").addEventListener("click", () => $("#theme-toggle").click());
$("#set-side").addEventListener("click", () => { const c = $("#tab-analysis").classList.contains("side-collapsed"); setSide(!c); showTab("analysis"); });

// ---------- thresholds tab ----------
const THR_NAMES = { criterion1: "Критерий 1 — рыночный контекст", economics: "Экономика (Gate 1 / Gate 2 / Критерий 2)", budget: "Бюджет (урок 08)", traffic: "Трафик по ключам (урок 09) и Cerebro", poe: "POE / концентрация (урок 11)", challenger: "Критерии 3–8 против доминирующего игрока", reviewsMoat: "Ров отзывов лидера", scorecard: "Scorecard", reconciliation: "Сверка источников", checklist: "Чеклист рисков" };
// Человеческие подписи порогов: [название, единица/подсказка]. Доли — в долях единицы (0.25 = 25 %).
const THR_LABELS = {
  "criterion1.passCount": ["Минимум зелёных подпунктов из 8", "шт (порог прохождения Критерия 1)"],
  "criterion1.nicheRevenueMonthly": ["1a — выручка ниши, минимум", "$/мес"],
  "criterion1.priceOk": ["1b — цена OK от", "$"], "criterion1.priceWarn": ["1b — цена «погранично» от", "$ (ниже — НЕ OK)"],
  "criterion1.adjSv": ["1c — Adj. SV главного ключа, минимум", "запросов/мес"],
  "criterion1.reviewsOk": ["1d — отзывов по нише, OK если меньше", "шт"], "criterion1.reviewsFail": ["1d — НЕ OK если больше", "шт"],
  "criterion1.topBrandShare": ["1e — доля топ-бренда, НЕ OK от", "доля (0.25 = 25 %)"],
  "criterion1.top5Ok": ["1f — топ-5 брендов OK если меньше", "доля"], "criterion1.top5Fail": ["1f — НЕ OK если больше", "доля"],
  "criterion1.seasonOk": ["1g — сезонная просадка OK если меньше", "доля"], "criterion1.seasonFail": ["1g — НЕ OK если больше", "доля"],
  "criterion1.launchOk": ["1h — успешность запусков OK от", "доля"], "criterion1.launchFail": ["1h — НЕ OK если меньше", "доля"],
  "criterion1.provenReviews": ["«Проверенный» конкурент — отзывов от", "шт (для медианы цены)"], "criterion1.minTrendWeeks": ["Минимум недель POE для сезонности", "нед."],
  "economics.marginMin": ["Gate 1 — маржа без рекламы, минимум", "доля"], "economics.profitMin": ["Gate 1 — прибыль на юнит, минимум", "$"],
  "economics.cheapPrice": ["Дешёвый сегмент — цена ниже", "$"], "economics.cheapMarginMin": ["Дешёвый сегмент — маржа вместо $15, минимум", "доля"],
  "economics.cvrGrid": ["Gate 2 — сетка CVR для стресс-теста", "доли через запятую"], "economics.cvrPassMax": ["Gate 2 — PASS если Net > 0 при CVR ≤", "доля"],
  "economics.roiOk": ["ROI норма от", "1.5 = 150 %"], "economics.roiLoss": ["ROI убыток ниже", "1.0 = 100 %"], "economics.roiSuspicious": ["ROI «перепроверь данные» выше", "2.0 = 200 %"],
  "economics.c2PassCount": ["Критерий 2 — минимум OK из 11", "шт"], "economics.roiAdsMin": ["2j — ROI с рекламой, минимум", "доля"], "economics.marginAdsMin": ["2k — маржинальность с рекламой, минимум", "доля"],
  "economics.cvrRealistic": ["2c — реалистичный CVR нового листинга", "от, до"], "economics.ppcShareRealistic": ["2e — реалистичная доля PPC на старте", "от, до"], "economics.periodDays": ["Горизонт расчёта 2g–2k", "дней"],
  "budget.receivingDays": ["Приёмка Amazon", "дней (добавляется к сроку партии)"], "budget.batches": ["Партий в бюджете", "шт (урок 08: две)"],
  "traffic.top2ShareMax": ["Доля топ-2 ключей, НЕ OK выше", "доля"], "traffic.relevantMin": ["Релевантных ключей, минимум", "шт"], "traffic.minSv": ["Значимый ключ — SV от", "запросов/мес"], "traffic.groupsMin": ["Групп ключей, минимум", "шт"],
  "traffic.minCompetitors": ["Cerebro multi-ASIN — конкурентов в топе от", "шт (фраза релевантна)"], "traffic.clusterLimit": ["Авто-кластер — максимум фраз", "шт"],
  "poe.searchConvLow": ["Конверсия поиска — «спрос не удовлетворён» ниже", "доля"], "poe.sponsoredHigh": ["Спонсорских товаров — «рекламная война» выше", "доля"], "poe.top20ProductsHigh": ["Топ-20 продуктов click share — концентрация выше", "доля"],
  "challenger.activateTopBrand": ["Доминирующий бренд — доля от", "доля (включает критерии 3–8)"], "challenger.passCount": ["Минимум зелёных из 8", "шт"],
  "challenger.loyaltyOk": ["3 — лояльность к бренду OK ниже", "доля"], "challenger.loyaltyFail": ["3 — НЕ OK выше", "доля"],
  "challenger.leaderRatingSafe": ["4 — лидер неуязвим при рейтинге выше", "★"], "challenger.complaintMinPct": ["4 — системная жалоба от", "% упоминаний"],
  "challenger.playersMin": ["5a — брендов с заметной долей, минимум", "шт"], "challenger.playerShareMin": ["5a — заметная доля бренда от", "доля"], "challenger.top5Ok": ["5b — топ-5 OK ниже", "доля"], "challenger.top5Fail": ["5b — НЕ OK выше", "доля"],
  "reviewsMoat.breakable": ["Ров пробиваем, отзывов лидера меньше", "шт"], "reviewsMoat.medium": ["Средний барьер до", "шт (выше — непробиваем)"],
  "reconciliation.noise": ["Расхождение источников — шум до", "доля"], "reconciliation.borderline": ["Погранично до", "доля (выше — конфликт)"],
  "checklist.designTestMin": ["Тест дизайна (PickFu) — минимум голосов", "%"], "checklist.lifecycleMonthsMin": ["Жизненный цикл, минимум", "мес"], "checklist.listingsHigh": ["Листингов в выдаче — высокая конкуренция от", "шт"],
};
function renderThresholds() {
  const th = mergeThresholds(S.a.thresholds);
  const def = DEFAULT_THRESHOLDS;
  const groups = Object.entries(th).filter(([, v]) => v && typeof v === "object");
  $("#thr").innerHTML = groups.map(([g, obj]) => `<div class="card"><h4>${THR_NAMES[g] || g}</h4>${Object.entries(obj).map(([k, v]) => {
    const [label, unit] = THR_LABELS[`${g}.${k}`] || [k, ""]; const d = def[g]?.[k]; const changed = JSON.stringify(d) !== JSON.stringify(v);
    const hint = `<small class="muted">${esc(unit)}${changed ? ` · по умолчанию ${Array.isArray(d) ? d.join(", ") : d}` : ""}</small>`;
    if (typeof v === "number") return `<div class="field"><label title="${esc(g + "." + k)}">${esc(label)}${changed ? ' <span class="chip warn">изменено</span>' : ""}</label><input type="number" step="any" data-thr="${g}.${k}" value="${v}">${hint}</div>`;
    if (Array.isArray(v)) return `<div class="field"><label title="${esc(g + "." + k)}">${esc(label)}${changed ? ' <span class="chip warn">изменено</span>' : ""}</label><input data-thr="${g}.${k}" data-arr="1" value="${v.join(", ")}">${hint}</div>`;
    return "";
  }).join("")}</div>`).join("");
  $("#help-ver").textContent = METHODOLOGY_VERSION;
}
$("#thr").addEventListener("change", (e) => {
  const el = e.target; if (!el.dataset.thr) return;
  const [g, k] = el.dataset.thr.split("."); S.a.thresholds[g] ||= {};
  S.a.thresholds[g][k] = el.dataset.arr ? el.value.split(/[,\s]+/).filter(Boolean).map(Number) : Number(el.value);
  markDirty(); scheduleFull(); toast("Порог изменён — пересчёт");
});
$("#thr-reset").addEventListener("click", () => { S.a.thresholds = {}; renderThresholds(); markDirty(); renderAll(); toast("Пороги сброшены к умолчаниям"); });

// ---------- init ----------
(async function init() {
  $("#help-ver").textContent = METHODOLOGY_VERSION;
  try { const h = await fetch("/api/health").then((r) => r.json()); S.models = Array.isArray(h.models) ? h.models : []; S.provider = h.provider; } catch {}
  if (!window.Chart) toast("Chart.js не загрузился — графики не будут отрисованы. Проверьте блокировщик скриптов.", 10000);

  await initLogin();
  updateHistCount();
  const last = localStorage.getItem("fba_last");
  if (last) { try { const d = await history.get(last); if (d) { loadAnalysis(d, true); return; } } catch {} }
  renderAll(); resumePendingJobs();
})();
