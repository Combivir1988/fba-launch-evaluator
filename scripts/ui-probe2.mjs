import { chromium } from "playwright";
import { spawn } from "node:child_process";
import path from "node:path";
const root = process.cwd(); const OUT = "C:/Users/User/AppData/Local/Temp/claude/f--Claude-Code-Allegro/c3aa2767-d354-43da-bb93-da6326ff096b/scratchpad/";
const srv = spawn(process.execPath, ["server/index.js"], { env: { ...process.env, PORT: "3998", APP_PASSWORD: "dev", MOCK_AI: "1" }, stdio: ["ignore", "pipe", "pipe"] });
await new Promise((r) => setTimeout(r, 1500));
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 }, colorScheme: "dark" });
const page = await ctx.newPage();
const logs = []; page.on("console", (m) => { if (["error", "warning"].includes(m.type())) logs.push(m.type() + ": " + m.text()); }); page.on("pageerror", (e) => logs.push("pageerror: " + e.message));
await page.addInitScript(() => { localStorage.setItem("fba_theme", "dark"); localStorage.setItem("fba_token", "dev"); });
await page.goto("http://127.0.0.1:3998/", { waitUntil: "networkidle" });
await page.fill("#f-core", "sound deadening mat");
await page.setInputFiles("#file-input", ["tests/fixtures/Helium_10_Xray_2026-08-21.csv", "tests/fixtures/US_AMAZON_cerebro__2026-08-21.csv", "tests/fixtures/POE_urinal_screen_deodorizer_2026-09-15.json"].map((f) => path.join(root, f)));
await page.waitForFunction(() => document.querySelectorAll(".filecard").length >= 3, null, { timeout: 30000 });
await page.waitForTimeout(3000); // autosave
const painted = () => page.evaluate(() => [...document.querelectorAll?.("x") || document.querySelectorAll("#dashboard canvas")].map((c) => { const img = c.getContext("2d").getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 3; i < img.length; i += 4) if (img[i] > 0) n++; return c.id + ":" + n; }).join(" "));
console.log("DARK, свежая загрузка:", await painted());
await page.locator("#sec-trend").screenshot({ path: OUT + "trend-dark.png" });
await page.reload({ waitUntil: "networkidle" });
await page.waitForTimeout(3000);
console.log("DARK, после reload из истории:", await painted(), "| sections:", await page.evaluate(() => document.querySelectorAll("#dashboard [data-section]:not(.hidden)").length));
await page.locator("#sec-trend").screenshot({ path: OUT + "trend-reload.png" });
await page.locator("#sec-reviews").screenshot({ path: OUT + "reviews-reload.png" });
// переключение темы
await page.click("#theme-toggle"); await page.waitForTimeout(1500);
console.log("после переключения темы:", await painted());
console.log("console:", logs.join("\n") || "(чисто)");
await browser.close(); srv.kill();
