-- spec 008: общие настройки приложения, которые задаёт администратор (см. specs/008-session-policy/plan.md).
-- Первая настройка — правила сеансов: ключ 'session_policy', значение {"idleMinutes": 0, "maxDays": 0} (0 — правило выключено).

CREATE TABLE app_settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES users(id) ON DELETE SET NULL
);
