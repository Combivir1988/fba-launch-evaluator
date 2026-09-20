// Подсказка CVR из SQP: без SQP подсказки нет → после загрузки SQP под ползунком появляется «клик → покупка» (рынок и свой ASIN) →
// «подставить» меняет CVR и пересчитывает экономику → значение сохраняется после F5.
import { chromium } from "playwright";
import { startServer, loginContext } from "./probe-helper.mjs";

const { srv, base } = await startServer(3984);
const browser = await chromium.launch(); const logs = [];
const ok = (c, l) => { console.log((c ? "✔ " : "✖ ") + l); if (!c) process.exitCode = 1; };
try {
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 1000 } }); const page = await ctx.newPage();
  page.on("console", (m) => { if (m.type() === "error" && !/401|404/.test(m.text())) logs.push(m.text()); }); page.on("pageerror", (e) => logs.push("pageerror: " + e.message));
  await loginContext(ctx, base); await page.goto(base + "/", { waitUntil: "networkidle" });
  await page.fill("#f-core", "urinal screen deodorizer");
  await page.setInputFiles("#file-input", ["tests/fixtures/POE_urinal_screen_deodorizer_2026-09-15.json"]);
  await page.waitForFunction(() => document.querySelectorAll(".filecard").length >= 1);
  await page.evaluate(() => document.querySelector("#s-cvr").closest("details").setAttribute("open", ""));
  for (const [sel, v] of [["#f-cogs", "4.37"], ["#f-cpc", "1.27"]]) { await page.fill(sel, v); await page.dispatchEvent(sel, "change"); }
  await page.waitForTimeout(600);
  const noSqp = (await page.textContent("#cvr-hint")).replace(/\s+/g, " ").trim();
  ok(/допущение, не данные/.test(noSqp) && /SQP/.test(noSqp) && /POE: \d+,\d % поисков/.test(noSqp) && /Безубыточный CVR/.test(noSqp) && (await page.$$("#cvr-hint [data-cvr-set]")).length === 0, "без SQP — пояснение вместо пустого места: " + noSqp.slice(0, 150) + "…");
  const netBefore = await page.evaluate(() => document.querySelector("#sec-economics")?.textContent.replace(/\s+/g, " ").slice(0, 4000));

  await page.setInputFiles("#file-input", ["tests/fixtures/SQP_synthetic_urinal_screen.csv"]);
  await page.waitForFunction(() => document.querySelector("#cvr-hint [data-cvr-set]"), null, { timeout: 15000 });
  const hint = (await page.textContent("#cvr-hint")).replace(/\s+/g, " ").trim();
  ok(/рынок: 1[0-9],[0-9] %/.test(hint) && /ваш ASIN: 1[0-9],[0-9] %/.test(hint), "подсказка под ползунком: " + hint.slice(0, 170));
  ok((await page.inputValue("#s-cvr")) === "10", "сама подсказка CVR не меняет — в расчёте по-прежнему 10 %");
  ok((await page.textContent("#sec-economics")).includes("по SQP"), "в пункте 2c дашборда видна сверка с SQP");

  await page.click("#cvr-hint [data-cvr-set] >> nth=0");
  await page.waitForFunction(() => document.querySelector("#s-cvr").value !== "10", null, { timeout: 10000 });
  const v = await page.inputValue("#s-cvr");
  ok(Number(v) >= 11.5 && Number(v) <= 12.5, "«подставить» (рынок): CVR = " + v + " %");
  const netAfter = await page.evaluate(() => document.querySelector("#sec-economics")?.textContent.replace(/\s+/g, " ").slice(0, 4000));
  ok(netAfter !== netBefore, "экономика пересчитана с новой конверсией");
  await page.waitForFunction(() => document.querySelector("#save-state")?.textContent.includes("сохранено в общую"), null, { timeout: 20000 });
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForFunction(() => document.querySelector("#cvr-hint [data-cvr-set]"), null, { timeout: 15000 });
  ok((await page.inputValue("#s-cvr")) === v, "после F5 CVR " + v + " % и подсказка на месте");
  console.log("console:", logs.join("\n") || "(чисто)"); if (logs.length) process.exitCode = 1;
} catch (e) { console.error("PROBE FAILED:", e.message.split("\n")[0]); console.log("console:", logs.join("\n")); process.exitCode = 1; }
finally { await browser.close(); srv.kill(); }
