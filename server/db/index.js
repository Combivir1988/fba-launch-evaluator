// Подключение к БД. Production — Postgres (Neon) через pg.Pool; разработка и тесты — PGlite (Postgres в процессе).
// Единый интерфейс: { kind, query(sql, params) → {rows}, exec(sql), tx(fn), close() }. BYTEA всегда возвращается как Buffer.
import { log } from "../log.js";

const RETRYABLE = new Set(["ECONNRESET", "ECONNREFUSED", "EPIPE", "ETIMEDOUT", "57P01", "57P02", "57P03", "08006", "08003", "08000"]);

/** pg v8 трактует sslmode=require как verify-full и предупреждает о смене поведения в v9 — фиксируем строгий режим явно. */
export function normalizeDbUrl(url) {
  try {
    const u = new URL(url);
    const mode = u.searchParams.get("sslmode");
    if (mode === "require" || mode === "prefer" || mode === "verify-ca") u.searchParams.set("sslmode", "verify-full");
    return u.toString();
  } catch { return url; }
}

const fixRow = (row) => { for (const k in row) if (row[k] instanceof Uint8Array && !Buffer.isBuffer(row[k])) row[k] = Buffer.from(row[k]); return row; };
const fixRows = (r) => ({ rows: (r.rows || []).map(fixRow), rowCount: r.rowCount ?? r.affectedRows ?? (r.rows || []).length });

async function connectPg(url) {
  const { default: pg } = await import("pg");
  const pool = new pg.Pool({ connectionString: normalizeDbUrl(url), max: 5, idleTimeoutMillis: 30_000, connectionTimeoutMillis: 10_000, keepAlive: true });
  pool.on("error", (e) => log("warn", "db pool error", { code: e.code, message: e.message })); // Neon рвёт простаивающие соединения — это не авария
  const run = async (sql, params) => {
    try { return await pool.query(sql, params); }
    catch (e) { if (!RETRYABLE.has(e.code)) throw e; log("warn", "db retry", { code: e.code }); return await pool.query(sql, params); }
  };
  return {
    kind: "pg",
    query: async (sql, params = []) => fixRows(await run(sql, params)),
    exec: (sql) => pool.query(sql), // несколько операторов без параметров (миграции)
    async tx(fn) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const out = await fn({ query: async (sql, params = []) => fixRows(await client.query(sql, params)), exec: (sql) => client.query(sql) });
        await client.query("COMMIT");
        return out;
      } catch (e) { try { await client.query("ROLLBACK"); } catch {} throw e; }
      finally { client.release(); }
    },
    close: () => pool.end(),
  };
}

async function connectPglite(dataDir) {
  let PGlite;
  try { ({ PGlite } = await import("@electric-sql/pglite")); }
  catch { throw new Error("Локальная БД недоступна: установите devDependencies (npm install) или задайте DATABASE_URL"); }
  const db = new PGlite(dataDir || "memory://");
  await db.waitReady;
  return {
    kind: "pglite",
    query: async (sql, params = []) => fixRows(await db.query(sql, params)),
    exec: (sql) => db.exec(sql),
    tx: (fn) => db.transaction((t) => fn({ query: async (sql, params = []) => fixRows(await t.query(sql, params)), exec: (sql) => t.exec(sql) })),
    close: () => db.close(),
  };
}

/** cfg: { databaseUrl, production, dbMemory } */
export async function connect(cfg = {}) {
  if (cfg.databaseUrl) return connectPg(cfg.databaseUrl);
  if (cfg.production) throw new Error("DATABASE_URL не задан — в production хранилище обязательно (см. specs/002-team-accounts-sharing/quickstart.md)");
  return connectPglite(cfg.dbMemory ? "memory://" : ".data/pg");
}

/** Ошибка доступа к хранилищу (а не логики) — для ответа 503 storage_unavailable. */
export const isStorageError = (e) => Boolean(e && (RETRYABLE.has(e.code) || /timeout|Connection terminated|ENOTFOUND|getaddrinfo/i.test(String(e.message))));
