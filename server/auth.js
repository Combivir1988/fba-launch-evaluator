// Лимит запросов в памяти: N за окно на ключ (по умолчанию IP; для вошедших — id пользователя).
// Общий пароль доступа (APP_PASSWORD, X-App-Token) упразднён в spec 002 — см. server/sessions.js и server/users.js.
export function rateLimiter({ limit, windowMs, key = (req) => req.ip || req.socket?.remoteAddress || "?" }) {
  const hits = new Map();
  return (req, res, next) => {
    const now = Date.now();
    const k = key(req);
    const arr = (hits.get(k) || []).filter((t) => now - t < windowMs);
    if (arr.length >= limit) {
      const retryAfter = Math.ceil((windowMs - (now - arr[0])) / 1000);
      res.set("Retry-After", String(retryAfter));
      return res.status(429).json({ error: "rate_limited", message: "Слишком много запросов — повторите позже", retryAfter });
    }
    arr.push(now); hits.set(k, arr);
    if (hits.size > 5000) for (const [kk, v] of hits) if (!v.some((t) => now - t < windowMs)) hits.delete(kk);
    next();
  };
}
