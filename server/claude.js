// Вызов Claude: streaming + structured outputs (JSON Schema) + adaptive thinking (сводка) + серверные fallbacks.
// Генератор отдаёт события SSE: meta | thinking | delta | done | error.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Anthropic from "@anthropic-ai/sdk";
import { SYSTEM_PROMPT, buildUserMessage } from "./prompt.js";
import { mockVerdict } from "./mock-verdict.js";
import { validateVerdict, apiSchema } from "../shared/validate-verdict.js";
import { normalizeVerdict } from "../shared/verdict-normalize.js";
import { log } from "./log.js";
import { openrouterStream, DEFAULT_OPENROUTER_MODEL, parseModelList } from "./openrouter.js";

const here = dirname(fileURLToPath(import.meta.url));
export const VERDICT_SCHEMA = JSON.parse(readFileSync(join(here, "..", "shared", "ai-verdict.schema.json"), "utf8"));
const API_SCHEMA = apiSchema(VERDICT_SCHEMA);
const FALLBACK_BETA = "server-side-fallback-2026-07-01";

export function configFromEnv(env = process.env) {
  const openrouterKey = env.OPENROUTER_API_KEY || "";
  const provider = ["anthropic", "openrouter"].includes(env.AI_PROVIDER) ? env.AI_PROVIDER : (openrouterKey && !env.ANTHROPIC_API_KEY ? "openrouter" : "anthropic");
  const openrouterModels = parseModelList(env.OPENROUTER_MODELS);
  const openrouterModel = env.OPENROUTER_MODEL || openrouterModels[0] || DEFAULT_OPENROUTER_MODEL;
  if (!openrouterModels.includes(openrouterModel)) openrouterModels.unshift(openrouterModel);
  return {
    provider, openrouterKey, openrouterModel, openrouterModels,
    googleKey: env.GOOGLE_AI_STUDIO_KEY || "", // модели с префиксом aistudio/ идут напрямую в Google AI Studio
    openrouterReasoning: env.OPENROUTER_REASONING === "1",
    publicUrl: env.PUBLIC_URL || (env.RAILWAY_PUBLIC_DOMAIN ? `https://${env.RAILWAY_PUBLIC_DOMAIN}` : ""),
    schema: VERDICT_SCHEMA,
    apiKey: env.ANTHROPIC_API_KEY || "",
    model: env.CLAUDE_MODEL || "claude-opus-5",
    effort: env.CLAUDE_EFFORT || "high",
    fallbacks: env.CLAUDE_FALLBACKS !== "0",
    mock: env.MOCK_AI === "1" || env.MOCK_AI === "true",
    databaseUrl: env.DATABASE_URL || "",
    production: env.NODE_ENV === "production",
    dbMemory: env.DB_MEMORY === "1",
    adminLogin: env.ADMIN_LOGIN || "",
    adminPassword: env.ADMIN_PASSWORD || "",
    googleClientId: env.GOOGLE_OAUTH_CLIENT_ID || "", googleClientSecret: env.GOOGLE_OAUTH_CLIENT_SECRET || "", // вход через Google (spec 004)
    maxJobs: Number(env.MAX_JOBS) || 4,
    publicRateLimit: Number(env.PUBLIC_RATE_LIMIT) || 60, // обращений к публичным ссылкам с одного IP за 10 минут
    loginRateLimit: Number(env.LOGIN_RATE_LIMIT) || 10, // попыток входа с одного IP за 10 минут
    port: Number(env.PORT) || 3000,
    rateLimitPerHour: Number(env.RATE_LIMIT_PER_HOUR) || 20,
    upstreamTimeoutMs: Number(env.UPSTREAM_TIMEOUT_MS) || 180_000,
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function* analyzeStream(body, cfg, { signal } = {}) {
  const { payload, niche, coreKeyword, options = {} } = body;
  const t0 = Date.now();
  if (cfg.mock) {
    yield { event: "meta", data: { model: "mock", requestId: "mock-" + t0 } };
    for (const text of ["Проверяю гейты… ", "Сверяю Критерий 1 с потолком правил… ", "Формирую рекомендации…"]) {
      await sleep(100);
      if (signal?.aborted) { yield { event: "error", data: { code: "aborted", message: "Запрос отменён (mock)", retryable: false } }; return; }
      yield { event: "thinking", data: { text } };
    }
    await sleep(100);
    if (signal?.aborted) { yield { event: "error", data: { code: "aborted", message: "Запрос отменён (mock)", retryable: false } }; return; }
    const verdict = mockVerdict(payload);
    const v = validateVerdict(verdict, VERDICT_SCHEMA);
    if (!v.ok) { yield { event: "error", data: { code: "parse", message: v.errors.join("; "), retryable: false } }; return; }
    yield { event: "done", data: { verdict, usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, durationMs: Date.now() - t0, model: "mock" } };
    return;
  }
  if (cfg.provider === "openrouter") { yield* openrouterStream(body, cfg, { signal }); return; }
  if (!cfg.apiKey) { yield { event: "error", data: { code: "auth", message: "На сервере не задан ANTHROPIC_API_KEY", retryable: false } }; return; }

  const client = new Anthropic({ apiKey: cfg.apiKey, timeout: cfg.upstreamTimeoutMs, maxRetries: 2 });
  const effort = ["low", "medium", "high", "xhigh", "max"].includes(options.effort) ? options.effort : cfg.effort;
  const params = {
    model: cfg.model,
    max_tokens: 16000,
    system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: buildUserMessage({ niche, coreKeyword, payload }) }],
    thinking: { type: "adaptive", display: "summarized" },
    output_config: { effort, format: { type: "json_schema", schema: API_SCHEMA } },
  };

  let stream;
  try {
    stream = cfg.fallbacks
      ? client.beta.messages.stream({ ...params, betas: [FALLBACK_BETA], fallbacks: "default" }, { signal })
      : client.messages.stream(params, { signal });
    // первый event приходит сразу, ошибки 400 на бета-параметры — тоже сразу
    yield* pump(stream, cfg, t0, body);
  } catch (err) {
    if (cfg.fallbacks && err instanceof Anthropic.BadRequestError && /fallback|beta/i.test(err.message || "")) {
      log("warn", "fallbacks unsupported, retrying without beta", { message: err.message });
      try {
        stream = client.messages.stream(params, { signal });
        yield* pump(stream, cfg, t0, body);
        return;
      } catch (err2) { yield { event: "error", data: toError(err2) }; return; }
    }
    yield { event: "error", data: toError(err) };
  }
}

