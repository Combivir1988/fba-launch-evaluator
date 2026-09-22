// Тестовая БД: один PGlite в памяти на тестовый файл (старт ~5 с), между тестами — TRUNCATE.
import { randomUUID } from "node:crypto";
import { connect } from "../../server/db/index.js";
import { migrate } from "../../server/db/migrate.js";

const TABLES = ["analysis_versions", "app_settings", "job_log", "shares", "analyses", "sessions", "users"];

export async function testDb() {
  const db = await connect({ dbMemory: true });
  await migrate(db);
  db.reset = () => db.exec(`TRUNCATE ${TABLES.join(", ")} CASCADE`);
  /** Пользователь напрямую в БД, без scrypt (быстро). Хэш заведомо невалидный — войти таким нельзя. */
  db.makeUser = async ({ login = "u" + randomUUID().slice(0, 8), name = "Тест", role = "user", active = true, mustChange = false, hash = "x", email = null } = {}) => {
    const id = randomUUID();
    await db.query("INSERT INTO users (id, login, name, role, active, password_hash, must_change_password, email) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)", [id, login, name, role, active, hash, mustChange, email]);
    return { id, login, name, role, active };
  };
  return db;
}
