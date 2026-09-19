// spec 002 — сквозная проба в Chromium. Часть 1 (US1): вход → смена временного пароля → создание пользователя →
// второй контекст под новым пользователем → раздел «Пользователи» недоступен → отключение закрывает доступ.
import { chromium } from "playwright";
import { startServer, ADMIN } from "./probe-helper.mjs";

const { srv, base } = await startServer(3990);
const browser = await chromium.launch();
const logs = [];
const watch = (page, tag) => { page.on("console", (m) => { if (m.type() === "error" && !/401|403/.test(m.text())) logs.push(`${tag}: ${m.text()}`); }); page.on("pageerror", (e) => logs.push(`${tag} pageerror: ${e.message}`)); };
const ok = (cond, label) => { console.log((cond ? "✔ " : "✖ ") + label); if (!cond) process.exitCode = 1; };

try {
  // --- администратор ---
  const ctxA = await browser.newContext({ viewport: { width: 1400, height: 1000 } }); const A = await ctxA.newPage(); watch(A, "admin");
  await A.goto(base + "/", { waitUntil: "networkidle" });
  ok(A.url().includes("/login.html"), "без сеанса приложение уводит на страницу входа");
  await A.fill("#login-name", "Admin"); await A.fill("#login-pass", "wrong-password-1"); await A.click("#login-btn");
  await A.waitForSelector("#login-msg:not(.hidden)");
  ok((await A.textContent("#login-msg")).includes("Неверный логин или пароль"), "неверный пароль — нейтральное сообщение");
  await A.fill("#login-pass", ADMIN.temp); await A.click("#login-btn");
  await A.waitForSelector("#change-form:not(.hidden)");
  ok(true, "временный пароль → форма принудительной смены");
  await A.fill("#change-next", "short"); await A.fill("#change-next2", "short");
  ok(await A.$eval("#change-next", (el) => !el.checkValidity()), "короткий пароль не проходит проверку формы");
  await A.fill("#change-next", ADMIN.password); await A.fill("#change-next2", ADMIN.password); await A.click("#change-btn");
  await A.waitForURL((u) => !u.pathname.endsWith("/login.html"), { timeout: 15000 });
  await A.waitForSelector("#user-chip:not(.hidden)");
  ok((await A.textContent("#user-name")).includes("админ"), "имя и роль в шапке: " + (await A.textContent("#user-name")));
  ok(await A.evaluate(() => !document.cookie.includes("fba_sid")), "cookie сеанса недоступна скриптам страницы (HttpOnly)");

  await A.click('.topbar nav button[data-tab="settings"]');
  await A.waitForSelector("#set-users:not(.hidden)");
  await A.fill("#un-name", "Анна Коваль"); await A.fill("#un-login", "Anna");
  const tempPw = await A.inputValue("#un-pass");
  ok(tempPw.length >= 14, "временный пароль сгенерирован (" + tempPw.length + " симв.)");
  await A.click('#user-new button[type="submit"]');
  await A.waitForFunction(() => [...document.querySelectorAll("#users-list tr")].some((tr) => tr.textContent.includes("anna")));
  ok(true, "пользователь anna появился в таблице");

  // --- обычный пользователь во втором контексте ---
  const ctxB = await browser.newContext({ viewport: { width: 1400, height: 1000 } }); const B = await ctxB.newPage(); watch(B, "user");
  await B.goto(base + "/login.html", { waitUntil: "networkidle" });
  await B.fill("#login-name", "anna"); await B.fill("#login-pass", tempPw); await B.click("#login-btn");
  await B.waitForSelector("#change-form:not(.hidden)");
  await B.fill("#change-next", "anna-own-password-1"); await B.fill("#change-next2", "anna-own-password-1"); await B.click("#change-btn");
  await B.waitForURL((u) => !u.pathname.endsWith("/login.html"), { timeout: 15000 });
  await B.waitForSelector("#user-chip:not(.hidden)");
  await B.click('.topbar nav button[data-tab="settings"]');
  ok(await B.$eval("#set-users", (el) => el.classList.contains("hidden")), "обычный пользователь не видит раздел «Пользователи»");
  const direct = await ctxB.request.get(base + "/api/users");
  ok(direct.status() === 403, "прямой запрос /api/users обычным пользователем → 403");
  ok((await B.textContent("#set-login-state")).includes("anna"), "в настройках видно, под кем вошли");

  // --- расчёты работают под учётной записью ---
  await B.click('.topbar nav button[data-tab="analysis"]');
  await B.fill("#f-core", "urinal screen deodorizer");
  await B.setInputFiles("#file-input", ["tests/fixtures/POE_urinal_screen_deodorizer_2026-09-15.json"]);
  await B.waitForFunction(() => document.querySelectorAll(".filecard").length >= 1);
  await B.click('[data-action="ai"]').catch(() => B.click("#btn-ai"));
  await B.waitForFunction(() => /AI-вердикт|Вердикт AI|MOCK|mock/i.test(document.querySelector("#sec-ai")?.textContent || "") && !document.querySelector("#btn-ai")?.disabled, null, { timeout: 40000 });
  ok(true, "AI-задача (mock) выполняется под cookie-сеансом, без токена в URL");

  // --- отключение ---
  await A.waitForSelector('#users-list button[data-uact="toggle"]');
  A.once("dialog", (d) => d.accept());
  await A.locator("#users-list tr", { hasText: "anna" }).locator('button[data-uact="toggle"]').click();
  await A.waitForFunction(() => [...document.querySelectorAll("#users-list tr")].some((tr) => tr.textContent.includes("anna") && tr.textContent.includes("отключён")));
  const after = await ctxB.request.get(base + "/api/auth/me");
  ok(after.status() === 401, "после отключения сеанс пользователя закрыт сразу");
  await B.reload({ waitUntil: "networkidle" });
  ok(B.url().includes("/login.html"), "отключённого пользователя уводит на вход");

  // --- выход ---
  await A.click("#user-logout"); await A.waitForURL((u) => u.pathname.endsWith("/login.html"));
  ok((await ctxA.request.get(base + "/api/auth/me")).status() === 401, "после «Выйти» сеанс администратора закрыт");
  console.log("console:", logs.join("\n") || "(чисто)");
  if (logs.length) process.exitCode = 1;
} catch (e) { console.error("PROBE FAILED:", e.message); console.log("console:", logs.join("\n")); process.exitCode = 1; }
finally { await browser.close(); srv.kill(); }
