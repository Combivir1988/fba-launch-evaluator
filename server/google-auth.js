// Вход через Google — OpenID Connect, authorization code + PKCE (spec 004, plan D1–D6). Google только подтверждает личность:
// сеанс остаётся нашим (server/sessions.js). Все сетевые вызовы идут через fetchImpl — в тестах Google подменяется целиком.
import { createHash, createPublicKey, randomBytes, verify as cryptoVerify } from "node:crypto";

export const GOOGLE = {
  authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
  tokenUrl: "https://oauth2.googleapis.com/token",
  jwksUrl: "https://www.googleapis.com/oauth2/v3/certs",
  issuers: ["https://accounts.google.com", "accounts.google.com"],
};
export const OAUTH_COOKIE = "fba_oauth";
export const STATE_TTL_MS = 10 * 60 * 1000;
const JWKS_TTL_MS = 60 * 60 * 1000;
const b64u = (buf) => Buffer.from(buf).toString("base64url");

export class GoogleAuthError extends Error { constructor(code, message) { super(message); this.code = code; } }

/** После входа возвращаем только на путь внутри приложения (не на чужой сайт и не обратно на страницу входа). */
export function safeNext(next) {
  const n = typeof next === "string" ? next : "";
  return n.startsWith("/") && !n.startsWith("//") && !n.startsWith("/\\") && !n.startsWith("/login.html") && !n.startsWith("/api/") && n.length < 300 ? n : "/";
}

export function createGoogleAuth(cfg = {}, { fetchImpl = fetch, now = () => Date.now() } = {}) {
  const clientId = cfg.googleClientId || "", clientSecret = cfg.googleClientSecret || "";
  const enabled = Boolean(clientId && clientSecret);
  const pending = new Map(); // state → { nonce, verifier, next, exp } — один экземпляр сервера; при перезапуске человек просто начинает вход заново
  let jwks = { keys: [], at: 0 };

  function sweep() { const t = now(); for (const [k, v] of pending) if (v.exp <= t) pending.delete(k); if (pending.size > 5000) pending.clear(); }

  /** Начало входа → адрес Google и одноразовое значение state (его же кладём в HttpOnly-cookie браузера). */
  function begin({ redirectUri, next }) {
    if (!enabled) throw new GoogleAuthError("disabled", "Вход через Google не настроен");
    sweep();
    const state = b64u(randomBytes(32)), nonce = b64u(randomBytes(16)), verifier = b64u(randomBytes(48));
    pending.set(state, { nonce, verifier, next: safeNext(next), exp: now() + STATE_TTL_MS });
    const u = new URL(GOOGLE.authUrl);
    u.search = new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri, response_type: "code", scope: "openid email profile", state, nonce,
      code_challenge: b64u(createHash("sha256").update(verifier).digest()), code_challenge_method: "S256", prompt: "select_account" }).toString();
    return { url: u.toString(), state };
  }

  async function loadJwks(force = false) {
    if (!force && jwks.keys.length && now() - jwks.at < JWKS_TTL_MS) return jwks.keys;
    const r = await fetchImpl(GOOGLE.jwksUrl); if (!r.ok) throw new GoogleAuthError("jwks", "Не удалось получить ключи Google");
    const j = await r.json(); jwks = { keys: Array.isArray(j.keys) ? j.keys : [], at: now() }; return jwks.keys;
  }

  /** Подпись RS256 по ключам Google + издатель, получатель, срок, одноразовый номер, подтверждённая почта. → claims */
  async function verifyIdToken(idToken, { nonce }) {
    const bad = (why) => new GoogleAuthError("bad_token", "Ответ Google не прошёл проверку: " + why);
    const parts = String(idToken || "").split("."); if (parts.length !== 3) throw bad("формат");
    let header, claims; try { header = JSON.parse(Buffer.from(parts[0], "base64url")); claims = JSON.parse(Buffer.from(parts[1], "base64url")); } catch { throw bad("формат"); }
    if (header.alg !== "RS256" || !header.kid) throw bad("алгоритм подписи");
    let jwk = (await loadJwks()).find((k) => k.kid === header.kid);
    if (!jwk) jwk = (await loadJwks(true)).find((k) => k.kid === header.kid); // Google сменил ключи
    if (!jwk) throw bad("неизвестный ключ подписи");
    let okSig = false; try { okSig = cryptoVerify("RSA-SHA256", Buffer.from(parts[0] + "." + parts[1]), createPublicKey({ key: jwk, format: "jwk" }), Buffer.from(parts[2], "base64url")); } catch { okSig = false; }
    if (!okSig) throw bad("подпись");
    if (!GOOGLE.issuers.includes(claims.iss)) throw bad("издатель");
    if (claims.aud !== clientId) throw bad("получатель");
    if (typeof claims.exp !== "number" || claims.exp * 1000 < now() - 60_000) throw bad("срок действия");
    if (!nonce || claims.nonce !== nonce) throw bad("одноразовый номер");
    if (claims.email_verified !== true || !claims.email || !claims.sub) throw bad("почта не подтверждена");
    return claims;
  }

  /** Завершение входа. cookieState — значение cookie fba_oauth из того же браузера. → { sub, email, name, next } */
  async function finish({ code, state, cookieState, redirectUri }) {
    if (!enabled) throw new GoogleAuthError("disabled", "Вход через Google не настроен");
    sweep();
    if (!state || !cookieState || state !== cookieState) throw new GoogleAuthError("state", "Вход начат в другом браузере или ссылка устарела");
    const p = pending.get(state); pending.delete(state); // одноразово — даже при последующей ошибке
    if (!p || p.exp <= now()) throw new GoogleAuthError("state", "Время на вход истекло — начните заново");
    if (!code) throw new GoogleAuthError("cancelled", "Вход через Google не завершён");
    const r = await fetchImpl(GOOGLE.tokenUrl, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ code: String(code), client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri, grant_type: "authorization_code", code_verifier: p.verifier }).toString() });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.id_token) throw new GoogleAuthError("exchange", "Google не подтвердил вход" + (j.error ? `: ${String(j.error).slice(0, 60)}` : ""));
    const c = await verifyIdToken(j.id_token, { nonce: p.nonce });
    return { sub: String(c.sub), email: String(c.email).toLowerCase(), name: typeof c.name === "string" ? c.name : "", next: p.next };
  }

  return { enabled, begin, finish, verifyIdToken, _pending: pending };
}
