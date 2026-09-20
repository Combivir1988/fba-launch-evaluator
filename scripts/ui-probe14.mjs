// spec 007 «Несколько POE»: второй POE другой ниши добавляется, а не заменяет первый → две карточки с долями рынка, пометка в шапке и в «Особенностях данных» →
// повторная загрузка той же ниши обновляет её → объединение переживает F5 → удаление ниши возвращает одну.
import { chromium } from "playwright";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startServer, loginContext } from "./probe-helper.mjs";

const POE = "tests/fixtures/POE_urinal_screen_deodorizer_2026-09-15.json";
const raw = JSON.parse(readFileSync(POE, "utf8")); const b = JSON.parse(JSON.stringify(raw));
b.data.niche.nicheId = "probe-niche-b"; b.data.niche.nicheTitle = "urinal cake deodorizer"; if (b.meta) { b.meta.nicheId = "probe-niche-b"; b.meta.nicheTitle = "urinal cake deodorizer"; }
b.data.niche.asinMetrics = b.data.niche.asinMetrics.slice(0, 30).map((a, i) => ({ ...a, asin: i < 10 ? a.asin : "B0PRB" + String(i).padStart(5, "0") }));
b.data.niche.searchTermMetrics = b.data.niche.searchTermMetrics.map((t, i) => ({ ...t, searchTerm: i < 4 ? t.searchTerm : t.searchTerm + " cake" }));
const dir = mkdtempSync(join(tmpdir(), "fba-probe14-")); const fileB = join(dir, "POE_urinal_cake_deodorizer.json"); writeFileSync(fileB, JSON.stringify(b));

const { srv, base } = await startServer(3994); const browser = await chromium.launch(); const logs = [];
const ok = (c, l) => { console.log((c ? "✔ " : "✖ ") + l); if (!c) process.exitCode = 1; };
const txt = (page, sel) => page.evaluate((s) => (document.querySelector(s)?.textContent || "").replace(/\s+/g, " "), sel);
try {
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 1000 } }); const page = await ctx.newPage();
  page.on("console", (m) => { if (m.type() === "error" && !/401|404/.test(m.text())) logs.push(m.text()); }); page.on("pageerror", (e) => logs.push("pageerror: " + e.message));
  await loginContext(ctx, base); await page.goto(base + "/", { waitUntil: "networkidle" });
  await page.setInputFiles("#file-input", [POE]); await page.waitForFunction(() => document.querySelectorAll(".filecard").length === 1, null, { timeout: 20000 });
  const hero1 = await txt(page, "#sec-hero"); ok(/POE · 67 ASIN/.test(hero1) && !/объединён/.test(hero1), "одна ниша: «POE · 67 ASIN», пометки об объединении нет");
  const cohort1 = await page.evaluate(() => document.querySelector("#sec-entry h3 .chip")?.textContent || "");

  await page.setInputFiles("#file-input", [fileB]); await page.waitForFunction(() => document.querySelectorAll(".filecard").length === 2, null, { timeout: 20000 });
  ok(/добавлена ниша «urinal cake deodorizer» — объединено ниш: 2, товаров без дублей: 87/.test(await txt(page, "#toast")), "сообщение: ниша добавлена, 87 товаров без дублей");
  const files = await txt(page, "#filelist"); ok(/urinal screen deodorizer · 67 ASIN · \d+ % рынка/.test(files) && /urinal cake deodorizer · 30 ASIN · \d+ % рынка/.test(files) && /Ниши объединены в один рынок: 87 товаров без дублей/.test(files), "две карточки POE с долями рынка");
  const hero2 = await txt(page, "#sec-hero"); ok(/POE · 2 ниш\(и\) · 87 ASIN/.test(hero2) && /POE объединён из 2 ниш:/.test(hero2) && /общих 10/.test(hero2) && /общих 4/.test(hero2), "шапка: чип «2 ниши · 87 ASIN» и состав объединения");
  const cohort2 = await page.evaluate(() => document.querySelector("#sec-entry h3 .chip")?.textContent || ""); ok(/из 87 товаров/.test(cohort2) && cohort2 !== cohort1, `новички считаются по общему рынку: «${cohort1}» → «${cohort2}»`);
  await page.evaluate(() => document.querySelector("#sec-entry details")?.setAttribute("open", "")); const notes = await txt(page, "#sec-entry details");
  ok(/POE объединён из 2 ниш/.test(notes) && /могут быть учтены дважды/.test(notes) && /Недельные тренды сложены по \d+ неделям/.test(notes), "«Особенности данных POE»: как собран рынок и что приближённо");

  await page.setInputFiles("#file-input", [fileB]); await page.waitForTimeout(700);
  ok(/ниша «urinal cake deodorizer» обновлена/.test(await txt(page, "#toast")) && (await page.$$(".filecard")).length === 2, "та же ниша повторно — обновлена, дубля нет");

  await page.waitForFunction(() => document.querySelector("#save-state")?.textContent.includes("сохранено"), null, { timeout: 30000 });
  await page.reload({ waitUntil: "networkidle" }); await page.waitForFunction(() => document.querySelectorAll(".filecard").length === 2, null, { timeout: 20000 });
  ok(/POE объединён из 2 ниш/.test(await txt(page, "#sec-hero")), "после F5 объединение на месте");

  await page.click('[data-rm-poe="probe-niche-b"]'); await page.waitForFunction(() => document.querySelectorAll(".filecard").length === 1, null, { timeout: 10000 });
  const hero3 = await txt(page, "#sec-hero"); ok(/POE · 67 ASIN/.test(hero3) && !/объединён/.test(hero3) && /urinal screen deodorizer/.test(await txt(page, "#filelist")), "удаление ниши возвращает одну исходную");
  const cohort3 = await page.evaluate(() => document.querySelector("#sec-entry h3 .chip")?.textContent || ""); ok(cohort3 === cohort1, "и показатели новичков — как до объединения");
  await page.click("[data-rm=poe]"); await page.waitForFunction(() => document.querySelectorAll(".filecard").length === 0, null, { timeout: 10000 }); ok(true, "последняя ниша удаляется обычной кнопкой");
  ok(logs.length === 0, "ошибок в консоли нет" + (logs.length ? ": " + logs.slice(0, 3).join(" | ") : ""));
} catch (e) { console.error("✖ проба упала:", e.message); process.exitCode = 1; }
finally { await browser.close(); srv.kill(); }
