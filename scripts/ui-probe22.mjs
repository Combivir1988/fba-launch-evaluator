// Вход без «мигания» оболочкой: без действующего сеанса главная отвечает переходом на вход (HTML приложения не приходит вовсе),
// а при живом сеансе приложение показывается только после проверки — пока идёт проверка, видно «Проверяем сеанс…», а не пустой дашборд.
import { chromium } from "playwright";
import { startServer, loginContext, ADMIN } from "./probe-helper.mjs";

const { srv, base } = await startServer(3992); const browser = await chromium.launch(); const logs = [];
const ok = (c, l) => { console.log((c ? "✔ " : "✖ ") + l); if (!c) process.exitCode = 1; };
const visible = (page, sel) => page.evaluate((s) => { const el = document.querySelector(s); if (!el) return false; const st = getComputedStyle(el); return st.visibility !== "hidden" && st.display !== "none"; }, sel);
try {
  // 1. Без сеанса: сервер уводит на вход сам, оболочка не показывается
  const anon = await browser.newContext(); const p0 = await anon.newPage();
  p0.on("console", (m) => { if (m.type() === "error" && !/401|404/.test(m.text())) logs.push(m.text()); });
  const r0 = await p0.goto(base + "/?tab=history", { waitUntil: "networkidle" });
  ok(/\/login\.html/.test(p0.url()), "без сеанса открывается страница входа: " + p0.url().replace(base, ""));
  ok(/next=%2F%3Ftab%3Dhistory/.test(p0.url()), "адрес запомнен — после входа вернёмся куда шли");
  const chain = []; for (let r = r0.request(); r; r = r.redirectedFrom()) chain.push(r.url().replace(base, ""));
  ok(chain.includes("/?tab=history"), "переход сделал сервер (302), а не страница: " + chain.reverse().join(" → "));
  ok(await p0.evaluate(() => !document.querySelector("header.topbar")), "HTML приложения браузеру не отдавался");
  await anon.close();

  // 2. Живой сеанс: пока идёт проверка, вместо дашборда — «Проверяем сеанс…»
  const ctx = await browser.newContext(); await loginContext(ctx, base); const page = await ctx.newPage();
  page.on("console", (m) => { if (m.type() === "error" && !/401|404/.test(m.text())) logs.push(m.text()); });
  await ctx.route("**/api/auth/me", async (route) => { await new Promise((r) => setTimeout(r, 1200)); await route.continue(); });
  const nav = page.goto(base + "/", { waitUntil: "networkidle" });
  await page.waitForSelector("#boot", { state: "attached", timeout: 10000 });
  await page.waitForFunction(() => document.body.classList.contains("booting"), null, { timeout: 10000 });
  ok(await visible(page, "#boot"), "во время проверки видно «Проверяем сеанс…»");
  ok(!(await visible(page, "header.topbar")) && !(await visible(page, "#dashboard")), "шапка и дашборд в это время скрыты");
  await nav; await page.waitForFunction(() => !document.body.classList.contains("booting"), null, { timeout: 20000 });
  ok((await visible(page, "header.topbar")) && !(await visible(page, "#boot")), "после проверки приложение показано, заставка убрана");
  ok(/Вы вошли|admin|Админ/i.test(await page.textContent("#user-chip")) || (await page.textContent("#user-name")).length > 0, "имя пользователя в шапке: " + (await page.textContent("#user-name")));
  await ctx.unroute("**/api/auth/me");

  // 3. Сеанс умер между загрузкой страницы и проверкой (страница из кэша браузера): оболочка так и не показывается
  const ctx2 = await browser.newContext(); await loginContext(ctx2, base, { login: "bob", temp: "bob-temp-pass-1", password: "bob-real-pass-1" }).catch(async () => { await loginContext(ctx2, base); });
  const p2 = await ctx2.newPage(); p2.on("console", (m) => { if (m.type() === "error" && !/401|404/.test(m.text())) logs.push(m.text()); });
  await ctx2.route("**/api/auth/me", async (route) => { await new Promise((r) => setTimeout(r, 900)); await route.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ error: "unauthorized", message: "Сеанс завершён из-за бездействия", reason: "idle" }) }); });
  p2.goto(base + "/", { waitUntil: "commit" }).catch(() => {});
  await p2.waitForFunction(() => document.body?.classList.contains("booting"), null, { timeout: 15000 });
  ok(!(await visible(p2, "header.topbar")), "умерший сеанс: оболочка скрыта, пока идёт проверка");
  await p2.waitForURL(/login\.html/, { timeout: 15000 });
  await p2.waitForFunction(() => /бездейств/i.test(document.querySelector("#login-msg")?.textContent || ""), null, { timeout: 10000 });
  ok(/бездейств/i.test(await p2.textContent("#login-msg")), "страница входа объясняет причину: " + (await p2.textContent("#login-msg")).trim());
  ok(/next=%2F/.test(p2.url()) && !/reason=/.test(p2.url()), "адрес возврата сохранён, причина из адреса убрана после показа");
  // 4. Вердикт в истории: у каждого значения свой цвет (Go — зелёный, не серый)
  const colors = await page.evaluate(() => {
    const row = document.createElement("div"); row.className = "histrow"; document.body.append(row);
    const out = {};
    for (const v of ["go", "go_conditional", "rework", "no_go"]) { const el = document.createElement("span"); el.className = "status vchip " + v; el.textContent = v; row.append(el); out[v] = [getComputedStyle(el).backgroundColor, getComputedStyle(el).color].join(" | "); }
    row.remove(); return out;
  });
  const plain = (c) => /rgba\(0, 0, 0, 0\)|transparent/.test(c.split(" | ")[0]);
  ok(!plain(colors.go), "вердикт Go окрашен: " + colors.go);
  ok(new Set(Object.values(colors)).size === 4 && !Object.values(colors).some(plain), "все четыре вердикта различимы по цвету: " + Object.entries(colors).map(([k, v]) => k + " " + v.split(" | ")[0]).join(", "));

  ok(logs.length === 0, "ошибок консоли нет" + (logs.length ? ": " + logs.join(" | ").slice(0, 300) : ""));
} catch (e) { console.error("PROBE FAILED:", e); process.exitCode = 1; }
finally { await browser.close(); srv.kill(); }
