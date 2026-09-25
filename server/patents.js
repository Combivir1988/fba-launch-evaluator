// Патентный скан (критерий 8 / Gate 4): AI формирует запросы → Google Patents (поиск + карточки) → AI оценивает
// пересечение claims с нашим ТЗ. Результат — ПРЕДВАРИТЕЛЬНЫЙ скрининг (🟡 допущение), не FTO-опиния юриста.
import { openrouterJson } from "./openrouter.js";
import { log } from "./log.js";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36";
const GP = "https://patents.google.com";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const STOP = new Set(["the", "and", "for", "with", "holder", "holders", "set", "pack", "new", "best", "kit"]);
const strip = (html) => String(html || "").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&hellip;/g, "…").replace(/\s+/g, " ").trim();

/** Поиск в Google Patents (недокументированный XHR, тот же, что использует сайт). */
export async function searchGooglePatents(q, { country = "US", status = "GRANT", type = "PATENT", num = 20, fetchImpl = fetch, signal } = {}) {
  const inner = [`q=${encodeURIComponent(q)}`, country ? `country=${country}` : "", status ? `status=${status}` : "", type ? `type=${type}` : "", `num=${num}`].filter(Boolean).join("&");
  const url = `${GP}/xhr/query?url=${encodeURIComponent(inner)}&exp=`;
  const res = await fetchImpl(url, { headers: { "User-Agent": UA, Accept: "application/json" }, signal });
  if (!res.ok) throw new Error(`Google Patents search ${res.status}`);
  const j = await res.json();
  const out = [];
  for (const cl of j.results?.cluster || []) for (const r of cl.result || []) {
    const p = r.patent || {};
    out.push({ id: r.id, number: p.publication_number, title: strip(p.title), snippet: strip(p.snippet), priorityDate: p.priority_date || null, filingDate: p.filing_date || null,
      grantDate: p.grant_date || null, publicationDate: p.publication_date || null, assignee: strip(p.assignee), inventor: strip(p.inventor), url: `${GP}/patent/${p.publication_number}/en`, type });
  }
  return { total: j.results?.total_num_results ?? out.length, items: out };
}

