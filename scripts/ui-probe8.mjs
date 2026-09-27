// spec 002, US2: одноразовый перенос локальной истории браузера (IndexedDB версии 001) в общую историю.
// Проверяет: предложение переноса, авторство, идемпотентность (повтор добавляет 0), локальная копия не удаляется.
import { chromium } from "playwright";
import { startServer, loginContext } from "./probe-helper.mjs";

const { srv, base } = await startServer(3989);
const browser = await chromium.launch();
const logs = []; const ok = (c, l) => { console.log((c ? "✔ " : "✖ ") + l); if (!c) process.exitCode = 1; };
try {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } }); const page = await ctx.newPage();
  page.on("console", (m) => { if (m.type() === "error" && !/401|404/.test(m.text())) logs.push(m.text()); }); page.on("pageerror", (e) => logs.push("pageerror: " + e.message));
  // 1) «старый браузер»: три анализа в IndexedDB, как их хранила версия 001
  await page.goto(base + "/login.html", { waitUntil: "networkidle" });
  const ids = await page.evaluate(async () => {
    const { newAnalysis } = await import("/shared/analysis.js");
    const docs = ["bike tube", "urinal screen", "towel rack"].map((n, i) => { const a = newAnalysis({ niche: n, coreKeyword: n }); a.inputs.cogs = 3 + i; a.updatedAt = a.createdAt = new Date(Date.UTC(2026, 7, 1 + i)).toISOString(); return a; });
    await new Promise((res, rej) => {
      const req = indexedDB.open("fba-launch-evaluator", 1);
      req.onupgradeneeded = () => req.result.createObjectStore("analyses", { keyPath: "id" }).createIndex("updatedAt", "updatedAt");
      req.onsuccess = () => { const t = req.result.transaction("analyses", "readwrite"); docs.forEach((d) => t.objectStore("analyses").put(d)); t.oncomplete = () => { req.result.close(); res(); }; t.onerror = () => rej(t.error); };
      req.onerror = () => rej(req.error);
    });
    localStorage.setItem("fba_last", docs[1].id);
    return docs.map((d) => d.id);
  });
  await loginContext(ctx, base);
  await page.goto(base + "/", { waitUntil: "networkidle" });
  await page.click('.topbar nav button[data-tab="history"]');
  await page.waitForSelector("#migrate-bar:not(.hidden)");
  ok((await page.textContent("#migrate-bar")).includes("3"), "предложение переноса показывает число локальных анализов");
  ok((await ctx.request.get(base + "/api/analyses").then((r) => r.json())).total === 0, "до переноса общая история пуста");
  await page.click("#migrate-go");
  await page.waitForFunction(() => /Перенесено: \+3 новых, 0 уже были/.test(document.querySelector("#migrate-msg")?.textContent || ""), null, { timeout: 30000 });
  ok(true, "перенос: " + (await page.textContent("#migrate-msg")));
  const list = await ctx.request.get(base + "/api/analyses").then((r) => r.json());
  ok(list.total === 3 && list.items.every((i) => i.createdBy.name === "Администратор"), "в общей истории 3 анализа, автор — выполнивший перенос");
  ok(list.items.map((i) => i.id).sort().join() === [...ids].sort().join(), "идентификаторы сохранены");
  ok(new Date(list.items.find((i) => i.niche === "bike tube").updatedAt).toISOString().startsWith("2026-08-01"), "исходные даты сохранены");
  await page.waitForFunction(() => document.querySelectorAll("#histlist .histrow").length === 3);
  await page.waitForFunction(() => document.querySelector("#f-core")?.value === "urinal screen", null, { timeout: 10000 });
  ok(true, "последний открытый локально анализ открыт из общей истории");
  // 2) повторный перенос из настроек — ноль новых
  await page.click('.topbar nav button[data-tab="settings"]'); await page.click("#set-migrate");
  await page.waitForFunction(() => /\+0 новых, 3 уже были/.test(document.querySelector("#set-migrate-msg")?.textContent || ""), null, { timeout: 30000 });
  ok((await ctx.request.get(base + "/api/analyses").then((r) => r.json())).total === 3, "повторный перенос добавил 0 (SC-010): " + (await page.textContent("#set-migrate-msg")));
  const localLeft = await page.evaluate(() => new Promise((res) => { const r = indexedDB.open("fba-launch-evaluator"); r.onsuccess = () => { const g = r.result.transaction("analyses").objectStore("analyses").count(); g.onsuccess = () => res(g.result); }; }));
  ok(localLeft === 3, "локальная копия в браузере не удалена (страховка)");
  await page.reload({ waitUntil: "networkidle" }); await page.click('.topbar nav button[data-tab="history"]');
  ok(await page.$eval("#migrate-bar", (el) => el.classList.contains("hidden")), "после переноса предложение больше не показывается");
  console.log("console:", logs.join("\n") || "(чисто)"); if (logs.length) process.exitCode = 1;
} catch (e) { console.error("PROBE FAILED:", e.message); console.log("console:", logs.join("\n")); process.exitCode = 1; }
finally { await browser.close(); srv.kill(); }
