// Обёртка над fetch для /api: сеанс в HttpOnly-cookie (скриптам не виден), заголовок X-Requested-With — защита от CSRF.
export class ApiError extends Error {
  constructor(status, code, message, extra = {}) { super(message || code || `HTTP ${status}`); this.status = status; this.code = code; Object.assign(this, extra); }
}

const MESSAGES = {
  0: "Сервер недоступен — проверьте соединение",
  draining: "Сервер перезапускается — повторите через несколько секунд",
  storage_unavailable: "Хранилище недоступно — изменения не сохранены. Работа во вкладке продолжается, на всякий случай скачайте JSON",
};

export function goLogin(hash = "") {
  if (location.pathname.endsWith("/login.html")) return;
  const next = location.pathname + location.search;
  location.replace("/login.html?next=" + encodeURIComponent(next) + hash);
}

/** api("POST", "/api/…", body) → разобранный JSON (или null для 204). Бросает ApiError. opts.noRedirect — не уходить на вход при 401. */
export async function api(method, path, body, opts = {}) {
  let res;
  try {
    res = await fetch(path, { method, credentials: "same-origin", headers: { "X-Requested-With": "fba", ...(body !== undefined ? { "Content-Type": "application/json" } : {}) }, body: body !== undefined ? JSON.stringify(body) : undefined, signal: opts.signal });
  } catch (e) { if (e.name === "AbortError") throw e; throw new ApiError(0, "network", MESSAGES[0]); }
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (res.ok) return data;
  const err = new ApiError(res.status, data.error || "http_" + res.status, MESSAGES[data.error] || data.message, data);
  if (res.status === 401 && !opts.noRedirect) goLogin();
  if (res.status === 403 && data.error === "password_change_required" && !opts.noRedirect) goLogin("#change");
  if (data.error === "storage_unavailable") window.dispatchEvent(new CustomEvent("storage-down"));
  throw err;
}

export const getMe = (opts) => api("GET", "/api/auth/me", undefined, opts);
