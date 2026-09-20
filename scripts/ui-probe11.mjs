// spec 004 — интерфейс входа через Google: кнопка на странице входа (только когда вход настроен), тексты отказов,
// приглашение по почте в «Пользователях», способ входа в таблице. Сам экран Google не открываем — наша часть потока покрыта HTTP-тестами.
import { chromium } from "playwright";
import { startServer, loginContext } from "./probe-helper.mjs";

const { srv, base } = await startServer(3983, { GOOGLE_OAUTH_CLIENT_ID: "probe-client.apps.googleusercontent.com", GOOGLE_OAUTH_CLIENT_SECRET: "probe-secret" });
const browser = await chromium.launch(); const logs = [];
const ok = (c, l) => { console.log((c ? "✔ " : "✖ ") + l); if (!c) process.exitCode = 1; };
try {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } }); const page = await ctx.newPage();
  page.on("console", (m) => { if (m.type() === "error" && !/401|403|404/.test(m.text())) logs.push(m.text()); }); page.on("pageerror", (e) => logs.push("pageerror: " + e.message));
  await page.goto(base + "/login.html?next=" + encodeURIComponent("/?tab=history"), { waitUntil: "networkidle" });
  await page.waitForSelector("#google-box:not(.hidden)");
  const href = await page.getAttribute("#google-btn", "href");
  ok(href === "/api/auth/google/start?next=" + encodeURIComponent("/?tab=history"), "кнопка «Войти через Google» видна и сохраняет адрес возврата: " + href);
  const r = await ctx.request.get(base + href, { maxRedirects: 0 }); const loc = new URL(r.headers()["location"]);
  ok(r.status() === 302 && loc.origin === "https://accounts.google.com" && loc.searchParams.get("redirect_uri") === base + "/api/auth/google/callback" && loc.searchParams.get("scope") === "openid email profile", "нажатие ведёт на Google с нашим адресом возврата и минимальным набором данных");
  await page.goto(base + "/login.html?error=google_not_invited", { waitUntil: "networkidle" });
  ok((await page.textContent("#login-msg")).includes("нет в списке приглашённых") && !page.url().includes("error="), "отказ неприглашённой почте: понятный текст, код убран из адреса");
  await page.goto(base + "/login.html?error=<script>alert(1)</script>", { waitUntil: "networkidle" });
  ok(await page.$eval("#login-msg", (e) => e.classList.contains("hidden")), "неизвестный код ошибки игнорируется");

  await loginContext(ctx, base); await page.goto(base + "/", { waitUntil: "networkidle" });
  await page.click('.topbar nav button[data-tab="settings"]'); await page.waitForSelector("#set-users:not(.hidden)");
  ok((await page.inputValue("#un-mode")) === "google" && await page.$eval("#un-pass", (e) => e.closest(".field").classList.contains("hidden")), "форма по умолчанию — приглашение через Google, поля логина и пароля скрыты");
  await page.fill("#un-email", "Anna.Koval@Gmail.com"); await page.click('#user-new button[type="submit"]');
  await page.waitForFunction(() => [...document.querySelectorAll("#users-list tr")].some((tr) => tr.textContent.includes("anna.koval@gmail.com")));
  const row = await page.locator("#users-list tr", { hasText: "anna.koval@gmail.com" }).textContent();
  ok(/Google · ещё не входил/.test(row) && /Задать пароль/.test(row), "приглашение по одной почте: в таблице способ входа «Google · ещё не входил», пароля нет");
  ok((await page.textContent("#un-msg")).includes("Войти через Google"), "подсказка администратору: " + (await page.textContent("#un-msg")).trim());
  await page.selectOption("#un-mode", "password");
  ok(await page.$eval("#un-pass", (e) => !e.closest(".field").classList.contains("hidden") && e.value.length >= 14), "режим «логин и пароль»: поля видны, временный пароль сгенерирован");
  const adminRow = await page.locator("#users-list tr", { hasText: "(вы)" }).textContent(); ok(/пароль/.test(adminRow), "у администратора способ входа — пароль (запасной вход сохранён)");
  ok(await page.$eval("#pw-form", (e) => !e.classList.contains("hidden")), "у пользователя с паролем форма смены пароля на месте");
  console.log("console:", logs.join("\n") || "(чисто)"); if (logs.length) process.exitCode = 1;
} catch (e) { console.error("PROBE FAILED:", e.message.split("\n")[0]); console.log("console:", logs.join("\n")); process.exitCode = 1; }
finally { await browser.close(); srv.kill(); }
