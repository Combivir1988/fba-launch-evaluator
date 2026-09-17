// Структурные логи (JSON-строки) без содержимого запросов.
export function log(level, msg, fields = {}) {
  const line = { t: new Date().toISOString(), level, msg, ...fields };
  const out = level === "error" ? console.error : console.log;
  out(JSON.stringify(line));
}
