// Общие настройки приложения, которые задаёт администратор (spec 008). Пока одна — правила сеансов.
// Значения кэшируются на 30 с: правила проверяются при КАЖДОМ запросе, а базу (Neon) ради этого будить нельзя.
import { UserError } from "./users.js";

export const IDLE_OPTIONS = [0, 15, 30, 60, 120, 240, 480, 1440]; // минут бездействия до выхода; 0 — выключено
export const MAX_DAYS_OPTIONS = [0, 1, 7, 30];                    // максимальная длительность сеанса, дней; 0 — без ограничения (30 дней с продлением активностью)
export const DEFAULT_SESSION_POLICY = Object.freeze({ idleMinutes: 0, maxDays: 0 });
const KEY = "session_policy", CACHE_MS = 30 * 1000;

export function normalizeSessionPolicy(v) {
  const idle = Number(v?.idleMinutes), max = Number(v?.maxDays);
  return { idleMinutes: IDLE_OPTIONS.includes(idle) ? idle : 0, maxDays: MAX_DAYS_OPTIONS.includes(max) ? max : 0 };
}

export function createAppSettings(db, { now = () => Date.now() } = {}) {
  let cached = null, cachedAt = 0;

  /** Правила сеансов. Ошибка чтения не должна выкидывать людей из сеансов — отдаём последнее известное значение (или «по умолчанию»). */
  async function getSessionPolicy() {
    if (cached && now() - cachedAt < CACHE_MS) return cached;
    try {
      const r = (await db.query("SELECT value FROM app_settings WHERE key = $1", [KEY])).rows[0];
      cached = normalizeSessionPolicy(r?.value); cachedAt = now();
    } catch (e) { if (!cached) return { ...DEFAULT_SESSION_POLICY }; }
    return cached;
  }

  async function sessionPolicyInfo() {
    const r = (await db.query("SELECT s.value, s.updated_at, u.name FROM app_settings s LEFT JOIN users u ON u.id = s.updated_by WHERE s.key = $1", [KEY])).rows[0];
    return { policy: normalizeSessionPolicy(r?.value), updatedAt: r?.updated_at ? new Date(r.updated_at).toISOString() : null, updatedBy: r?.name || null, options: { idleMinutes: IDLE_OPTIONS, maxDays: MAX_DAYS_OPTIONS } };
  }

  async function setSessionPolicy(input, userId) {
    const idle = Number(input?.idleMinutes), max = Number(input?.maxDays);
    if (!IDLE_OPTIONS.includes(idle)) throw new UserError("invalid", "Время бездействия: выберите одно из значений списка", 400);
    if (!MAX_DAYS_OPTIONS.includes(max)) throw new UserError("invalid", "Максимальная длительность сеанса: выберите одно из значений списка", 400);
    const value = { idleMinutes: idle, maxDays: max };
    await db.query(`INSERT INTO app_settings (key, value, updated_at, updated_by) VALUES ($1, $2, $3, $4)
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at, updated_by = EXCLUDED.updated_by`, [KEY, JSON.stringify(value), new Date(now()), userId || null]);
    cached = value; cachedAt = now();
    return sessionPolicyInfo();
  }

  return { getSessionPolicy, sessionPolicyInfo, setSessionPolicy, _forget: () => { cached = null; } };
}
