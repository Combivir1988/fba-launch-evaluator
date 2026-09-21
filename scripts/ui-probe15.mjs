// spec 008 «Правила сеансов»: администратор включает выход при бездействии → за минуту до выхода предупреждение с отсчётом → «Остаться» продлевает →
// при полном бездействии несохранённое сохраняется, сеанс завершается, страница входа объясняет причину → повторный вход, изменения на месте; обычный пользователь блока не видит.
// Время в браузере управляется часами Playwright (минуты бездействия проматываются мгновенно); серверное правило проверено в tests/session-policy.test.js.
import { chromium } from "playwright";
import { startServer, loginContext, ADMIN } from "./probe-helper.mjs";

const { srv, base } = await startServer(3995); const browser = await chromium.launch(); const logs = [];
const ok = (c, l) => { console.log((c ? "✔ " : "✖ ") + l); if (!c) process.exitCode = 1; };
const H = { "content-type": "application/json", "x-requested-with": "fba" };
try {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } }); const page = await ctx.newPage();
  page.on("console", (m) => { if (m.type() === "error" && !/401|404/.test(m.text())) logs.push(m.text()); }); page.on("pageerror", (e) => logs.push("pageerror: " + e.message));
  await loginContext(ctx, base); await page.clock.install(); await page.goto(base + "/#settings", { waitUntil: "networkidle" });
  await page.waitForFunction(() => document.querySelectorAll("#sp-idle option").length === 8, null, { timeout: 15000 });
  ok((await page.$$eval("#sp-idle option", (o) => o.map((x) => x.textContent))).join("|").includes("15 минут") && (await page.$$("#sp-max option")).length === 4, "администратор видит блок «Сеансы»: 8 вариантов бездействия, 4 — длительности");
  ok(/Правила не задавались/.test(await page.textContent("#sp-msg")), "по умолчанию правил нет");
  await page.selectOption("#sp-idle", "15"); await page.waitForFunction(() => /Изменено:/.test(document.querySelector("#sp-msg").textContent), null, { timeout: 10000 });
  const me = await (await ctx.request.get(base + "/api/auth/me")).json(); ok(me.sessionPolicy.idleMinutes === 15, "правило сохранено на сервере и приходит приложению: 15 минут");

  await page.evaluate(() => document.querySelector('[data-tab="analysis"]').click()); await page.fill("#f-niche", "проба бездействия"); await page.dispatchEvent("#f-niche", "input");
  await page.mouse.move(300, 300); await page.clock.runFor("13:30"); ok(!(await page.evaluate(() => document.querySelector("#idle-dlg").open)), "13,5 минуты бездействия — предупреждения ещё нет");
  await page.clock.runFor("00:40"); ok(await page.evaluate(() => document.querySelector("#idle-dlg").open), "за минуту до выхода — предупреждение «Вы ещё здесь?»");
  const left1 = Number(await page.textContent("[data-idle-left]")); await page.clock.runFor("00:10"); const left2 = Number(await page.textContent("[data-idle-left]")); ok(left1 > left2 && left2 > 0 && left2 <= 50, `обратный отсчёт идёт: ${left1} → ${left2} с`);
  await page.evaluate(() => document.querySelector("[data-idle-stay]").click()); /* при подменённых часах обычный click ждёт кадр анимации */
  ok(!(await page.evaluate(() => document.querySelector("#idle-dlg").open)) && page.url().startsWith(base + "/") && !page.url().includes("login"), "«Остаться» закрывает предупреждение, сеанс продолжается");
  await page.clock.runFor("10:00"); await page.mouse.move(420, 360); await page.clock.runFor("10:00"); ok(!(await page.evaluate(() => document.querySelector("#idle-dlg").open)) && !page.url().includes("login"), "движение мыши считается активностью: 20 минут с одним движением — без выхода");

  await Promise.all([page.waitForURL(/login\.html/, { timeout: 20000 }), page.clock.runFor("15:30")]);
  ok(/reason=idle|login\.html/.test(page.url()), "полное бездействие 15 минут → страница входа");
  await page.waitForFunction(() => /из-за бездействия/.test(document.querySelector("#login-msg")?.textContent || ""), null, { timeout: 10000 }); ok(true, "страница входа объясняет причину: «Сеанс завершён из-за бездействия»");
  ok((await ctx.request.get(base + "/api/auth/me")).status() === 401, "сеанс действительно завершён на сервере");

  await loginContext(ctx, base); const list = await (await ctx.request.get(base + "/api/analyses")).json(); const items = list.items || list.analyses || list;
  ok(JSON.stringify(items).includes("проба бездействия"), "несохранённое изменение сохранено перед выходом");

  // обычный пользователь: блока нет, правило менять нельзя
  await ctx.request.post(base + "/api/users", { headers: H, data: { login: "ann", name: "Ann", role: "user", password: "ann-temp-pass-1" } });
  const ctx2 = await browser.newContext(); await loginContext(ctx2, base, { login: "ann", temp: "ann-temp-pass-1", password: "ann-real-pass-1" }); const p2 = await ctx2.newPage(); await p2.goto(base + "/#settings", { waitUntil: "networkidle" });
  ok(await p2.evaluate(() => document.querySelector("#set-users").classList.contains("hidden")), "обычный пользователь блока «Сеансы» не видит");
  ok((await ctx2.request.put(base + "/api/admin/session-policy", { headers: H, data: { idleMinutes: 0, maxDays: 0 } })).status() === 403, "и изменить правило не может (403)");
  ok(logs.length === 0, "ошибок в консоли нет" + (logs.length ? ": " + logs.slice(0, 3).join(" | ") : ""));
} catch (e) { console.error("✖ проба упала:", e.message); process.exitCode = 1; }
finally { await browser.close(); srv.kill(); }
