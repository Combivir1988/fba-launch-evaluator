// Этап 2 (spec 010, D2): загрузка страниц Amazon через Scrapfly — ТОЛЬКО на сервере, ключ из окружения.
// Ответ модели извлечения «product» сводится к текстовой записи листинга (без HTML, картинок и отзывов) для кэша в анализе.
import { log } from "./log.js";
import { parsePromo } from "./promo-parse.js";

export const SCRAPFLY_URL = "https://api.scrapfly.io/scrape";
const COST_BUDGET = 80; // кредитов на страницу — страховка от неожиданной надбавки за размер HTML (норма 26–31)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const isNum = (v) => typeof v === "number" && Number.isFinite(v);

export function scrapflyUrl(asin, key) {
  const q = new URLSearchParams({ key, url: `https://www.amazon.com/dp/${asin}`, asp: "true", country: "us", render_js: "false", extraction_model: "product", cost_budget: String(COST_BUDGET) });
  return `${SCRAPFLY_URL}?${q}`;
}

/** Данные модели «product» → запись листинга для кэша анализа (только текст). */
export function normalizeProduct(asin, data = {}, { cost = null, fetchedAt = new Date().toISOString(), html = null } = {}) {
  const bullets = String(data.description || "").split(/\n+/).map((s) => s.trim()).filter(Boolean).slice(0, 12).map((s) => s.slice(0, 600));
  const specs = (Array.isArray(data.specifications) ? data.specifications : []).map((s) => ({ k: String(s?.name || "").trim().slice(0, 80), v: String(s?.value ?? "").trim().slice(0, 300) })).filter((s) => s.k && s.v).slice(0, 40);
  const variants = [...new Set((Array.isArray(data.variants) ? data.variants : []).map((v) => [v?.color, v?.size, v?.style].filter(Boolean).join(" / ")).filter(Boolean))].slice(0, 20);
  const price = data.offers?.[0]?.price; const rating = data.aggregate_rating || {};
  const aplus = String(data.aplus_text || data.a_plus || "").trim().slice(0, 2000); // модель «product» A+ почти не отдаёт (картинки) — поле оставлено на будущее
  return { asin, fetchedAt, cost: isNum(cost) ? cost : null, title: String(data.name || "").trim().slice(0, 400), brand: String(data.brand || "").trim().slice(0, 80), bullets, specs, aplus,
    price: isNum(price) ? price : null, rating: isNum(rating.rating_value) ? rating.rating_value : null, ratingCount: isNum(rating.review_count) ? rating.review_count : null,
    variants, imageCount: Array.isArray(data.images) ? data.images.length : 0, category: String(data.main_category || "").trim().slice(0, 80),
    promo: parsePromo(html) }; // купоны, дилы, List Price, Subscribe & Save — из сырого HTML того же ответа (spec 014); null — HTML не было
}

/** Ошибка Scrapfly → { code, message, retryable }. 401/402/403 — ключ или кредиты: задача останавливается. */
export function classifyScrapfly(status, text = "") {
  const t = String(text).slice(0, 300);
  if (status === 401 || status === 403) return { code: "auth", message: "Scrapfly отклонил ключ (" + status + ") — проверьте SCRAPFLY_API_KEY", retryable: false };
  if (status === 402 || /quota|budget exceeded|insufficient credit|out of credit/i.test(t)) return { code: "credits", message: "Кредиты Scrapfly исчерпаны (" + status + ") — пополните план и запустите заново", retryable: false };
  if (status === 429) return { code: "rate", message: "Scrapfly: слишком много запросов (429)", retryable: true };
  if (status === 422) return { code: "asp", message: "Scrapfly не смог обойти защиту страницы (422)", retryable: false };
  if (status >= 500) return { code: "http_5xx", message: `Scrapfly ${status}`, retryable: true };
  return { code: "http", message: `Scrapfly ${status}: ${t}`, retryable: false };
}

