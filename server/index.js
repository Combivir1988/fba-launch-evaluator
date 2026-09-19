// FBA Launch Evaluator — сервер: статика + /api (health, учётные записи, фоновые AI-задачи с SSE).
import express from "express";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { rateLimiter } from "./auth.js";
import { connect, isStorageError } from "./db/index.js";
import { migrate } from "./db/migrate.js";
import { createSessions, csrfGuard } from "./sessions.js";
import { createUsers, UserError } from "./users.js";
import { createAnalyses } from "./analyses.js";
import { analyzeStream, configFromEnv } from "./claude.js";
import { patentScanStream } from "./patents.js";
import { startJob, getJob, subscribe, cancelJob, runningCount } from "./jobs.js";
import { log } from "./log.js";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");

export const inflight = { count: 0, draining: false };

/** deps.db — подключённая БД (обязательна): см. server/db/index.js; в тестах — PGlite из tests/helpers/db.js. */
export function createApp(cfg = configFromEnv(), deps = {}) {
  const db = deps.db;
  if (!db) throw new Error("createApp: нужна БД (deps.db)");
  const sessions = deps.sessions || createSessions(db, cfg);
  const users = deps.users || createUsers(db, sessions, deps.usersOpts || {});
  const analyses = deps.analyses || createAnalyses(db);
  const app = express();
  app.locals.sessions = sessions; app.locals.users = users; app.locals.analyses = analyses;
  app.use("/api", (req, res, next) => { if (inflight.draining && req.path !== "/health") { res.set("Retry-After", "5"); return res.status(503).json({ error: "draining", message: "Сервер перезапускается — повторите через несколько секунд" }); } next(); });
  app.disable("x-powered-by");
  app.set("trust proxy", 1);

  app.use((req, res, next) => {
    res.set("X-Content-Type-Options", "nosniff");
    res.set("Referrer-Policy", "no-referrer");
    res.set("X-Frame-Options", "DENY");
    res.set("Content-Security-Policy", "default-src 'self'; img-src 'self' data: https://m.media-amazon.com https://images-na.ssl-images-amazon.com; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'");
    next();
  });

  app.get("/api/health", (req, res) => res.json({ ok: true, provider: cfg.mock ? "mock" : cfg.provider, model: cfg.mock ? "mock" : cfg.provider === "openrouter" ? cfg.openrouterModel : cfg.model,
    models: cfg.mock ? ["mock"] : cfg.provider === "openrouter" ? cfg.openrouterModels : [cfg.model], mock: cfg.mock, uptime: Math.round(process.uptime()), running: runningCount(), storage: db.kind })); // БД не трогаем — Neon должен спать при простое

  // Лимиты тела — по роутам (contracts/api.md): 100 KB по умолчанию, 1 MB для AI-задач.
  const jsonSmall = express.json({ limit: "100kb" });
  const jsonMid = express.json({ limit: "1mb" });
  const jsonBig = express.json({ limit: "12mb" }); // агрегаты отчётов и импорт целого анализа
  app.use("/api", sessions.attachUser, csrfGuard);
  const { requireUser, requireAdmin, requirePasswordChanged } = sessions;
  const authed = [requireUser, requirePasswordChanged];
  const admin = [requireAdmin, requirePasswordChanged];

  // ---------- вход и своя учётная запись ----------
  const loginLimiter = rateLimiter({ limit: cfg.loginRateLimit || 10, windowMs: 10 * 60 * 1000 });
  const me = (u) => ({ user: { id: u.id, login: u.login, name: u.name, role: u.role, settings: u.settings || {} }, mustChangePassword: Boolean(u.mustChangePassword) });
  app.post("/api/auth/login", loginLimiter, jsonSmall, async (req, res) => {
    const { login, password } = req.body || {};
    try {
      const u = await users.authenticate(login, password);
      const token = await sessions.createSession(u.id, req.get("user-agent") || "");
      sessions.setCookie(res, token);
      log("info", "login ok", { login: u.login, ip: req.ip });
      res.json(me(u));
    } catch (e) {
      if (e instanceof UserError) log("warn", "login failed", { login: String(login ?? "").slice(0, 40), code: e.code, ip: req.ip });
      throw e;
    }
  });
  app.post("/api/auth/logout", async (req, res) => { await sessions.destroySession(req.sessionToken); sessions.clearCookie(res); res.status(204).end(); });
  app.get("/api/auth/me", requireUser, (req, res) => res.json(me(req.user)));
  app.post("/api/auth/password", requireUser, jsonSmall, async (req, res) => {
    await users.changePassword(req.user.id, req.body?.current, req.body?.next, req.sessionToken);
    log("info", "password changed", { login: req.user.login });
    res.status(204).end();
  });
  app.patch("/api/auth/settings", authed, jsonSmall, async (req, res) => res.json({ settings: await users.updateSettings(req.user.id, req.body || {}) }));

  // ---------- пользователи (admin) ----------
  app.get("/api/users/names", authed, async (req, res) => res.json(await users.listNames()));
  app.get("/api/users", admin, async (req, res) => res.json(await users.listUsers()));
  app.post("/api/users", admin, jsonSmall, async (req, res) => {
    const u = await users.createUser(req.body || {});
    log("info", "user created", { login: u.login, role: u.role, by: req.user.login });
    res.status(201).json({ user: u });
  });
  app.patch("/api/users/:id", admin, jsonSmall, async (req, res) => {
    const u = await users.updateUser(req.params.id, req.body || {});
    log("info", "user updated", { login: u.login, role: u.role, active: u.active, by: req.user.login });
    res.json({ user: u });
  });
  app.post("/api/users/:id/reset-password", admin, jsonSmall, async (req, res) => {
    await users.resetPassword(req.params.id, req.body?.password);
    log("info", "password reset", { id: req.params.id, by: req.user.login });
    res.status(204).end();
  });

  // ---------- общая история анализов ----------
  app.get("/api/analyses", authed, async (req, res) => res.json(await analyses.list({ userId: req.user.id, mine: req.query.mine === "1", q: req.query.q, limit: req.query.limit, offset: req.query.offset })));
  app.post("/api/analyses/import", authed, jsonBig, async (req, res) => {
    const r = await analyses.importDoc(req.body?.analysis, req.user);
    if (r.imported) log("info", "analysis imported", { id: r.id, by: req.user.login });
    res.status(r.imported ? 201 : 200).json(r);
  });
  app.get("/api/analyses/:id", authed, async (req, res) => res.json(await analyses.get(req.params.id)));
  app.put("/api/analyses/:id", authed, jsonMid, async (req, res) => {
    const b = req.body || {};
    res.json(await analyses.saveCore({ id: req.params.id, baseVersion: b.baseVersion ?? null, core: b.core, force: b.force === true }, req.user));
  });
  app.put("/api/analyses/:id/aggregates", authed, jsonBig, async (req, res) => {
    const b = req.body || {};
    res.json(await analyses.saveAggregates({ id: req.params.id, baseVersion: b.baseVersion, aggregates: b.aggregates, force: b.force === true }, req.user));
  });
  app.post("/api/analyses/:id/copy", authed, jsonBig, async (req, res) => res.status(201).json(await analyses.copy({ core: req.body?.core, aggregates: req.body?.aggregates }, req.user)));
  app.delete("/api/analyses/:id", authed, async (req, res) => {
    await analyses.remove(req.params.id, req.user);
    log("info", "analysis deleted", { id: req.params.id, by: req.user.login });
    res.status(204).end();
  });

  const limiter = rateLimiter({ limit: cfg.rateLimitPerHour, windowMs: 60 * 60 * 1000, key: (req) => req.user?.id || req.ip });
  const sseHeaders = (res) => { res.status(200).set({ "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no" }); res.flushHeaders?.(); };

  // Запуск AI-анализа как фоновой задачи → { jobId }. Поток событий — GET /api/jobs/:id/events.
  app.post("/api/analyze", authed, limiter, jsonMid, (req, res) => {
    const body = req.body || {};
    if (!body.payload || typeof body.payload !== "object") return res.status(400).json({ error: "bad_request", message: "payload обязателен" });
    const job = startJob("analyze", (signal) => analyzeStream(body, cfg, { signal }), { niche: String(body.niche || "").slice(0, 60), userId: req.user.id, userName: req.user.name });
    log("info", "analyze job start", { id: job.id, user: req.user.login, niche: job.meta.niche, payloadChars: JSON.stringify(body.payload).length, provider: cfg.mock ? "mock" : cfg.provider, model: body.options?.model || (cfg.provider === "openrouter" ? cfg.openrouterModel : cfg.model) });
    res.status(202).json({ jobId: job.id });
  });
  app.post("/api/patents/scan", authed, limiter, jsonMid, (req, res) => {
    const body = req.body || {};
    if (!body.coreKeyword && !body.niche) return res.status(400).json({ error: "bad_request", message: "niche/coreKeyword обязателен" });
    if (!cfg.mock && cfg.provider !== "openrouter") return res.status(400).json({ error: "bad_request", message: "Патентный скан требует AI_PROVIDER=openrouter" });
    const job = startJob("patents", (signal) => patentScanStream(body, cfg, { signal }), { niche: String(body.niche || body.coreKeyword || "").slice(0, 60), userId: req.user.id, userName: req.user.name });
    log("info", "patent scan job start", { id: job.id, user: req.user.login, niche: job.meta.niche });
    res.status(202).json({ jobId: job.id });
  });
  // Состояние задачи (для восстановления после перезагрузки страницы)
  app.get("/api/jobs/:id", authed, (req, res) => {
    const job = getJob(req.params.id);
    if (!job) return res.status(404).json({ error: "not_found", message: "Задача не найдена или истекла (результаты хранятся 1 час)" });
    res.json({ id: job.id, type: job.type, status: job.status, createdAt: job.createdAt, events: job.events.length, result: job.status === "done" ? job.result : null, error: job.error });
  });
  // SSE с replay: EventSource переподключается сам, Last-Event-ID → продолжаем с нужного места
  app.get("/api/jobs/:id/events", authed, (req, res) => {
    const job = getJob(req.params.id);
    if (!job) return res.status(404).json({ error: "not_found", message: "Задача не найдена или истекла" });
    sseHeaders(res);
    const from = Number(req.get("last-event-id") ?? req.query.from ?? -1) + 1;
    const unsub = subscribe(job, res, from);
    if (job.status !== "running") { res.end(); return; }
    const ping = setInterval(() => { if (!res.writableEnded) res.write(": ping\n\n"); }, 15000);
    const onEnd = (ev) => { if (ev.event === "end") { clearInterval(ping); job.listeners.delete(onEnd); unsub(); res.end(); } };
    job.listeners.add(onEnd);
    res.on("close", () => { clearInterval(ping); unsub(); job.listeners.delete(onEnd); });
  });
  app.delete("/api/jobs/:id", authed, (req, res) => res.json({ cancelled: cancelJob(req.params.id) }));
  app.use("/api", (req, res) => res.status(404).json({ error: "not_found", message: "Нет такого метода API" }));

  // Кэш: vendor (Chart.js, PapaParse) — долго; файлы приложения — всегда ревалидация по ETag (no-cache),
  // иначе после деплоя пользователь до часа видит старую версию.
  app.use("/vendor", express.static(join(root, "public", "vendor"), { maxAge: "7d", immutable: false, etag: true }));
  const noCache = { etag: true, lastModified: true, setHeaders: (res) => res.set("Cache-Control", "no-cache") };
  app.use("/shared", express.static(join(root, "shared"), { extensions: ["js"], ...noCache }));
  app.use(express.static(join(root, "public"), noCache));
  app.use((req, res) => res.status(404).json({ error: "not_found" }));
  // Единая обработка ошибок: ошибки логики → их код; хранилище недоступно → 503; остальное → 500 без деталей.
  app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
    if (res.headersSent) return;
    if (err instanceof UserError) { if (err.retryAfter) res.set("Retry-After", String(err.retryAfter)); return res.status(err.status).json({ error: err.code, message: err.message, ...(err.extra || {}) }); }
    if (err?.type === "entity.too.large") return res.status(413).json({ error: "too_large", message: "Слишком большой запрос" });
    if (err?.type === "entity.parse.failed" || err instanceof SyntaxError) return res.status(400).json({ error: "bad_json", message: "Некорректный JSON" });
    if (isStorageError(err)) { log("error", "storage unavailable", { code: err.code, message: err.message, path: req.path }); return res.status(503).json({ error: "storage_unavailable", message: "Хранилище недоступно — изменения не сохранены, повторите через несколько секунд" }); }
    log("error", "unhandled", { path: req.path, message: err?.message, code: err?.code });
    res.status(500).json({ error: "internal", message: "Внутренняя ошибка сервера" });
  });
  return app;
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const cfg = configFromEnv();
  if (!cfg.mock && cfg.provider === "anthropic" && !cfg.apiKey) log("warn", "ANTHROPIC_API_KEY не задан — AI-анализ недоступен (MOCK_AI=1 для демо или AI_PROVIDER=openrouter)");
  if (!cfg.mock && cfg.provider === "openrouter" && !cfg.openrouterKey) log("warn", "OPENROUTER_API_KEY не задан — AI-анализ недоступен");
  let db;
  try {
    db = await connect(cfg);
    await migrate(db);
  } catch (e) { log("error", "storage init failed", { message: e.message, code: e.code }); process.exit(1); }
  const app = createApp(cfg, { db });
  try {
    const b = await app.locals.users.bootstrapAdmin(cfg);
    if (b.created) log("warn", b.restored ? "admin access restored from env" : "first admin created from env", { login: b.login });
    else if (b.reason === "no_env") log("warn", "в БД нет активного администратора и не заданы ADMIN_LOGIN/ADMIN_PASSWORD — войти некому");
    await app.locals.sessions.purgeExpired();
  } catch (e) { log("error", "bootstrap failed", { message: e.message }); process.exit(1); }
  setInterval(() => app.locals.sessions.purgeExpired().catch(() => {}), 24 * 60 * 60 * 1000).unref();
  const server = app.listen(cfg.port, () => log("info", "listening", { port: cfg.port, storage: db.kind, provider: cfg.mock ? "mock" : cfg.provider, model: cfg.mock ? "mock" : cfg.provider === "openrouter" ? cfg.openrouterModel : cfg.model, effort: cfg.effort }));
  server.keepAliveTimeout = 65_000;
  // Graceful shutdown: при SIGTERM (редеплой) не рвём активные AI-стримы — ждём их до DRAIN_SECONDS
  const DRAIN = Number(process.env.DRAIN_SECONDS) || 300;
  const shutdown = (sig) => {
    if (inflight.draining) return;
    inflight.draining = true;
    log("warn", "shutdown requested", { signal: sig, running: runningCount(), drainSeconds: DRAIN });
    server.close(() => log("info", "listener closed"));
    const t0 = Date.now();
    const tick = setInterval(async () => {
      if (runningCount() <= 0 || Date.now() - t0 > DRAIN * 1000) { clearInterval(tick); log("info", "exit", { running: runningCount(), waitedMs: Date.now() - t0 }); try { await db.close(); } catch {} process.exit(0); }
    }, 500);
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}
