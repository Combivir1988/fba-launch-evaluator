// Регресс: результат патентного скана не теряется после «История → Открыть» того же анализа и после F5
// (анализ после перезагрузки всегда fromHistory=true, автосохранение выключено — результат задачи должен сохраняться явно).
import { chromium } from "playwright";
import { startServer, loginContext } from "./probe-helper.mjs";
import path from "node:path";
const root = process.cwd();
const { srv, base } = await startServer(3996);
const browser = await chromium.launch(); const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
const logs = []; page.on("console", (m) => { if (m.type() === "error") logs.push(m.text()); }); page.on("pageerror", (e) => logs.push("pageerror: " + e.message));
await page.addInitScript(() => { if (!localStorage.getItem("probe6")) { localStorage.clear(); localStorage.setItem("probe6", "1"); } });
const chip = () => page.evaluate(() => document.querySelector("#sec-patents h2 .chip")?.textContent);
await loginContext(page.context(), base);
await page.goto("http://127.0.0.1:3996/", { waitUntil: "networkidle" });
await page.fill("#f-core", "urinal screen deodorizer");
await page.setInputFiles("#file-input", [path.join(root, "tests/fixtures/POE_urinal_screen_deodorizer_2026-09-15.json")]);
await page.waitForFunction(() => document.querySelectorAll(".filecard").length >= 1);
await page.waitForTimeout(2000); // autosave
// 1) перезагрузка → анализ открыт из истории (fromHistory=true)
await page.reload({ waitUntil: "networkidle" });
console.log("after reload core:", await page.inputValue("#f-core"), "| chip:", await chip());
await page.click('details:has(#f-pfeature) summary').catch(() => {});
await page.fill("#f-pfeature", "enzyme odor neutralizer with anti-splash mesh");
await page.waitForTimeout(400);
await page.click("#btn-patents");
await page.waitForFunction(() => document.querySelector("#sec-patents")?.textContent.includes("AI-скан"), null, { timeout: 30000 });
await page.waitForTimeout(800);
console.log("after scan chip:", await chip());
// 2) История → Открыть тот же анализ
await page.click('.topbar nav button[data-tab="history"]');
await page.waitForSelector("[data-open]");
await page.click("[data-open]");
await page.waitForTimeout(500);
console.log("after history→open chip:", await chip(), "| tab analysis visible:", await page.evaluate(() => !document.querySelector("#tab-analysis").classList.contains("hidden")));
// 3) F5
await page.reload({ waitUntil: "networkidle" });
await page.waitForTimeout(500);
console.log("after F5 chip:", await chip(), "| feature:", await page.inputValue("#f-pfeature"));
const crit8 = await page.evaluate(() => document.querySelector("#sec-challenger tbody tr:nth-child(8)")?.textContent.replace(/\s+/g, " ").slice(0, 120));
console.log("crit8:", crit8);
console.log("console:", logs.join("\n") || "(чисто)");
await browser.close(); srv.kill();
