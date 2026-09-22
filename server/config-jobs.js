// Этап 2 (spec 010, D3): три фоновые задачи — схема полей (config_schema), извлечение по листингам (config_extract), ТЗ (config_tz).
// Генераторы событий для startJob: stage | done | error. Страницы грузит server/scrapfly.js, AI — openrouterJson; в тестах оба подменяются.
import { openrouterJson } from "./openrouter.js";
import { fetchMany, totalCost } from "./scrapfly.js";
import { FIELDS_SCHEMA, EXTRACT_SCHEMA, TZ_SCHEMA, SYS_FIELDS, SYS_EXTRACT, SYS_TZ, fieldsUser, extractUser, tzUser, normalizeSection, normalizePriority } from "./config-prompts.js";
import { mockFields, mockExtract, mockTz } from "./mock-config.js";
import { sanitizeSchema, mergeExtraction } from "../shared/config-extract.js";
import { collectTzNumbers, markUnverified } from "../shared/tz-payload.js";
import { log } from "./log.js";

const ASIN_RE = /^B0[A-Z0-9]{8}$/;
export const MAX_ASINS_HARD = 200; // жёсткий предел сервера; рабочий — thresholds.config.maxAsins (150) на клиенте

const pickModel = (options, cfg) => (options?.model && cfg.openrouterModels?.includes(options.model) ? options.model : cfg.openrouterModel);
const cleanAsins = (list) => [...new Set((Array.isArray(list) ? list : []).map((a) => String(a?.asin ?? a).toUpperCase().trim()).filter((a) => ASIN_RE.test(a)))].slice(0, MAX_ASINS_HARD);
const toErr = (e) => ({ code: e?.code || "upstream", message: e?.message || String(e), retryable: e?.retryable ?? (e?.code !== "auth" && e?.code !== "credits") });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** Вызов AI с повторами: перегрузка бесплатной модели (429/503) — обычное дело, а страницы уже оплачены. Ошибка ключа не повторяется;
 *  ответ не по схеме (parse) — один повтор сразу: модель недетерминирована, вторая попытка обычно проходит. */
async function retryAi(fn, { tries = 3, pauseMs = 15000, signal } = {}) {
  let last, parseRetries = 0;
  for (let i = 0; i < tries; i++) {
    try { return await fn(); }
    catch (e) {
      last = e; if (e?.code === "auth" || signal?.aborted) throw e;
      if (e?.code === "parse") { if (parseRetries++ >= 1) throw e; log("warn", "ai answer not by schema, retrying", { message: String(e.message).slice(0, 200) }); continue; }
      if (e?.retryable === false || i === tries - 1) throw e; await sleep(pauseMs * (i + 1));
    }
  }
  throw last;
}

/** Загрузить недостающие страницы: cached — свежий кэш клиента; отдаёт события fetch и возвращает { listings (все), fresh (новые), cost }. */
async function* fetchMissing(asins, cached, cfg, deps, label = "Загружаю страницы") {
  const have = {}; for (const a of asins) if (cached?.[a] && !cached[a].error) have[a] = cached[a];
  const missing = asins.filter((a) => !have[a]);
  const fresh = {};
  if (missing.length) {
    yield { event: "stage", data: { stage: "fetch", done: 0, total: missing.length, text: `${label}: 0/${missing.length} (в кэше ${asins.length - missing.length})`, cost: 0 } };
    const progress = []; let resolveWait = null;
    const p = fetchMany(missing, cfg, { fetchImpl: deps.fetchImpl, signal: deps.signal, concurrency: deps.concurrency ?? 3, onProgress: (d, t, l) => { progress.push({ d, t, l }); resolveWait?.(); } })
      .then((r) => ({ ok: true, r })).catch((e) => ({ ok: false, e }));
    let finished = false; let result;
    while (!finished) {
      const next = await Promise.race([p.then((r) => { finished = true; result = r; return null; }), new Promise((res) => { resolveWait = () => res(true); })]);
      while (progress.length) { const { d, t, l } = progress.shift(); fresh[l.asin] = l; yield { event: "stage", data: { stage: "fetch", done: d, total: t, text: `${label}: ${d}/${t}${l.error ? " · ошибка " + l.asin : ""}`, cost: totalCost(fresh) } }; }
      if (next === null && !finished) break;
    }
    if (!result.ok) { const e = result.e; Object.assign(fresh, e.partial || {}); throw Object.assign(e, { partial: fresh }); }
    Object.assign(fresh, result.r);
  }
  return { listings: { ...have, ...fresh }, fresh, cost: totalCost(fresh) };
}

