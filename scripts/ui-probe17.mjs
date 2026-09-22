// spec 010 «Этап 2 — конфигурация продукта и ТЗ» (MOCK: страницы из тайтлов Xray, AI — заглушки): Xray → шаг 1 схема → правка схемы →
// шаг 2 извлечение (подтверждение расхода) → диаграммы (сумма 100 %) → ценовой диапазон и переключатель → правка клетки → шаг 3 ТЗ → правка строки →
// DOCX скачан → F5: всё сохранено в общей истории → публичная ссылка: диаграммы есть, ТЗ нет.
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { startServer, loginContext } from "./probe-helper.mjs";

const XRAY = "tests/fixtures/Helium_10_Xray_2026-08-21.csv", POE = "tests/fixtures/POE_urinal_screen_deodorizer_2026-09-15.json";
const H = { "content-type": "application/json", "x-requested-with": "fba" };
const { srv, base } = await startServer(3997); const browser = await chromium.launch(); const logs = [];
const ok = (c, l) => { console.log((c ? "✔ " : "✖ ") + l); if (!c) process.exitCode = 1; };
const txt = (page, sel) => page.evaluate((s) => (document.querySelector(s)?.textContent || "").replace(/\s+/g, " "), sel);
const click = (page, sel) => page.evaluate((s) => { const el = document.querySelector(s); if (!el) throw new Error("нет " + s); el.click(); }, sel);
const saved = (page) => page.waitForFunction(() => document.querySelector("#save-state")?.textContent.includes("сохранено"), null, { timeout: 30000 });
try {
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 1000 }, acceptDownloads: true }); const page = await ctx.newPage(); const dialogs = [];
  page.on("console", (m) => { if (m.type() === "error" && !/401|404/.test(m.text())) logs.push(m.text()); }); page.on("pageerror", (e) => logs.push("pageerror: " + e.message));
  page.on("dialog", (d) => { dialogs.push(d.message()); d.accept(); });
  await loginContext(ctx, base); await page.goto(base + "/", { waitUntil: "networkidle" });
  await page.fill("#f-niche", "bike inner tube"); await page.fill("#f-core", "bike tube"); await page.setInputFiles("#file-input", [XRAY, POE]);
  await page.waitForFunction(() => document.querySelectorAll(".filecard").length >= 2, null, { timeout: 20000 }); await saved(page);
  const head0 = await txt(page, "#sec-config h2"); ok(/Конфигурация продукта — этап 2/.test(head0) && /\d+ ASIN/.test(head0), "секция этапа 2 видна после Xray: " + head0.trim());
  ok(await page.evaluate(() => document.querySelector('#sec-config [data-action="config-extract"]').disabled), "без схемы извлечение недоступно");

  // точка входа: раздел 9 панели и ссылка в шапке
  ok(/не начат/.test(await txt(page, "#config-side-badge")) && /Начните с шага 1/.test(await txt(page, "#config-side-status")), "раздел 9 панели показывает состояние «не начат» и подсказку");
  ok(/Этап 2 · конфигурация продукта и ТЗ: не начат/.test(await txt(page, "#sec-hero [data-goto]")), "в шапке дашборда есть ссылка на этап 2");
  ok(await page.evaluate(() => document.querySelector("#dashboard").dataset.stage === "1" && getComputedStyle(document.querySelector("#sec-config")).display === "none" && getComputedStyle(document.querySelector("#sec-economics")).display !== "none"), "вкладка «Этап 1»: секции этапа 2 скрыты, экономика видна");
  await click(page, '#stage-tabs [data-stage="2"]'); await page.waitForTimeout(300);
  ok(await page.evaluate(() => document.querySelector("#dashboard").dataset.stage === "2" && getComputedStyle(document.querySelector("#sec-config")).display !== "none" && getComputedStyle(document.querySelector("#sec-economics")).display === "none" && getComputedStyle(document.querySelector("#sec-hero")).display !== "none"), "вкладка «Этап 2»: видны шапка и секции этапа 2, остальное скрыто");
  await click(page, '#stage-tabs [data-stage="1"]'); await page.waitForTimeout(200);
  await click(page, "#side-config-go");
  const scrolled = await page.waitForFunction(() => { const r = document.querySelector("#sec-config").getBoundingClientRect(); return r.top >= -5 && r.top < window.innerHeight - 100 && document.querySelector("#dashboard").dataset.stage === "2"; }, null, { timeout: 4000 }).then(() => true).catch(() => false);
  ok(scrolled, "«Показать секцию ↓» открывает вкладку «Этап 2», секция в поле зрения" + (scrolled ? "" : " (top=" + (await page.evaluate(() => Math.round(document.querySelector("#sec-config").getBoundingClientRect().top))) + ")"));
  ok(await page.evaluate(() => document.querySelector("#side-config-extract").disabled && !document.querySelector("#side-config-schema").disabled), "кнопки панели: шаг 1 доступен, шаг 2 — нет");

  // шаг 1 — схема (кнопкой из панели)
  await click(page, "#side-config-schema");
  await page.waitForFunction(() => /Схема полей \(\d+\)/.test(document.querySelector("#sec-config")?.textContent || ""), null, { timeout: 30000 });
  const nFields = await page.evaluate(() => document.querySelectorAll("#sec-config .chips .chip").length); ok(nFields >= 3, `схема предложена: ${nFields} полей`);
  await saved(page);
  ok(/страниц: \d+/.test(await txt(page, "#sec-config h2")) && !/страниц: 0/.test(await txt(page, "#sec-config h2")), "страницы попали в кэш анализа");
  // правка схемы: переименовать первое поле
  await click(page, '#sec-config [data-action="config-edit"]'); await page.waitForFunction(() => document.querySelector("#schema-dlg").open, null, { timeout: 5000 });
  ok(await page.evaluate(() => document.querySelector("#schema-dlg").open), "диалог схемы открыт");
  await page.fill('#schema-rows tr:first-child [data-sf="name"]', "Материал корпуса"); await page.click("#schema-save");
  await page.waitForFunction(() => /правилась вручную/.test(document.querySelector("#sec-config summary")?.textContent || ""), null, { timeout: 5000 });
  ok(/Материал корпуса/.test(await txt(page, "#sec-config .chips")), "поле переименовано, схема помечена как правленная");

  // шаг 2 — извлечение (страницы уже в кэше для топ-15; остальные догружаются → подтверждение расхода)
  await click(page, '#sec-config [data-action="config-extract"]');
  await page.waitForFunction(() => document.querySelector("#sec-config .piegrid"), null, { timeout: 60000 }); await saved(page);
  ok(dialogs.length === 1 && /Будет загружено \d+ страниц/.test(dialogs[0]), "перед загрузкой страниц спрошено подтверждение расхода кредитов: " + (dialogs[0] || "").slice(0, 60));
  const pies = await page.evaluate(() => document.querySelectorAll("#sec-config .pie").length); ok(pies === nFields, `диаграмм по числу полей: ${pies}`);
  const sums = await page.evaluate(() => [...document.querySelectorAll("#sec-config .pie")].map((p) => [...p.querySelectorAll(".pietab tbody tr td:nth-child(2)")].reduce((s, td) => s + parseFloat(td.textContent.replace(",", ".")), 0)));
  ok(sums.every((s) => Math.abs(s - 100) < 0.6), "сумма долей по каждому полю 100 %: " + sums.map((s) => s.toFixed(1)).join(", "));
  const dom = await txt(page, "#sec-config h3 + table"); ok(/Материал корпуса/.test(dom), "доминирующая конфигурация содержит переименованное поле");
  ok(await page.evaluate(() => document.querySelectorAll("#sec-config canvas").length > 0 && document.querySelector("#sec-config canvas").width > 0), "диаграммы отрисованы");
  const chip = await txt(page, "#sec-config h2"); ok(/извлечено: \d+/.test(chip), "счётчик извлечённых листингов в шапке");

  // ценовой диапазон → переключатель
  await page.evaluate(() => document.querySelector("#f-pmin").closest("details").setAttribute("open", ""));
  await page.fill("#f-pmin", "10"); await page.dispatchEvent("#f-pmin", "change"); await page.fill("#f-pmax", "40"); await page.dispatchEvent("#f-pmax", "change");
  await page.waitForFunction(() => document.querySelectorAll("#sec-config [data-config-view]").length === 2, null, { timeout: 5000 });
  await page.evaluate(() => { const r = document.querySelector('#sec-config [data-config-view][value="band"]'); r.checked = true; r.dispatchEvent(new Event("change", { bubbles: true })); });
  ok(/диапазон/.test(await txt(page, "#sec-config h3")), "переключатель «мой диапазон» перерисовал доминирующую конфигурацию");
  await page.fill("#f-pmin", ""); await page.dispatchEvent("#f-pmin", "change"); await page.fill("#f-pmax", ""); await page.dispatchEvent("#f-pmax", "change");
  await page.waitForFunction(() => document.querySelectorAll("#sec-config [data-config-view]").length === 0, null, { timeout: 5000 });

  // правка клетки
  await page.evaluate(() => { document.querySelector("#sec-config details.cfgtable").open = true; });
  const cellSel = await page.evaluate(() => { const td = [...document.querySelectorAll("#sec-config td[data-cell]")].find((t) => t.closest("tr").querySelector("select") === null); return td.dataset.cell; });
  await page.evaluate((c) => document.querySelector(`#sec-config td[data-cell="${c}"]`).click(), cellSel);
  const ctl = await page.evaluate((c) => document.querySelector(`#sec-config td[data-cell="${c}"] select, #sec-config td[data-cell="${c}"] input`)?.tagName, cellSel); ok(Boolean(ctl), "клик по клетке открыл редактор: " + ctl);
  await page.evaluate((c) => { const td = document.querySelector(`#sec-config td[data-cell="${c}"]`); const el = td.firstElementChild; if (el.tagName === "SELECT") el.selectedIndex = el.options.length - 1; else el.value = el.type === "number" ? "7" : "ручное значение"; el.dispatchEvent(new Event("change", { bubbles: true })); }, cellSel);
  await page.waitForFunction((c) => /✎/.test(document.querySelector(`#sec-config td[data-cell="${c}"]`)?.textContent || ""), cellSel, { timeout: 5000 });
  ok(true, "клетка исправлена вручную (пометка ✎)"); ok(await page.evaluate(() => document.querySelector("#sec-config details.cfgtable").open), "таблица осталась раскрытой после перерисовки");

  ok(/извлечено/.test(await txt(page, "#config-side-badge")) && /извлечено/.test(await txt(page, "#stage2-badge")) && !(await page.evaluate(() => document.querySelector("#side-config-tz").disabled)), "раздел 9 и бейдж вкладки: «извлечено», шаг 3 доступен");
  // шаг 3 — ТЗ
  ok(/не составлено/.test(await txt(page, "#sec-tz h2")), "секция ТЗ видна после извлечения");
  await click(page, '#sec-tz [data-action="config-tz"]');
  await page.waitForFunction(() => document.querySelectorAll("#sec-tz tbody tr").length >= 5, null, { timeout: 30000 }); await saved(page);
  const rows = await page.evaluate(() => document.querySelectorAll("#sec-tz tbody tr").length); ok(rows >= 5, `ТЗ составлено: ${rows} строк`);
  await page.evaluate(() => { const td = document.querySelector('#sec-tz td[data-tz$="|requirement"]'); td.focus(); td.textContent = "Правленое требование"; td.dispatchEvent(new Event("input", { bubbles: true })); td.blur(); });
  await page.waitForTimeout(300); ok(/Правленое требование/.test(await txt(page, "#sec-tz tbody tr:first-child")), "строка ТЗ правится прямо в таблице");
  await click(page, '#sec-tz [data-action="tz-add"]'); ok((await page.evaluate(() => document.querySelectorAll("#sec-tz tbody tr").length)) === rows + 1, "«＋ Строка» добавила строку");
  const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 15000 }), click(page, '#sec-tz [data-action="tz-docx"]')]);
  const buf = readFileSync(await dl.path()); ok(/^TZ-.*\.docx$/.test(dl.suggestedFilename()) && buf.toString("latin1", 0, 2) === "PK" && buf.length > 2000, `DOCX скачан: ${dl.suggestedFilename()}, ${buf.length} байт`);
  await saved(page);

  // F5: схема, таблица, ручная клетка и ТЗ — из общей истории
  await page.reload({ waitUntil: "networkidle" }); await page.waitForFunction(() => document.querySelector("#sec-config .piegrid"), null, { timeout: 20000 });
  ok(await page.evaluate(() => document.querySelector("#dashboard").dataset.stage === "2" && document.querySelector("#sec-config canvas").width > 0), "после F5 открыта вкладка «Этап 2» (запомнена), диаграммы отрисованы");
  ok(/Материал корпуса/.test(await txt(page, "#sec-config .chips")) && /Правленое требование/.test(await txt(page, "#sec-tz")), "после F5 схема, таблица и правленое ТЗ на месте");
  ok(await page.evaluate((c) => /✎/.test(document.querySelector(`#sec-config td[data-cell="${c}"]`)?.textContent || ""), cellSel), "ручная клетка пережила F5");

  // публичная ссылка: диаграммы да, ТЗ нет
  const me = await (await ctx.request.get(base + "/api/auth/me")).json(); const id = me.user.settings.lastAnalysisId;
  const sh = await (await ctx.request.post(`${base}/api/analyses/${id}/shares`, { headers: H, data: { mode: "full", expiresInDays: 7 } })).json();
  const guest = await browser.newContext({ viewport: { width: 1280, height: 900 } }); const g = await guest.newPage(); g.on("pageerror", (e) => logs.push("guest pageerror: " + e.message));
  const token = sh.share.token || String(sh.share.url || "").split("/s/")[1]; await g.goto(`${base}/s/${token}`, { waitUntil: "networkidle" });
  await g.waitForFunction(() => document.querySelector("#sec-config .piegrid"), null, { timeout: 20000 });
  ok(await g.evaluate(() => document.querySelector("#sec-tz").classList.contains("hidden") && document.querySelectorAll("#sec-config button, #sec-config td[data-cell]").length === 0), "в публичной ссылке: диаграммы и таблица есть, ТЗ и кнопок нет");
  const body = await (await guest.request.get(`${base}/api/public/shares/${token}`)).text();
  ok(!/Правленое требование/.test(body) && !/"listings"/.test(body), "в данных ссылки нет ТЗ и кэша страниц");
  ok(logs.length === 0, "ошибок в консоли нет" + (logs.length ? ": " + logs.slice(0, 3).join(" | ") : ""));
} catch (e) { console.error("✖ проба упала:", e.stack || e.message); process.exitCode = 1; }
finally { await browser.close(); srv.kill(); }
