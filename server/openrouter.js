// Провайдер OpenRouter (OpenAI-совместимый /chat/completions, SSE-стрим, structured outputs).
// Генератор отдаёт те же события, что и anthropic-путь: meta | thinking | delta | done | error.
// Каскад надёжности: json_schema (strict) → json_object + схема в промпте → без response_format + извлечение JSON из текста.
import { SYSTEM_PROMPT, buildUserMessage } from "./prompt.js";
import { validateVerdict, apiSchema } from "../shared/validate-verdict.js";
import { log } from "./log.js";

export const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
export const DEFAULT_OPENROUTER_MODEL = "google/gemini-3.8-flash";
export const DEFAULT_OPENROUTER_MODELS = [
  "google/gemini-3.8-flash", "openai/gpt-5.6-sol", "anthropic/claude-sonnet-5", "anthropic/claude-opus-5",
  "deepseek/deepseek-v3.2", "x-ai/grok-4.6", "mistralai/mistral-medium-3-5", "openai/gpt-5.4-mini",
];

export function parseModelList(s, fallback = DEFAULT_OPENROUTER_MODELS) {
  const list = String(s || "").split(/[,\s]+/).map((x) => x.trim()).filter(Boolean);
  return list.length ? list : fallback;
}

/** Достаёт первый полный JSON-объект из текста (на случай ```json ... ``` или преамбулы). */
export function extractJson(text) {
  if (!text) return null;
  const t = String(text).trim();
  try { return JSON.parse(t); } catch {}
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) { try { return JSON.parse(fence[1]); } catch {} }
  const a = t.indexOf("{"), b = t.lastIndexOf("}");
  if (a >= 0 && b > a) { try { return JSON.parse(t.slice(a, b + 1)); } catch {} }
  return null;
}

/** Разбор SSE-потока OpenAI-совместимого ответа. Возвращает {text, reasoning, model, usage, finish}. */
export async function* readOpenAiSse(body, onEvent) {
  const reader = body.getReader(); const dec = new TextDecoder();
  let buf = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, idx).replace(/\r$/, ""); buf = buf.slice(idx + 1);
      if (!line.startsWith("data:")) continue; // комментарии ": OPENROUTER PROCESSING" пропускаем
      const data = line.slice(5).trim();
      if (data === "[DONE]") return;
      let j; try { j = JSON.parse(data); } catch { continue; }
      yield j;
    }
  }
}

