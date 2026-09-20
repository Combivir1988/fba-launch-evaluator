// spec 006 «Подсказки при наведении»: наведение на плитку, столбец прокручиваемой таблицы, поле панели и ползунок дашборда → подсказка видна целиком в пределах экрана;
// уход мыши, Esc и прокрутка её убирают; клавиатура (фокус) и 360 px работают; движение ползунка не ломает подсказки.
import { chromium } from "playwright";
import { startServer, loginContext } from "./probe-helper.mjs";

const { srv, base } = await startServer(3987);
const browser = await chromium.launch(); const logs = [];
const ok = (c, l) => { console.log((c ? "✔ " : "✖ ") + l); if (!c) process.exitCode = 1; };
try {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } }); const page = await ctx.newPage();
  page.on("console", (m) => { if (m.type() === "error" && !/401|404/.test(m.text())) logs.push(m.text()); }); page.on("pageerror", (e) => logs.push("pageerror: " + e.message));
  await loginContext(ctx, base); await page.goto(base + "/", { waitUntil: "networkidle" });
  await page.fill("#f-niche", "urinal screen deodorizer"); await page.fill("#f-core", "urinal screen deodorizer");
  await page.setInputFiles("#file-input", ["tests/fixtures/POE_urinal_screen_deodorizer_2026-09-15.json"]);
  await page.waitForFunction(() => document.querySelectorAll(".filecard").length >= 1, null, { timeout: 20000 });
  await page.evaluate(() => document.querySelector("#f-cogs").closest("details").setAttribute("open", ""));
  for (const [sel, v] of [["#f-price", "24.99"], ["#f-cogs", "4.37"], ["#f-cpc", "1.27"]]) { await page.fill(sel, v); await page.dispatchEvent(sel, "change"); }
  await page.waitForFunction(() => /Пик вложений/.test(document.querySelector("#sec-cashflow")?.textContent || ""), null, { timeout: 15000 });

  const tip = () => page.evaluate(() => { const b = document.querySelector("#fba-tipbox"); if (!b || b.hidden) return null; const r = b.getBoundingClientRect(); return { text: b.textContent, left: r.left, top: r.top, right: r.right, bottom: r.bottom, vw: document.documentElement.clientWidth, vh: innerHeight }; });
  const inside = (t) => t && t.left >= 0 && t.top >= 0 && t.right <= t.vw + 1 && t.bottom <= t.vh + 1;
  const hoverText = async (scope, text) => { const h = await page.evaluateHandle(([s, tx]) => [...document.querySelectorAll(s + " [data-tip]")].find((x) => x.textContent.trim().startsWith(tx)), [scope, text]); const el = h.asElement(); await el.scrollIntoViewIfNeeded(); await page.mouse.move(0, 0); await el.hover(); await page.waitForTimeout(260); return tip(); };

  ok((await page.$$("#dashboard [data-tip]")).length >= 90, "в дашборде пояснений: " + (await page.$$("#dashboard [data-tip]")).length);
  let t = await hoverText("#sec-overview", "Adj. SV"); ok(t && /Скорректированный поисковый объём/.test(t.text) && inside(t), "плитка «Adj. SV»: подсказка видна и в пределах экрана");
  await page.mouse.move(700, 5); await page.waitForTimeout(200); ok((await tip()) === null, "мышь ушла — подсказка исчезла");
  t = await hoverText("#sec-cashflow .cashtable", "Отзывы"); ok(t && /Vine/.test(t.text) && inside(t), "последний столбец прокручиваемой таблицы: подсказка не обрезана таблицей и не выходит за экран");
  await page.keyboard.press("Escape"); ok((await tip()) === null, "Esc убирает подсказку");
  t = await hoverText("#sec-criterion1", "Niche Revenue"); ok(t && /\$500 тыс/.test(t.text), "пункт 1a Критерия 1");
  await page.mouse.wheel(0, 300); await page.waitForTimeout(150); ok((await tip()) === null, "прокрутка убирает подсказку");
  t = await hoverText(".side", "COGS"); ok(t && /Себестоимость одной штуки/.test(t.text) && inside(t), "поле панели «COGS»");
  t = await hoverText(".side details > summary", "6. Экономика"); ok(t && /Ваши числа/.test(t.text), "раздел панели «Экономика и бюджет»");
  t = await hoverText("#sec-quick", "CVR"); ok(t && /превратится в покупки/.test(t.text), "ползунок «CVR» в дашборде");

  // клавиатура
  await page.mouse.move(0, 0); await page.evaluate(() => [...document.querySelectorAll("#sec-overview .tile .k [data-tip]")].find((x) => x.textContent.startsWith("Top brand")).focus()); await page.waitForTimeout(80);
  t = await tip(); ok(t && /25 %/.test(t.text), "фокус с клавиатуры показывает подсказку");
  await page.evaluate(() => document.activeElement.blur()); ok((await tip()) === null, "потеря фокуса убирает её");

  // ползунок перерисовывает секции — подсказки на новых элементах живы, старая не зависла
  await hoverText("#sec-cashflow", "Пик вложений");
  await page.evaluate(() => { const el = document.querySelector('#sec-quick [data-quick="unitsPerDay"]'); el.value = "25"; el.dispatchEvent(new Event("input", { bubbles: true })); }); await page.waitForTimeout(300);
  ok(await page.evaluate(() => { const b = document.querySelector("#fba-tipbox"); if (b.hidden) return true; const el = document.querySelector('[aria-describedby="fba-tipbox"]'); return Boolean(el && el.isConnected && el.getAttribute("data-tip") === b.textContent); }), "секция перерисована ползунком — подсказка не зависла: скрыта или привязана к новому элементу под курсором"); t = await hoverText("#sec-cashflow", "Пик вложений"); ok(t && /Максимальная сумма/.test(t.text), "после перерисовки подсказки работают");

  // 360 px: касание
  await page.setViewportSize({ width: 360, height: 760 }); await page.waitForTimeout(400);
  const h = await page.evaluateHandle(() => [...document.querySelectorAll("#sec-overview .tile .k [data-tip]")].find((x) => x.textContent.startsWith("Топ-5 брендов"))); await h.asElement().evaluate((el) => { el.scrollIntoView({ block: "center" }); }); await page.waitForTimeout(250); await h.asElement().evaluate((el) => el.dispatchEvent(new MouseEvent("click", { bubbles: true }))); await page.waitForTimeout(120);
  t = await tip(); ok(t && inside(t) && t.right - t.left <= 344, "360 px: подсказка по касанию помещается в экран (ширина " + (t ? Math.round(t.right - t.left) : "—") + " px)");
  const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth); ok(over <= 2, "360 px: горизонтальной прокрутки нет");
  ok(logs.length === 0, "ошибок в консоли нет" + (logs.length ? ": " + logs.slice(0, 3).join(" | ") : ""));
} catch (e) { console.error("✖ проба упала:", e.message); process.exitCode = 1; }
finally { await browser.close(); srv.kill(); }
