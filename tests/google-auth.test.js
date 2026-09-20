import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createGoogleAuth, safeNext, STATE_TTL_MS, GOOGLE } from "../server/google-auth.js";
import { fakeGoogle, CLIENT_ID } from "./helpers/fake-google.js";

const REDIRECT = "https://app.example/api/auth/google/callback";
const setup = () => { let clock = Date.parse("2026-09-20T10:00:00Z"); const G = fakeGoogle({ now: () => clock });
  const A = createGoogleAuth({ googleClientId: CLIENT_ID, googleClientSecret: "secret" }, { fetchImpl: G.fetchImpl, now: () => clock }); return { G, A, tick: (ms) => { clock += ms; } }; };
const nonceOf = (url) => new URL(url).searchParams.get("nonce");
const code = (c) => (e) => e.code === c;

test("begin: адрес Google со всеми параметрами, PKCE S256, минимальный набор данных", () => {
  const { A } = setup(); const { url, state } = A.begin({ redirectUri: REDIRECT, next: "/?tab=history" }); const u = new URL(url), p = u.searchParams;
  assert.equal(u.origin + u.pathname, GOOGLE.authUrl); assert.equal(p.get("client_id"), CLIENT_ID); assert.equal(p.get("redirect_uri"), REDIRECT);
  assert.equal(p.get("response_type"), "code"); assert.equal(p.get("scope"), "openid email profile"); assert.equal(p.get("state"), state); assert.equal(p.get("code_challenge_method"), "S256");
  assert.match(state, /^[A-Za-z0-9_-]{43}$/); assert.ok(p.get("nonce").length >= 20); assert.match(p.get("code_challenge"), /^[A-Za-z0-9_-]{43}$/);
  assert.equal(url.includes("secret"), false, "секрет клиента в адрес не попадает");
  assert.equal(createGoogleAuth({}).enabled, false); assert.throws(() => createGoogleAuth({}).begin({ redirectUri: REDIRECT }), code("disabled"));
});

test("успешный вход: обмен кода с code_verifier и секретом, проверенные данные, возврат внутрь приложения", async () => {
  const { G, A } = setup(); const b = A.begin({ redirectUri: REDIRECT, next: "/?tab=history" });
  const c = G.issueCode({ nonce: nonceOf(b.url), sub: "g-111", email: "Anna@Gmail.com", name: "Анна" });
  const out = await A.finish({ code: c, state: b.state, cookieState: b.state, redirectUri: REDIRECT });
  assert.deepEqual(out, { sub: "g-111", email: "anna@gmail.com", name: "Анна", next: "/?tab=history" });
  const sent = G.calls.token[0]; assert.equal(sent.client_secret, "secret"); assert.equal(sent.grant_type, "authorization_code"); assert.equal(sent.redirect_uri, REDIRECT);
  assert.equal(createHash("sha256").update(sent.code_verifier).digest("base64url"), new URL(b.url).searchParams.get("code_challenge"), "code_verifier соответствует code_challenge");
});

test("state: чужой браузер, подмена, повтор, истёкший срок, отмена на стороне Google", async () => {
  const { G, A, tick } = setup(); const b = A.begin({ redirectUri: REDIRECT }); const c = G.issueCode({ nonce: nonceOf(b.url) });
  await assert.rejects(A.finish({ code: c, state: b.state, cookieState: "", redirectUri: REDIRECT }), code("state"));
  await assert.rejects(A.finish({ code: c, state: b.state, cookieState: "другое", redirectUri: REDIRECT }), code("state"));
  await assert.rejects(A.finish({ code: c, state: "придуманный", cookieState: "придуманный", redirectUri: REDIRECT }), code("state"));
  assert.ok(await A.finish({ code: c, state: b.state, cookieState: b.state, redirectUri: REDIRECT }));
  await assert.rejects(A.finish({ code: G.issueCode({ nonce: nonceOf(b.url) }), state: b.state, cookieState: b.state, redirectUri: REDIRECT }), code("state"), "state одноразовый");
  const late = A.begin({ redirectUri: REDIRECT }); tick(STATE_TTL_MS + 1000);
  await assert.rejects(A.finish({ code: G.issueCode({ nonce: nonceOf(late.url) }), state: late.state, cookieState: late.state, redirectUri: REDIRECT }), code("state"));
  const cancelled = A.begin({ redirectUri: REDIRECT }); await assert.rejects(A.finish({ code: "", state: cancelled.state, cookieState: cancelled.state, redirectUri: REDIRECT }), code("cancelled"));
  const failed = A.begin({ redirectUri: REDIRECT }); await assert.rejects(A.finish({ code: G.issueCode({}, { tokenError: true }), state: failed.state, cookieState: failed.state, redirectUri: REDIRECT }), code("exchange"));
});

test("ID-токен отклоняется: чужая подпись, чужой получатель и издатель, просрочен, не тот nonce, почта не подтверждена, alg none", async () => {
  const { G, A, tick } = setup();
  const attempt = async (over, opts) => { const b = A.begin({ redirectUri: REDIRECT }); return A.finish({ code: G.issueCode({ nonce: nonceOf(b.url), ...over }, opts), state: b.state, cookieState: b.state, redirectUri: REDIRECT }); };
  await assert.rejects(attempt({}, { foreignKey: true }), code("bad_token"));
  await assert.rejects(attempt({ aud: "another-app.apps.googleusercontent.com" }), code("bad_token"));
  await assert.rejects(attempt({ iss: "https://evil.example" }), code("bad_token"));
  await assert.rejects(attempt({ nonce: "не-тот" }), code("bad_token"));
  await assert.rejects(attempt({ email_verified: false }), code("bad_token"));
  await assert.rejects(attempt({ email: "" }), code("bad_token"));
  await assert.rejects(attempt({}, { header: { alg: "none" } }), code("bad_token"));
  await assert.rejects(attempt({ exp: Math.floor(Date.parse("2026-09-20T09:00:00Z") / 1000) }), code("bad_token"));
  assert.ok(await attempt({ iss: "accounts.google.com" }), "короткая форма издателя допустима");
  tick(1000); assert.ok(await attempt({}), "обычный вход по-прежнему проходит");
});

test("смена ключей Google: неизвестный kid → ключи перезагружаются один раз; кэш на час", async () => {
  const { G, A } = setup(); const go = async () => { const b = A.begin({ redirectUri: REDIRECT }); return A.finish({ code: G.issueCode({ nonce: nonceOf(b.url) }), state: b.state, cookieState: b.state, redirectUri: REDIRECT }); };
  await go(); await go(); assert.equal(G.calls.jwks, 1, "ключи кэшируются");
  G.rotate("key-2"); assert.ok(await go()); assert.equal(G.calls.jwks, 2, "после ротации ключи перечитаны");
});

test("safeNext: только путь внутри приложения", () => {
  for (const ok of ["/", "/?tab=history", "/index.html#x"]) assert.equal(safeNext(ok), ok);
  for (const bad of ["https://evil.example", "//evil.example", "/\\evil.example", "javascript:alert(1)", "/login.html", "/api/users", "", null, undefined, 5, "/" + "a".repeat(400)]) assert.equal(safeNext(bad), "/", String(bad));
});
