// spec 014 «Обновить промо» (MOCK): Xray → схема → извлечение, при этом ответ задачи извлечения подменён так, будто страницы сохранены без промо
// (старый кэш до spec 014) → в столбце «Промо» прочерки, кнопка «Обновить промо · N стр.» → подтверждение расхода → страницы перезагружены,
// промо появились, кнопка исчезла, «Промо в нише» посчитано, всё сохранено → F5.
import { chromium } from "playwright";
import { startServer, loginContext } from "./probe-helper.mjs";

const XRAY = "tests/fixtures/Helium_10_Xray_2026-08-21.csv";
const { srv, base } = await startServer(3993); const browser = await chromium.launch(); const logs = [];
const ok = (c, l) => { console.log((c ? "✔ " : "✖ ") + l); if (!c) process.exitCode = 1; };
const txt = (page, sel) => page.evaluate((s) => (document.querySelector(s)?.textContent || "").replace(/\s+/g, " "), sel);
const click = (page, sel) => page.evaluate((s) => { const el = document.querySelector(s); if (!el) throw new Error("нет " + s); el.click(); }, sel);
const saved = (page) => page.waitForFunction(() => document.querySelector("#save-state")?.textContent.includes("сохранено"), null, { timeout: 30000 });
try {
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 1000 } }); const page = await ctx.newPage(); const dialogs = [];
  page.on("console", (m) => { if (m.type() === "error" && !/401|404/.test(m.text())) logs.push(m.text()); }); page.on("pageerror", (e) => logs.push("pageerror: " + e.message));
  page.on("dialog", (d) => { dialogs.push(d.message()); d.accept(); });
  // Подмена: из событий задач схемы/извлечения вырезаем promo у страниц — как у кэша, загруженного до spec 014. После включения флага strip=false события идут как есть.
  let strip = true;
  await ctx.route("**/api/jobs/*/events", async (route) => {
    const r = await route.fetch(); let body = await r.text();
    if (strip) body = body.split("\n").map((line) => { if (!line.startsWith("data: ")) return line; try { const d = JSON.parse(line.slice(6)); if (d?.listings) for (const l of Object.values(d.listings)) delete l.promo; return "data: " + JSON.stringify(d); } catch { return line; } }).join("\n");
    await route.fulfill({ response: r, body, headers: { ...r.headers(), "content-length": String(Buffer.byteLength(body)) } });
  });
  await loginContext(ctx, base); await page.goto(base + "/", { waitUntil: "networkidle" });
  await page.fill("#f-niche", "bike inner tube"); await page.fill("#f-core", "bike tube"); await page.setInputFiles("#file-input", [XRAY]);
  await page.waitForFunction(() => document.querySelectorAll(".filecard").length >= 1, null, { timeout: 20000 }); await saved(page);
  await page.evaluate(() => document.querySelector('#stage-tabs [data-stage="2"]')?.click());
  await click(page, '#sec-config [data-action="config-schema"]');
  await page.waitForFunction(() => /Схема полей \(\d+\)/.test(document.querySelector("#sec-config")?.textContent || ""), null, { timeout: 30000 }); await saved(page);
  ok(await page.evaluate(() => !document.querySelector('#sec-config [data-action="config-promo"]')), "до извлечения кнопки «Обновить промо» нет");
  await click(page, '#sec-config [data-action="config-extract"]');
  await page.waitForFunction(() => document.querySelector("#sec-config .piegrid"), null, { timeout: 60000 }); await saved(page);
  const rows = await page.evaluate(() => document.querySelectorAll("#sec-config td.promo").length);
  const dashes = await page.evaluate(() => [...document.querySelectorAll("#sec-config td.promo")].filter((td) => td.textContent.trim() === "—").length);
  ok(rows > 0 && dashes === rows, `старый кэш: в столбце «Промо» прочерки во всех ${rows} строках`);
  ok(/появятся после повторной загрузки страниц/.test(await txt(page, "#sec-config")) && /кнопка «Обновить промо»/.test(await txt(page, "#sec-config")), "секция объясняет, откуда прочерки, и зовёт кнопку");
  const btn = await txt(page, '#sec-config [data-action="config-promo"]'); ok(new RegExp(`Обновить промо · ${rows} стр`).test(btn), "кнопка «Обновить промо» с числом страниц: " + btn.trim());
  ok(!(await txt(page, "#sec-config")).includes("Промо в нише"), "карточек «Промо в нише» пока нет");

  // обновить промо: подтверждение расхода → задача без AI → промо появились
  strip = false; const nDialogs = dialogs.length;
  await click(page, '#sec-config [data-action="config-promo"]');
  await page.waitForFunction(() => !document.querySelector('#sec-config [data-action="config-promo"]') && !document.querySelector("#config-status")?.textContent.trim(), null, { timeout: 60000 }); await saved(page);
  ok(dialogs.length === nDialogs + 1 && new RegExp(`Страницы ${rows} листингов будут загружены заново.*≈ ${rows * 30} кредитов`).test(dialogs.at(-1)), "спрошено подтверждение с числом страниц и кредитов: " + dialogs.at(-1).slice(0, 80));
  const dashes2 = await page.evaluate(() => [...document.querySelectorAll("#sec-config td.promo")].filter((td) => td.textContent.trim() === "—").length);
  ok(dashes2 === 0, "после обновления прочерков в столбце «Промо» нет");
  ok(await page.evaluate(() => [...document.querySelectorAll("#sec-config td.promo .chip")].some((c) => /купон/.test(c.textContent))), "чипы промо (купон) появились");
  ok(/Промо в нише/.test(await txt(page, "#sec-config")), "карточки «Промо в нише» посчитаны");
  ok(await page.evaluate(() => !document.querySelector('#sec-config [data-action="config-promo"]')), "кнопка исчезла — промо есть у всех листингов");
  const cov = await txt(page, "#sec-config h2"); ok(/извлечено: \d+/.test(cov), "таблица характеристик на месте: " + cov.match(/извлечено: \d+/)?.[0]);
  // F5 — промо в общей истории
  await page.reload({ waitUntil: "networkidle" }); await page.waitForFunction(() => document.querySelector("#sec-config .piegrid"), null, { timeout: 30000 });
  await page.evaluate(() => document.querySelector('#stage-tabs [data-stage="2"]')?.click());
  ok(await page.evaluate(() => [...document.querySelectorAll("#sec-config td.promo")].every((td) => td.textContent.trim() !== "—")), "после F5 промо на месте (сохранены в анализе)");
  ok(await page.evaluate(() => !document.querySelector('#sec-config [data-action="config-promo"]')), "после F5 кнопки нет");
  ok(logs.length === 0, "ошибок консоли нет" + (logs.length ? ": " + logs.join(" | ").slice(0, 300) : ""));
} catch (e) { console.error("PROBE FAILED:", e); process.exitCode = 1; }
finally { await browser.close(); srv.kill(); }
