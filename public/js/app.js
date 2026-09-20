// FBA Launch Evaluator — состояние приложения, привязка формы, пересчёт, история, AI, экспорт.
import { newAnalysis, migrate, splitDoc, coreSignature } from "/shared/analysis.js";
import { compute } from "/shared/compute.js";
import { DEFAULT_THRESHOLDS, mergeThresholds, METHODOLOGY_VERSION } from "/shared/thresholds.js";
import { suggestCluster, annotateKeywords } from "/shared/parse-cerebro.js";
import { toNum } from "/shared/num.js";
import { mergePoe, upsertPoePart, poePartKey } from "/shared/merge-poe.js";
import { detectAndParse } from "./files.js";
import { history, localHistory } from "./history.js";
import { runAi, runPatentScan, pendingJob } from "./ai.js";
import { api, goLogin } from "/js/api.js";
import { exportAnalysisJson, exportHistoryJson, exportStandaloneHtml } from "./export.js";

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const R = () => window.FBARender;
const S = { a: newAnalysis(), user: null, baseVersion: null, meta: null, sig: "", aggDirty: false, conflict: null, dirty: false, aiBusy: false, kwShowAll: false, models: [], model: "", modelPatents: "" };
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
// Анимация — только через transform (его рисует видеокарта). Ширину колонок меняем ОДИН раз, до начала движения:
// если анимировать саму сетку, браузер на каждом кадре заново раскладывает весь дашборд и перерисовывает все графики — отсюда рывки.
// Панель и дашборд едут ОДНОВРЕМЕННО: при сворачивании панель на время движения «прикалывается» поверх раскладки (position: absolute с прежними размерами).
const SIDE_MS = 180; let sideSeq = 0;
function setSide(collapsed, instant = false) {
  const layout = $("#tab-analysis"), side = $("#side"); const seq = ++sideSeq;
  localStorage.setItem("fba_side", collapsed ? "collapsed" : "open");
  const cleanup = () => { dash.style.transition = ""; dash.style.transform = ""; layout.classList.remove("side-animating"); side.classList.remove("side-pinned", "side-leaving"); for (const k of ["left", "top", "width", "height"]) side.style[k] = ""; };
  cleanup(); // прерванная предыдущая анимация (быстрый двойной клик) не оставляет следов
  const apply = () => { layout.classList.toggle("side-collapsed", collapsed); $("#side-open").classList.toggle("hidden", !collapsed);
    setTimeout(() => { for (const c of Object.values(dash.__charts || {})) { try { c.resize(); } catch {} } }, SIDE_MS + 60); }; // графики под новую ширину — после движения
  if (layout.classList.contains("side-collapsed") === collapsed) { $("#side-open").classList.toggle("hidden", !collapsed); return; }
  if (instant || layout.classList.contains("hidden") || innerWidth <= 980 || matchMedia("(prefers-reduced-motion: reduce)").matches) return apply();
  const from = dash.getBoundingClientRect().left;
  if (collapsed) { const r = side.getBoundingClientRect(), lr = layout.getBoundingClientRect(); // панель остаётся на месте, пока раскладка под ней меняется
    side.style.left = r.left - lr.left + "px"; side.style.top = r.top - lr.top + "px"; side.style.width = r.width + "px"; side.style.height = r.height + "px"; side.classList.add("side-pinned"); }
  else side.classList.add("side-leaving"); // панель ждёт за краем экрана
  layout.classList.add("side-animating"); apply();
  const dx = from - dash.getBoundingClientRect().left;
  dash.style.transition = "none"; dash.style.transform = `translateX(${dx}px)`; // дашборд визуально остаётся там, где был
  // Движение — через два кадра: первый кадр браузер тратит на новую раскладку, анимация не должна «съесть» своё начало.
  requestAnimationFrame(() => requestAnimationFrame(() => { if (seq !== sideSeq) return;
    side.classList.toggle("side-leaving", collapsed); dash.style.transition = `transform ${SIDE_MS}ms ease-out`; dash.style.transform = "translateX(0)";
    setTimeout(() => { if (seq === sideSeq) cleanup(); }, SIDE_MS + 40); }));
}
$("#side-toggle").addEventListener("click", () => setSide(true));
$("#side-open").addEventListener("click", () => setSide(false));
if (localStorage.getItem("fba_side") === "collapsed") setSide(true, true); // при загрузке — без анимации

