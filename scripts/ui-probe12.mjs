// spec 005 «Вход в нишу»: секции видны после загрузки Xray + POE одной ниши → ползунок цели меняет нужную долю кликов и пик вложений →
// поля сценария в панели работают → триггеры по названию ниши → 360 px без горизонтальной прокрутки → значения переживают F5.
// Xray в фикстурах из другой ниши, поэтому CSV собирается на лету поверх ASIN из POE (продажи ≈ 40 шт/мес на 1 % кликов).
import { chromium } from "playwright";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startServer, loginContext } from "./probe-helper.mjs";

const POE = "tests/fixtures/POE_urinal_screen_deodorizer_2026-09-15.json";
const niche = JSON.parse(readFileSync(POE, "utf8")).data.niche;
const q = (s) => '"' + String(s ?? "").replace(/"/g, '""') + '"';
const lines = ["ASIN,Brand,Product Details,Price  USD,ASIN Sales,ASIN Revenue,Review Count,Ratings,Creation Date,Seller,Fulfillment"];
niche.asinMetrics.forEach((a, i) => { const share = Number(a.clickShareT90 || a.clickShareT360 || 0), sales = Math.round(share * 100 * 40 * (0.65 + ((i * 37) % 71) / 100)), price = Number(a.avgPriceT360 || 20);
  lines.push([a.asin, q(a.brand), q(a.asinTitle), price.toFixed(2), sales, (sales * price).toFixed(2), Math.round(Number(a.totalReviews || 0) * 1.6), a.customerRating || "", a.launchDate || "", q("Seller"), "FBA"].join(",")); });
const xrayPath = join(mkdtempSync(join(tmpdir(), "fba-probe12-")), "Helium_10_Xray_synthetic.csv"); writeFileSync(xrayPath, "﻿" + lines.join("\n"));

const { srv, base } = await startServer(3986);
const browser = await chromium.launch(); const logs = [];
const ok = (c, l) => { console.log((c ? "✔ " : "✖ ") + l); if (!c) process.exitCode = 1; };
const txt = (page, sel) => page.evaluate((s) => (document.querySelector(s)?.textContent || "").replace(/\s+/g, " "), sel);
try {
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 1000 } }); const page = await ctx.newPage();
  page.on("console", (m) => { if (m.type() === "error" && !/401|404/.test(m.text())) logs.push(m.text()); }); page.on("pageerror", (e) => logs.push("pageerror: " + e.message));
  await loginContext(ctx, base); await page.goto(base + "/", { waitUntil: "networkidle" });
  await page.fill("#f-niche", "urinal screen deodorizer"); await page.fill("#f-core", "urinal screen deodorizer");
  await page.setInputFiles("#file-input", [POE, xrayPath]);
  await page.waitForFunction(() => document.querySelectorAll(".filecard").length >= 2, null, { timeout: 20000 });
  await page.evaluate(() => document.querySelector("#f-cogs").closest("details").setAttribute("open", ""));
  for (const [sel, v] of [["#f-price", "24.99"], ["#f-cogs", "4.37"], ["#f-cpc", "1.27"], ["#f-budget", "18750"]]) { await page.fill(sel, v); await page.dispatchEvent(sel, "change"); }
  await page.waitForFunction(() => /Нужная доля кликов/.test(document.querySelector("#sec-entry")?.textContent || "") && /Пик вложений/.test(document.querySelector("#sec-cashflow")?.textContent || ""), null, { timeout: 15000 });

  const entry = await txt(page, "#sec-entry");
  ok(/Продаж на 1 % кликов ниши\s*\d+/.test(entry) && /под цель 300 шт\/мес/.test(entry) && /порог предварительный/.test(entry), "секция «Вход в нишу»: продажи на 1 % кликов и нужная доля под цель 300 шт/мес");
  ok(/Новые участники \d+ из 67 товаров/.test(entry) && /Срок до планки отзывов/.test(entry) && /всех оценок/.test(entry), "когорта новичков и срок до планки отзывов посчитаны");
  ok((await page.$$("#sec-entry table tbody tr")).length >= 3, "таблица новичков заполнена");
  const cash = await txt(page, "#sec-cashflow");
  ok(/Деньги по месяцам/.test(cash) && /медиана продаж новичков ниши/.test(cash) && (await page.$$("#sec-cashflow .cashtable tbody tr")).length === 15, "«Деньги по месяцам»: 15 месяцев, старт от продаж новичков");
  ok(await page.evaluate(() => Boolean(document.querySelector("#ch-cash")) && document.querySelector("#ch-cash").width > 0), "график денег отрисован");
  ok(/Хватает ли бюджета на пик вложений/.test(await txt(page, "#sec-budget")) && /справочно, 2 партии/.test(await txt(page, "#sec-budget")), "стоп-вопрос о бюджете — по пику вложений, две партии справочно");
  ok(/Цена по кликам покупателей/.test(await txt(page, "#sec-pricing")), "цена по кликам покупателей в секции цен");
  ok(/Пограничные значения/.test(await txt(page, "#sec-borderline")), "секция пограничных значений");
  ok(/Регуляторные триггеры/.test(await txt(page, "#sec-checklist")), "блок регуляторных триггеров в чеклисте");

  // ползунок цели в дашборде: мгновенный пересчёт нужной доли и пика
  const read = () => page.evaluate(() => ({ share: document.querySelector("#sec-entry .tiles .tile:nth-child(2) .v").textContent, peak: document.querySelector("#sec-cashflow .cards .card .big").textContent }));
  const before = await read();
  await page.evaluate(() => { const el = document.querySelector('#sec-quick [data-quick="unitsPerDay"]'); el.value = "30"; el.dispatchEvent(new Event("input", { bubbles: true })); });
  await page.waitForFunction((b) => document.querySelector("#sec-entry .tiles .tile:nth-child(2) .v").textContent !== b, before.share, { timeout: 5000 });
  const after = await read();
  ok(after.share !== before.share && after.peak !== before.peak && /под цель 900 шт\/мес/.test(await txt(page, "#sec-entry")), `цель 10 → 30 шт/день: доля ${before.share} → ${after.share}, пик ${before.peak} → ${after.peak}`);

  // поля сценария в панели
  await page.fill("#f-startup", "2500"); await page.fill("#f-horizon", "18"); await page.fill("#f-rrate", "4"); await page.dispatchEvent("#f-rrate", "change");
  await page.waitForFunction(() => document.querySelectorAll("#sec-cashflow .cashtable tbody tr").length === 21, null, { timeout: 8000 });
  ok(true, "горизонт 18 мес → 21 строка сценария (3 мес поставки + 18 мес продаж)");
  ok(!/допущение, меняется в панели/.test(await txt(page, "#sec-entry")) && /4,0 % покупателей с отзывом/.test(await txt(page, "#sec-entry")), "своя доля покупателей с отзывом снимает пометку «допущение»");

  // триггеры по названию ниши
  await page.fill("#f-niche", "antibacterial baby teether"); await page.dispatchEvent("#f-niche", "input");
  await page.waitForFunction(() => /CPSC/.test(document.querySelector("#sec-checklist")?.textContent || ""), null, { timeout: 8000 });
  const chk = await txt(page, "#sec-checklist"); ok(/CPSC/.test(chk) && /EPA/.test(chk) && /обещание/.test(chk) && /тип товара/.test(chk), "название ниши «antibacterial baby teether» → CPSC (тип товара) и EPA (обещание)");

  // пороги: новые группы с человеческими подписями
  await page.click('[data-tab="thresholds"]').catch(() => {}); const thr = await txt(page, "#thr");
  ok(/Вход в нишу/.test(thr) && /Деньги по месяцам и отзывы/.test(thr) && /Пограничное значение — ближе к порогу чем/.test(thr) && !/entry\.|cashflow\./.test(thr.replace(/title="[^"]*"/g, "")), "пороги spec 005 во вкладке «Пороги» с подписями");
  await page.click('[data-tab="analysis"]');

  // сохранение и F5
  await page.waitForFunction(() => document.querySelector("#save-state")?.textContent.includes("сохранено"), null, { timeout: 25000 });
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForFunction(() => document.querySelectorAll("#sec-cashflow .cashtable tbody tr").length === 21, null, { timeout: 20000 });
  ok((await page.inputValue("#f-startup")) === "2500" && (await page.inputValue("#f-horizon")) === "18" && (await page.inputValue("#f-rrate")) === "4", "после F5 поля сценария на месте");

  // 360 px
  await page.setViewportSize({ width: 360, height: 800 }); await page.waitForTimeout(500);
  const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  ok(over <= 2, "360 px: без горизонтальной прокрутки страницы (лишних px: " + over + ")");
  ok(logs.length === 0, "ошибок в консоли нет" + (logs.length ? ": " + logs.slice(0, 3).join(" | ") : ""));
} catch (e) { console.error("✖ проба упала:", e.message); process.exitCode = 1; }
finally { await browser.close(); srv.kill(); }
