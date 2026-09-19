// spec 003 — ценовой диапазон анализа: ввод границ → пересчёт конкурентов → выбор сегмента кнопкой → некорректный диапазон →
// сброс (значения как в начале) → F5 (диапазон сохранён на сервере) → публичная ссылка с пометкой о диапазоне.
import { chromium } from "playwright";
import { startServer, loginContext } from "./probe-helper.mjs";

const { srv, base } = await startServer(3985);
const browser = await chromium.launch(); const logs = [];
const ok = (c, l) => { console.log((c ? "✔ " : "✖ ") + l); if (!c) process.exitCode = 1; };
try {
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 1000 } }); const page = await ctx.newPage();
  page.on("console", (m) => { if (m.type() === "error" && !/401|404/.test(m.text())) logs.push(m.text()); }); page.on("pageerror", (e) => logs.push("pageerror: " + e.message));
  await loginContext(ctx, base); await page.goto(base + "/", { waitUntil: "networkidle" });
  await page.fill("#f-core", "sound deadening mat");
  await page.setInputFiles("#file-input", ["tests/fixtures/Helium_10_Xray_2026-08-21.csv", "tests/fixtures/US_AMAZON_cerebro__2026-08-21.csv", "tests/fixtures/POE_urinal_screen_deodorizer_2026-09-15.json"]);
  await page.waitForFunction(() => document.querySelectorAll(".filecard").length >= 3, null, { timeout: 30000 }); await page.waitForTimeout(800);
  const snap = () => page.evaluate(() => { const g = (k) => [...document.querySelectorAll("#sec-criterion1 .gate")].find((x) => x.querySelector(".id")?.textContent === k)?.querySelector(".val")?.textContent.trim(); return { a: g("1a"), b: g("1b"), c: g("1c"), d: g("1d"), e: g("1e"), f: g("1f"), g: g("1g"), h: g("1h"), traffic: document.querySelector("#sec-traffic .tiles")?.textContent.replace(/\s+/g, " ") }; });
  const prices = () => page.$$eval("#sec-competitors tbody tr td:nth-child(4)", (tds) => tds.map((t) => Number(t.textContent.replace(/[^0-9,.-]/g, "").replace(",", "."))));
  const openBand = () => page.evaluate(() => document.querySelector("#f-pmin").closest("details").setAttribute("open", ""));
  const before = await snap(); const pricesAll = await prices();
  ok((await page.textContent("#band-stats")).includes("Диапазон не задан"), "без диапазона: " + (await page.textContent("#band-stats")).trim());
  ok(!(await page.textContent("#sec-hero")).includes("Анализ сужен"), "без диапазона в шапке нет пометки");

  await openBand(); await page.fill("#f-pmin", "20"); await page.fill("#f-pmax", "40"); await page.dispatchEvent("#f-pmax", "change");
  await page.waitForFunction(() => document.querySelector("#sec-hero")?.textContent.includes("Анализ сужен до цен $20–$40"), null, { timeout: 10000 });
  ok(true, "шапка: " + (await page.textContent("#sec-hero .bandnote")).trim().slice(0, 110) + "…");
  const stats = (await page.textContent("#band-stats")).trim(); ok(/В диапазоне \d+ из \d+ листингов, \d+ % выручки ниши/.test(stats), "счётчик в панели: " + stats);
  const inBand = await snap(); const pricesBand = await prices();
  ok(pricesBand.length > 0 && pricesBand.every((p) => p >= 20 && p <= 40) && pricesAll.some((p) => p > 40 || p < 20), `таблица конкурентов: ${pricesBand.length} строк, все цены в 20–40 (до фильтра были вне диапазона)`);
  ok(inBand.e !== before.e || inBand.f !== before.f || inBand.d !== before.d, `конкурентные показатели пересчитаны: 1e ${before.e} → ${inBand.e}, 1f ${before.f} → ${inBand.f}, 1d ${before.d} → ${inBand.d}`);
  ok(inBand.a === before.a && inBand.c === before.c && inBand.g === before.g && inBand.h === before.h && inBand.traffic === before.traffic, `спрос и размер рынка не изменились: 1a ${inBand.a}, 1c ${inBand.c}`);
  ok((await page.textContent("#sec-criterion1")).includes("Статус — по всей нише") && (await page.textContent("#sec-competitors")).includes("против всей ниши"), "у 1a две цифры, в конкурентах блок сравнения с нишей");
  ok(await page.$eval("#band-badge", (e) => !e.classList.contains("hidden") && e.textContent.includes("$20")), "значок диапазона в заголовке раздела панели");

  await page.click("#sec-pricing .seg-pick >> nth=2");
  await page.waitForFunction(() => document.querySelector("#sec-pricing tr.seg-selected") && !document.querySelector("#sec-hero").textContent.includes("$20–$40"), null, { timeout: 10000 });
  const picked = await page.evaluate(() => [document.querySelector("#f-pmin").value, document.querySelector("#f-pmax").value]);
  ok(Number(picked[0]) > 0 && Number(picked[1]) > Number(picked[0]), `выбор сегмента Premium одной кнопкой: границы ${picked[0]}–${picked[1]} подставлены в панель`);

  await page.fill("#f-pmin", "90"); await page.fill("#f-pmax", "10"); await page.dispatchEvent("#f-pmax", "change");
  await page.waitForFunction(() => document.querySelector("#f-pmin").classList.contains("invalid"), null, { timeout: 10000 });
  const invalid = await snap();
  ok((await page.textContent("#band-stats")).includes("больше верхней") && invalid.e === before.e, "некорректный диапазон: поля подсвечены, причина показана, расчёт по всей нише");

  await page.click("#band-reset"); await page.waitForFunction(() => !document.querySelector("#sec-hero").textContent.includes("Анализ сужен") && document.querySelector("#f-pmin").value === "", null, { timeout: 10000 });
  ok(JSON.stringify(await snap()) === JSON.stringify(before), "«Сбросить»: все показатели вернулись к исходным до последней цифры");

  await page.fill("#f-pmin", "20"); await page.fill("#f-pmax", "40"); await page.dispatchEvent("#f-pmax", "change");
  await page.waitForFunction(() => document.querySelector("#save-state")?.textContent.includes("сохранено в общую"), null, { timeout: 20000 });
  await page.reload({ waitUntil: "networkidle" }); await page.waitForFunction(() => document.querySelector("#sec-hero")?.textContent.includes("Анализ сужен до цен $20–$40"), null, { timeout: 15000 });
  ok((await page.inputValue("#f-pmin")) === "20" && (await page.inputValue("#f-pmax")) === "40", "после F5 диапазон на месте (сохранён в общей истории)");

  const id = await page.evaluate(() => localStorage.getItem("fba_last"));
  const sh = await (await ctx.request.post(base + `/api/analyses/${id}/shares`, { headers: { "content-type": "application/json", "x-requested-with": "fba" }, data: { mode: "no_economics", expiresInDays: 7 } })).json();
  const guest = await (await browser.newContext({ viewport: { width: 1200, height: 900 } })).newPage();
  await guest.goto(base + sh.share.path, { waitUntil: "load" }); await guest.waitForSelector("#sec-hero .bandnote", { timeout: 15000 });
  ok((await guest.textContent("#sec-hero")).includes("Анализ сужен до цен $20–$40") && (await guest.$$("#dashboard .seg-pick")).length === 0, "гость по публичной ссылке (режим без экономики) видит пометку о диапазоне, кнопок выбора нет");
  console.log("console:", logs.join("\n") || "(чисто)"); if (logs.length) process.exitCode = 1;
} catch (e) { console.error("PROBE FAILED:", e.message.split("\n")[0]); console.log("console:", logs.join("\n")); process.exitCode = 1; }
finally { await browser.close(); srv.kill(); }