// ---------- tabs ----------
$$(".topbar nav button").forEach((b) => b.addEventListener("click", () => showTab(b.dataset.tab)));
// Открытый раздел живёт в адресе (#history) и запоминается в браузере: после F5 открывается тот же раздел, ссылку на раздел можно переслать.
const TABS = ["analysis", "history", "settings", "thresholds", "help"];
const wantedTab = () => { const h = location.hash.slice(1); if (TABS.includes(h)) return h; try { const t = localStorage.getItem("fba_tab"); if (TABS.includes(t)) return t; } catch {} return "analysis"; };
window.addEventListener("hashchange", () => { const h = location.hash.slice(1); if (TABS.includes(h)) showTab(h); });
function showTab(name) {
  if (!TABS.includes(name)) name = "analysis";
  $$(".topbar nav button").forEach((b) => { const on = b.dataset.tab === name; b.classList.toggle("active", on); if (on) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current"); });
  for (const t of TABS) $(`#tab-${t}`).classList.toggle("hidden", t !== name);
  try { localStorage.setItem("fba_tab", name); } catch {}
  if (location.hash.slice(1) !== name) window.history.replaceState(null, "", name === "analysis" && !location.hash ? location.pathname + location.search : "#" + name); // history в этом файле — модуль истории анализов
  if (name === "analysis") setTimeout(() => { for (const c of Object.values(dash.__charts || {})) { try { c.resize(); } catch {} } }, 0); // графики, нарисованные в скрытом разделе, получают размер
  if (name === "settings") renderSettings();
  if (name === "history") renderHistory();
  if (name === "thresholds") renderThresholds();
}

// ---------- учётная запись ----------
/** Без сеанса приложение не работает: api() сам уводит на /login.html. Модели AI хранятся в аккаунте (одноразово переносим из браузера). */
async function initUser() {
  const me = await api("GET", "/api/auth/me");
  if (me.mustChangePassword) { goLogin("#change"); throw new Error("password change required"); }
  S.user = me.user;
  const st = me.user.settings || {}; const patch = {};
  for (const [key, ls, prop] of [["modelAi", "fba_model", "model"], ["modelPatents", "fba_model_patents", "modelPatents"]]) {
    const local = localStorage.getItem(ls);
    if (st[key]) S[prop] = st[key]; else if (local) { S[prop] = local; patch[key] = local; }
    localStorage.removeItem(ls);
  }
  localStorage.removeItem("fba_token");
  if (Object.keys(patch).length) api("PATCH", "/api/auth/settings", patch).catch(() => {});
  $("#user-name").textContent = me.user.name + (me.user.role === "admin" ? " · админ" : "");
  $("#user-chip").classList.remove("hidden");
}
async function logout() { try { await api("POST", "/api/auth/logout", undefined, { noRedirect: true }); } catch {} goLogin(); }
$("#user-logout").addEventListener("click", logout);
window.addEventListener("storage-down", () => toast("Хранилище недоступно — повторите через несколько секунд", 7000));

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
  const cf = a.results?.cashflow; // поля сценария: в пустом поле видно, какое значение взято автоматически
  const ph = (id, text) => { const el = $(id); if (el) el.placeholder = text; };
  if (cf && !cf.pending) { ph("#f-start", `авто: ${Math.round(cf.startSales)} — ${{ cohort: "новички ниши", zero: "с нуля", input: "задано" }[cf.startSource]}`); ph("#f-first", `авто: ${cf.firstBatchUnits} шт`); }
  else { ph("#f-start", "авто"); ph("#f-first", "авто"); }
  renderFileList(); renderCluster(); renderBrandChips(); renderOverrides(); renderChallengerUser();
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
  if (el.id === "set-model-ai") { S.model = el.value; api("PATCH", "/api/auth/settings", { modelAi: el.value }).catch((e) => toast("Не удалось сохранить выбор модели: " + e.message)); renderSettings(); R().update(dash, S.a, renderOpts(), ["ai", "patents"]); return; }
  if (el.id === "set-model-patents") { S.modelPatents = el.value; api("PATCH", "/api/auth/settings", { modelPatents: el.value }).catch((e) => toast("Не удалось сохранить выбор модели: " + e.message)); renderSettings(); R().update(dash, S.a, renderOpts(), ["patents"]); return; }
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
function markDirty() { S.dirty = true; if (S.a.ai && !S.a.ai.staleSince) S.a.ai.staleSince = new Date().toISOString(); if (!S.conflict) setSaveState("dirty"); }

// ---------- compute / render ----------
function recompute() { S.a.results = compute(S.a); S.a.status = S.a.ai ? "ai_done" : "computed"; S.a.updatedAt = new Date().toISOString(); }
function renderAll() { recompute(); R().render(dash, S.a, renderOpts()); syncForm(); renderBandPanel(); renderCvrHint(); autosave(); }
function renderEcon() { recompute(); R().update(dash, S.a, renderOpts()); const op = $('[data-axis="opRisk"]'); if (op.disabled) { op.value = S.a.results.scorecard.axes.opRisk.score; setOutput(op); } autosave(); }
const scheduleFull = debounce(renderAll, 250);
let rafId = 0; function scheduleEcon() { cancelAnimationFrame(rafId); rafId = requestAnimationFrame(renderEcon); }

// ---------- сохранение в общую историю (сервер) ----------
// Лёгкая часть документа уходит при любом изменении (не чаще раза в 2 с и только если содержимое реально изменилось),
// отчёты — только после загрузки/удаления файлов. Чужую правку ловит версия: сервер отвечает 409, мы показываем диалог.
const SAVE_TEXT = { dirty: "● есть несохранённые изменения", saving: "сохраняю…", saved: "✓ сохранено в общую историю", conflict: "⚠ не сохранено: анализ изменён другим человеком", error: "⚠ не сохранено" };
function setSaveState(state, extra = "") {
  const el = $("#save-state"); if (!el) return;
  el.textContent = state ? SAVE_TEXT[state] + (extra ? " — " + extra : "") : "";
  el.className = state === "saved" ? "ok" : state === "conflict" || state === "error" ? "bad" : "muted";
  if (state === "conflict") { el.style.cursor = "pointer"; el.title = "Показать варианты"; } else { el.style.cursor = ""; el.title = ""; }
}
function renderDocMeta() {
  const m = S.meta; const el = $("#doc-meta"); if (!el) return;
  const t = (d) => new Date(d).toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "short" });
  el.textContent = m ? `автор: ${m.createdBy?.name || "—"} · изменил: ${m.updatedBy?.name || "—"}, ${t(m.updatedAt)}` : "";
}
let saveChain = Promise.resolve(true);
/** Поставить сохранение в очередь (запросы к одному анализу идут строго по одному). → true, если на сервере актуальная версия. */
function saveNow(opts = {}) { saveChain = saveChain.then(() => doSave(opts)).catch((e) => { console.warn("save", e); return false; }); return saveChain; }
async function doSave({ force = false } = {}) {
  if (!hasContent()) return true;
  if (S.conflict && !force) return false;
  const doc = S.a, id = doc.id;
  const sig = coreSignature(splitDoc(doc).core);
  const coreChanged = sig !== S.sig || S.baseVersion === null || force;
  if (!coreChanged && !S.aggDirty) { S.dirty = false; return true; }
  setSaveState("saving");
  const sendAgg = S.aggDirty; S.aggDirty = false;
  try {
    let last = null;
    if (coreChanged) { last = await history.saveCore(doc, S.baseVersion, { force }); if (S.a.id !== id) return true; S.baseVersion = last.version; S.sig = sig; }
    if (sendAgg) { last = await history.saveAggregates(doc, S.baseVersion, { force }); if (S.a.id !== id) return true; S.baseVersion = last.version; }
    S.conflict = null; S.dirty = coreSignature(splitDoc(S.a).core) !== S.sig || S.aggDirty;
    if (last) S.meta = { ...(S.meta || { createdBy: { id: S.user.id, name: S.user.name }, createdAt: last.updatedAt }), version: last.version, updatedAt: last.updatedAt, updatedBy: { id: S.user.id, name: S.user.name } };
    localStorage.setItem("fba_last", id); setSaveState(S.dirty ? "dirty" : "saved"); renderDocMeta(); updateHistCount();
    if (S.dirty) autosave();
    return true;
  } catch (e) {
    if (sendAgg) S.aggDirty = true;
    if (S.a.id !== id) return false;
    if (e.code === "conflict" || e.code === "exists") { S.conflict = e; setSaveState("conflict"); showConflict(e); return false; }
    setSaveState("error", e.message); return false;
  }
}
const autosave = debounce(() => saveNow(), 2000);
/** Результат дорогой задачи (AI-вердикт, патентный скан) сохраняем сразу, не дожидаясь паузы автосохранения. */
async function persistJobResult(label) {
  S.a.updatedAt = new Date().toISOString();
  if (!(await saveNow())) toast(`${label}: результат получен, но не сохранён в общую историю — см. индикатор под кнопками`, 8000);
}
window.addEventListener("beforeunload", (e) => { if (S.dirty && hasContent()) { e.preventDefault(); e.returnValue = ""; } });
window.addEventListener("storage-down", () => setSaveState("error", "хранилище недоступно, скачайте JSON на всякий случай"));

