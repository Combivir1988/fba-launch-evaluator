// spec 002 — сквозная проба в Chromium. Часть 1 (US1): вход → смена временного пароля → создание пользователя →
// второй контекст под новым пользователем → раздел «Пользователи» недоступен → отключение закрывает доступ.
// Часть 2 (US2): общая история — автор, фильтр и поиск, конфликт версий → копия, F5.
// Часть 3 (US3): «Поделиться» — гость без входа, графики, 360 px, скачивание HTML, режим без экономики, обновление и отзыв ссылки.
import { chromium } from "playwright";
import { startServer, ADMIN } from "./probe-helper.mjs";

const { srv, base } = await startServer(3990);
const browser = await chromium.launch();
const logs = [];
const watch = (page, tag) => { page.on("console", (m) => { if (m.type() === "error" && !/401|403|404|409/.test(m.text())) logs.push(`${tag}: ${m.text()}`); }); page.on("pageerror", (e) => logs.push(`${tag} pageerror: ${e.message}`)); };
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

  // ================= Часть 2 (US2): общая история =================
  const saved = (page) => page.waitForFunction(() => document.querySelector("#save-state")?.textContent.includes("сохранено в общую историю"), null, { timeout: 20000 });
  const setField = async (page, sel, val) => { await page.click('.topbar nav button[data-tab="analysis"]'); await page.evaluate((q) => { const el = document.querySelector(q); el.closest("details")?.setAttribute("open", ""); }, sel); await page.fill(sel, val); await page.dispatchEvent(sel, "change"); };
  await saved(B);
  ok((await B.textContent("#doc-meta")).includes("автор: Анна Коваль"), "у автора под кнопками: " + (await B.textContent("#doc-meta")));

  await A.click('.topbar nav button[data-tab="history"]');
  await A.waitForFunction(() => document.querySelector("#histlist .histrow"));
  const rowA = await A.textContent("#histlist .histrow");
  ok(rowA.includes("автор: Анна Коваль") && rowA.includes("urinal screen deodorizer"), "администратор видит анализ Анны в общей истории с автором");
  ok(/AI/.test(rowA), "значок AI в списке (результат задачи сохранён на сервере)");
  ok(await A.$("#histlist [data-del]") !== null, "администратор может удалить чужой анализ (кнопка есть)");
  await A.selectOption("#hist-mine", "1");
  await A.waitForFunction(() => document.querySelector("#histlist .empty"));
  ok(true, "фильтр «мои» у администратора — пусто");
  await A.selectOption("#hist-mine", "0"); await A.fill("#hist-search", "коваль");
  await A.waitForFunction(() => document.querySelectorAll("#histlist .histrow").length === 1);
  ok(true, "поиск по автору находит анализ");
  await A.click("#histlist [data-open]");
  await A.waitForFunction(() => document.querySelector("#f-core")?.value === "urinal screen deodorizer");
  ok((await A.textContent("#sec-ai")).length > 50 && (await A.textContent("#save-state")).includes("сохранено"), "администратор открыл чужой анализ: дашборд и AI-блок на месте, лишнего сохранения нет");
  const v0 = await ctxA.request.get(base + "/api/analyses").then((r) => r.json()).then((j) => j.items[0]);
  ok(v0.updatedBy.name === "Анна Коваль", "открытие чужого анализа не меняет «кто изменил»");

  // администратор правит цену → «изменил: Администратор»
  await setField(A, "#f-price", "27.5"); await saved(A);
  ok((await A.textContent("#doc-meta")).includes("изменил: Администратор"), "после правки: " + (await A.textContent("#doc-meta")));
  // Анна (со старой версией) правит COGS → конфликт, без молчаливой перезаписи
  await setField(B, "#f-cogs", "4.2");
  await B.waitForSelector("#conflict-dlg[open]", { timeout: 20000 });
  ok((await B.textContent("#conflict-text")).includes("Администратор"), "диалог конфликта называет изменившего: " + (await B.textContent("#conflict-text")).trim());
  const price = await ctxA.request.get(base + "/api/analyses/" + v0.id).then((r) => r.json()).then((j) => j.core.inputs.price);
  ok(price === 27.5, "правка администратора не затёрта (цена на сервере " + price + ")");
  await B.click("#conflict-copy");
  await B.waitForFunction(() => !document.querySelector("#conflict-dlg").open && document.querySelector("#save-state")?.textContent.includes("сохранено"), null, { timeout: 20000 });
  const list2 = await ctxB.request.get(base + "/api/analyses").then((r) => r.json());
  ok(list2.total === 2 && list2.items.some((i) => /копия/.test(i.niche) && i.createdBy.name === "Анна Коваль"), "копия сохранена, её автор — Анна; всего анализов: " + list2.total);
  const copy = list2.items.find((i) => /копия/.test(i.niche));
  const copyDoc = await ctxB.request.get(base + "/api/analyses/" + copy.id).then((r) => r.json());
  ok(copyDoc.core.inputs.cogs === 4.2 && Object.keys(copyDoc.aggregates).includes("poe"), "в копии — правка Анны (COGS 4.2) и загруженные отчёты");
  await B.reload({ waitUntil: "networkidle" });
  await B.waitForFunction(() => document.querySelector("#f-cogs")?.value === "4.2", null, { timeout: 15000 });
  ok(true, "после F5 открыта копия с сохранёнными правками");
  // удалить чужой анализ обычный пользователь не может
  await B.click('.topbar nav button[data-tab="history"]');
  await B.waitForFunction(() => document.querySelectorAll("#histlist .histrow").length === 2);
  ok(await B.$$eval("#histlist .histrow", (rows) => rows.map((r) => Boolean(r.querySelector("[data-del]")))).then((a) => a.filter(Boolean).length === 2), "Анна — автор обоих анализов, кнопка «Удалить» есть у обоих");

  // ================= Часть 3 (US3): «Поделиться» =================
  const fs = await import("node:fs");
  await setField(B, "#f-cogs", "4.37"); await setField(B, "#f-budget", "18750"); await saved(B);
  await B.click("#btn-share"); await B.waitForSelector("#share-dlg[open]");
  await B.click("#share-create");
  await B.waitForFunction(() => document.querySelectorAll("#share-list .shareitem").length === 1, null, { timeout: 20000 });
  const urlFull = (await B.textContent("#share-list .shareitem .url")).trim();
  ok(/\/s\/[A-Za-z0-9_-]{43}$/.test(urlFull), "ссылка создана, адрес неугадываемый (43 символа)");
  ok((await B.textContent("#share-msg")).includes("создана"), "сообщение: " + (await B.textContent("#share-msg")));

  // получатель без учётной записи: отдельный контекст без cookie
  const ctxC = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true }); const C = await ctxC.newPage(); watch(C, "guest");
  await C.goto(urlFull, { waitUntil: "networkidle" });
  await C.waitForSelector("#sec-hero .snapnote", { timeout: 15000 });
  const note = (await C.textContent("#sec-hero .snapnote")).trim();
  ok(note.includes("Анна Коваль") && note.includes("только чтение"), "гость видит дашборд с пометкой: " + note);
  ok(await C.$eval("#dashboard", (d) => d.querySelectorAll("button, input, select, textarea, [data-action]").length === 0), "в дашборде гостя нет полей ввода, ползунков и кнопок запуска");
  ok(await C.evaluate(() => !document.querySelector('.topbar nav button, [data-tab="history"], #btn-ai, #set-users')), "у гостя нет вкладок истории, настроек и запуска AI");
  const painted = await C.$$eval("#dashboard canvas", (cs) => cs.map((c) => { try { const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++; return n; } catch { return -1; } }));
  ok(painted.filter((n) => n > 500).length >= 6, "графики у гостя отрисованы: " + painted.filter((n) => n > 500).length + " из " + painted.length + " (Gate 2 пуст без CPC — в анализе только POE)");
  ok((await C.textContent("#sec-economics")).length > 50 && (await C.textContent("#sec-economics")).includes("4,37"), "полный режим: экономика видна (COGS $4,37)");
  ok((await ctxC.request.get(base + "/api/analyses")).status() === 401 && (await ctxC.request.get(base + "/api/auth/me")).status() === 401, "у гостя нет доступа к истории и учётным записям");
  const [dl] = await Promise.all([C.waitForEvent("download"), C.click("#share-download")]);
  const htmlFull = fs.readFileSync(await dl.path(), "utf8");
  ok(htmlFull.length > 200000 && htmlFull.includes("FBARender") && htmlFull.includes("Анна Коваль"), "«Скачать HTML» у гостя: автономный файл " + Math.round(htmlFull.length / 1024) + " KB с пометкой автора");
  await C.setViewportSize({ width: 360, height: 760 }); await C.reload({ waitUntil: "networkidle" }); await C.waitForSelector("#sec-hero .snapnote");
  const overflow = await C.evaluate(() => document.scrollingElement.scrollWidth - window.innerWidth);
  ok(overflow <= 2, "ширина 360 px: нет горизонтальной прокрутки страницы (переполнение " + overflow + " px)");
  await C.setViewportSize({ width: 1280, height: 900 });

  // снимок не меняется при правках, «Обновить ссылку» сохраняет адрес
  await B.click("#share-close"); await setField(B, "#f-price", "31.11"); await saved(B);
  await C.reload({ waitUntil: "networkidle" }); await C.waitForSelector("#sec-hero .snapnote");
  ok(!(await C.textContent("#dashboard")).includes("31,11"), "правка автора не попала в ссылку — гость видит прежний снимок");
  await B.click("#btn-share"); await B.waitForSelector("#share-list .shareitem .chip.warn");
  ok(true, "в списке ссылок пометка «анализ изменён после снимка»");
  B.once("dialog", (d) => d.accept()); await B.click('#share-list [data-sact="refresh"]');
  await B.waitForFunction(() => !document.querySelector("#share-list .shareitem .chip.warn"), null, { timeout: 15000 });
  ok((await B.textContent("#share-list .shareitem .url")).trim() === urlFull, "после «Обновить ссылку» адрес прежний");
  await C.reload({ waitUntil: "networkidle" }); await C.waitForSelector("#sec-hero .snapnote");
  ok((await C.textContent("#dashboard")).includes("31,11"), "после обновления гость видит новую версию (цена $31,11)");
  ok(/просмотров: 1/.test(await B.textContent("#share-list .shareitem")), "счётчик просмотров: один гость = 1 (повторы за 30 мин и свои не считаются)");

  // режим без закупочной экономики
  await B.selectOption("#share-mode", "no_economics"); await B.selectOption("#share-expiry", "7"); await B.click("#share-create");
  await B.waitForFunction(() => document.querySelectorAll("#share-list .shareitem").length === 2, null, { timeout: 20000 });
  const urlRed = (await B.$$eval("#share-list .shareitem", (els) => els.map((e) => ({ url: e.querySelector(".url")?.textContent.trim(), text: e.textContent })))).find((x) => x.text.includes("без закупочной экономики")).url;
  await C.goto(urlRed, { waitUntil: "networkidle" }); await C.waitForSelector("#sec-hero .snapnote");
  ok((await C.textContent("#sec-hero .snapnote")).includes("закупочная экономика скрыта автором"), "режим без экономики: пометка в шапке");
  ok(await C.$eval("#sec-economics", (e) => e.classList.contains("hidden")) && await C.$eval("#sec-budget", (e) => e.classList.contains("hidden")), "секции «Экономика» и «Бюджет» скрыты");
  const apiBody = await (await ctxC.request.get(base + "/api/public/shares/" + urlRed.split("/s/")[1])).text();
  const { aggregates: _agg, ...restSnap } = JSON.parse(apiBody).snapshot.analysis; const restText = JSON.stringify(restSnap);
  const pageText = await C.textContent("#dashboard");
  const [dl2] = await Promise.all([C.waitForEvent("download"), C.click("#share-download")]); const htmlRed = fs.readFileSync(await dl2.path(), "utf8");
  const dataRed = htmlRed.slice(htmlRed.indexOf('id="fba-data"')); const { aggregates: _a2, ...restHtml } = JSON.parse(dataRed.slice(dataRed.indexOf(">") + 1, dataRed.indexOf("</script>"))); const htmlText = JSON.stringify(restHtml);
  for (const needle of ["4.37", "4,37", "18750", "18 750"]) ok(!restText.includes(needle) && !pageText.includes(needle) && !htmlText.includes(needle), "значение «" + needle + "» отсутствует в ответе сервера, на странице и в скачанном HTML");
  ok(!/"cogs"|"budget"\s*:|"economics"\s*:\s*\{"pending"/.test(restText), "в данных снимка нет полей закупочной экономики");

  // отзыв: единый экран для отозванной и несуществующей ссылки
  B.once("dialog", (d) => d.accept()); await B.locator("#share-list .shareitem", { hasText: "без закупочной экономики" }).locator('[data-sact="revoke"]').click();
  await B.waitForFunction(() => [...document.querySelectorAll("#share-list .shareitem")].some((e) => e.textContent.includes("отозвана")), null, { timeout: 15000 });
  await C.reload({ waitUntil: "load" }); await C.waitForSelector("#share-unavailable:not(.hidden)", { timeout: 15000 });
  const gone = (await C.textContent("#share-unavailable")).replace(/\s+/g, " ").trim();
  await C.goto(base + "/s/" + "Z".repeat(43), { waitUntil: "load" }); await C.waitForSelector("#share-unavailable:not(.hidden)", { timeout: 15000 });
  ok(gone === (await C.textContent("#share-unavailable")).replace(/\s+/g, " ").trim() && gone.includes("недействительна"), "отозванная и несуществующая ссылки выглядят одинаково: «" + gone.slice(0, 60) + "…»");
  await B.click("#share-close"); await B.click('.topbar nav button[data-tab="history"]');
  await B.waitForFunction(() => [...document.querySelectorAll("#histlist .histrow")].some((r) => r.querySelector(".chip.ok")?.textContent === "ссылка"));
  ok(true, "в истории у анализа значок «ссылка»");
  await ctxC.close();

  // --- отключение ---
  await A.click('.topbar nav button[data-tab="settings"]');
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
