// Проба 23: косметика — свёрнутые секции. Смотрим глазами, а не только тестами.
import { chromium } from "playwright";
import { startServer, loginContext } from "./probe-helper.mjs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import os from "node:os";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."); // fileURLToPath, а не pathname: иначе пробел в пути приезжает как %20
const OUT = process.env.PROBE_OUT || os.tmpdir() + path.sep;
const { srv, base } = await startServer(3457);
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
await loginContext(context, base);
const page = await context.newPage();
page.on("pageerror", (e) => console.log("ОШИБКА СТРАНИЦЫ:", e.message));
await page.goto(base + "/", { waitUntil: "load" });

await page.setInputFiles("#file-input", [
  path.join(root, "tests/fixtures/Helium_10_Xray_2026-08-21.csv"),
  path.join(root, "tests/fixtures/US_AMAZON_cerebro__2026-08-21.csv"),
  path.join(root, "tests/fixtures/POE_urinal_screen_deodorizer_2026-09-15.json"),
]);
await page.waitForSelector("#sec-overview", { timeout: 20000 });
await page.waitForTimeout(1500);

const open = await page.$$eval("details.seccol[open]", (ds) => ds.map((d) => d.dataset.sec));
const closed = await page.$$eval("details.seccol:not([open])", (ds) => ds.map((d) => d.dataset.sec));
console.log("открыты:", open.join(", "));
console.log("свёрнуты:", closed.length, "—", closed.join(", "));

// Высота страницы до и после: ради этого всё и затевалось.
const hBefore = await page.evaluate(() => document.querySelector("#dashboard").scrollHeight);
await page.screenshot({ path: OUT + "probe23-collapsed.png", fullPage: false });
await page.screenshot({ path: OUT + "probe23-collapsed-full.png", fullPage: true });

// Разворачиваем «Конкурентную карту» — проверяем, что график не остался нулевым.
await page.click('details.seccol[data-sec="competitors"] > summary');
await page.waitForTimeout(900);
const canvas = await page.$eval("#ch-brands", (c) => ({ w: c.width, h: c.height, cw: c.clientWidth, ch: c.clientHeight }));
console.log("график в развёрнутой секции:", JSON.stringify(canvas), canvas.cw > 50 && canvas.ch > 50 ? "— нарисован" : "— НУЛЕВОЙ, нужен resize");
const sec = page.locator("#sec-competitors");
await sec.screenshot({ path: OUT + "probe23-competitors.png" });

// Состояние переживает пересчёт (ввод цифры в панели).
await page.fill('[data-input="cogs"]', "5.5");
await page.waitForTimeout(1200);
const open2 = await page.$$eval("details.seccol[open]", (ds) => ds.map((d) => d.dataset.sec));
console.log("после пересчёта открыты:", open2.join(", "), open2.includes("competitors") ? "— состояние сохранилось" : "— СОСТОЯНИЕ ПОТЕРЯНО");

const hAfter = await page.evaluate(() => document.querySelector("#dashboard").scrollHeight);
console.log(`высота дашборда: ${hBefore} px свёрнутый -> ${hAfter} px с раскрытой картой`);

// Перезагрузка: состояние живёт в браузере.
await page.reload({ waitUntil: "load" });
await page.waitForSelector("#sec-overview", { timeout: 20000 });
await page.waitForTimeout(1500);
const open3 = await page.$$eval("details.seccol[open]", (ds) => ds.map((d) => d.dataset.sec));
console.log("после F5 открыты:", open3.join(", "));

console.log("\nснимки:", OUT + "probe23-collapsed.png", "·", OUT + "probe23-collapsed-full.png", "·", OUT + "probe23-competitors.png");
await browser.close(); srv.kill();