// ---------- конфликт одновременного редактирования ----------
function showConflict(e) {
  const who = e.updatedBy?.name || "другой пользователь"; const when = e.updatedAt ? new Date(e.updatedAt).toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "short" }) : "";
  $("#conflict-text").textContent = e.code === "exists" ? "Анализ с таким идентификатором уже есть в общей истории (его сохранили с другого устройства)." : `«${S.a.niche || "Без названия"}» изменил(а) ${who}${when ? " в " + when : ""}, пока вы работали с ним.`;
  const d = $("#conflict-dlg"); if (!d.open) d.showModal();
}
$("#save-state").addEventListener("click", () => { if (S.conflict) showConflict(S.conflict); });
$("#conflict-later").addEventListener("click", () => $("#conflict-dlg").close());
$("#conflict-copy").addEventListener("click", async () => {
  try { recompute(); const r = await history.copy(S.a); const g = await history.get(r.id); $("#conflict-dlg").close(); S.conflict = null; loadAnalysis(g.doc, g.meta); toast("Ваши правки сохранены как копия — вы её автор"); }
  catch (err) { toast("Не удалось сохранить копию: " + err.message, 7000); }
});
$("#conflict-reload").addEventListener("click", async () => {
  if (!confirm("Открыть свежую версию? Ваши несохранённые правки в этой вкладке пропадут.")) return;
  try { const g = await history.get(S.a.id); $("#conflict-dlg").close(); S.conflict = null; loadAnalysis(g.doc, g.meta); toast("Открыта свежая версия"); }
  catch (err) { toast(err.message, 7000); }
});
$("#conflict-force").addEventListener("click", async () => {
  if (!confirm("Перезаписать версию коллеги своими правками? Его изменения будут потеряны.")) return;
  $("#conflict-dlg").close(); const c = S.conflict; S.conflict = null; S.aggDirty = S.aggDirty || Boolean(Object.keys(S.a.aggregates || {}).length && c?.code === "exists");
  if (S.baseVersion === null) S.baseVersion = c?.version ?? 0;
  if (await saveNow({ force: true })) toast("Сохранено поверх версии коллеги"); else toast("Не удалось сохранить", 6000);
});

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
      if (r.kind === "poe") { toast(addPoePart(r.data, r.meta), 5000); if (!S.a.niche) S.a.niche = r.data.meta.nicheTitle; if (!S.a.coreKeyword) S.a.coreKeyword = r.data.meta.nicheTitle; continue; } // POE не заменяется, а добавляется к объединению ниш
      S.a.aggregates[r.kind] = r.data; S.a.sources[r.kind] = r.meta; S.aggDirty = true;
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
// ---------- несколько ниш POE в одном анализе (spec 007) ----------
// aggregates.poe — всегда ОДИН объект, по которому идёт расчёт (одна ниша как есть или объединение); aggregates.poeParts хранит ниши по отдельности, только когда их больше одной.
function poeParts() { const g = S.a.aggregates; return g.poeParts?.length ? g.poeParts : g.poe && !g.poe.merged ? [g.poe] : []; }
function setPoeParts(parts, metas) {
  const g = S.a.aggregates;
  if (!parts.length) { delete g.poe; delete g.poeParts; S.a.sources.poe = null; }
  else { const poe = mergePoe(parts); g.poe = poe; if (parts.length > 1) g.poeParts = parts; else delete g.poeParts;
    const byKey = new Map(metas.map((m) => [m.key, m])); const w = new Map((poe.merged?.niches || []).map((n) => [n.key, n.weight]));
    const list = parts.map((p) => { const key = poePartKey(p), m = byKey.get(key) || {}; return { key, fileName: m.fileName || "", nicheTitle: p.meta?.nicheTitle || "", nicheId: p.meta?.nicheId || null, rows: p.asinMetrics.length, capturedAt: p.meta?.capturedAt || null, loadedAt: m.loadedAt || null, weight: w.get(key) ?? 1 }; });
    S.a.sources.poe = parts.length > 1 ? { fileName: `${parts.length} ниш(и) POE`, rows: poe.asinMetrics.length, nicheTitle: poe.meta.nicheTitle, capturedAt: poe.meta.capturedAt, parts: list } : { ...list[0], parts: undefined }; }
  S.aggDirty = true;
}
const poeMetas = () => (S.a.sources.poe?.parts?.length ? S.a.sources.poe.parts : S.a.sources.poe ? [{ ...S.a.sources.poe, key: poePartKey(S.a.aggregates.poe) }] : []);
function addPoePart(data, meta) {
  const before = poeParts(), metas = poeMetas(); const { parts, action } = upsertPoePart(before, data); const key = poePartKey(data);
  setPoeParts(parts, [...metas.filter((m) => m.key !== key), { ...meta, key }]);
  const title = data.meta.nicheTitle || meta.fileName;
  return action === "updated" ? `POE: ниша «${title}» обновлена (${data.asinMetrics.length} ASIN)` : parts.length > 1 ? `POE: добавлена ниша «${title}» — объединено ниш: ${parts.length}, товаров без дублей: ${S.a.aggregates.poe.asinMetrics.length}` : `POE: ${data.asinMetrics.length} ASIN из ${meta.fileName}`;
}
function removePoePart(key) { setPoeParts(poeParts().filter((p) => poePartKey(p) !== key), poeMetas().filter((m) => m.key !== key)); markDirty(); renderAll(); }
function removeSource(kind) { if (kind === "poe") delete S.a.aggregates.poeParts; delete S.a.aggregates[kind]; S.a.sources[kind] = null; S.aggDirty = true; if (kind === "cerebro") S.a.inputs.clusterKeywords = []; markDirty(); renderAll(); }

function renderFileList() {
  const el = $("#filelist"); const labels = { xray: "Xray", cerebro: "Cerebro", poe: "POE", sqp: "SQP" };
  const pc = (v) => Math.round(v * 100) + " %";
  const poeCards = (v) => v.parts.map((p) => `<div class="filecard"><span class="tag">POE</span><span class="muted">${esc(p.nicheTitle || p.fileName)} · ${p.rows} ASIN · ${pc(p.weight)} рынка${p.fileName ? ` · <small>${esc(p.fileName)}</small>` : ""}</span><button class="x" data-rm-poe="${esc(p.key)}" title="Убрать эту нишу из объединения">✕</button></div>`).join("") + `<div class="muted" style="font-size:.8rem;margin:-.1rem 0 .3rem">Ниши объединены в один рынок: ${v.rows} товаров без дублей. Ещё один POE-файл добавит нишу, файл той же ниши — обновит её.</div>`;
  el.innerHTML = Object.entries(S.a.sources || {}).filter(([, v]) => v).map(([k, v]) => k === "poe" && v.parts?.length > 1 ? poeCards(v) : `<div class="filecard"><span class="tag">${labels[k]}</span><span class="muted">${esc(v.fileName || "")} · ${v.rows ?? ""} ${k === "xray" ? "ASIN" : k === "cerebro" ? "ключей" : k === "poe" ? "ASIN" : "строк"}${v.duplicatesDropped ? ` · <b title="одинаковые ASIN учтены один раз">дублей удалено: ${v.duplicatesDropped}</b>` : ""}${v.nicheTitle ? " · " + esc(v.nicheTitle) : ""}</span><button class="x" data-rm="${k}" title="Убрать">✕</button></div>`).join("") || '<div class="muted" style="font-size:.85rem">Ничего не загружено</div>';
  $$("[data-rm]", el).forEach((b) => b.addEventListener("click", () => removeSource(b.dataset.rm)));
  $$("[data-rm-poe]", el).forEach((b) => b.addEventListener("click", () => removePoePart(b.dataset.rmPoe)));
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
  if (!S.a.results) renderAll();
  S.aiBusy = true; $("#btn-ai").disabled = true;
  const chosen = modelAi();
  if (S.a.ai) R().update(dash, S.a, renderOpts(), ["ai"]); // прежний результат затемняем, пока идёт новый
  const prog = $("#ai-progress"), status = $("#ai-status");
  if (prog) { prog.classList.remove("hidden"); prog.textContent = ""; } if (status) status.textContent = resumeJobId ? "продолжаю задачу после перезагрузки…" : `запрос… (${chosen || "модель по умолчанию"})`;
  try {
    const ai = await runAi(S.a, { model: chosen || undefined, resumeJobId,
      onMeta: (m) => { if (status) status.textContent = `модель ${m.model}…`; },
      onThinking: (t) => { if (prog) { prog.textContent += t; prog.scrollTop = prog.scrollHeight; } },
      onProgress: (n) => { if (status) status.textContent = `формирую ответ… ${n} симв.`; },
      onReconnect: (n) => { if (status) status.textContent = `связь прервалась — переподключаюсь (${n})… задача продолжается на сервере`; } });
    S.a.ai = ai; S.a.status = "ai_done"; S.dirty = true;
    R().update(dash, S.a, renderOpts(), ["hero", "ai"]);
    await persistJobResult("AI");
    toast(ai.adjustedByRules ? "AI-вердикт получен и скорректирован правилами" : "AI-вердикт получен");
  } catch (err) {
    console.error(err);
    if (err.code === "auth") goLogin();
    if (status) status.textContent = "ошибка: " + err.message; toast("AI: " + err.message, 7000);
  } finally { S.aiBusy = false; $("#btn-ai").disabled = false; R().update(dash, S.a, renderOpts(), ["ai"]); }
}

async function startPatentScan(resumeJobId = null) {
  if (S.patBusy) return;
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
      { resumeJobId, onStage: (d) => setStatus(d.text || d.stage), onReconnect: (n) => setStatus(`связь прервалась — переподключаюсь (${n})…`) });
    S.a.patents = scan; if (S.a.ai && !S.a.ai.staleSince) S.a.ai.staleSince = new Date().toISOString(); // AI-вердикт считался без этих данных
    renderAll(); await persistJobResult("Патентный скан");
    setStatus(`готово: ${{ conflict: "есть красные флаги", unsure: "требует проверки", clear: "явных пересечений нет" }[scan.status] || scan.status}`);
    toast("Патентный скан завершён — критерий 8 получил статус «допущение»");
    document.getElementById("sec-patents")?.scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (e) { console.error(e); if (e.code === "auth") goLogin(); setStatus("ошибка: " + e.message); toast("Патентный скан: " + e.message, 7000); }
  finally { S.patBusy = false; $("#btn-patents").disabled = false; R().update(dash, S.a, renderOpts(), ["patents"]); }
}

