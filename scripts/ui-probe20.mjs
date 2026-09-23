// spec 012: Amazon как продавец — Xray с листингом Amazon → сразу No-Go («Amazon в нише»), чип в конкурентной карте; пороги: режим «учитывать» снимает блок,
// область «мой диапазон» без Amazon внутри — не блокирует; строковые пороги показаны списком и переживают F5.
import { chromium } from "playwright";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startServer, loginContext } from "./probe-helper.mjs";

const POE = "tests/fixtures/POE_urinal_screen_deodorizer_2026-09-15.json";
const niche = JSON.parse(readFileSync(POE, "utf8")).data.niche;
const q = (s) => '"' + String(s ?? "").replace(/"/g, '""') + '"';
const lines = ["ASIN,Brand,Product Details,Price  USD,ASIN Sales,ASIN Revenue,Review Count,Ratings,Creation Date,Seller,Fulfillment"];
niche.asinMetrics.slice(0, 40).forEach((a, i) => { const price = i === 3 ? 95 : Number(a.avgPriceT360 || 20), sales = 120 - i * 2;
  lines.push([a.asin, q(a.brand), q(a.asinTitle), price.toFixed(2), sales, (sales * price).toFixed(2), Math.round(Number(a.totalReviews || 0)), a.customerRating || "", a.launchDate || "", q(i === 3 ? "Amazon.com" : "Seller " + i), i === 3 ? "Amazon" : "FBA"].join(",")); });
const xrayPath = join(mkdtempSync(join(tmpdir(), "fba-probe20-")), "Helium_10_Xray_amazon.csv"); writeFileSync(xrayPath, "﻿" + lines.join("\n"));

const { srv, base } = await startServer(3993); const browser = await chromium.launch(); const logs = [];
const ok = (c, l) => { console.log((c ? "✔ " : "✖ ") + l); if (!c) process.exitCode = 1; };
const txt = (page, sel) => page.evaluate((s) => (document.querySelector(s)?.textContent || "").replace(/\s+/g, " ").trim(), sel);
const tab = (page, name) => page.evaluate((n) => document.querySelector(`[data-tab="${n}"]`).click(), name);
const saved = (page) => page.waitForFunction(() => document.querySelector("#save-state")?.textContent.includes("сохранено"), null, { timeout: 30000 });
try {
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 1000 } }); const page = await ctx.newPage();
  page.on("console", (m) => { if (m.type() === "error" && !/401|404/.test(m.text())) logs.push(m.text()); }); page.on("pageerror", (e) => logs.push("pageerror: " + e.message));
  await loginContext(ctx, base); await page.goto(base + "/", { waitUntil: "networkidle" });
  await page.fill("#f-niche", "urinal screen deodorizer"); await page.fill("#f-core", "urinal screen deodorizer"); await page.setInputFiles("#file-input", [POE, xrayPath]);
  await page.waitForFunction(() => document.querySelectorAll(".filecard").length >= 2, null, { timeout: 20000 }); await saved(page);
  const hero = await txt(page, "#sec-hero .verdict"); ok(/No-Go/.test(hero) && /Amazon в нише/.test(hero), "шапка: No-Go, решающий «Amazon в нише» — " + hero.slice(0, 90));
  const chip = await txt(page, "#sec-competitors h2"); ok(/Amazon продаёт сам · 1 ASIN · \d+ % выручки · No-Go/.test(chip), "чип в конкурентной карте: " + chip.replace(/^Конкурентная карта/, "").trim());
  ok(/Amazon продаёт сам/.test(await txt(page, "#sec-checklist")) && /по всей нише · однозначно No-Go/.test(await txt(page, "#sec-checklist")), "чеклист: область и режим");
  ok(/Amazon продаёт сам/.test(await txt(page, "#sec-conclusion")) || /Amazon/.test(await txt(page, "#sec-hero")), "причина видна в заключении/шапке");
  // пороги: режим «учитывать в общей картине»
  await tab(page, "thresholds"); await page.waitForSelector('select[data-thr="amazon.mode"]');
  ok((await page.$$eval('select[data-thr="amazon.mode"] option', (o) => o.map((x) => x.textContent).join("|"))) === "однозначно No-Go|учитывать в общей картине", "порог-строка показан списком с понятными названиями");
  await page.selectOption('select[data-thr="amazon.mode"]', "consider"); await page.waitForTimeout(600);
  await tab(page, "analysis"); const hero2 = await txt(page, "#sec-hero .verdict"); ok(!/Amazon в нише/.test(hero2), "режим «учитывать»: решающий гейт уже не Amazon — " + hero2.slice(0, 80));
  ok(/Amazon продаёт сам · 1 ASIN/.test(await txt(page, "#sec-competitors h2")) && !/No-Go/.test(await txt(page, "#sec-competitors h2")), "чип остался, но без «No-Go»");
  ok(/изменено порогов: 1/.test(await (async () => { await tab(page, "thresholds"); await page.waitForTimeout(200); return txt(page, "#thr-preset-note"); })()), "строковый порог учтён как изменённый");
  // область «мой ценовой диапазон» без Amazon внутри
  await page.selectOption('select[data-thr="amazon.mode"]', "block"); await page.selectOption('select[data-thr="amazon.scope"]', "band"); await page.waitForTimeout(500);
  await tab(page, "analysis"); ok(/Amazon в нише/.test(await txt(page, "#sec-hero .verdict")), "область «диапазон» без заданного диапазона → проверена вся ниша, No-Go");
  await page.evaluate(() => document.querySelector("#f-pmin").closest("details").setAttribute("open", "")); await page.fill("#f-pmin", "5"); await page.dispatchEvent("#f-pmin", "change"); await page.fill("#f-pmax", "60"); await page.dispatchEvent("#f-pmax", "change"); await page.waitForTimeout(700);
  ok(!/Amazon в нише/.test(await txt(page, "#sec-hero .verdict")) && !/Amazon продаёт сам/.test(await txt(page, "#sec-competitors h2")), "Amazon за $95 вне диапазона $5–60 — не блокирует, чипа нет");
  await page.fill("#f-pmax", "120"); await page.dispatchEvent("#f-pmax", "change"); await page.waitForTimeout(700);
  ok(/Amazon в нише/.test(await txt(page, "#sec-hero .verdict")) && /в ценовом диапазоне/.test(await txt(page, "#sec-checklist")), "диапазон расширен до $120 — Amazon внутри, снова No-Go по диапазону");
  await saved(page); await page.reload({ waitUntil: "networkidle" }); await page.waitForFunction(() => document.querySelector("#sec-hero .verdict"), null, { timeout: 20000 });
  ok(/Amazon в нише/.test(await txt(page, "#sec-hero .verdict")), "после F5 пороги Amazon сохранены с анализом");
  ok(logs.length === 0, "ошибок в консоли нет" + (logs.length ? ": " + logs.slice(0, 3).join(" | ") : ""));
} catch (e) { console.error("✖ проба упала:", e.stack || e.message); process.exitCode = 1; }
finally { await browser.close(); srv.kill(); }