/** Схема полей: топ-листинги → AI. body: { niche, coreKeyword, asins, listings, options } */
export async function* schemaStream(body, cfg, deps = {}) {
  const aiJson = deps.aiJson || openrouterJson; const t0 = Date.now();
  const asins = cleanAsins(body.asins).slice(0, 25); const model = pickModel(body.options, cfg);
  if (!asins.length) { yield { event: "error", data: { code: "bad_request", message: "Нет ASIN для схемы — загрузите Xray", retryable: false } }; return; }
  let fresh = null;
  try {
    const got = yield* fetchMissing(asins, body.listings, cfg, deps); fresh = got.fresh;
    const listings = asins.map((a) => got.listings[a]).filter((l) => l && !l.error);
    if (listings.length < 3) { yield { event: "stage", data: { stage: "partial", listings: got.fresh } }; yield { event: "error", data: { code: "asp", message: `Загрузилось только ${listings.length} страниц — схему не построить`, retryable: true } }; return; }
    yield { event: "stage", data: { stage: "ai", text: `AI предлагает схему полей по ${listings.length} листингам…`, cost: got.cost } };
    const raw = cfg.mock ? mockFields({ listings }) : await retryAi(() => aiJson({ cfg, model, system: SYS_FIELDS, user: fieldsUser({ niche: body.niche, coreKeyword: body.coreKeyword, listings }), schema: FIELDS_SCHEMA, signal: deps.signal, fetchImpl: deps.fetchImpl, maxTokens: 6000 }), { pauseMs: deps.aiPauseMs ?? 15000, signal: deps.signal });
    const schema = sanitizeSchema({ fields: raw.fields, proposedAt: new Date().toISOString(), model: cfg.mock ? "mock" : model, editedAt: null, basedOn: listings.length });
    if (schema.fields.length < 3) { yield { event: "stage", data: { stage: "partial", listings: got.fresh } }; yield { event: "error", data: { code: "parse", message: "AI вернул меньше трёх полей — повторите (страницы сохранены в кэше)", retryable: true } }; return; }
    log("info", "config schema done", { fields: schema.fields.length, listings: listings.length, cost: got.cost, ms: Date.now() - t0 });
    yield { event: "done", data: { schema, listings: got.fresh, cost: got.cost, model: schema.model, durationMs: Date.now() - t0 } };
  } catch (e) { log("warn", "config schema error", toErr(e)); const partial = e?.partial || fresh; if (partial && Object.keys(partial).length) yield { event: "stage", data: { stage: "partial", listings: partial } }; yield { event: "error", data: toErr(e) }; } // оплаченные страницы не теряются
}

