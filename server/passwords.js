// Пароли: scrypt из node:crypto (research R3). Формат хэша: scrypt$<logN>$<r>$<p>$<salt b64>$<hash b64>.
// Все вызовы идут через очередь по одному: один scrypt при N=2^15, r=8 занимает ~33 MB, а лимит процесса — 0.5 GB.
import { scrypt, randomBytes, timingSafeEqual } from "node:crypto";

const PARAMS = { logN: 15, r: 8, p: 3, keylen: 64, saltLen: 16 };
const MAXMEM = 64 * 1024 * 1024;
export const MIN_PASSWORD_LENGTH = 10;

let chain = Promise.resolve();
let peak = 0, active = 0;
/** Выполняет fn строго после предыдущих — не более одного scrypt одновременно. */
function queued(fn) {
  const run = chain.then(async () => { active++; peak = Math.max(peak, active); try { return await fn(); } finally { active--; } });
  chain = run.catch(() => {});
  return run;
}
export const _stats = () => ({ peak });

const derive = (password, salt, { logN, r, p, keylen }) => new Promise((resolve, reject) =>
  scrypt(String(password).normalize("NFKC"), salt, keylen, { N: 2 ** logN, r, p, maxmem: MAXMEM }, (err, key) => (err ? reject(err) : resolve(key))));

export function hashPassword(password) {
  return queued(async () => {
    const salt = randomBytes(PARAMS.saltLen);
    const key = await derive(password, salt, PARAMS);
    return `scrypt$${PARAMS.logN}$${PARAMS.r}$${PARAMS.p}$${salt.toString("base64")}$${key.toString("base64")}`;
  });
}

function parse(stored) {
  const m = /^scrypt\$(\d{1,2})\$(\d{1,2})\$(\d{1,2})\$([A-Za-z0-9+/=]+)\$([A-Za-z0-9+/=]+)$/.exec(String(stored || ""));
  if (!m) return null;
  const logN = Number(m[1]), r = Number(m[2]), p = Number(m[3]);
  if (logN < 10 || logN > 20 || r < 1 || r > 32 || p < 1 || p > 16) return null;
  const salt = Buffer.from(m[4], "base64"), hash = Buffer.from(m[5], "base64");
  if (salt.length < 8 || hash.length < 16) return null;
  return { logN, r, p, keylen: hash.length, salt, hash };
}

export function verifyPassword(password, stored) {
  const h = parse(stored);
  if (!h) return dummyVerify().then(() => false); // битый хэш: время ответа как у обычной проверки
  return queued(async () => {
    try { const key = await derive(password, h.salt, h); return key.length === h.hash.length && timingSafeEqual(key, h.hash); }
    catch { return false; }
  });
}

const DUMMY_SALT = randomBytes(PARAMS.saltLen);
/** Фиктивная проверка для неизвестного логина — одинаковое время ответа (FR-007). */
export function dummyVerify() { return queued(async () => { await derive("dummy-password", DUMMY_SALT, PARAMS); return false; }); }

/** null, если пароль годится; иначе текст ошибки по-русски. */
export function validateNewPassword(next, current = null) {
  if (typeof next !== "string" || next.length < MIN_PASSWORD_LENGTH) return `Пароль должен быть не короче ${MIN_PASSWORD_LENGTH} символов`;
  if (next.length > 200) return "Пароль слишком длинный (максимум 200 символов)";
  if (current !== null && next === current) return "Новый пароль должен отличаться от текущего";
  return null;
}
