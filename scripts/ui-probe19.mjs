// spec 011: личные наборы порогов — сохранить, «＋ Новый» даёт умолчания, загрузить в новый анализ, обновить, второй пользователь наборов не видит, удалить.
import { chromium } from "playwright";
import { startServer, loginContext } from "./probe-helper.mjs";

const POE = "tests/fixtures/POE_urinal_screen_deodorizer_2026-09-15.json"; const H = { "content-type": "application/json", "x-requested-with": "fba" };
const { srv, base } = await startServer(3994); const browser = await chromium.launch(); const logs = [];
const ok = (c, l) => { console.log((c ? "✔ " : "✖ ") + l); if (!c) process.exitCode = 1; };
const txt = (page, sel) => page.evaluate((s) => (document.querySelector(s)?.textContent || "").replace(/\s+/g, " ").trim(), sel);
const saved = (page) => page.waitForFunction(() => document.querySelector("#save-state")?.textContent.includes("сохранено"), null, { timeout: 30000 });
const tab = (page, name) => page.evaluate((n) => document.querySelector(`[data-tab="${n}"]`).click(), name);
try {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } }); const page = await ctx.newPage();
  page.on("console", (m) => { if (m.type() === "error" && !/401|404/.test(m.text())) logs.push(m.text()); }); page.on("pageerror", (e) => logs.push("pageerror: " + e.message));
  page.on("dialog", (d) => (d.type() === "prompt" ? d.accept("Дешёвые товары") : d.accept()));
  await loginContext(ctx, base); await page.goto(base + "/", { waitUntil: "networkidle" });
  await page.fill("#f-niche", "urinal screen"); await page.setInputFiles("#file-input", [POE]); await page.waitForFunction(() => document.querySelectorAll(".filecard").length === 1); await saved(page);
  await tab(page, "thresholds"); await page.waitForSelector("#thr-presets");
  ok(/пороги по умолчанию/.test(await txt(page, "#thr-preset-note")) && (await page.evaluate(() => document.querySelector("#thr-load").disabled)), "вкладка «Пороги»: наборов нет, анализ на умолчаниях");
  await page.evaluate(() => document.querySelector("#thr-save-as").click()); await page.waitForTimeout(300);
  ok(/сохранять нечего/.test(await txt(page, "#toast")), "сохранять умолчания нельзя — подсказка");
  await page.fill('[data-thr="criterion1.priceOk"]', "20"); await page.dispatchEvent('[data-thr="criterion1.priceOk"]', "change"); await page.fill('[data-thr="economics.marginMin"]', "0.35"); await page.dispatchEvent('[data-thr="economics.marginMin"]', "change"); await page.keyboard.press("Tab"); await page.waitForTimeout(400);
  ok(/изменено порогов: 2/.test(await txt(page, "#thr-preset-note")), "изменено порогов: 2");
  await page.evaluate(() => document.querySelector("#thr-save-as").click()); await page.waitForFunction(() => document.querySelectorAll("#thr-preset option").length === 2, null, { timeout: 10000 });
  ok(/Дешёвые товары · 2/.test(await txt(page, "#thr-preset")), "набор сохранён с двумя порогами и выбран: " + (await txt(page, "#thr-preset option:nth-child(2)")));
  const me = await (await ctx.request.get(base + "/api/auth/me")).json(); ok(me.user.settings.thresholdPresets?.[0]?.thresholds?.criterion1?.priceOk === 20 && !me.user.settings.thresholdPresets[0].thresholds.criterion1.priceWarn, "в учётной записи — только отличия от умолчаний");
  await saved(page);
  // новый анализ — умолчания
  await tab(page, "analysis"); await page.evaluate(() => document.querySelector("#btn-new").click()); await page.waitForTimeout(500);
  await tab(page, "thresholds"); await page.waitForTimeout(200);
  ok((await page.inputValue('[data-thr="criterion1.priceOk"]')) === "30" && /по умолчанию/.test(await txt(page, "#thr-preset-note")), `«＋ Новый»: пороги по умолчанию, набор не применён сам (priceOk=${await page.inputValue('[data-thr="criterion1.priceOk"]')}, note=«${await txt(page, "#thr-preset-note")}», niche=«${await page.inputValue("#f-niche")}», изменено: ${await page.evaluate(() => [...document.querySelectorAll('#thr .field:has(.chip.warn) input')].map((i) => i.dataset.thr + '=' + i.value).join(','))})`);
  await page.selectOption("#thr-preset", { index: 1 }); await page.evaluate(() => document.querySelector("#thr-load").click()); await page.waitForTimeout(500);
  ok((await page.inputValue('[data-thr="criterion1.priceOk"]')) === "20" && (await page.inputValue('[data-thr="economics.marginMin"]')) === "0.35" && /изменено порогов: 2/.test(await txt(page, "#thr-preset-note")), "«Загрузить в этот анализ» применил набор к новому анализу");
  ok((await page.$$('#thr .chip.warn')).length === 2, "изменённые пороги помечены «изменено»");
  // обновить набор
  await page.fill('[data-thr="criterion1.priceOk"]', "22"); await page.dispatchEvent('[data-thr="criterion1.priceOk"]', "change"); await page.waitForTimeout(300);
  await page.selectOption("#thr-preset", { index: 1 }); await page.evaluate(() => document.querySelector("#thr-update").click()); await page.waitForFunction(() => /обновлён/.test(document.querySelector("#toast")?.textContent || ""), null, { timeout: 10000 });
  const me2 = await (await ctx.request.get(base + "/api/auth/me")).json(); ok(me2.user.settings.thresholdPresets[0].thresholds.criterion1.priceOk === 22, "«Обновить набор» перезаписал значения");
  // второй пользователь не видит
  await ctx.request.post(base + "/api/users", { headers: H, data: { login: "olga", name: "Ольга", role: "user", password: "olga-temp-pass-1" } });
  const ctx2 = await browser.newContext({ viewport: { width: 1400, height: 900 } }); const p2 = await ctx2.newPage(); await loginContext(ctx2, base, { login: "olga", temp: "olga-temp-pass-1", password: "olga-real-pass-1" });
  await p2.goto(base + "/", { waitUntil: "networkidle" }); await tab(p2, "thresholds"); await p2.waitForSelector("#thr-presets");
  ok((await p2.$$("#thr-preset option")).length === 1 && (await p2.inputValue('[data-thr="criterion1.priceOk"]')) === "30", "у другого пользователя наборов нет, пороги по умолчанию");
  const me3 = await (await ctx2.request.get(base + "/api/auth/me")).json(); ok(!me3.user.settings.thresholdPresets, "и в её настройках чужих наборов нет");
  // удалить
  await page.selectOption("#thr-preset", { index: 1 }); await page.evaluate(() => document.querySelector("#thr-delete").click()); await page.waitForFunction(() => document.querySelectorAll("#thr-preset option").length === 1, null, { timeout: 10000 });
  ok(true, "набор удалён после подтверждения"); ok((await page.inputValue('[data-thr="criterion1.priceOk"]')) === "22", "пороги анализа при удалении набора не меняются");
  ok(logs.length === 0, "ошибок в консоли нет" + (logs.length ? ": " + logs.slice(0, 3).join(" | ") : ""));
} catch (e) { console.error("✖ проба упала:", e.stack || e.message); process.exitCode = 1; }
finally { await browser.close(); srv.kill(); }