export async function* openrouterStream(body, cfg, { signal, fetchImpl = fetch } = {}) {
  const { payload, niche, coreKeyword, options = {} } = body;
  const t0 = Date.now();
  if (!cfg.openrouterKey) { yield { event: "error", data: { code: "auth", message: "На сервере не задан OPENROUTER_API_KEY", retryable: false } }; return; }
  const allowed = cfg.openrouterModels;
  const model = options.model && allowed.includes(options.model) ? options.model : cfg.openrouterModel;
  const effort = ["low", "medium", "high"].includes(options.effort) ? options.effort : (["low", "medium", "high"].includes(cfg.effort) ? cfg.effort : "medium");
  const schema = apiSchema(cfg.schema);
  const baseMessages = [{ role: "system", content: SYSTEM_PROMPT }, { role: "user", content: buildUserMessage({ niche, coreKeyword, payload }) }];
  const headers = { Authorization: `Bearer ${cfg.openrouterKey}`, "Content-Type": "application/json", "HTTP-Referer": cfg.publicUrl || "https://github.com/Combivir1988/fba-launch-evaluator", "X-Title": "FBA Launch Evaluator" };

  const modes = [
    { name: "json_schema", response_format: { type: "json_schema", json_schema: { name: "AIVerdict", strict: true, schema } }, messages: baseMessages },
    { name: "json_object", response_format: { type: "json_object" }, messages: [{ role: "system", content: SYSTEM_PROMPT + "\n\nОтвечай СТРОГО одним JSON-объектом по этой JSON Schema (без markdown):\n" + JSON.stringify(schema) }, baseMessages[1]] },
    { name: "text", response_format: undefined, messages: [{ role: "system", content: SYSTEM_PROMPT + "\n\nОтвечай СТРОГО одним JSON-объектом по этой JSON Schema, без пояснений и без markdown:\n" + JSON.stringify(schema) }, baseMessages[1]] },
  ];

  let lastErr = null;
  for (const mode of modes) {
    const req = { model, messages: mode.messages, stream: true, temperature: 0.2, max_tokens: 16000, usage: { include: true } };
    if (mode.response_format) req.response_format = mode.response_format;
    if (cfg.openrouterReasoning) req.reasoning = { effort };
    let res;
    try { res = await fetchImpl(OPENROUTER_URL, { method: "POST", headers, body: JSON.stringify(req), signal }); }
    catch (e) { if (e?.name === "AbortError") { yield { event: "error", data: { code: "aborted", message: "Запрос отменён", retryable: false } }; return; } yield { event: "error", data: { code: "upstream", message: "OpenRouter недоступен: " + (e?.message || e), retryable: true } }; return; }
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      const err = classify(res.status, txt);
      // неподдерживаемый формат ответа → следующий режим каскада
      if (res.status === 400 && /response_format|json_schema|structured|schema/i.test(txt) && mode.name !== "text") { log("warn", "openrouter: response_format не поддержан, деградация", { model, mode: mode.name }); lastErr = err; continue; }
      if (res.status === 404 && /provider|no endpoints|not found/i.test(txt) && mode.name !== "text" && req.response_format) { log("warn", "openrouter: нет провайдера с structured outputs, деградация", { model, mode: mode.name }); lastErr = err; continue; }
      yield { event: "error", data: err }; return;
    }
    let text = "", reasoning = "", usage = null, gotModel = model, metaSent = false, finish = null;
    try {
      for await (const j of readOpenAiSse(res.body)) {
        if (j.error) { yield { event: "error", data: classify(j.error.code || 500, JSON.stringify(j.error)) }; return; }
        if (!metaSent) { metaSent = true; gotModel = j.model || model; yield { event: "meta", data: { model: gotModel, requestId: j.id || null, provider: "openrouter", mode: mode.name } }; }
        const ch = j.choices?.[0]; const d = ch?.delta || {};
        const r = typeof d.reasoning === "string" ? d.reasoning : Array.isArray(d.reasoning_details) ? d.reasoning_details.map((x) => x.text || "").join("") : "";
        if (r) { reasoning += r; yield { event: "thinking", data: { text: r } }; }
        if (typeof d.content === "string" && d.content) { text += d.content; yield { event: "delta", data: { chars: text.length } }; }
        if (ch?.finish_reason) finish = ch.finish_reason;
        if (j.usage) usage = j.usage;
      }
    } catch (e) { if (e?.name === "AbortError" || signal?.aborted) { yield { event: "error", data: { code: "aborted", message: "Запрос отменён", retryable: false } }; return; } yield { event: "error", data: { code: "upstream", message: "Обрыв потока OpenRouter: " + (e?.message || e), retryable: true } }; return; }
    if (finish === "length") { yield { event: "error", data: { code: "parse", message: "Ответ обрезан по max_tokens", retryable: true } }; return; }
    if (finish === "content_filter") { yield { event: "error", data: { code: "refusal", message: "Модель отклонила запрос (content filter)", retryable: false } }; return; }
    const verdict = extractJson(text);
    if (!verdict) { lastErr = { code: "parse", message: `Модель ${gotModel} не вернула JSON (${mode.name})`, retryable: true }; log("warn", "openrouter: не JSON, деградация", { model, mode: mode.name }); continue; }
    const v = validateVerdict(verdict, cfg.schema);
    if (!v.ok) { lastErr = { code: "parse", message: "Ответ не по схеме: " + v.errors.slice(0, 5).join("; "), retryable: true }; log("warn", "openrouter: не по схеме, деградация", { model, mode: mode.name, errors: v.errors.slice(0, 3) }); if (mode.name === "text") break; continue; }
    const u = usage || {};
    const out = { input: u.prompt_tokens ?? 0, output: u.completion_tokens ?? 0, cacheRead: u.prompt_tokens_details?.cached_tokens ?? 0, cacheWrite: 0, reasoning: u.completion_tokens_details?.reasoning_tokens ?? 0, cost: typeof u.cost === "number" ? u.cost : null };
    log("info", "analyze done", { provider: "openrouter", model: gotModel, mode: mode.name, ...out, durationMs: Date.now() - t0 });
    yield { event: "done", data: { verdict, usage: out, durationMs: Date.now() - t0, model: gotModel, provider: "openrouter" } };
    return;
  }
  yield { event: "error", data: lastErr || { code: "upstream", message: "OpenRouter: не удалось получить ответ", retryable: true } };
}