/** Карточка патента: abstract, независимые claims, даты, правовой статус. */
export function parsePatentHtml(html) {
  const sec = (name) => { const m = html.match(new RegExp(`<section[^>]*itemprop="${name}"[^>]*>([\\s\\S]*?)</section>`, "i")); return m ? m[1] : ""; };
  const abstract = strip(sec("abstract")).slice(0, 1500);
  const claimsHtml = sec("claims");
  // независимые claims = блоки .claim без класса claim-dependent
  const claims = [];
  const re = /<div[^>]*class="claim(?![-\w])[^"]*"[^>]*>([\s\S]*?)<\/div>\s*(?=<div[^>]*class="claim|<\/section|$)/gi;
  let m; while ((m = re.exec(claimsHtml)) && claims.length < 40) { const block = m[0]; const dependent = /claim-dependent|claim-ref/i.test(block); const text = strip(block); if (text.length > 20) claims.push({ text: text.slice(0, 1200), dependent }); }
  const independent = claims.filter((c) => !c.dependent).slice(0, 3).map((c) => c.text);
  const totalClaims = (claimsHtml.match(/class="claim-text"/g) || []).length;
  const date = (name) => { const mm = html.match(new RegExp(`itemprop="${name}"[^>]*datetime="([^"]+)"`, "i")); return mm ? mm[1] : null; };
  const status = (() => { const mm = html.match(/itemprop="legalStatusIfi"[^>]*>([\s\S]*?)<\//i); return mm ? strip(mm[1]) : null; })();
  const expiration = (() => { const mm = html.match(/itemprop="expiration"[^>]*datetime="([^"]+)"/i) || html.match(/Anticipated expiration[\s\S]{0,200}?datetime="([^"]+)"/i); return mm ? mm[1] : null; })();
  const assignee = (() => { const mm = html.match(/itemprop="assigneeCurrent"[^>]*>([\s\S]*?)<\//i) || html.match(/itemprop="assigneeOriginal"[^>]*>([\s\S]*?)<\//i); return mm ? strip(mm[1]) : null; })();
  const title = (() => { const mm = html.match(/<meta name="DC.title" content="([^"]*)"/i) || html.match(/<span itemprop="title"[^>]*>([\s\S]*?)<\/span>/i); return mm ? strip(mm[1]) : null; })();
  return { title, abstract, independentClaims: independent, totalClaims, priorityDate: date("priorityDate"), filingDate: date("filingDate"), publicationDate: date("publicationDate"), expiration, legalStatus: status, assignee };
}

export async function fetchPatentDetail(number, { fetchImpl = fetch, signal } = {}) {
  const res = await fetchImpl(`${GP}/xhr/result?id=${encodeURIComponent(`patent/${number}/en`)}`, { headers: { "User-Agent": UA }, signal });
  if (!res.ok) throw new Error(`Google Patents detail ${res.status}`);
  return parsePatentHtml(await res.text());
}

/** Оценка срока: приоритет + 20 лет (utility) / 15 лет от выдачи (design). */
export function estimateExpiry(p) {
  if (p.expiration) return p.expiration;
  if (p.type === "DESIGN" && p.grantDate) return addYears(p.grantDate, 15);
  const base = p.priorityDate || p.filingDate; return base ? addYears(base, 20) : null;
}
const addYears = (iso, y) => { const d = new Date(iso); if (Number.isNaN(d.getTime())) return null; d.setUTCFullYear(d.getUTCFullYear() + y); return d.toISOString().slice(0, 10); };
const expired = (iso) => iso && new Date(iso) < new Date();

export const QUERIES_SCHEMA = { type: "object", additionalProperties: false, required: ["queries", "concepts"], properties: {
  queries: { type: "array", items: { type: "object", additionalProperties: false, required: ["q", "purpose"], properties: { q: { type: "string", description: "Английский поисковый запрос для Google Patents (3–8 слов, без кавычек)" }, purpose: { type: "string", description: "Что ищем этим запросом (по-русски)" } } } },
  concepts: { type: "array", items: { type: "string" }, description: "Технические признаки нашего ТЗ, которые могут быть запатентованы" } } };

export const ASSESS_SCHEMA = { type: "object", additionalProperties: false, required: ["overall", "summary", "patents", "nextSteps", "designPatentNote"], properties: {
  overall: { type: "string", enum: ["clear", "unsure", "conflict"] },
  summary: { type: "string" },
  designPatentNote: { type: "string", description: "Что проверить вручную по design patents (внешний вид), 1–2 предложения" },
  patents: { type: "array", items: { type: "object", additionalProperties: false, required: ["number", "relevance", "risk", "claimed", "overlap", "designAround"], properties: {
    number: { type: "string" }, relevance: { type: "number", description: "доля от 0 до 1 (не проценты): 0.95 — почти полное совпадение" }, risk: { type: "string", enum: ["none", "low", "med", "high"] },
    claimed: { type: "string", description: "Что защищает независимый claim, 1–2 предложения по-русски" },
    overlap: { type: "string", description: "Пересечение с нашим ТЗ / фичей" }, designAround: { type: "string", description: "Как обойти (или «не требуется»)" } } } },
  nextSteps: { type: "array", items: { type: "string" } } } };

const SYS_QUERIES = `Ты патентный аналитик. По описанию товара для Amazon FBA и его дифференциатора составь 5–7 поисковых запросов для Google Patents (английский, 3–8 слов: конструкция, механизм, материал, применение; синонимы и отраслевые термины), покрывающих: сам тип товара, нашу ключевую фичу/дифференциатор, конструкции лидеров ниши. ОБЯЗАТЕЛЬНО: каждый запрос содержит тип товара (например «candle holder», «urinal screen») — иначе поиск вернёт патенты из чужих областей. Плюс перечисли технические признаки нашего ТЗ, которые в принципе патентуемы. Только JSON.`;
const SYS_ASSESS = `Ты патентный аналитик, делаешь ПРЕДВАРИТЕЛЬНЫЙ скрининг FTO (freedom-to-operate) для товара Amazon FBA. Это не юридическое заключение: цель — найти явные красные флаги и подсказать design-around, чтобы менеджер знал, с чем идти к патентному поверенному.
Правила: 1) Оценивай пересечение по НЕЗАВИСИМЫМ claims, а не по названию/абстракту. 2) Истёкшие патенты (expired=true) — риск none, но отметь как prior art. 3) risk=high только если наш дифференциатор/конструкция прямо читается на независимый claim действующего патента; med — частичное совпадение или неясная формулировка; low — далёкая аналогия. 4) overall: conflict — есть хотя бы один high; unsure — есть med или данных мало; clear — только none/low. 5) Не выдумывай патенты — оценивай только переданные. 6) Русский язык, кратко, без markdown. Только JSON.`;

/**
 * Основной сценарий скана. Генератор SSE-событий: stage | done | error.
 * deps: { fetchImpl, aiJson } — подменяются в тестах.
 */
export async function* patentScanStream(body, cfg, { signal, fetchImpl = fetch, aiJson = openrouterJson } = {}) {
  const t0 = Date.now();
  const { niche, coreKeyword, feature = "", hypotheses = [], brands = [], options = {} } = body;
  const product = `Товар/ниша: ${niche || coreKeyword}\nГлавный ключ: ${coreKeyword}\nНаш дифференциатор / ключевая фича (ТЗ): ${feature || "(не задан — оцени сам тип товара)"}\nГипотезы дифференциации из отзывов: ${hypotheses.slice(0, 5).join(" | ") || "—"}\nБренды-лидеры ниши: ${brands.slice(0, 6).join(", ") || "—"}`;
  const model = options.model && cfg.openrouterModels?.includes(options.model) ? options.model : cfg.openrouterModel;
  try {
    // A. запросы
    yield { event: "stage", data: { stage: "queries", text: "Формирую поисковые запросы…" } };
    let plan;
    if (cfg.mock) plan = { queries: [{ q: `${coreKeyword || niche}`, purpose: "тип товара" }, { q: `${coreKeyword || niche} ${feature}`.trim(), purpose: "наша фича" }], concepts: [feature || "конструкция"] };
    else plan = await aiJson({ cfg, model, system: SYS_QUERIES, user: product, schema: QUERIES_SCHEMA, signal, fetchImpl, maxTokens: 8000 });
    const queries = (plan.queries || []).slice(0, 7);
    // B. поиск
    const found = new Map();
    for (const [i, qq] of queries.entries()) {
      yield { event: "stage", data: { stage: "search", text: `Google Patents ${i + 1}/${queries.length}: «${qq.q}»`, query: qq.q } };
      if (cfg.mock) { for (let k = 0; k < 3; k++) { const n = `US${9000000 + i * 10 + k}B2`; found.set(n, { number: n, title: `Mock patent ${n} for ${qq.q}`, snippet: "mock", priorityDate: "2015-01-01", filingDate: "2016-01-01", grantDate: "2018-01-01", assignee: "Mock Inc", url: `${GP}/patent/${n}/en`, type: "PATENT", hits: 1, queries: [qq.q] }); } continue; }
      try {
        const r = await searchGooglePatents(qq.q, { fetchImpl, signal, num: 15, status: "GRANT", type: "PATENT" });
        for (const it of r.items) { const cur = found.get(it.number); if (cur) { cur.hits++; cur.queries.push(qq.q); } else found.set(it.number, { ...it, hits: 1, queries: [qq.q] }); }
        // заявки (pending) по первому и «фичевому» запросу — риск на горизонте
        if (i < 2) { const a = await searchGooglePatents(qq.q, { fetchImpl, signal, num: 8, status: "APPLICATION", type: "PATENT" }); for (const it of a.items) if (!found.has(it.number)) found.set(it.number, { ...it, pending: true, hits: 1, queries: [qq.q] }); }
        await sleep(350);
      } catch (e) { log("warn", "patents search failed", { q: qq.q, message: e.message }); }
    }
    // design patents — по типу товара (текстовый поиск слабый, но флаг для ручной проверки)
    let designHits = [];
    if (!cfg.mock && queries[0]) { try { designHits = (await searchGooglePatents(queries[0].q, { fetchImpl, signal, num: 10, status: "GRANT", type: "DESIGN" })).items.map((d) => ({ ...d, type: "DESIGN" })); } catch {} }
    // C. кандидаты: релевантность (слова типа товара в названии/аннотации) важнее частоты попадания в запросы
    const coreToks = [...new Set(String(coreKeyword || niche || "").toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !STOP.has(w)))];
    const overlap = (c) => { const t = `${c.title || ""} ${c.snippet || ""}`.toLowerCase(); return coreToks.filter((w) => t.includes(w.replace(/s$/, ""))).length; };
    for (const c of found.values()) c.relevanceScore = overlap(c) * 3 + Math.min(c.hits, 3);
    const all = [...found.values()].sort((a, b) => b.relevanceScore - a.relevanceScore || String(b.priorityDate || "").localeCompare(String(a.priorityDate || "")));
    const withOverlap = all.filter((c) => overlap(c) > 0);
    const cands = (withOverlap.length >= 6 ? withOverlap : all).slice(0, 12);
    const droppedIrrelevant = found.size - (withOverlap.length >= 6 ? withOverlap.length : found.size);
    for (const [i, c] of cands.entries()) {
      yield { event: "stage", data: { stage: "details", text: `Читаю claims ${i + 1}/${cands.length}: ${c.number}` } };
      if (cfg.mock) { Object.assign(c, { abstract: "mock abstract", independentClaims: ["1. A mock device comprising a housing."], totalClaims: 5, legalStatus: "Active" }); continue; }
      try { Object.assign(c, await fetchPatentDetail(c.number, { fetchImpl, signal })); await sleep(300); } catch (e) { c.detailError = e.message; }
    }
    for (const c of cands) { c.expiryEstimate = estimateExpiry(c); c.expired = Boolean(expired(c.expiryEstimate)) || /expired|lapsed|ceased/i.test(c.legalStatus || ""); }
    // D. оценка
    yield { event: "stage", data: { stage: "assess", text: `Оцениваю пересечение claims (${cands.length} патентов)…` } };
    const packed = cands.map((c) => ({ number: c.number, title: c.title, assignee: c.assignee, priorityDate: c.priorityDate, expiryEstimate: c.expiryEstimate, expired: c.expired, pending: Boolean(c.pending), legalStatus: c.legalStatus, abstract: (c.abstract || c.snippet || "").slice(0, 700), independentClaims: (c.independentClaims || []).map((t) => t.slice(0, 900)) }));
    let assess;
    if (cfg.mock) assess = { overall: "unsure", summary: "[MOCK] Демонстрационная оценка без AI.", designPatentNote: "Проверьте design patents по картинкам лидеров.", patents: packed.map((p, i) => ({ number: p.number, relevance: 0.5, risk: i === 0 ? "med" : "low", claimed: "mock", overlap: "mock", designAround: "mock" })), nextSteps: ["Показать патентному поверенному"] };
    else assess = await aiJson({ cfg, model, system: SYS_ASSESS, user: `${product}\n\nТехнические признаки ТЗ: ${(plan.concepts || []).join("; ")}\n\nКандидаты (JSON):\n${JSON.stringify(packed)}`, schema: ASSESS_SCHEMA, signal, fetchImpl, maxTokens: 16000 });
    const byNum = Object.fromEntries(cands.map((c) => [c.number, c]));
    // Модель иногда отдаёт релевантность в процентах (95) вместо доли (0.95) — приводим к доле, иначе в таблице получается «9 500 %».
    const relShare = (v) => { const n = Number(v); if (!Number.isFinite(n) || n < 0) return null; return Math.min(1, n > 1 ? n / 100 : n); };
    const items = (assess.patents || []).map((a) => { const c = byNum[a.number] || {}; return { ...a, relevance: relShare(a.relevance), title: c.title || null, assignee: c.assignee || null, priorityDate: c.priorityDate || null, expiryEstimate: c.expiryEstimate || null, expired: Boolean(c.expired), pending: Boolean(c.pending), legalStatus: c.legalStatus || null, url: c.url || `${GP}/patent/${a.number}/en`, hits: c.hits || 0 }; })
      .sort((a, b) => ({ high: 3, med: 2, low: 1, none: 0 }[b.risk] - { high: 3, med: 2, low: 1, none: 0 }[a.risk]) || b.relevance - a.relevance);
    const scan = { createdAt: new Date().toISOString(), status: assess.overall, summary: assess.summary, designPatentNote: assess.designPatentNote, nextSteps: assess.nextSteps || [], items,
      queries: queries.map((q) => ({ ...q, url: `${GP}/?q=${encodeURIComponent(q.q)}&country=US&status=GRANT&type=PATENT` })), concepts: plan.concepts || [], candidatesTotal: found.size, droppedIrrelevant, designHits: designHits.slice(0, 10).map((d) => ({ number: d.number, title: d.title, assignee: d.assignee, url: d.url, grantDate: d.grantDate })),
      feature, model: cfg.mock ? "mock" : model, source: "Google Patents (US, utility grants + applications; design — только по названию)", durationMs: Date.now() - t0,
      disclaimer: "Предварительный AI-скрининг по независимым claims. Не является юридическим заключением (FTO opinion). Заявки до публикации (18 мес.) и design patents по изображениям не покрыты. Решение по критерию 8 — за менеджером/патентным поверенным." };
    log("info", "patent scan done", { queries: queries.length, candidates: found.size, assessed: items.length, status: scan.status, durationMs: scan.durationMs, model: scan.model });
    yield { event: "done", data: { scan } };
  } catch (e) {
    if (e?.name === "AbortError" || signal?.aborted) { yield { event: "error", data: { code: "aborted", message: "Скан отменён", retryable: false } }; return; }
    log("error", "patent scan failed", { message: e?.message });
    yield { event: "error", data: { code: e?.code || "upstream", message: e?.message || String(e), retryable: true } };
  }
}
