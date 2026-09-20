// Фальшивый Google для тестов входа (spec 004): собственная RSA-пара, JWKS и токен-эндпоинт через fetchImpl — полностью офлайн.
import { generateKeyPairSync, createSign, randomUUID } from "node:crypto";
import { GOOGLE } from "../../server/google-auth.js";

export const CLIENT_ID = "test-client.apps.googleusercontent.com";
const b64u = (o) => Buffer.from(typeof o === "string" ? o : JSON.stringify(o)).toString("base64url");

export function fakeGoogle({ now = () => Date.now() } = {}) {
  const mk = (kid) => { const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 }); return { kid, privateKey, jwk: { ...publicKey.export({ format: "jwk" }), kid, alg: "RS256", use: "sig" } }; };
  const keys = [mk("key-1")]; const foreign = mk("key-1"); // чужой ключ с тем же kid — «подпись не Google»
  const codes = new Map(); const calls = { token: [], jwks: 0 };
  function sign(claims, key = keys[0], header = {}) {
    const head = b64u({ alg: "RS256", typ: "JWT", kid: key.kid, ...header }), body = b64u(claims);
    const s = createSign("RSA-SHA256"); s.update(head + "." + body); return head + "." + body + "." + s.sign(key.privateKey).toString("base64url");
  }
  const claims = (over = {}) => ({ iss: "https://accounts.google.com", aud: CLIENT_ID, sub: "g-" + randomUUID().slice(0, 8), email: "anna@gmail.com", email_verified: true, name: "Анна Коваль", iat: Math.floor(now() / 1000), exp: Math.floor(now() / 1000) + 3600, ...over });
  /** Регистрирует «код авторизации»: при обмене вернётся подписанный ID-токен. nonce подставляется из запроса начала входа. */
  function issueCode(over = {}, opts = {}) { const code = "code-" + randomUUID(); codes.set(code, { over, opts }); return code; }
  const fetchImpl = async (url, init = {}) => {
    if (String(url) === GOOGLE.jwksUrl) { calls.jwks++; return new Response(JSON.stringify({ keys: keys.map((k) => k.jwk) }), { status: 200 }); }
    if (String(url) === GOOGLE.tokenUrl) {
      const p = new URLSearchParams(init.body); calls.token.push(Object.fromEntries(p));
      const c = codes.get(p.get("code")); codes.delete(p.get("code"));
      if (!c || c.opts.tokenError) return new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 });
      return new Response(JSON.stringify({ access_token: "ya29.test", id_token: sign(claims(c.over), c.opts.foreignKey ? foreign : keys[0], c.opts.header || {}) }), { status: 200 });
    }
    throw new Error("неожиданный запрос в тесте: " + url);
  };
  return { fetchImpl, issueCode, sign, claims, keys, foreign, calls, rotate: (kid) => { keys.length = 0; keys.push(mk(kid)); } };
}
