// FBA Launch Evaluator — сервер: статика + /api (health, auth/check, analyze SSE).
import express from "express";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { authMiddleware, rateLimiter } from "./auth.js";
import { analyzeStream, configFromEnv } from "./claude.js";
import { log } from "./log.js";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");

export function createApp(cfg = configFromEnv()) {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", 1);

  app.use((req, res, next) => {
    res.set("X-Content-Type-Options", "nosniff");
    res.set("Referrer-Policy", "no-referrer");
    res.set("X-Frame-Options", "DENY");
    res.set("Content-Security-Policy", "default-src 'self'; img-src 'self' data: https://m.media-amazon.com https://images-na.ssl-images-amazon.com; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'");
    next();
  });

  app.get("/api/health", (req, res) => res.json({ ok: true, model: cfg.mock ? "mock" : cfg.model, mock: cfg.mock, uptime: Math.round(process.uptime()) }));

  app.use("/api", authMiddleware(cfg));
  app.use("/api", express.json({ limit: "1mb" }));
  app.post("/api/auth/check", (req, res) => res.status(204).end());

  const limiter = rateLimiter({ limit: cfg.rateLimitPerHour, windowMs: 60 * 60 * 1000 });
  app.post("/api/analyze", limiter, async (req, res) => {
    const body = req.body || {};
    if (!body.payload || typeof body.payload !== "object") return res.status(400).json({ error: "bad_request", message: "payload обязателен" });
    res.status(200).set({ "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no" });
    res.flushHeaders?.();
    const send = (event, data) => { if (!res.writableEnded) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); };
    const ping = setInterval(() => { if (!res.writableEnded) res.write(": ping\n\n"); }, 15000);
    const ac = new AbortController();
    // ВАЖНО: слушать close на ответе, не на запросе — req.close срабатывает сразу после чтения тела
    res.on("close", () => { if (!res.writableFinished) ac.abort(); });
    const t0 = Date.now();
    log("info", "analyze start", { ip: req.ip, niche: String(body.niche || "").slice(0, 60), payloadChars: JSON.stringify(body.payload).length, model: cfg.mock ? "mock" : cfg.model });
    try {
      for await (const ev of analyzeStream(body, cfg, { signal: ac.signal })) send(ev.event, ev.data);
    } catch (err) {
      log("error", "analyze failed", { message: err?.message });
      send("error", { code: "upstream", message: err?.message || "Ошибка сервера", retryable: true });
    } finally {
      clearInterval(ping);
      log("info", "analyze end", { durationMs: Date.now() - t0 });
      res.end();
    }
  });

  app.use("/shared", express.static(join(root, "shared"), { extensions: ["js"], maxAge: "1h" }));
  app.use(express.static(join(root, "public"), { maxAge: "1h", etag: true }));
  app.use((req, res) => res.status(404).json({ error: "not_found" }));
  return app;
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const cfg = configFromEnv();
  if (!cfg.appPassword) log("warn", "APP_PASSWORD не задан — /api/* будет отвечать 503");
  if (!cfg.apiKey && !cfg.mock) log("warn", "ANTHROPIC_API_KEY не задан — AI-анализ недоступен (используйте MOCK_AI=1 для демо)");
  createApp(cfg).listen(cfg.port, () => log("info", "listening", { port: cfg.port, model: cfg.mock ? "mock" : cfg.model, effort: cfg.effort, fallbacks: cfg.fallbacks }));
}
