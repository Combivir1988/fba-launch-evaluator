// Структурные логи (JSON-строки) без содержимого запросов.
export function log(level, msg, fields = {}) {
  // Поле `message` сборщик логов (Railway) считает самой строкой и в атрибуты не кладёт — текст ошибки пропадал.
  // Замер 2026-10-20: от упавшей задачи в логах остались только code и retryable. Поэтому кладём его как `detail`.
  const { message, ...rest } = fields;
  const line = { t: new Date().toISOString(), level, msg, ...(message === undefined ? {} : { detail: message }), ...rest };
  const out = level === "error" ? console.error : console.log;
  out(JSON.stringify(line));
}
