import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import zlib from "node:zlib";
import { testDb } from "./helpers/db.js";
import { migrate } from "../server/db/migrate.js";
import { normalizeDbUrl, connect } from "../server/db/index.js";

let db;
before(async () => { db = await testDb(); });
after(async () => { await db.close(); });

test("миграции идемпотентны, все таблицы созданы", async () => {
  assert.deepEqual(await migrate(db), []);
  const t = (await db.query("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY 1")).rows.map((r) => r.table_name);
  for (const name of ["analyses", "job_log", "schema_migrations", "sessions", "shares", "users"]) assert.ok(t.includes(name), name);
});

test("tx откатывается при исключении", async () => {
  await db.reset();
  await assert.rejects(db.tx(async (t) => { await t.query("INSERT INTO users (id, login, name, role, password_hash) VALUES (gen_random_uuid(), 'a1', 'A', 'user', 'x')"); throw new Error("boom"); }), /boom/);
  assert.equal((await db.query("SELECT count(*)::int AS n FROM users")).rows[0].n, 0);
});

test("BYTEA возвращается как Buffer, gzip round-trip", async () => {
  await db.reset();
  const u = await db.makeUser();
  const gz = zlib.gzipSync(JSON.stringify({ k: "ключ".repeat(100) }));
  await db.query("INSERT INTO analyses (id, core, aggregates_gz, created_by, updated_by) VALUES (gen_random_uuid(), $1, $2, $3, $3)", [JSON.stringify({ niche: "n" }), gz, u.id]);
  const row = (await db.query("SELECT aggregates_gz, core FROM analyses")).rows[0];
  assert.ok(Buffer.isBuffer(row.aggregates_gz));
  assert.equal(JSON.parse(zlib.gunzipSync(row.aggregates_gz)).k.length, 400);
  assert.equal(row.core.niche, "n");
});

test("ограничения схемы: роль и уникальность логина", async () => {
  await db.reset();
  await db.makeUser({ login: "dup" });
  await assert.rejects(db.makeUser({ login: "dup" }));
  await assert.rejects(db.makeUser({ role: "root" }));
});

test("normalizeDbUrl: require → verify-full; production без URL — ошибка", async () => {
  assert.match(normalizeDbUrl("postgresql://u:p@h/db?sslmode=require&channel_binding=require"), /sslmode=verify-full&channel_binding=require/);
  assert.equal(normalizeDbUrl("postgresql://u:p@h/db"), "postgresql://u:p@h/db");
  await assert.rejects(connect({ production: true }), /DATABASE_URL/);
});