function classify(status, txt) {
  let msg = ""; try { const j = JSON.parse(txt); msg = j.error?.message || j.message || txt; } catch { msg = txt; }
  msg = String(msg).slice(0, 300);
  if (status === 401) return { code: "auth", message: "OpenRouter: неверный API-ключ", retryable: false };
  if (status === 402) return { code: "billing", message: "OpenRouter: недостаточно кредитов — пополните баланс на openrouter.ai/settings/credits", retryable: false };
  if (status === 429) return { code: "rate_limited", message: "OpenRouter: лимит запросов — повторите позже", retryable: true };
  if (status === 408 || status === 504) return { code: "upstream", message: "OpenRouter: таймаут модели", retryable: true };
  if (status === 400 || status === 404 || status === 422) return { code: "bad_request", message: `OpenRouter ${status}: ${msg}`, retryable: false };
  return { code: "upstream", message: `OpenRouter ${status}: ${msg}`, retryable: status >= 500 };
}

/**
 * Non-streaming JSON-вызов OpenRouter с тем же каскадом (json_schema → json_object → text+extractJson) и валидацией.
 * Возвращает объект или бросает Error с code (auth|billing|rate_limited|bad_request|parse|upstream).
 */
export async function openrouterJson({ cfg, model, system, user, schema, signal, fetchImpl = fetch, maxTokens = 4000, temperature = 0.2 }) {
  if (!cfg.openrouterKey) throw Object.assign(new Error("На сервере не задан OPENROUTER_API_KEY"), { code: "auth" });
  const headers = { Authorization: `Bearer ${cfg.openrouterKey}`, "Content-Type": "application/json", "HTTP-Referer": cfg.publicUrl || "https://github.com/Combivir1988/fba-launch-evaluator", "X-Title": "FBA Launch Evaluator" };
  const strictSchema = apiSchema(schema);
  const NL = String.fromCharCode(10);
  const hint = (extra) => system + NL + NL + "Отвечай СТРОГО одним JSON по схеме" + extra + ":" + NL + JSON.stringify(strictSchema);
  const modes = [
    { name: "json_schema", response_format: { type: "json_schema", json_schema: { name: "Result", strict: true, schema: strictSchema } }, sys: system },
    { name: "json_object", response_format: { type: "json_object" }, sys: hint("") },
    { name: "text", response_format: undefined, sys: hint(", без markdown") },
  ];
  let last = null;
  for (const mode of modes) {
    const req = { model: model || cfg.openrouterModel, messages: [{ role: "system", content: mode.sys }, { role: "user", content: user }], temperature, max_tokens: maxTokens };
    if (mode.response_format) req.response_format = mode.response_format;
    const res = await fetchImpl(OPENROUTER_URL, { method: "POST", headers, body: JSON.stringify(req), signal });
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      const err = classify(res.status, txt);
      if ((res.status === 400 || res.status === 404) && /response_format|json_schema|structured|schema|provider/i.test(txt) && mode.name !== "text") { last = err; continue; }
      throw Object.assign(new Error(err.message), { code: err.code });
    }
    const j = await res.json().catch(() => null);
    const text = j?.choices?.[0]?.message?.content ?? "";
    const obj = extractJson(typeof text === "string" ? text : JSON.stringify(text));
    if (!obj) { last = { code: "parse", message: `Модель не вернула JSON (${mode.name})` }; continue; }
    const v = validateVerdict(obj, schema);
    if (!v.ok) { last = { code: "parse", message: "Ответ не по схеме: " + v.errors.slice(0, 4).join("; ") }; if (mode.name === "text") break; continue; }
    return obj;
  }
  throw Object.assign(new Error(last?.message || "OpenRouter: нет ответа"), { code: last?.code || "upstream" });
}
