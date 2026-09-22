// Этап 2 (spec 010, D2): нормализация ответа Scrapfly, классификация ошибок, повторы, остановка при кредитах, MOCK.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { normalizeProduct, classifyScrapfly, fetchListing, fetchMany, scrapflyUrl, mockListing, totalCost } from "../server/scrapfly.js";

const fixture = (asin) => JSON.parse(readFileSync(new URL(`./fixtures/scrapfly-${asin}.json`, import.meta.url), "utf8"));
const cfg = { scrapflyKey: "test-key", mock: false };
const res = (status, body) => new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

test("normalizeProduct: только текст — тайтл, буллеты, характеристики, цена, рейтинг, варианты, число картинок; без HTML и отзывов", () => {
  const j = fixture("B0BZHHSV52");
  const l = normalizeProduct("B0BZHHSV52", j.result.extracted_data.data, { cost: j.context.cost.total, fetchedAt: "2026-09-22T00:00:00Z" });
  assert.equal(l.asin, "B0BZHHSV52"); assert.equal(l.cost, 31); assert.equal(l.fetchedAt, "2026-09-22T00:00:00Z");
  assert.ok(l.title.length > 10); assert.equal(l.brand, "Yatim"); assert.equal(l.bullets.length, 8); assert.ok(l.bullets[0].startsWith("Material:"));
  assert.ok(l.specs.length >= 20); assert.deepEqual(l.specs[0], { k: "Brand Name", v: "Yatim" });
  assert.equal(l.price, 30.99); assert.equal(l.rating, 4.8); assert.equal(l.ratingCount, 549); assert.equal(l.imageCount, 3); assert.deepEqual(l.variants, ["Light Green", "Blue", "Bottle Green", "Pink"]);
  assert.equal(l.category, "Home & Kitchen"); assert.equal(l.aplus, "");
  assert.ok(!("images" in l) && !("reviews" in l) && !("html" in l));
  const empty = normalizeProduct("B0TEST00001", {}); assert.equal(empty.title, ""); assert.deepEqual(empty.bullets, []); assert.equal(empty.price, null); assert.equal(empty.cost, null);
});

test("scrapflyUrl: параметры пробы + cost_budget; ключ только в запросе к Scrapfly", () => {
  const u = new URL(scrapflyUrl("B0BZHHSV52", "k-1")); assert.equal(u.origin + u.pathname, "https://api.scrapfly.io/scrape");
  assert.equal(u.searchParams.get("key"), "k-1"); assert.equal(u.searchParams.get("url"), "https://www.amazon.com/dp/B0BZHHSV52");
  assert.equal(u.searchParams.get("asp"), "true"); assert.equal(u.searchParams.get("country"), "us"); assert.equal(u.searchParams.get("render_js"), "false"); assert.equal(u.searchParams.get("extraction_model"), "product"); assert.equal(u.searchParams.get("cost_budget"), "60");
});

test("classifyScrapfly: ключ/кредиты — не повторять, 429/5xx — повторять", () => {
  assert.equal(classifyScrapfly(401).code, "auth"); assert.equal(classifyScrapfly(403).retryable, false);
  assert.equal(classifyScrapfly(402).code, "credits"); assert.equal(classifyScrapfly(400, '{"message":"budget exceeded"}').code, "credits");
  assert.equal(classifyScrapfly(429).retryable, true); assert.equal(classifyScrapfly(503).code, "http_5xx"); assert.equal(classifyScrapfly(422).code, "asp"); assert.equal(classifyScrapfly(422).retryable, false);
});

test("fetchListing: успех с первого раза; повтор после 5xx; ошибка страницы → запись с error; кредиты → исключение", async () => {
  const j = fixture("B0BZHGDPMK"); const calls = [];
  const okFetch = async (u) => { calls.push(u); return res(200, j); };
  const l = await fetchListing("B0BZHGDPMK", cfg, { fetchImpl: okFetch }); assert.equal(l.title, j.result.extracted_data.data.name); assert.equal(l.cost, 26); assert.equal(calls.length, 1);
  let n = 0; const flaky = async () => (++n === 1 ? res(503, "busy") : res(200, j));
  const l2 = await fetchListing("B0BZHGDPMK", cfg, { fetchImpl: flaky, retries: 2 }); assert.equal(l2.error, undefined); assert.equal(n, 2);
  const asp = await fetchListing("B0BZHGDPMK", cfg, { fetchImpl: async () => res(422, "asp failed") }); assert.equal(asp.error.code, "asp"); assert.equal(asp.asin, "B0BZHGDPMK"); assert.ok(asp.fetchedAt);
  await assert.rejects(fetchListing("B0BZHGDPMK", cfg, { fetchImpl: async () => res(402, "no credits") }), (e) => e.code === "credits" && e.retryable === false);
  await assert.rejects(fetchListing("B0BZHGDPMK", { scrapflyKey: "" }, { fetchImpl: okFetch }), (e) => e.code === "auth");
  const empty = await fetchListing("B0BZHGDPMK", cfg, { fetchImpl: async () => res(200, { result: { extracted_data: { data: {} } }, context: { cost: { total: 5 } } }), retries: 0 }); assert.equal(empty.error.code, "empty"); assert.equal(empty.cost, 5);
});

test("fetchMany: параллельно, прогресс, ошибка страницы не останавливает; кредиты — стоп с partial", async () => {
  const j = fixture("B0D3FVSHBR"); const asins = ["B0000000A1", "B0000000A2", "B0000000A3", "B0000000A4"];
  let active = 0, peak = 0; const prog = [];
  const fetchImpl = async (u) => { active++; peak = Math.max(peak, active); await new Promise((r) => setTimeout(r, 5)); active--; return u.includes("B0000000A3") ? res(422, "asp") : res(200, j); };
  const out = await fetchMany(asins, cfg, { fetchImpl, concurrency: 2, onProgress: (d, t) => prog.push([d, t]) });
  assert.equal(Object.keys(out).length, 4); assert.equal(out.B0000000A3.error.code, "asp"); assert.equal(out.B0000000A1.cost, 31); assert.ok(peak <= 2 && peak >= 1); assert.deepEqual(prog.at(-1), [4, 4]);
  assert.equal(totalCost(out), 93);
  let k = 0; const credits = async () => (++k <= 2 ? res(200, j) : res(402, "no credits"));
  await assert.rejects(fetchMany(asins, cfg, { fetchImpl: credits, concurrency: 1 }), (e) => e.code === "credits" && Object.keys(e.partial).length === 2);
});

test("MOCK: листинг из тайтла, детерминированный, без сети", async () => {
  const a = mockListing("B0BZHGDPMK", "Boxing Machine Pro"); const b = mockListing("B0BZHGDPMK", "Boxing Machine Pro");
  assert.deepEqual({ ...a, fetchedAt: 0 }, { ...b, fetchedAt: 0 }); assert.equal(a.title, "Boxing Machine Pro"); assert.equal(a.cost, 0); assert.ok(a.specs.some((s) => s.k === "Material"));
  const l = await fetchListing("B0BZHGDPMK", { mock: true, mockTitles: { B0BZHGDPMK: "T" } }, { fetchImpl: async () => { throw new Error("сеть не должна вызываться"); } }); assert.equal(l.title, "T");
});
