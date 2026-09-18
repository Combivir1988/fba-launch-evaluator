// Общий пароль доступа: заголовок X-App-Token сравнивается с APP_PASSWORD (постоянное время).
import { timingSafeEqual } from "node:crypto";

export function tokenMatches(token, secret) {
  if (typeof token !== "string" || typeof secret !== "string" || !secret) return false;
  const a = Buffer.from(token), b = Buffer.from(secret);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function authMiddleware(cfg) {
  return (req, res, next) => {
    if (req.path === "/api/health") return next();
    if (!cfg.appPassword) return res.status(503).json({ error: "app_password_not_configured", message: "На сервере не задан APP_PASSWORD" });
    const token = req.get("x-app-token") || (typeof req.query?.token === "string" ? req.query.token : "") || "";
    if (!tokenMatches(token, cfg.appPassword)) return res.status(401).json({ error: "unauthorized" });
    next();
  };
}

/** Простой лимит запросов в памяти: N за окно на IP. */
export function rateLimiter({ limit, windowMs }) {
  const hits = new Map();
  return (req, res, next) => {
    const now = Date.now();
    const ip = req.ip || req.socket?.remoteAddress || "?";
    const arr = (hits.get(ip) || []).filter((t) => now - t < windowMs);
    if (arr.length >= limit) {
      const retryAfter = Math.ceil((windowMs - (now - arr[0])) / 1000);
      res.set("Retry-After", String(retryAfter));
      return res.status(429).json({ error: "rate_limited", retryAfter });
    }
    arr.push(now); hits.set(ip, arr);
    if (hits.size > 5000) for (const [k, v] of hits) if (!v.some((t) => now - t < windowMs)) hits.delete(k);
    next();
  };
}