/** После загрузки анализа — продолжить незавершённые задачи (страница перезагружалась во время AI). */
function resumePendingJobs() {
  const hourAgo = Date.now() - 60 * 60 * 1000;
  const a = pendingJob.get(S.a.id, "analyze"); if (a?.jobId && a.startedAt > hourAgo) startAi(a.jobId); else if (a) pendingJob.clear(S.a.id, "analyze");
  const p = pendingJob.get(S.a.id, "patents"); if (p?.jobId && p.startedAt > hourAgo) startPatentScan(p.jobId); else if (p) pendingJob.clear(S.a.id, "patents");
}

// ---------- save / export / new ----------
$("#btn-save").addEventListener("click", async () => {
  if (!hasContent()) return toast("Нечего сохранять");
  recompute(); markDirty();
  if (await saveNow()) toast("Сохранено в общую историю");
});
$("#btn-json").addEventListener("click", () => { recompute(); exportAnalysisJson(S.a); });
$("#btn-html").addEventListener("click", async () => { recompute(); try { await exportStandaloneHtml(S.a); toast("HTML-дашборд скачан"); } catch (e) { toast("Ошибка экспорта: " + e.message); } });
/** Перед уходом с текущего анализа: дописать изменения; если не вышло — спросить. */
async function leaveCurrent(question) {
  if (!hasContent()) return true;
  if (await saveNow()) return true;
  return confirm(question);
}
$("#btn-new").addEventListener("click", async () => { if (!(await leaveCurrent("Текущий анализ не сохранён. Начать новый и потерять несохранённые изменения?"))) return; loadAnalysis(newAnalysis(), null); });

/** meta — сведения сервера ({version, createdBy, updatedBy, …}) или null для нового, ещё не сохранённого анализа. */
function loadAnalysis(doc, meta = null) {
  R().destroy(dash); S.a = migrate(doc); S.meta = meta; S.baseVersion = meta?.version ?? null; S.aggDirty = false; S.conflict = null; S.dirty = false;
  if (S.a.aggregates?.cerebro) reannotateCerebro();
  if (S.a.thresholds && Object.keys(S.a.thresholds).length) renderThresholds();
  renderAll(); showTab("analysis");
  // Подпись — после пересчёта: открытие анализа само по себе ничего не сохраняет и не меняет «кто изменил».
  S.sig = meta ? coreSignature(splitDoc(S.a).core) : ""; S.dirty = false;
  if (meta) localStorage.setItem("fba_last", S.a.id);
  setSaveState(meta ? "saved" : ""); renderDocMeta();
  resumePendingJobs();
}
async function importDoc(obj) {
  if (obj.type === "fba-launch-evaluator/analysis") {
    const d = migrate(obj.analysis); const r = await history.importOne(d);
    toast(r.imported ? `Импортирован анализ «${d.niche}» — вы его автор` : `«${d.niche}» уже есть в общей истории — открыта версия из истории`, 5000);
    const g = await history.get(d.id); loadAnalysis(g.doc, g.meta);
  } else if (obj.type === "fba-launch-evaluator/history") {
    const docs = (obj.analyses || []).map(migrate);
    const r = await history.importMany(docs, (i, n) => toast(`Импорт: ${i} из ${n}…`, 60000));
    toast(`Импорт: +${r.added} новых, ${r.skipped} уже были${r.failed ? `, ${r.failed} не удалось` : ""}`, 6000); updateHistCount(); renderHistory();
  } else throw new Error("Неизвестный формат файла");
}

// ---------- history tab ----------
async function updateHistCount() { try { const n = await history.count(); $("#hist-count").textContent = n ? `(${n})` : ""; } catch {} }
async function renderHistory() {
  const box = $("#histlist");
  let data;
  try { data = await history.list({ mine: $("#hist-mine").value === "1", q: $("#hist-search").value.trim() }); }
  catch (e) { box.innerHTML = `<div class="empty">Не удалось загрузить историю: ${esc(e.message)}</div>`; return; }
  const V = R().VLABEL; const t = (d) => new Date(d).toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "short" });
  box.innerHTML = data.items.map((h) => {
    const canDelete = h.createdBy.id === S.user.id || S.user.role === "admin";
    const who = h.updatedBy.id === h.createdBy.id ? `автор: <b>${esc(h.createdBy.name)}</b>` : `автор: <b>${esc(h.createdBy.name)}</b> · изменил: <b>${esc(h.updatedBy.name)}</b>`;
    return `<div class="histrow"><div><div class="t">${esc(h.niche || "Без названия")} ${h.verdict && V[h.verdict] ? `<span class="status ${h.verdict}">${V[h.verdict]}</span>` : ""}${h.aiDone ? ' <span class="chip">AI</span>' : ""}${h.patentsDone ? ' <span class="chip">патенты</span>' : ""}${h.shares ? ` <span class="chip ok" title="Активных публичных ссылок: ${h.shares}">ссылка</span>` : ""}${h.id === S.a.id ? ' <span class="chip">открыт</span>' : ""}</div>
    <div class="m who">${who} · ${esc(t(h.updatedAt))}</div>
    <div class="m">ключ: ${esc(h.coreKeyword || "—")} · Критерий 1: ${h.c1 ?? "—"}/8 · scorecard ${h.score != null ? Math.round(h.score) + " %" : "—"} · ${h.sources.join(", ") || "без файлов"}</div></div>
    <div class="b"><button data-open="${h.id}" class="primary">Открыть</button><button data-share="${h.id}" data-niche="${esc(h.niche || "")}">🔗 Поделиться</button><button data-json="${h.id}">JSON</button>${canDelete ? `<button data-del="${h.id}" class="danger">Удалить</button>` : ""}</div></div>`;
  }).join("") || `<div class="empty">${$("#hist-search").value || $("#hist-mine").value === "1" ? "Ничего не найдено." : "История пуста. Анализы сохраняются сюда автоматически и видны всей команде."}</div>`;
  if (data.total > data.items.length) box.insertAdjacentHTML("beforeend", `<div class="muted" style="padding:.5rem">Показаны последние ${data.items.length} из ${data.total} — уточните поиск.</div>`);
}
$("#histlist").addEventListener("click", async (e) => {
  const b = e.target.closest("button"); if (!b) return;
  try {
    if (b.dataset.open) {
      if (b.dataset.open === S.a.id) return showTab("analysis");
      if (!(await leaveCurrent("Текущий анализ не сохранён. Открыть другой и потерять несохранённые изменения?"))) return;
      const g = await history.get(b.dataset.open); loadAnalysis(g.doc, g.meta);
    } else if (b.dataset.share) { openShareDialog(b.dataset.share, b.dataset.niche); }
    else if (b.dataset.json) { exportAnalysisJson((await history.get(b.dataset.json)).doc); }
    else if (b.dataset.del) {
      if (!confirm("Удалить анализ из общей истории? Он пропадёт у всей команды, публичные ссылки на него перестанут работать.")) return;
      await history.delete(b.dataset.del);
      if (S.a.id === b.dataset.del) { localStorage.removeItem("fba_last"); loadAnalysis(newAnalysis(), null); showTab("history"); }
      renderHistory(); updateHistCount();
    }
  } catch (err) { toast(err.message, 7000); }
});
$("#hist-mine").addEventListener("change", renderHistory);
$("#hist-search").addEventListener("input", debounce(renderHistory, 300));
$("#hist-export").addEventListener("click", async () => { try { const all = await history.getAllFull((i, n) => toast(`Готовлю экспорт: ${i} из ${n}…`, 60000)); exportHistoryJson(all); toast(`Экспортировано анализов: ${all.length}`); } catch (e) { toast("Экспорт: " + e.message, 7000); } });
$("#hist-import").addEventListener("click", () => $("#hist-import-file").click());
$("#hist-import-file").addEventListener("change", async (e) => { const f = e.target.files[0]; if (!f) return; try { await importDoc(JSON.parse(await f.text())); } catch (err) { toast("Импорт: " + err.message, 6000); } e.target.value = ""; });

