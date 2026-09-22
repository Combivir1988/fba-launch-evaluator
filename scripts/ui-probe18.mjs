// Подсказки графиков (spec 010): наведение на столбец / сектор / линию показывает подсказку Chart.js со значением и подвалом «Что это…»;
// значок «?» у каждого графика объясняет, что на нём. Проверяется в реальном браузере, а не по конфигу.
import { chromium } from "playwright";
import { startServer, loginContext } from "./probe-helper.mjs";

const XRAY = "tests/fixtures/Helium_10_Xray_2026-08-21.csv", POE = "tests/fixtures/POE_urinal_screen_deodorizer_2026-09-15.json";
const { srv, base } = await startServer(3998); const browser = await chromium.launch(); const logs = [];
const ok = (c, l) => { console.log((c ? "✔ " : "✖ ") + l + (logs.length ? `  [ошибок: ${logs.length}]` : "")); if (!c) process.exitCode = 1; };
try {
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 1000 } }); const page = await ctx.newPage();
  page.on("pageerror", (e) => { logs.push("pageerror: " + e.message); console.log("  [pageerror]", String(e.stack || e.message).split("\n").slice(0, 5).join(" ⏎ ").slice(0, 600)); });
  page.on("console", (m) => { if (m.text().startsWith("BAD ANIM")) console.log("  [" + m.text().slice(0, 300) + "]"); });
  await loginContext(ctx, base); await page.goto(base + "/", { waitUntil: "networkidle" });
  if (process.env.PROBE_DIAG) await page.evaluate(() => { const T = Chart.Animation.prototype.tick; Chart.Animation.prototype.tick = function (t) { if (typeof this._fn !== "function") { console.log("BAD ANIM prop=" + this._prop + " from=" + JSON.stringify(this._from) + " to=" + JSON.stringify(this._to) + " target=" + (this._target && this._target.constructor && this._target.constructor.name)); this._active = false; return; } return T.call(this, t); }; });
  await page.fill("#f-niche", "bike inner tube"); await page.fill("#f-core", "bike tube"); await page.setInputFiles("#file-input", [XRAY, POE]);
  await page.waitForFunction(() => document.querySelectorAll(".filecard").length >= 2 && document.querySelector("#ch-brands"), null, { timeout: 20000 });
  await page.waitForTimeout(600);
  /** Навести на график: в центр самого большого элемента первого набора данных. → { active, title, body, footer } */
  const hover = async (id) => {
    const pos = await page.evaluate((id) => { const c = document.getElementById(id); const ch = Chart.getChart(c); if (!ch) return null; const meta = ch.getDatasetMeta(0); const el = meta.data.find((d) => d && Number.isFinite(d.x)); const r = c.getBoundingClientRect(); const p = el.tooltipPosition ? el.tooltipPosition() : { x: el.x, y: el.y }; return { x: r.left + p.x, y: r.top + p.y }; }, id);
    if (!pos) return null;
    await page.mouse.move(pos.x, pos.y); await page.waitForTimeout(150); await page.mouse.move(pos.x + 1, pos.y); await page.waitForTimeout(600);
    return page.evaluate((id) => { const ch = Chart.getChart(document.getElementById(id)); const t = ch.tooltip; return { active: t.getActiveElements().length > 0 || (t.body || []).length > 0, opacity: t.opacity, title: (t.title || []).join(" "), body: (t.body || []).flatMap((b) => b.lines).join(" | "), footer: (t.footer || []).join(" ") }; }, id);
  };
  for (const [id, want] of [["ch-brands", /%/], ["ch-price", /%/], ["ch-kw", /запросов/], ["ch-sv", /\d/], ["ch-radar", /из 10/], ["ch-rev", /%/]]) {
    await page.evaluate((id) => document.getElementById(id)?.scrollIntoView({ block: "center" }), id); await page.waitForTimeout(250);
    const t = await hover(id);
    ok(t && t.active && t.opacity === 1 && want.test(t.body) && /^Что это:/.test(t.footer), `${id}: подсказка нарисована (opacity ${t?.opacity}) — ${t ? `${t.title ? t.title + " · " : ""}${t.body} · ${t.footer.slice(0, 50)}…` : "графика нет"}`);
  }
  // кольцевая диаграмма этапа 2: подсказка при наведении в центр (не на дугу)
  await page.evaluate(() => document.querySelector('#sec-hero [data-goto]').click()); await page.waitForTimeout(400);
  await page.evaluate(() => document.querySelector('#sec-config [data-action="config-schema"]').click());
  await page.waitForFunction(() => /Схема полей \(\d+\)/.test(document.querySelector("#sec-config")?.textContent || ""), null, { timeout: 30000 });
  page.on("dialog", (d) => d.accept()); await page.waitForFunction(() => { const b = document.querySelector('#sec-config [data-action="config-extract"]'); return b && !b.disabled; }, null, { timeout: 15000 });
  await page.evaluate(() => document.querySelector('#sec-config [data-action="config-extract"]').click());
  await page.waitForFunction(() => document.querySelector("#sec-config .piegrid canvas"), null, { timeout: 60000 }); await page.waitForTimeout(500);
  const pie = await page.evaluate(() => { const c = document.querySelector("#sec-config .piegrid canvas"); c.scrollIntoView({ block: "center" }); const r = c.getBoundingClientRect(); return { id: c.id, x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
  await page.mouse.move(pie.x, pie.y); await page.waitForTimeout(150); await page.mouse.move(pie.x + 1, pie.y + 1); await page.waitForTimeout(400);
  const pt = await page.evaluate((id) => { const t = Chart.getChart(document.getElementById(id)).tooltip; return { body: (t.body || []).flatMap((b) => b.lines).join(" | "), footer: (t.footer || []).join(" ") }; }, pie.id);
  ok(/% выручки/.test(pt.body) && /^Что это: доля выручки ниши по значениям поля/.test(pt.footer), `кольцо этапа 2: подсказка при наведении в центр — ${pt.body} · ${pt.footer.slice(0, 40)}…`);
  // значок «?» у каждого графика — подсказка «что это» без наведения на фигуру
  const marks = await page.evaluate(() => [...document.querySelectorAll(".chartbox .chart-what[data-tip]")].map((m) => m.getAttribute("data-tip").slice(0, 40)));
  const boxes = await page.evaluate(() => document.querySelectorAll(".chartbox").length);
  ok(marks.length === boxes && marks.every((m) => /^Что это/.test(m)), `у каждого графика значок «?» с пояснением: ${marks.length} из ${boxes}`);
  await page.evaluate(() => document.querySelector("#sec-config .chart-what").scrollIntoView({ block: "center" }));
  await page.hover("#sec-config .chart-what"); await page.waitForTimeout(300);
  ok(await page.evaluate(() => { const b = document.querySelector(".tipbox"); return b && !b.hidden && b.textContent.startsWith("Что это"); }), "наведение на «?» показывает пояснение графика");
  ok(logs.length === 0, "ошибок нет" + (logs.length ? ": " + logs.join(" | ") : ""));
} catch (e) { console.error("✖ проба упала:", e.stack || e.message); process.exitCode = 1; }
finally { await browser.close(); srv.kill(); }