/** Извлечение: недостающие страницы → AI пачками. body: { niche, schema, asins, listings, prevTable, options } */
export async function* extractStream(body, cfg, deps = {}) {
  const aiJson = deps.aiJson || openrouterJson; const t0 = Date.now();
  const schema = sanitizeSchema(body.schema || {}); const asins = cleanAsins(body.asins); const model = pickModel(body.options, cfg);
  const batchSize = Math.max(1, Math.min(12, Number(body.batchSize) || 6)); const parallel = deps.aiParallel ?? 2;
  if (!schema.fields.length) { yield { event: "error", data: { code: "bad_request", message: "Схема полей пуста", retryable: false } }; return; }
  if (!asins.length) { yield { event: "error", data: { code: "bad_request", message: "Нет ASIN для извлечения", retryable: false } }; return; }
  let fresh = null;
  try {
    const got = yield* fetchMissing(asins, body.listings, cfg, deps); fresh = got.fresh;
    const ok = asins.filter((a) => got.listings[a] && !got.listings[a].error);
    const batches = []; for (let i = 0; i < ok.length; i += batchSize) batches.push(ok.slice(i, i + batchSize));
    const items = []; let doneB = 0; const errors = [];
    yield { event: "stage", data: { stage: "ai", done: 0, total: batches.length, text: `AI заполняет таблицу: 0/${batches.length} пачек`, cost: got.cost } };
    let bi = 0;
    const runBatch = async (batch) => {
      const listings = batch.map((a) => got.listings[a]);
      if (cfg.mock) return mockExtract({ schema, listings }).items;
      const r = await retryAi(() => aiJson({ cfg, model, system: SYS_EXTRACT, user: extractUser({ niche: body.niche, schema, listings }), schema: EXTRACT_SCHEMA, signal: deps.signal, fetchImpl: deps.fetchImpl, maxTokens: 8000 }), { tries: 3, pauseMs: deps.aiPauseMs ?? 15000, signal: deps.signal });
      return r.items || [];
    };
    const worker = async (out) => { while (bi < batches.length && !deps.signal?.aborted) { const b = batches[bi++]; try { out.push(...(await runBatch(b))); } catch (e) { errors.push({ asins: b, message: e?.message }); if (e?.code === "auth") throw e; } doneB++; } };
    // события между пачками: воркеры пишут в items, генератор опрашивает прогресс
    const outs = []; const ps = Array.from({ length: Math.min(parallel, batches.length) }, () => { const o = []; outs.push(o); return worker(o); });
    let last = 0; const all = Promise.all(ps).then(() => "end");
    while (true) { const r = await Promise.race([all, new Promise((res) => setTimeout(() => res("tick"), 300))]); if (doneB !== last) { last = doneB; yield { event: "stage", data: { stage: "ai", done: doneB, total: batches.length, text: `AI заполняет таблицу: ${doneB}/${batches.length} пачек`, cost: got.cost } }; } if (r === "end") break; }
    for (const o of outs) items.push(...o);
    const table = mergeExtraction({ schema, prevTable: body.prevTable || null, items, listings: got.listings, asins, model: cfg.mock ? "mock" : model, cost: got.cost });
    if (errors.length) table.aiErrors = errors.map((e) => ({ asins: e.asins, message: String(e.message || "").slice(0, 200) }));
    log("info", "config extract done", { asins: asins.length, loaded: ok.length, batches: batches.length, errors: errors.length, cost: got.cost, ms: Date.now() - t0 });
    yield { event: "done", data: { table, schema, listings: got.fresh, cost: got.cost, model: table.model, durationMs: Date.now() - t0 } };
  } catch (e) { log("warn", "config extract error", toErr(e)); const partial = e?.partial || fresh; if (partial && Object.keys(partial).length) yield { event: "stage", data: { stage: "partial", listings: partial } }; yield { event: "error", data: toErr(e) }; }
}

/** ТЗ производителю: факты → AI → проверка чисел. body: { niche, coreKeyword, payload, options } */
export async function* tzStream(body, cfg, deps = {}) {
  const aiJson = deps.aiJson || openrouterJson; const t0 = Date.now(); const model = pickModel(body.options, cfg);
  const payload = body.payload; if (!payload || typeof payload !== "object") { yield { event: "error", data: { code: "bad_request", message: "Нет фактов для ТЗ", retryable: false } }; return; }
  try {
    yield { event: "stage", data: { stage: "ai", text: "AI составляет ТЗ по фактам этапов 1–2…" } };
    const raw = cfg.mock ? mockTz({ payload }) : await retryAi(() => aiJson({ cfg, model, system: SYS_TZ, user: tzUser({ niche: body.niche, coreKeyword: body.coreKeyword, payload }), schema: TZ_SCHEMA, signal: deps.signal, fetchImpl: deps.fetchImpl, maxTokens: 10000 }), { pauseMs: deps.aiPauseMs ?? 15000, signal: deps.signal });
    const tz = markUnverified({ title: String(raw.title || "").slice(0, 200), summary: String(raw.summary || "").slice(0, 2000), rows: (raw.rows || []).filter((r) => r && (r.requirement || r.param)).slice(0, 60).map((r) => ({ section: normalizeSection(r.section), param: String(r.param || "").slice(0, 120), requirement: String(r.requirement || "").slice(0, 600), rationale: String(r.rationale || "").slice(0, 600), priority: normalizePriority(r.priority), source: String(r.source || "").slice(0, 200) })),
      openQuestions: (raw.openQuestions || []).slice(0, 20).map((q) => String(q).slice(0, 300)), generatedAt: new Date().toISOString(), model: cfg.mock ? "mock" : model, editedAt: null }, collectTzNumbers(payload));
    log("info", "config tz done", { rows: tz.rows.length, unverified: tz.rows.filter((r) => r.unverified).length, ms: Date.now() - t0 });
    yield { event: "done", data: { tz, durationMs: Date.now() - t0 } };
  } catch (e) { log("warn", "config tz error", toErr(e)); yield { event: "error", data: toErr(e) }; }
}