// ---------- settings tab ----------
const FREE_HINT = "Бесплатные :free модели: $0, но ответ 3–6 минут и слабее структура. Платные (Gemini 3.8 Flash ≈ $0.02, GPT-5.6 Sol / Claude Sonnet 5 ≈ $0.05, Opus 5 ≈ $0.10 за анализ) — после пополнения openrouter.ai/settings/credits.";
function renderSettings() {
  $("#set-provider").textContent = S.provider || "—";
  const fill = (id, cur) => { const el = $(id); el.innerHTML = S.models.map((m) => `<option value="${esc(m)}" ${m === cur ? "selected" : ""}>${esc(m)}${/^aistudio\//.test(m) ? " — бесплатно, Google AI Studio (быстро)" : /:free$/.test(m) ? " — бесплатно, OpenRouter (часто перегружено)" : ""}</option>`).join("") || '<option value="">(список моделей недоступен — сервер не отвечает)</option>'; };
  fill("#set-model-ai", modelAi()); fill("#set-model-patents", modelPatents());
  $("#set-model-hint").textContent = `AI-вердикт: ${modelAi() || "—"} · патентный скан: ${modelPatents() || "—"}. ${FREE_HINT}`;
  $("#set-login-state").textContent = S.user ? `Вы вошли как ${S.user.name} (логин ${S.user.login}, ${S.user.role === "admin" ? "администратор" : "пользователь"}).` : "";
  $("#pw-user").value = S.user?.login || "";
  api("GET", "/api/auth/me").then((me) => { const has = me.user.hasPassword !== false; $("#pw-form").classList.toggle("hidden", !has); if (!has) $("#set-login-state").textContent += " Вы входите через Google — пароля у учётной записи нет; при необходимости его задаст администратор."; }).catch(() => {});
  $("#set-users").classList.toggle("hidden", S.user?.role !== "admin");
  if (S.user?.role === "admin") renderUsers();
}
$("#set-logout").addEventListener("click", logout);
$("#pw-form").addEventListener("submit", async (e) => {
  e.preventDefault(); const msg = $("#pw-msg"); msg.textContent = "";
  try { await api("POST", "/api/auth/password", { current: $("#pw-current").value, next: $("#pw-next").value }); e.target.reset(); $("#pw-user").value = S.user.login; msg.textContent = "Пароль изменён, остальные сеансы закрыты."; toast("Пароль изменён"); }
  catch (err) { msg.textContent = err.message; }
});

// ---------- пользователи (только администратор) ----------
function genPassword(n = 14) {
  const abc = "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // без похожих символов l/1/I/O/0
  const buf = new Uint32Array(n); crypto.getRandomValues(buf);
  return Array.from(buf, (x) => abc[x % abc.length]).join("");
}
async function copyText(t) { try { await navigator.clipboard.writeText(t); toast("Скопировано"); } catch { window.prompt("Скопируйте вручную:", t); } }
async function renderUsers() {
  if (!$("#un-pass").value) $("#un-pass").value = genPassword();
  let list = [];
  try { list = await api("GET", "/api/users"); } catch (e) { $("#users-list").innerHTML = `<tr><td colspan="8" class="muted">Не удалось загрузить: ${esc(e.message)}</td></tr>`; return; }
  const fmt = (d) => (d ? new Date(d).toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "short" }) : "—");
  $("#users-list").innerHTML = list.map((u) => {
    const self = u.id === S.user.id; const lockedNow = u.lockedUntil && new Date(u.lockedUntil) > new Date();
    const status = !u.active ? '<span class="chip na">отключён</span>' : lockedNow ? '<span class="chip warn">заблокирован до ' + esc(fmt(u.lockedUntil)) + "</span>" : u.mustChangePassword ? '<span class="chip">временный пароль</span>' : '<span class="chip ok">активен</span>';
    const method = u.hasPassword && u.email ? "Google и пароль" : u.email ? (u.googleLinked ? "Google" : "Google · ещё не входил") : "пароль";
    return `<tr class="${u.active ? "" : "off"}"><td>${esc(u.name)}${self ? ' <span class="muted">(вы)</span>' : ""}</td><td>${u.email ? esc(u.email) + "<br>" : ""}<small class="muted">логин: <code>${esc(u.login)}</code></small></td><td>${esc(method)}</td><td>${u.role === "admin" ? "администратор" : "пользователь"}</td><td>${status}</td><td>${esc(fmt(u.lastLoginAt))}</td><td>${u.analyses ?? 0}</td>
      <td><div class="acts"><button data-uact="role" data-id="${u.id}" data-role="${u.role === "admin" ? "user" : "admin"}">${u.role === "admin" ? "Сделать пользователем" : "Сделать админом"}</button><button data-uact="email" data-id="${u.id}" data-email="${esc(u.email || "")}" data-name="${esc(u.name)}">Почта</button><button data-uact="reset" data-id="${u.id}" data-name="${esc(u.name)}">${u.hasPassword ? "Сбросить пароль" : "Задать пароль"}</button><button data-uact="toggle" data-id="${u.id}" data-active="${u.active ? "0" : "1"}" class="${u.active ? "danger" : ""}">${u.active ? "Отключить" : "Включить"}</button></div></td></tr>`;
  }).join("") || '<tr><td colspan="8" class="muted">Пользователей нет</td></tr>';
}
$("#users-list").addEventListener("click", async (e) => {
  const b = e.target.closest("[data-uact]"); if (!b) return;
  try {
    if (b.dataset.uact === "role") await api("PATCH", `/api/users/${b.dataset.id}`, { role: b.dataset.role });
    if (b.dataset.uact === "email") {
      const v = window.prompt(`Почта аккаунта Google для «${b.dataset.name}» (пусто — убрать вход через Google):`, b.dataset.email); if (v === null) return;
      await api("PATCH", `/api/users/${b.dataset.id}`, { email: v.trim() }); toast(v.trim() ? "Почта сохранена — человек может входить через Google" : "Почта убрана");
    }
    if (b.dataset.uact === "toggle") { if (b.dataset.active === "0" && !confirm("Отключить пользователя? Он потеряет доступ в течение минуты, его анализы останутся.")) return; await api("PATCH", `/api/users/${b.dataset.id}`, { active: b.dataset.active === "1" }); }
    if (b.dataset.uact === "reset") {
      if (!confirm(`Сбросить пароль пользователю «${b.dataset.name}»? Его текущие сеансы будут закрыты.`)) return;
      const pw = genPassword(); await api("POST", `/api/users/${b.dataset.id}/reset-password`, { password: pw });
      window.prompt("Новый временный пароль — передайте его пользователю (при входе он задаст свой):", pw);
    }
    renderUsers();
  } catch (err) { toast(err.message, 7000); }
});
$("#un-gen").addEventListener("click", () => { $("#un-pass").value = genPassword(); });
$("#un-copy").addEventListener("click", () => copyText(`Логин: ${$("#un-login").value.trim().toLowerCase()}\nВременный пароль: ${$("#un-pass").value}\n${location.origin}`));
function syncUserMode() {
  const google = $("#un-mode").value === "google";
  $$(".un-password-only").forEach((el) => el.classList.toggle("hidden", google)); $$(".un-google-only").forEach((el) => el.classList.toggle("hidden", !google));
  $("#un-email").required = google; $("#un-login").required = !google; $("#un-pass").required = !google; $("#un-name").required = !google;
  if (!google && !$("#un-pass").value) $("#un-pass").value = genPassword();
}
$("#un-mode").addEventListener("change", syncUserMode);
fetch("/api/health").then((r) => r.json()).then((h) => {
  if (!h.googleLogin) { $("#un-mode").value = "password"; $("#un-mode").querySelector('[value="google"]').disabled = true; $("#un-google-off").textContent = "Вход через Google на сервере не настроен (нет GOOGLE_OAUTH_CLIENT_ID / SECRET) — доступен только вход по паролю."; }
  syncUserMode();
}).catch(syncUserMode);
$("#user-new").addEventListener("submit", async (e) => {
  e.preventDefault(); const msg = $("#un-msg"); msg.textContent = ""; const google = $("#un-mode").value === "google";
  try {
    const body = { name: $("#un-name").value.trim(), role: $("#un-role").value, email: $("#un-email").value.trim() };
    if (!google) { body.login = $("#un-login").value; body.password = $("#un-pass").value; }
    const r = await api("POST", "/api/users", body);
    if (google) { msg.textContent = `Добавлен ${r.user.email}. Человеку достаточно открыть сайт и нажать «Войти через Google».`; await copyText(`${location.origin}\nВход: кнопка «Войти через Google», аккаунт ${r.user.email}`); }
    else { msg.textContent = `Добавлен ${r.user.name} (${r.user.login}). Передайте ему логин и временный пароль.`; await copyText(`Логин: ${r.user.login}\nВременный пароль: ${$("#un-pass").value}\n${location.origin}`); }
    $("#un-name").value = ""; $("#un-login").value = ""; $("#un-email").value = ""; $("#un-pass").value = google ? "" : genPassword(); renderUsers();
  } catch (err) { msg.textContent = err.message; }
});

