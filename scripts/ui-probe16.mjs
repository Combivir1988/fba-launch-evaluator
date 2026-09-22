// spec 009: два человека на одном браузере — каждый видит при входе свой последний анализ; чужой анализ помечен автором с кнопкой «Работать над копией»;
// перезаписанный анализ возвращается через «🕘 Версии» → «Восстановить»; восстановление обратимо.
import { chromium } from "playwright";
import { startServer, loginContext, ADMIN } from "./probe-helper.mjs";

const POE = "tests/fixtures/POE_urinal_screen_deodorizer_2026-09-15.json";
const { srv, base } = await startServer(3996); const browser = await chromium.launch(); const logs = [];
const ok = (c, l) => { console.log((c ? "✔ " : "✖ ") + l); if (!c) process.exitCode = 1; };
const H = { "content-type": "application/json", "x-requested-with": "fba" };
const saved = (page) => page.waitForFunction(() => document.querySelector("#save-state")?.textContent.includes("сохранено"), null, { timeout: 30000 });
const logoutVia = async (ctx) => { await ctx.request.post(base + "/api/auth/logout", { headers: H }); };
try {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } }); const page = await ctx.newPage();
  page.on("console", (m) => { if (m.type() === "error" && !/401|404/.test(m.text())) logs.push(m.text()); }); page.on("pageerror", (e) => logs.push("pageerror: " + e.message));
  // администратор создаёт анализ «Amaranthus»
  await loginContext(ctx, base); await page.goto(base + "/", { waitUntil: "networkidle" });
  await page.fill("#f-niche", "Amaranthus artificial flower"); await page.fill("#f-core", "amaranthus"); await page.setInputFiles("#file-input", [POE]); await page.waitForFunction(() => document.querySelectorAll(".filecard").length === 1);
  await saved(page); const adminAnalysis = await page.evaluate(() => JSON.parse(localStorage.getItem("fba_last") || "null")); ok(adminAnalysis === null, "в браузере больше не хранится «последний анализ»");
  const me = await (await ctx.request.get(base + "/api/auth/me")).json(); const idA = me.user.settings.lastAnalysisId; ok(/^[0-9a-f-]{36}$/.test(idA || ""), "последний анализ записан в учётную запись администратора");
  await page.reload({ waitUntil: "networkidle" }); ok((await page.inputValue("#f-niche")) === "Amaranthus artificial flower", "после F5 у администратора открыт его анализ");
  ok(await page.evaluate(() => document.querySelector("#foreign-note").classList.contains("hidden")), "свой анализ — без предупреждения об авторе");

  // на том же браузере входит новый пользователь
  await ctx.request.post(base + "/api/users", { headers: H, data: { login: "iryna", name: "Iryna", role: "user", password: "iryna-temp-pass-1" } });
  await logoutVia(ctx); await loginContext(ctx, base, { login: "iryna", temp: "iryna-temp-pass-1", password: "iryna-real-pass-1" }); await page.goto(base + "/", { waitUntil: "networkidle" });
  ok((await page.inputValue("#f-niche")) === "" && (await page.$$(".filecard")).length === 0, "новый пользователь видит пустой новый анализ, а не чужой");
  // она открывает чужой анализ из истории
  await page.evaluate(() => document.querySelector('[data-tab="history"]').click()); await page.waitForFunction(() => document.querySelector(`[data-open]`), null, { timeout: 10000 });
  await page.evaluate((id) => document.querySelector(`[data-open="${id}"]`).click(), idA); await page.waitForFunction(() => document.querySelector("#f-niche").value.includes("Amaranthus"), null, { timeout: 10000 });
  const note = await page.evaluate(() => { const n = document.querySelector("#foreign-note"); return { hidden: n.classList.contains("hidden"), text: n.textContent.replace(/\s+/g, " ") }; });
  ok(!note.hidden && /Автор этого анализа — Администратор/.test(note.text) && /Работать над копией/.test(note.text), "чужой анализ помечен автором и кнопкой «Работать над копией»");
  // …и всё же перезаписывает его
  await page.fill("#f-niche", "Urinal Deodorizer Tablets"); await page.dispatchEvent("#f-niche", "input"); await saved(page); await page.waitForTimeout(400);
  const meI = await (await ctx.request.get(base + "/api/auth/me")).json(); ok(meI.user.settings.lastAnalysisId === idA, "у Iryna свой «последний анализ» — тот, что она открыла");

  // администратор возвращается: видит свой последний анализ (перезаписанный) и восстанавливает версию
  await logoutVia(ctx); await loginContext(ctx, base); await page.goto(base + "/", { waitUntil: "networkidle" });
  ok((await page.inputValue("#f-niche")) === "Urinal Deodorizer Tablets", "администратор видит анализ в перезаписанном виде — история покажет, кто");
  await page.click("#btn-versions"); await page.waitForFunction(() => document.querySelectorAll("#versions-list [data-restore]").length >= 1, null, { timeout: 10000 });
  const rows = await page.$$eval("#versions-list tbody tr", (tr) => tr.map((r) => r.textContent.replace(/\s+/g, " ")));
  ok(rows.some((r) => /Amaranthus artificial flower/.test(r) && /Администратор/.test(r) && /до правок Iryna/.test(r)), "в версиях есть состояние «Amaranthus», записанное администратором, вытесненное правками Iryna: " + rows[0]);
  await page.evaluate(() => [...document.querySelectorAll("#versions-list tbody tr")].find((r) => /Amaranthus/.test(r.textContent)).querySelector("[data-restore]").click());
  await page.waitForFunction(() => document.querySelector("#f-niche").value === "Amaranthus artificial flower", null, { timeout: 15000 }); ok(true, "«Восстановить» вернул анализ «Amaranthus»");
  ok(/Версия восстановлена/.test(await page.textContent("#toast")), "сообщение о восстановлении");
  await page.click("#btn-versions"); await page.waitForFunction(() => document.querySelectorAll("#versions-list [data-restore]").length >= 2, null, { timeout: 10000 });
  const rows2 = await page.$$eval("#versions-list tbody tr", (tr) => tr.map((r) => r.textContent.replace(/\s+/g, " ")));
  ok(/Urinal Deodorizer Tablets/.test(rows2[0]) && /до восстановления/.test(rows2[0]), "состояние до восстановления тоже в списке — шаг обратим");
  await page.click("#versions-close");
  // из «Истории»: у карточки чип «версий: N» и своя кнопка «Версии»; восстановление оттуда открывает анализ
  await page.evaluate(() => document.querySelector('[data-tab="history"]').click()); await page.waitForFunction((id) => document.querySelector(`[data-versions="${id}"]`), idA, { timeout: 10000 });
  const card = await page.evaluate((id) => document.querySelector(`[data-open="${id}"]`).closest(".histrow").textContent.replace(/\s+/g, " "), idA); ok(/версий: \d+/.test(card), "карточка в истории показывает число версий: " + card.slice(0, 80));
  await page.evaluate((id) => document.querySelector(`[data-versions="${id}"]`).click(), idA); await page.waitForFunction(() => document.querySelectorAll("#versions-list [data-restore]").length >= 2, null, { timeout: 10000 });
  ok(/Amaranthus artificial flower/.test(await page.textContent("#versions-title")), "диалог из истории назван по нише карточки");
  await page.evaluate(() => [...document.querySelectorAll("#versions-list tbody tr")].find((r) => /Urinal Deodorizer/.test(r.textContent)).querySelector("[data-restore]").click());
  await page.waitForFunction(() => document.querySelector("#f-niche").value === "Urinal Deodorizer Tablets" && !document.querySelector("#tab-analysis").classList.contains("hidden"), null, { timeout: 15000 }); ok(true, "восстановление из истории открывает восстановленный анализ во вкладке «Анализ»");
  ok((await page.$$eval(".filecard", (x) => x.length)) === 1, "восстановленный анализ открыт со своим отчётом");
  ok(logs.length === 0, "ошибок в консоли нет" + (logs.length ? ": " + logs.slice(0, 3).join(" | ") : ""));
} catch (e) { console.error("✖ проба упала:", e.message); process.exitCode = 1; }
finally { await browser.close(); srv.kill(); }
