// FBA Launch Evaluator — сервер: статика + /api (health, учётные записи, фоновые AI-задачи с SSE).
import express from "express";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { rateLimiter } from "./auth.js";
import { connect, isStorageError } from "./db/index.js";
import { migrate } from "./db/migrate.js";
import { createSessions, csrfGuard, readCookie } from "./sessions.js";
import { createAppSettings } from "./app-settings.js";
import { createGoogleAuth, GoogleAuthError, OAUTH_COOKIE, STATE_TTL_MS } from "./google-auth.js";
import { createUsers, UserError } from "./users.js";
import { createAnalyses } from "./analyses.js";
import { createShares } from "./shares.js";
import { analyzeStream, configFromEnv } from "./claude.js";
import { patentScanStream } from "./patents.js";
import { schemaStream, extractStream, tzStream, promoStream } from "./config-jobs.js";
import { buildTzDocx, tzFileName } from "./tz-docx.js";
import { startJob, getJob, subscribe, cancelJob, runningCount } from "./jobs.js";
import { log } from "./log.js";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");

export const inflight = { count: 0, draining: false };

/** deps.db — подключённая БД (обязательна): см. server/db/index.js; в тестах — PGlite из tests/helpers/db.js. */
export function createApp(cfg = configFromEnv(), deps = {}) {
  const db = deps.db;
  if (!db) throw new Error("createApp: нужна БД (deps.db)");
  const appSettings = deps.appSettings || createAppSettings(db, deps.appSettingsOpts || {});
  const sessions = deps.sessions || createSessions(db, { ...cfg, getPolicy: appSettings.getSessionPolicy });
  const users = deps.users || createUsers(db, sessions, deps.usersOpts || {});
  const analyses = deps.analyses || createAnalyses(db, deps.analysesOpts || {});
  const google = deps.google || createGoogleAuth(cfg, deps.googleOpts || {});
  const shares = deps.shares || createShares(db, analyses, { publicUrl: cfg.publicUrl, ...(deps.sharesOpts || {}) });
  const app = express();
  app.locals.sessions = sessions; app.locals.users = users; app.locals.analyses = analyses; app.locals.shares = shares;
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
    models: cfg.mock ? ["mock"] : cfg.provider === "openrouter" ? cfg.openrouterModels : [cfg.model], mock: cfg.mock, uptime: Math.round(process.uptime()), running: runningCount(), storage: db.kind, googleLogin: google.enabled, scrapfly: Boolean(cfg.mock || cfg.scrapflyKey) })); // БД не трогаем — Neon должен спать при простое

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
  const me = (u) => ({ user: { id: u.id, login: u.login, name: u.name, role: u.role, settings: u.settings || {}, email: u.email || null, hasPassword: u.hasPassword !== false }, mustChangePassword: Boolean(u.mustChangePassword) });
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
  // ---------- вход через Google (spec 004): только приглашённые почты; сеанс после входа — обычный ----------
  const callbackUrl = (req) => { const base = cfg.publicUrl ? (cfg.publicUrl.endsWith("/") ? cfg.publicUrl.slice(0, -1) : cfg.publicUrl) : `${req.protocol}://${req.get("host")}`; return base + "/api/auth/google/callback"; };
  const oauthCookie = { httpOnly: true, secure: Boolean(cfg.production), sameSite: "lax", path: "/api/auth/google" };
  app.get("/api/auth/google/start", loginLimiter, (req, res) => {
    if (!google.enabled) return res.status(404).json({ error: "not_found", message: "Вход через Google не настроен" });
    const { url, state } = google.begin({ redirectUri: callbackUrl(req), next: req.query.next });
    res.cookie(OAUTH_COOKIE, state, { ...oauthCookie, maxAge: STATE_TTL_MS });
    res.redirect(302, url);
  });
  app.get("/api/auth/google/callback", async (req, res) => {
    const back = (code) => { res.clearCookie(OAUTH_COOKIE, oauthCookie); res.redirect(302, "/login.html?error=" + code); };
    if (!google.enabled) return back("google_failed");
    try {
      if (req.query.error) { log("warn", "google login cancelled", { reason: String(req.query.error).slice(0, 40), ip: req.ip }); return back("google_cancelled"); }
      const g = await google.finish({ code: req.query.code, state: req.query.state, cookieState: readCookie(req, OAUTH_COOKIE), redirectUri: callbackUrl(req) });
      let u;
      try { u = await users.findForGoogle(g); }
      catch (e) { if (e instanceof UserError && e.code === "google_not_invited") { log("warn", "google login rejected", { email: g.email, reason: "not_invited", ip: req.ip }); return back("google_not_invited"); } throw e; }
      const token = await sessions.createSession(u.id, req.get("user-agent") || "");
      sessions.setCookie(res, token); res.clearCookie(OAUTH_COOKIE, oauthCookie);
      log("info", "login ok", { login: u.login, via: "google", ip: req.ip });
      res.redirect(302, g.next || "/");
    } catch (e) {
      if (e instanceof GoogleAuthError) { log("warn", "google login failed", { code: e.code, ip: req.ip }); return back(e.code === "state" ? "google_retry" : e.code === "cancelled" ? "google_cancelled" : "google_failed"); }
      if (isStorageError(e)) { log("error", "storage unavailable", { path: req.path, code: e.code }); return back("google_failed"); }
      log("error", "google login error", { message: e?.message }); back("google_failed");
    }
  });

  app.post("/api/auth/logout", async (req, res) => { await sessions.destroySession(req.sessionToken); sessions.clearCookie(res); res.status(204).end(); });
  // Правила сеансов приложению нужны, чтобы самому выйти при бездействии и предупредить заранее (spec 008).
  app.get("/api/auth/me", requireUser, async (req, res) => res.json({ ...me(req.user), sessionPolicy: await appSettings.getSessionPolicy() }));
  app.post("/api/auth/password", requireUser, jsonSmall, async (req, res) => {
    await users.changePassword(req.user.id, req.body?.current, req.body?.next, req.sessionToken);
    log("info", "password changed", { login: req.user.login });
    res.status(204).end();
  });
  app.patch("/api/auth/settings", authed, jsonSmall, async (req, res) => res.json({ settings: await users.updateSettings(req.user.id, req.body || {}) }));

  // ---------- правила сеансов (admin, spec 008) ----------
  app.get("/api/admin/session-policy", admin, async (req, res) => res.json(await appSettings.sessionPolicyInfo()));
  app.put("/api/admin/session-policy", admin, jsonSmall, async (req, res) => {
    const info = await appSettings.setSessionPolicy(req.body || {}, req.user.id);
    log("info", "session policy changed", { by: req.user.login, ...info.policy });
    res.json(info);
  });

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
  // История версий (spec 009)
  app.get("/api/analyses/:id/versions", authed, async (req, res) => res.json({ items: await analyses.listVersions(req.params.id) }));
  app.post("/api/analyses/:id/versions/:vid/restore", authed, async (req, res) => { const r = await analyses.restoreVersion(req.params.id, req.params.vid, req.user); log("info", "version restored", { by: req.user.login, analysis: req.params.id, version: req.params.vid }); res.json(r); });
  app.post("/api/analyses/:id/copy", authed, jsonBig, async (req, res) => res.status(201).json(await analyses.copy({ core: req.body?.core, aggregates: req.body?.aggregates }, req.user)));
  app.delete("/api/analyses/:id", authed, async (req, res) => {
    await analyses.remove(req.params.id, req.user);
    log("info", "analysis deleted", { id: req.params.id, by: req.user.login });
    res.status(204).end();
  });

  // ---------- публичные ссылки: управление (нужен вход) ----------
  app.get("/api/shares", authed, async (req, res) => res.json(await shares.listAll(req.user)));
  app.get("/api/analyses/:id/shares", authed, async (req, res) => res.json(await shares.listForAnalysis(req.params.id)));
  app.post("/api/analyses/:id/shares", authed, jsonSmall, async (req, res) => {
    const b = req.body || {};
    const sh = await shares.create({ analysisId: req.params.id, mode: b.mode ?? "full", expiresInDays: b.expiresInDays === undefined ? 30 : b.expiresInDays }, req.user);
    log("info", "share created", { share: sh.id, analysis: req.params.id, mode: sh.mode, expiresAt: sh.expiresAt, by: req.user.login }); // токен ссылки в логи не пишем
    res.status(201).json({ share: sh });
  });
  app.post("/api/shares/:shareId/refresh", authed, async (req, res) => { const sh = await shares.refresh(req.params.shareId, req.user); log("info", "share refreshed", { share: sh.id, by: req.user.login }); res.json({ share: sh }); });
  app.delete("/api/shares/:shareId", authed, async (req, res) => { await shares.revoke(req.params.shareId, req.user); log("info", "share revoked", { share: req.params.shareId, by: req.user.login }); res.status(204).end(); });

  // ---------- публичная часть: без входа (research R7) ----------
  // Несуществующая, отозванная, истёкшая ссылка и ссылка удалённого анализа дают один и тот же ответ.
  const publicLimiter = rateLimiter({ limit: cfg.publicRateLimit || 60, windowMs: 10 * 60 * 1000 });
  const publicHeaders = (res) => res.set({ "X-Robots-Tag": "noindex, nofollow", "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" });
  app.get("/api/public/shares/:token", publicLimiter, async (req, res) => {
    publicHeaders(res);
    const snap = await shares.getPublic(req.params.token);
    if (!snap) return res.status(404).json({ error: "link_unavailable", message: "Ссылка недействительна: её не существует, она отозвана или истёк срок действия" });
    shares.countView(req.params.token, req.ip, Boolean(req.user)).catch(() => {});
    res.json({ snapshot: snap });
  });
  app.get("/s/:token", publicLimiter, (req, res) => { publicHeaders(res); res.sendFile(join(root, "public", "share.html")); }); // одна и та же оболочка для любого токена

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
  // Этап 2 (spec 010): схема полей → извлечение характеристик → ТЗ. Страницы грузит сервер через Scrapfly (ключ только здесь).
  const scrapflyReady = (req, res, next) => (cfg.mock || cfg.scrapflyKey ? next() : res.status(400).json({ error: "bad_request", message: "Scrapfly не настроен: задайте SCRAPFLY_API_KEY на сервере" }));
  const configJob = (type, stream, check) => (req, res) => {
    const body = req.body || {}; const bad = check(body); if (bad) return res.status(400).json({ error: "bad_request", message: bad });
    const job = startJob(type, (signal) => stream(body, cfg, { signal }), { niche: String(body.niche || body.coreKeyword || "").slice(0, 60), userId: req.user.id, userName: req.user.name });
    log("info", type + " job start", { id: job.id, user: req.user.login, niche: job.meta.niche, asins: Array.isArray(body.asins) ? body.asins.length : 0 });
    res.status(202).json({ jobId: job.id });
  };
  app.post("/api/config/schema", authed, limiter, scrapflyReady, jsonBig, configJob("config_schema", schemaStream, (b) => (!Array.isArray(b.asins) || !b.asins.length ? "asins обязательны" : null)));
  app.post("/api/config/extract", authed, limiter, scrapflyReady, jsonBig, configJob("config_extract", extractStream, (b) => (!Array.isArray(b.asins) || !b.asins.length ? "asins обязательны" : !b.schema?.fields?.length ? "schema обязательна" : null)));
  app.post("/api/config/promo", authed, limiter, scrapflyReady, jsonBig, configJob("config_promo", promoStream, (b) => (!Array.isArray(b.asins) || !b.asins.length ? "asins обязательны" : null))); // spec 014: перезагрузка страниц ради промо, без AI
  app.post("/api/config/tz", authed, limiter, jsonMid, configJob("config_tz", tzStream, (b) => (!b.payload || typeof b.payload !== "object" ? "payload обязателен" : null)));
  app.post("/api/tz/docx", authed, jsonMid, async (req, res) => {
    const { tz, meta } = req.body || {};
    if (!tz || !Array.isArray(tz.rows)) return res.status(400).json({ error: "bad_request", message: "tz.rows обязателен" });
    const buf = await buildTzDocx(tz, { ...(meta || {}), preparedBy: meta?.preparedBy || req.user.name });
    res.set({ "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "Content-Disposition": `attachment; filename="${tzFileName(meta || {})}"`, "Cache-Control": "no-store" }).send(buf);
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
  // Главная страница без действующего сеанса ведёт на вход сразу ответом сервера: иначе браузер успевает показать оболочку приложения и «мигнуть» ею перед переходом.
  const pageGuard = async (req, res, next) => {
    const token = readCookie(req);
    try { if (token && (await sessions.resolveSession(token))) return next(); }
    catch { return next(); } // хранилище недоступно — отдаём приложение, оно объяснит само
    const back = req.originalUrl.startsWith("/index.html") ? "/" + req.originalUrl.slice("/index.html".length) : req.originalUrl;
    res.set("Cache-Control", "no-store").redirect(302, "/login.html?next=" + encodeURIComponent(back));
  };
  app.get("/", pageGuard); app.get("/index.html", pageGuard);
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