$("#set-theme").addEventListener("click", () => $("#theme-toggle").click());
$("#set-side").addEventListener("click", () => { const c = $("#tab-analysis").classList.contains("side-collapsed"); setSide(!c); showTab("analysis"); });

// ---------- «Поделиться»: публичные ссылки на снимок дашборда ----------
const shareUrl = (sh) => location.origin + sh.path;
const SHARE_STATE = { active: ["ok", "активна"], expired: ["na", "срок истёк"], revoked: ["na", "отозвана"] };
function shareItemHtml(sh, { withNiche = false } = {}) {
  const t = (d) => (d ? new Date(d).toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "short" }) : "—");
  const st = SHARE_STATE[sh.state] || SHARE_STATE.revoked; const active = sh.state === "active";
  return `<div class="shareitem ${active ? "" : "off"}" data-share-id="${sh.id}">
    <div>${withNiche ? `<b>${esc(sh.niche || "Без названия")}</b> · ` : ""}<span class="chip ${st[0]}">${st[1]}</span> <span class="chip">${sh.mode === "no_economics" ? "без закупочной экономики" : "весь дашборд"}</span>${active && sh.stale ? ' <span class="chip warn" title="Анализ менялся после создания снимка — получатель видит прежнюю версию">анализ изменён после снимка</span>' : ""}</div>
    ${active ? `<div class="url">${esc(shareUrl(sh))}</div>` : ""}
    <div class="muted">создал(а) ${esc(sh.createdBy.name)} ${esc(t(sh.createdAt))} · снимок от ${esc(t(sh.snapshotAt))} · ${sh.expiresAt ? "действует до " + esc(t(sh.expiresAt)) : "без срока"} · просмотров: <b>${sh.views}</b>${sh.lastViewedAt ? ", последний " + esc(t(sh.lastViewedAt)) : ""}</div>
    ${active ? `<div class="acts"><button data-sact="copy">Копировать</button><button data-sact="open">Открыть</button><button data-sact="refresh" class="${sh.stale ? "primary" : ""}" title="Заменить снимок текущим состоянием анализа, адрес останется прежним">Обновить ссылку</button><button data-sact="revoke" class="danger">Отозвать</button></div>` : ""}</div>`;
}
const shareDlg = { analysisId: null, items: [] };
async function loadShareList() {
  const box = $("#share-list");
  try { shareDlg.items = await api("GET", `/api/analyses/${encodeURIComponent(shareDlg.analysisId)}/shares`); box.innerHTML = shareDlg.items.map((sh) => shareItemHtml(sh)).join("") || '<div class="muted">Ссылок пока нет.</div>'; }
  catch (e) { box.innerHTML = `<div class="muted">Не удалось загрузить ссылки: ${esc(e.message)}</div>`; }
}
async function openShareDialog(analysisId, niche) {
  if (analysisId === S.a.id && hasContent() && !(await saveNow())) return toast("Сначала сохраните анализ — ссылка строится из сохранённой версии", 6000);
  shareDlg.analysisId = analysisId; $("#share-niche").textContent = niche ? `· ${niche}` : ""; $("#share-msg").textContent = ""; $("#share-list").innerHTML = '<div class="muted">Загружаю…</div>';
  const d = $("#share-dlg"); if (!d.open) d.showModal();
  loadShareList();
}
$("#btn-share").addEventListener("click", async () => {
  if (!hasContent()) return toast("Нечем делиться — загрузите файлы или заполните данные");
  recompute(); if (!(await saveNow())) return toast("Анализ не сохранён — ссылка строится из сохранённой версии", 6000);
  openShareDialog(S.a.id, S.a.niche);
});
$("#share-close").addEventListener("click", () => $("#share-dlg").close());
$("#share-form").addEventListener("submit", async (e) => {
  e.preventDefault(); const btn = $("#share-create"), msg = $("#share-msg"); btn.disabled = true; msg.textContent = "создаю…";
  try {
    const exp = $("#share-expiry").value;
    const { share } = await api("POST", `/api/analyses/${encodeURIComponent(shareDlg.analysisId)}/shares`, { mode: $("#share-mode").value, expiresInDays: exp === "null" ? null : Number(exp) });
    let copied = true; try { await navigator.clipboard.writeText(shareUrl(share)); } catch { copied = false; }
    msg.textContent = copied ? "Ссылка создана и скопирована в буфер обмена." : "Ссылка создана — скопируйте её из списка ниже.";
    await loadShareList(); if (!$("#tab-history").classList.contains("hidden")) renderHistory();
  } catch (err) { msg.textContent = err.message; }
  finally { btn.disabled = false; }
});
async function shareAction(e, reload) {
  const b = e.target.closest("[data-sact]"); if (!b) return;
  const id = b.closest("[data-share-id]").dataset.shareId; const sh = [...shareDlg.items, ...(shareAction.all || [])].find((x) => x.id === id); if (!sh) return;
  try {
    if (b.dataset.sact === "copy") return copyText(shareUrl(sh));
    if (b.dataset.sact === "open") return void window.open(shareUrl(sh), "_blank", "noopener");
    if (b.dataset.sact === "refresh") {
      if (sh.analysisId === S.a.id && !(await saveNow())) return toast("Анализ не сохранён — обновлять нечем", 6000);
      if (!confirm("Заменить снимок текущим состоянием анализа? Получатели по этой же ссылке увидят новую версию.")) return;
      await api("POST", `/api/shares/${id}/refresh`); toast("Снимок обновлён, адрес прежний");
    }
    if (b.dataset.sact === "revoke") { if (!confirm("Отозвать ссылку? Она сразу перестанет открываться у всех, кому вы её отправили.")) return; await api("DELETE", `/api/shares/${id}`); toast("Ссылка отозвана"); }
    await reload(); if (!$("#tab-history").classList.contains("hidden")) renderHistory();
  } catch (err) { toast(err.message, 7000); }
}
$("#share-list").addEventListener("click", (e) => shareAction(e, loadShareList));
async function loadAllShares() {
  const box = $("#set-shares-list");
  try { shareAction.all = await api("GET", "/api/shares"); box.innerHTML = shareAction.all.map((sh) => shareItemHtml(sh, { withNiche: true })).join("") || '<div class="muted">Ссылок нет.</div>'; }
  catch (e) { box.innerHTML = `<div class="muted">${esc(e.message)}</div>`; }
}
$("#set-shares-load").addEventListener("click", loadAllShares);
$("#set-shares-list").addEventListener("click", (e) => shareAction(e, loadAllShares));