/** Один листинг. Ошибка страницы возвращается записью с error (не бросает), ошибка ключа/кредитов — бросает {code}. */
export async function fetchListing(asin, cfg, { fetchImpl = fetch, signal, retries = 2 } = {}) {
  if (cfg.mock) return mockListing(asin, cfg.mockTitles?.[asin]);
  if (!cfg.scrapflyKey) throw Object.assign(new Error("Scrapfly не настроен"), { code: "auth", retryable: false });
  let last = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt) await sleep(1500 * attempt);
    let res;
    try { res = await fetchImpl(scrapflyUrl(asin, cfg.scrapflyKey), { signal }); }
    catch (e) { if (signal?.aborted) throw e; last = { code: "network", message: e?.message || "сеть", retryable: true }; continue; }
    if (!res.ok) {
      const err = classifyScrapfly(res.status, await res.text().catch(() => ""));
      if (err.code === "auth" || err.code === "credits") throw Object.assign(new Error(err.message), err);
      last = err; if (!err.retryable) break; continue;
    }
    const j = await res.json().catch(() => null);
    const data = j?.result?.extracted_data?.data; const cost = j?.context?.cost?.total ?? j?.result?.cost?.total ?? null;
    if (!data || !data.name) { last = { code: "empty", message: "Scrapfly вернул страницу без данных товара", retryable: attempt < retries }; if (isNum(cost)) last.cost = cost; continue; }
    return normalizeProduct(asin, data, { cost, html: j?.result?.content || null });
  }
  return { asin, fetchedAt: new Date().toISOString(), cost: last?.cost ?? null, error: { code: last?.code || "unknown", message: last?.message || "не удалось загрузить" } };
}

/**
 * Пачка листингов с параллельностью. onProgress(done, total, listing) после каждой страницы.
 * Ошибка ключа/кредитов прерывает загрузку: бросается ошибка с полем partial — уже загруженные записи.
 */
export async function fetchMany(asins, cfg, { fetchImpl = fetch, signal, concurrency = 3, onProgress } = {}) {
  const out = {}; let i = 0, done = 0, fatal = null;
  const worker = async () => {
    while (i < asins.length && !fatal && !signal?.aborted) {
      const asin = asins[i++];
      try { const l = await fetchListing(asin, cfg, { fetchImpl, signal }); out[asin] = l; done++; onProgress?.(done, asins.length, l); }
      catch (e) { if (e?.code === "auth" || e?.code === "credits") { fatal = e; } else if (signal?.aborted) { fatal = e; } else { out[asin] = { asin, fetchedAt: new Date().toISOString(), cost: null, error: { code: "unknown", message: e?.message || String(e) } }; done++; onProgress?.(done, asins.length, out[asin]); } }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, asins.length)) }, worker));
  if (fatal) { fatal.partial = out; log("warn", "scrapfly stopped", { code: fatal.code, loaded: Object.keys(out).length, of: asins.length }); throw fatal; }
  return out;
}

export const totalCost = (listings) => Object.values(listings || {}).reduce((s, l) => s + (isNum(l?.cost) ? l.cost : 0), 0);

/** MOCK: листинг из тайтла (тесты, npm run dev, пробы) — детерминированный, без сети. */
export function mockListing(asin, title = "") {
  const t = title || `Mock product ${asin}`; const n = [...asin].reduce((s, c) => s + c.charCodeAt(0), 0);
  const material = ["Steel", "Plastic", "Wood", "Silicone"][n % 4], color = ["Black", "White", "Blue", "Red"][n % 4];
  return { asin, fetchedAt: new Date().toISOString(), cost: 0, title: t, brand: t.split(" ")[0] || "Mock", category: "Mock",
    bullets: [`Material: ${material} — durable ${t.toLowerCase()}`, `Pack of ${1 + (n % 3)} pieces`, `Color: ${color}`, `Weight: ${(1 + (n % 5) * 0.5).toFixed(1)} lb`],
    specs: [{ k: "Brand Name", v: t.split(" ")[0] || "Mock" }, { k: "Material", v: material }, { k: "Number of Items", v: String(1 + (n % 3)) }, { k: "Color", v: color }, { k: "Item Weight", v: `${(1 + (n % 5) * 0.5).toFixed(1)} Pounds` }],
    aplus: "", price: 10 + (n % 50), rating: 4 + (n % 10) / 10, ratingCount: 50 + n, variants: n % 2 ? [color, "Green"] : [], imageCount: 5 + (n % 5),
    promo: n % 3 === 0 ? { price: 10 + (n % 50), listPrice: Math.round((10 + (n % 50)) * 1.25 * 100) / 100, discountPct: 20, coupon: { text: "Save 10% with coupon", value: 10, unit: "%" }, deal: n % 6 === 0 ? "Limited time deal" : null, sns: n % 9 === 0 ? { min: 5, max: 15 } : null, promotions: [], hasPromo: true } : { price: 10 + (n % 50), listPrice: null, discountPct: null, coupon: null, deal: null, sns: null, promotions: [], hasPromo: false } };
}
