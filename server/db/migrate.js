// Миграции схемы: SQL-файлы из migrations/ применяются по имени, каждая в своей транзакции, один раз.
import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { log } from "../log.js";

const dir = join(dirname(fileURLToPath(import.meta.url)), "migrations");

export async function migrate(db) {
  await db.exec("CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())");
  const done = new Set((await db.query("SELECT name FROM schema_migrations")).rows.map((r) => r.name));
  const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
  const applied = [];
  for (const name of files) {
    if (done.has(name)) continue;
    const sql = await readFile(join(dir, name), "utf8");
    await db.tx(async (t) => { await t.exec(sql); await t.query("INSERT INTO schema_migrations (name) VALUES ($1)", [name]); });
    applied.push(name);
    log("info", "migration applied", { name });
  }
  return applied;
}