// ---------- подсказка CVR из SQP ----------
function renderCvrHint() {
  const box = $("#cvr-hint"); if (!box) return; const h = S.a.results?.cvrHint;
  const pc = (v) => (v * 100).toFixed(1).replace(".", ",") + " %"; const cur = S.a.inputs.cvr; const be = S.a.results?.economics?.breakEvenCvr;
  const beLine = typeof be === "number" && be > 0 ? `<br>Безубыточный CVR для вашей экономики: <b>${pc(be)}</b> — ниже него реклама съедает всю прибыль с единицы.` : "";
  if (!h) {
    // Данных о конверсии клика нет ни в одном файле — говорим об этом прямо, а не оставляем пустое место.
    box.innerHTML = `<b>${pc(cur)} — допущение, не данные.</b> Подсказка появится после загрузки <b>POE</b> (конверсия клика ниши — есть для любой ниши) или <b>SQP</b> из Brand Analytics (только если вы уже продаёте по этим запросам).${beLine}`;
    box.classList.remove("hidden"); return;
  }
  const btn = (x) => `<button type="button" data-cvr-set="${x.cvr}" style="padding:.1rem .45rem;font-size:.75rem">подставить</button>`;
  const lines = [];
  if (h.niche) lines.push(`<b>POE, конверсия клика ниши: ${pc(h.niche.cvr)}</b> <span title="${h.niche.purchases.toLocaleString("ru-RU")} покупок на ${h.niche.clicks.toLocaleString("ru-RU")} кликов по товарам ниши за 360 дней; запросов в расчёте: ${h.niche.queries} из ${h.niche.queriesTotal}">(${h.niche.clicks.toLocaleString("ru-RU")} кликов${h.niche.smallSample ? ", мало данных" : ""})</span> ${btn(h.niche)}<br><span class="muted">Это средняя по зрелым листингам ниши — у нового листинга без отзывов обычно ниже. Для сравнения: покупкой заканчиваются ${pc(h.niche.searchConv)} поисков, но реклама платится за клик, а не за поиск.</span>`);
  const sq = [h.market ? `рынок <b>${pc(h.market.cvr)}</b> (${h.market.clicks.toLocaleString("ru-RU")} кликов${h.market.smallSample ? ", мало данных" : ""}) ${btn(h.market)}` : "", h.mine ? `ваш ASIN <b>${pc(h.mine.cvr)}</b> (${h.mine.clicks.toLocaleString("ru-RU")} кликов${h.mine.smallSample ? ", мало данных" : ""}) ${btn(h.mine)}` : ""].filter(Boolean);
  if (sq.length) lines.push(`SQP, клик → покупка ${esc(h.scopeLabel)}: ${sq.join(" · ")}`);
  const notes = [];
  if (h.aboveRealistic) notes.push("выше 15 % — для нового листинга без отзывов это оптимистично");
  if (Math.abs(cur - h.suggested) / h.suggested > 0.25) notes.push(`сейчас в расчёте ${pc(cur)} — ${cur > h.suggested ? "оптимистичнее" : "осторожнее"} данных`);
  box.innerHTML = lines.join("<br>") + (notes.length ? `<br><span style="color:var(--warn)">${esc(notes.join("; "))}</span>` : "") + beLine;
  box.classList.remove("hidden");
}
$("#cvr-hint").addEventListener("click", (e) => {
  const b = e.target.closest("[data-cvr-set]"); if (!b) return;
  const v = Math.min(0.30, Math.max(0.03, Math.round(Number(b.dataset.cvrSet) * 200) / 200)); // шаг ползунка 0,5 %
  S.a.inputs.cvr = v; markDirty(); renderAll(); toast(`CVR = ${(v * 100).toFixed(1).replace(".", ",")} % — из SQP`);
});

// ---------- ценовой диапазон анализа (spec 003) ----------
function setBand(min, max) {
  S.a.inputs.priceMin = min; S.a.inputs.priceMax = max;
  $("#f-pmin").value = min ?? ""; $("#f-pmax").value = max ?? "";
  markDirty(); renderAll();
}
function renderBandPanel() {
  const pb = S.a.results?.priceBand; const stats = $("#band-stats"); if (!stats) return;
  const invalid = pb && pb.valid === false;
  $("#f-pmin").classList.toggle("invalid", Boolean(invalid)); $("#f-pmax").classList.toggle("invalid", Boolean(invalid));
  $("#band-badge").classList.toggle("hidden", !pb?.active); if (pb?.active) $("#band-badge").textContent = pb.label;
  const segs = S.a.results?.priceSegments?.segments || [];
  $("#band-segments").innerHTML = segs.map((sg) => `<button type="button" class="${sg.selected ? "on" : ""}" data-band-min="${sg.min}" data-band-max="${sg.max}" title="Доля товаров ${Math.round(sg.itemsShare * 100)} %, доля ${S.a.results.priceSegments.weightLabel === "revenue" ? "выручки" : "кликов"} ${Math.round(sg.weightShare * 100)} %">${esc(sg.name)} $${Math.round(sg.min)}–${Math.round(sg.max)}</button>`).join("");
  if (invalid) stats.innerHTML = `<span style="color:var(--fail)">${esc(pb.error)}</span>`;
  else if (pb?.active) {
    const share = typeof pb.revenueShare === "number" ? `, ${Math.round(pb.revenueShare * 100)} % ${pb.weightLabel === "revenue" ? "выручки ниши" : "кликов ниши"}` : "";
    const warn = pb.sample === "insufficient" ? " — слишком мало: конкурентные показатели не считаются" : pb.sample === "small" ? " — малая выборка, доли ненадёжны" : "";
    stats.innerHTML = `В диапазоне <b>${pb.inCount} из ${pb.totalCount}</b> листингов${share}${pb.noPrice ? `; без цены — ${pb.noPrice}` : ""}<span style="color:var(--warn)">${warn}</span>${pb.myPriceOutside ? '<br><span style="color:var(--warn)">Цена вашего товара вне диапазона.</span>' : ""}`;
  } else stats.textContent = pb?.source ? `Диапазон не задан — анализ по всем ${pb.totalCount} листингам.` : "Загрузите Xray или POE — появятся сегменты цен.";
}
function pickBandFrom(el) { const b = el.closest("[data-band-min]"); if (!b) return false; setBand(Number(b.dataset.bandMin), Number(b.dataset.bandMax)); toast(`Анализ конкурентов сужен до $${Math.round(Number(b.dataset.bandMin))}–${Math.round(Number(b.dataset.bandMax))}`); return true; }
$("#band-segments").addEventListener("click", (e) => { pickBandFrom(e.target); });
dash.addEventListener("click", (e) => { if (e.target.closest(".seg-pick")) pickBandFrom(e.target); });
$("#band-reset").addEventListener("click", () => { if (S.a.inputs.priceMin === null && S.a.inputs.priceMax === null) return; setBand(null, null); toast("Диапазон сброшен — анализ по всей нише"); });

