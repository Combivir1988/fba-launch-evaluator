// Публичная страница отчёта (spec 002, US3): снимок дашборда только для чтения, без учётной записи.
// Страница обращается только к /api/public/shares/:token и к статике; никаких полей ввода и запусков задач.
import { buildStandaloneHtml, download } from "/js/export.js";
import { slug, fileStamp } from "/shared/analysis.js";

const $ = (s) => document.querySelector(s);
const token = (location.pathname.match(/^\/s\/([^/]+)\/?$/) || [])[1] || "";
const dash = $("#dashboard");
let snapshot = null;

const saved = (() => { try { return localStorage.getItem("fba_theme"); } catch { return null; } })();
if (saved) document.documentElement.setAttribute("data-theme", saved);
const curTheme = () => document.documentElement.getAttribute("data-theme") || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
const renderOpts = () => ({ static: true, hidden: snapshot.hidden || [], snapshot: { preparedBy: snapshot.preparedBy, snapshotAt: snapshot.snapshotAt, mode: snapshot.mode } });
function draw() { window.FBARender.destroy(dash); window.FBARender.render(dash, snapshot.analysis, renderOpts()); }

$("#theme-toggle").addEventListener("click", () => {
  const next = curTheme() === "dark" ? "light" : "dark"; document.documentElement.setAttribute("data-theme", next);
  try { localStorage.setItem("fba_theme", next); } catch {}
  if (snapshot) draw();
});

function unavailable(text) {
  dash.classList.add("hidden"); const box = $("#share-unavailable"); box.classList.remove("hidden");
  if (text) box.querySelector("p").textContent = text;
  document.title = "Ссылка недействительна · FBA Launch Evaluator";
}

$("#share-download").addEventListener("click", async () => {
  try { const html = await buildStandaloneHtml(snapshot.analysis, renderOpts()); download(`FBA_${slug(snapshot.analysis.niche)}_${fileStamp(new Date(snapshot.snapshotAt))}.html`, html, "text/html"); }
  catch (e) { const t = $("#toast"); t.textContent = "Не удалось собрать файл: " + e.message; t.classList.remove("hidden"); setTimeout(() => t.classList.add("hidden"), 5000); }
});

(async function init() {
  if (!token) return unavailable();
  let res;
  try { res = await fetch("/api/public/shares/" + encodeURIComponent(token), { credentials: "same-origin", headers: { Accept: "application/json" } }); }
  catch { return unavailable("Не удалось связаться с сервером. Проверьте соединение и обновите страницу."); }
  if (res.status === 429) return unavailable("Слишком много обращений с вашего адреса. Повторите через несколько минут.");
  if (!res.ok) return unavailable();
  try { snapshot = (await res.json()).snapshot; } catch { return unavailable(); }
  if (!snapshot?.analysis?.results) return unavailable();
  document.title = `${snapshot.analysis.niche || "Отчёт по нише"} · FBA Launch Evaluator`;
  if (!window.Chart) console.warn("Chart.js не загрузился — графики не будут отрисованы");
  draw();
  $("#share-download").classList.remove("hidden");
})();
