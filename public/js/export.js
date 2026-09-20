// Экспорт: JSON анализа/истории и автономный HTML (inline CSS + Chart.js + render.js + данные).
import { slug, fileStamp } from "/shared/analysis.js";

export function download(name, content, type = "application/json") {
  const blob = content instanceof Blob ? content : new Blob([content], { type });
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}

export function exportAnalysisJson(analysis) {
  download(`FBA_${slug(analysis.niche)}_${fileStamp()}.json`, JSON.stringify({ type: "fba-launch-evaluator/analysis", schemaVersion: analysis.schemaVersion, exportedAt: new Date().toISOString(), analysis }, null, 1));
}
export function exportHistoryJson(analyses) {
  download(`FBA_history_${fileStamp()}.json`, JSON.stringify({ type: "fba-launch-evaluator/history", schemaVersion: 1, exportedAt: new Date().toISOString(), analyses }));
}

let cache = null;
async function assets() {
  if (cache) return cache;
  const [css, chart, render] = await Promise.all(["/css/app.css", "/vendor/chart.umd.js", "/js/render.js"].map((u) => fetch(u).then((r) => r.text())));
  cache = { css, chart, render };
  return cache;
}
const safeJson = (o) => JSON.stringify(o).replace(/<\/script/gi, "<\\/script").replace(/<!--/g, "<\\!--");

/** Автономный HTML-дашборд (CSS, Chart.js, рендерер и данные — внутри файла). opts передаются рендереру (hidden, snapshot). */
export async function buildStandaloneHtml(analysis, opts = {}) {
  const { css, chart, render } = await assets();
  const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
  if (analysis?.aggregates?.poeParts) { const { poeParts, ...rest } = analysis.aggregates; analysis = { ...analysis, aggregates: rest }; } // ниши по отдельности в HTML не нужны
  const ropts = { ...opts, static: true };
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex,nofollow">
<title>FBA · ${esc(analysis.niche || "анализ")} · ${fileStamp()}</title><style>${css}</style></head>
<body><header class="topbar"><div class="brand">📦 FBA Launch Evaluator — автономный дашборд</div><nav></nav><button id="theme-toggle" aria-label="Переключить тему">◐</button></header>
<main class="layout" style="grid-template-columns:1fr"><section class="main" id="dashboard"></section></main>
<script>${chart}</script><script>${render}</script>
<script id="fba-data" type="application/json">${safeJson(analysis)}</script>
<script id="fba-opts" type="application/json">${safeJson(ropts)}</script>
<script>(function(){var d=JSON.parse(document.getElementById("fba-data").textContent);var o=JSON.parse(document.getElementById("fba-opts").textContent);var el=document.getElementById("dashboard");
var t=document.getElementById("theme-toggle");function cur(){return document.documentElement.getAttribute("data-theme")||(matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light")}
t.addEventListener("click",function(){document.documentElement.setAttribute("data-theme",cur()==="dark"?"light":"dark");FBARender.render(el,d,o)});
FBARender.render(el,d,o);})();</script></body></html>`;
}

export async function exportStandaloneHtml(analysis) {
  download(`FBA_${slug(analysis.niche)}_${fileStamp()}.html`, await buildStandaloneHtml(analysis), "text/html");
}