// ---------- перенос локальной истории браузера в общую (одноразово, идемпотентно) ----------
async function migrateLocalHistory(msgEl) {
  const say = (t) => { if (msgEl) msgEl.textContent = t; };
  const docs = (await localHistory.readAll()).filter((d) => d && d.id);
  if (!docs.length) { say("В этом браузере локальной истории нет."); localStorage.setItem("fba_migrated", "1"); return null; }
  const prepared = []; for (const d of docs) { try { prepared.push(migrate(d)); } catch (e) { console.warn("migrate", d.id, e); } }
  const r = await history.importMany(prepared, (i, n) => say(`Переношу: ${i} из ${n}…`));
  if (!r.failed) localStorage.setItem("fba_migrated", "1");
  say(`Перенесено: +${r.added} новых, ${r.skipped} уже были в общей истории${r.failed ? `, ${r.failed} не удалось — повторите` : ""}.`);
  updateHistCount(); if (!$("#tab-history").classList.contains("hidden")) renderHistory();
  return r;
}
async function offerLocalMigration() {
  if (localStorage.getItem("fba_migrated")) return;
  const docs = await localHistory.readAll();
  if (!docs.length) { localStorage.setItem("fba_migrated", "1"); return; }
  const bar = $("#migrate-bar");
  bar.innerHTML = `В этом браузере осталось анализов из прежней версии: <b>${docs.length}</b>. Перенести их в общую историю? Вы станете их автором, дубли не появятся. <button id="migrate-go" class="primary">Перенести</button> <button id="migrate-skip">Не сейчас</button> <span id="migrate-msg"></span>`;
  bar.classList.remove("hidden");
  toast(`В браузере есть локальная история (${docs.length}) — перенос во вкладке «История»`, 7000);
  $("#migrate-skip").addEventListener("click", () => bar.classList.add("hidden"));
  $("#migrate-go").addEventListener("click", async (e) => {
    e.target.disabled = true; const r = await migrateLocalHistory($("#migrate-msg")); e.target.disabled = false;
    if (r && !r.failed) { $("#migrate-go").remove(); $("#migrate-skip").textContent = "Закрыть"; await openLastIfEmpty(); }
  });
}
async function openLastIfEmpty() {
  if (hasContent()) return; const last = localStorage.getItem("fba_last"); if (!last) return;
  try { const g = await history.get(last); loadAnalysis(g.doc, g.meta); showTab("history"); } catch {}
}
$("#set-migrate").addEventListener("click", async (e) => { e.target.disabled = true; try { await migrateLocalHistory($("#set-migrate-msg")); } catch (err) { $("#set-migrate-msg").textContent = err.message; } e.target.disabled = false; });

// ---------- thresholds tab ----------
const THR_NAMES = { criterion1: "Критерий 1 — рыночный контекст", economics: "Экономика (Gate 1 / Gate 2 / Критерий 2)", budget: "Бюджет", traffic: "Трафик по ключам и Cerebro", poe: "POE / концентрация", challenger: "Критерии 3–8 против доминирующего игрока", reviewsMoat: "Ров отзывов лидера", scorecard: "Scorecard", reconciliation: "Сверка источников", checklist: "Чеклист рисков", priceBand: "Ценовой диапазон анализа", entry: "Вход в нишу: трафик и новички (пороги предварительные)", cashflow: "Деньги по месяцам и отзывы", borderline: "Пограничные значения" };
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
  "budget.receivingDays": ["Приёмка Amazon", "дней (добавляется к сроку партии)"], "budget.batches": ["Партий в бюджете", "шт (по умолчанию две)"],
  "traffic.top2ShareMax": ["Доля топ-2 ключей, НЕ OK выше", "доля"], "traffic.relevantMin": ["Релевантных ключей, минимум", "шт"], "traffic.minSv": ["Значимый ключ — SV от", "запросов/мес"], "traffic.groupsMin": ["Групп ключей, минимум", "шт"],
  "traffic.minCompetitors": ["Cerebro multi-ASIN — конкурентов в топе от", "шт (фраза релевантна)"], "traffic.clusterLimit": ["Авто-кластер — максимум фраз", "шт"],
  "poe.searchConvLow": ["Конверсия поиска — «спрос не удовлетворён» ниже", "доля"], "poe.sponsoredHigh": ["Спонсорских товаров — «рекламная война» выше", "доля"], "poe.top20ProductsHigh": ["Топ-20 продуктов click share — концентрация выше", "доля"],
  "challenger.activateTopBrand": ["Доминирующий бренд — доля от", "доля (включает критерии 3–8)"], "challenger.passCount": ["Минимум зелёных из 8", "шт"],
  "challenger.loyaltyOk": ["3 — лояльность к бренду OK ниже", "доля"], "challenger.loyaltyFail": ["3 — НЕ OK выше", "доля"],
  "challenger.leaderRatingSafe": ["4 — лидер неуязвим при рейтинге выше", "★"], "challenger.complaintMinPct": ["4 — системная жалоба от", "% упоминаний"],
  "challenger.playersMin": ["5a — брендов с заметной долей, минимум", "шт"], "challenger.playerShareMin": ["5a — заметная доля бренда от", "доля"], "challenger.top5Ok": ["5b — топ-5 OK ниже", "доля"], "challenger.top5Fail": ["5b — НЕ OK выше", "доля"],
  "reviewsMoat.breakable": ["Ров пробиваем, отзывов лидера меньше", "шт"], "reviewsMoat.medium": ["Средний барьер до", "шт (выше — непробиваем)"],
  "reconciliation.noise": ["Расхождение источников — шум до", "доля"], "reconciliation.borderline": ["Погранично до", "доля (выше — конфликт)"],
  "priceBand.smallSample": ["Малая выборка — листингов в диапазоне меньше", "шт (предупреждение: доли брендов ненадёжны)"], "priceBand.minSample": ["Недостаточная выборка — листингов меньше", "шт (конкурентные показатели диапазона не считаются)"],
  "entry.minOverlap": ["Продажи на 1 % кликов — общих товаров Xray и POE, минимум", "шт"], "entry.cohortMinAgeMonths": ["Новичок — возраст листинга от", "мес"], "entry.cohortMaxAgeMonths": ["Новичок — возраст листинга до", "мес"],
  "entry.minCohort": ["Когорта новичков — минимум товаров для ориентиров", "шт"], "entry.inheritedReviewRate": ["Унаследованные отзывы — больше чем продажи × возраст ×", "доля (плюс 50 отзывов запаса)"],
  "entry.reachOkPct": ["Достижимо — нужная доля кликов не выше перцентиля новичков", "перцентиль, 0–100"], "entry.reachWarnPct": ["На пределе — не выше перцентиля новичков", "перцентиль, 0–100"], "entry.reachOkProducts": ["Без когорты: достижимо, если такая доля есть у товаров, минимум", "шт"],
  "entry.dateGapDays": ["Расхождение дат Xray и POE — показывать от", "дней"], "entry.clickPriceGap": ["Цена по кликам — подсвечивать расхождение от", "доля"],
  "cashflow.horizonMonths": ["Горизонт сценария по умолчанию", "месяцев продаж"], "cashflow.rampMonths": ["Разгон до цели по умолчанию", "мес"], "cashflow.reviewRate": ["Покупателей с отзывом по умолчанию", "доля (допущение)"],
  "cashflow.vineReviews": ["Отзывов по программе Vine по умолчанию", "шт"], "cashflow.newListingCvrFactor": ["Конверсия до планки отзывов — множитель", "доля от заданного CVR"],
  "borderline.pct": ["Пограничное значение — ближе к порогу чем", "доля"],
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
  const startTab = wantedTab(); // до загрузки анализа: она сама переключает на «Анализ»
  try { R().initTips(); R().annotateInputs($(".side")); } catch (e) { console.warn("tips", e); } // подсказки у полей панели (spec 006)
  $("#help-ver").textContent = METHODOLOGY_VERSION;
  try { const h = await fetch("/api/health").then((r) => r.json()); S.models = Array.isArray(h.models) ? h.models : []; S.provider = h.provider; } catch {}
  if (!window.Chart) toast("Chart.js не загрузился — графики не будут отрисованы. Проверьте блокировщик скриптов.", 10000);

  try { await initUser(); } catch { return; } // без сеанса api() уже увёл на страницу входа
  updateHistCount();
  const last = localStorage.getItem("fba_last");
  let opened = false;
  if (last) { try { const g = await history.get(last); loadAnalysis(g.doc, g.meta); opened = true; } catch (e) { if (e.status === 404 && localStorage.getItem("fba_migrated")) localStorage.removeItem("fba_last"); } } // до переноса локальной истории анализ может быть ещё только в браузере
  if (!opened) { renderAll(); resumePendingJobs(); }
  showTab(startTab);
  offerLocalMigration().catch((e) => console.warn("migration offer", e));
})();
