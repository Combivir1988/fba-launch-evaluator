import { chromium } from "playwright";
import { startServer, loginContext } from "./probe-helper.mjs";
import path from "node:path";
const root = process.cwd();
const { srv, base } = await startServer(3999);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
const logs = [];
page.on("console", (m) => { if (["error", "warning"].includes(m.type())) logs.push(m.type() + ": " + m.text()); });
page.on("pageerror", (e) => logs.push("pageerror: " + e.message));
await loginContext(page.context(), base);
await page.goto("http://127.0.0.1:3999/", { waitUntil: "networkidle" });
await page.click("#login-skip").catch(() => {});
await page.fill("#f-core", "sound deadening mat");
await page.setInputFiles("#file-input", [path.join(root, "tests/fixtures/Helium_10_Xray_2026-08-21.csv"), path.join(root, "tests/fixtures/US_AMAZON_cerebro__2026-08-21.csv"), path.join(root, "tests/fixtures/POE_urinal_screen_deodorizer_2026-09-15.json")]);
const toasts = []; page.on("console", () => {}); const t0 = Date.now(); await page.waitForFunction(() => document.querySelectorAll(".filecard").length >= 3, null, { timeout: 30000 }).catch(() => console.log("filecards<3 after 30s")); console.log("ждал мс:", Date.now() - t0, "| toast:", await page.locator("#toast").textContent()); await page.waitForTimeout(1500);
const info = await page.evaluate(() => {
  const d = document.getElementById("dashboard");
  const charts = Object.entries(d.__charts || {}).map(([k, c]) => [k, c.canvas?.width, c.canvas?.height, c.data?.datasets?.[0]?.data?.length]);
  const canvases = [...d.querySelectorAll("canvas")].map((c) => { let painted = -1; try { const ctx = c.getContext("2d"); const img = ctx.getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 3; i < img.length; i += 4) if (img[i] > 0) n++; painted = n; } catch (e) { painted = "err:" + e.message; } return [c.id, c.width, c.height, "painted px:", painted]; });
  const src = Object.fromEntries(Object.entries(JSON.parse(localStorage.getItem("__dbg")||"{}"))); return { hasChart: typeof window.Chart, charts, canvases, filecards: [...document.querySelectorAll(".filecard")].map((f) => f.textContent.trim()), sections: [...d.querySelectorAll("[data-section]")].filter((s) => !s.classList.contains("hidden")).length };
});
console.log(JSON.stringify(info));
console.log("console:", logs.slice(0, 15).join("\n") || "(чисто)");
for (const id of ["sec-trend","sec-reviews","sec-traffic"]) { const el = page.locator("#"+id); console.log(id, "visible:", await el.isVisible()); if (await el.isVisible()) await el.screenshot({ path: (process.env.PROBE_OUT || (await import("node:os")).tmpdir() + "/")+id+".png" }); }
await browser.close(); srv.kill();