async function* pump(stream, cfg, t0, body) {
  let text = "";
  let metaSent = false;
  for await (const ev of stream) {
    if (ev.type === "message_start" && !metaSent) { metaSent = true; yield { event: "meta", data: { model: ev.message?.model || cfg.model, requestId: ev.message?.id || null } }; }
    if (ev.type === "content_block_delta") {
      if (ev.delta.type === "thinking_delta" && ev.delta.thinking) yield { event: "thinking", data: { text: ev.delta.thinking } };
      else if (ev.delta.type === "text_delta") { text += ev.delta.text; yield { event: "delta", data: { chars: text.length } }; }
    }
  }
  const msg = await stream.finalMessage();
  if (msg.stop_reason === "refusal") { yield { event: "error", data: { code: "refusal", message: `Модель отклонила запрос${msg.stop_details?.category ? ` (${msg.stop_details.category})` : ""}`, retryable: false } }; return; }
  if (msg.stop_reason === "max_tokens") { yield { event: "error", data: { code: "parse", message: "Ответ обрезан по max_tokens", retryable: true } }; return; }
  const full = msg.content.filter((b) => b.type === "text").map((b) => b.text).join("") || text;
  let verdict;
  try { verdict = normalizeVerdict(JSON.parse(full), body?.payload || {}); } catch { yield { event: "error", data: { code: "parse", message: "Ответ модели не является JSON", retryable: true } }; return; }
  const v = validateVerdict(verdict, VERDICT_SCHEMA);
  if (!v.ok) { yield { event: "error", data: { code: "parse", message: "Ответ не по схеме: " + v.errors.slice(0, 5).join("; "), retryable: true } }; return; }
  const u = msg.usage || {};
  const usage = { input: u.input_tokens ?? 0, output: u.output_tokens ?? 0, cacheRead: u.cache_read_input_tokens ?? 0, cacheWrite: u.cache_creation_input_tokens ?? 0 };
  log("info", "analyze done", { model: msg.model, ...usage, durationMs: Date.now() - t0, stop: msg.stop_reason });
  yield { event: "done", data: { verdict, usage, durationMs: Date.now() - t0, model: msg.model, provider: "anthropic" } };
}

function toError(err) {
  if (err instanceof Anthropic.AuthenticationError) return { code: "auth", message: "Неверный ANTHROPIC_API_KEY", retryable: false };
  if (err instanceof Anthropic.RateLimitError) return { code: "rate_limited", message: "Лимит запросов Claude API — повторите позже", retryable: true };
  if (err instanceof Anthropic.BadRequestError && /credit balance/i.test(err.message || "")) return { code: "billing", message: "На балансе Anthropic API нет средств — пополните кредиты: console.anthropic.com → Plans & Billing. Ключ и сервер настроены верно.", retryable: false };
  if (err instanceof Anthropic.BadRequestError) return { code: "bad_request", message: err.message, retryable: false };
  if (err instanceof Anthropic.APIConnectionTimeoutError) return { code: "upstream", message: "Таймаут Claude API", retryable: true };
  if (err instanceof Anthropic.APIError) return { code: "upstream", message: `Claude API ${err.status}: ${err.message}`, retryable: (err.status ?? 500) >= 500 };
  if (err?.name === "AbortError") return { code: "aborted", message: "Запрос отменён", retryable: false };
  return { code: "upstream", message: err?.message || String(err), retryable: true };
}
