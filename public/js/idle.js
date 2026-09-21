// Выход при бездействии (spec 008). Правило задаёт администратор; сервер проверяет его сам при каждом запросе,
// а этот модуль делает то же в браузере: предупреждает за минуту, сохраняет несохранённое и уводит на страницу входа.
// Активность общая для всех вкладок приложения (localStorage), поэтому работа в одной вкладке не «выкидывает» остальные.
const ACT_KEY = "fba_last_activity", OUT_KEY = "fba_idle_logout";
const WARN_MS = 60 * 1000, PING_MS = 60 * 1000, WRITE_MS = 5 * 1000;
const EVENTS = ["mousemove", "mousedown", "keydown", "wheel", "scroll", "touchstart", "pointerdown"];

/**
 * @param {object} o { getIdleMinutes(): number, ping(): Promise, beforeLogout(): Promise, logout(): Promise, dialog: HTMLDialogElement, now?(): number }
 * @returns {{ stop(): void, check(): void }}
 */
export function startIdleWatch(o) {
  const now = o.now || (() => Date.now());
  let last = now(), lastWrite = 0, lastPing = now(), dirty = false, leaving = false, timer = 0;
  const dlg = o.dialog, left = dlg?.querySelector("[data-idle-left]");
  const stored = () => { try { return Number(localStorage.getItem(ACT_KEY)) || 0; } catch { return 0; } };
  const lastActivity = () => Math.max(last, stored());

  function mark() {
    last = now(); dirty = true;
    if (last - lastWrite >= WRITE_MS) { lastWrite = last; try { localStorage.setItem(ACT_KEY, String(last)); } catch {} }
    if (dlg?.open) { dlg.close(); schedule(); }
  }
  /** Сервер узнаёт об активности: пользователь может долго читать дашборд, не делая ни одного запроса. */
  function maybePing(force = false) {
    if (leaving || (!force && (!dirty || now() - lastPing < PING_MS))) return;
    dirty = false; lastPing = now(); o.ping().catch(() => {});
  }
  async function leave() {
    if (leaving) return; leaving = true; clearTimeout(timer);
    try { localStorage.setItem(OUT_KEY, String(now())); } catch {}
    try { await o.beforeLogout(); } catch {}
    await o.logout("idle");
  }
  function check() {
    if (leaving) return;
    const limit = (o.getIdleMinutes() || 0) * 60 * 1000;
    if (!limit) { if (dlg?.open) dlg.close(); return schedule(); }
    const idle = now() - lastActivity();
    if (idle >= limit) return void leave();
    if (idle >= limit - WARN_MS) { if (dlg && !dlg.open) dlg.showModal(); if (left) left.textContent = String(Math.max(1, Math.ceil((limit - idle) / 1000))); }
    else { if (dlg?.open) dlg.close(); maybePing(); }
    schedule();
  }
  function schedule() { clearTimeout(timer); timer = setTimeout(check, dlg?.open ? 1000 : 5000); }

  const onEvent = () => mark();
  const onVisible = () => { if (document.visibilityState === "visible") check(); };
  const onStorage = (e) => { if (e.key === OUT_KEY && e.newValue) { leaving = true; o.logout("idle", { alreadyLoggedOut: true }); } if (e.key === ACT_KEY && dlg?.open) check(); };
  for (const ev of EVENTS) window.addEventListener(ev, onEvent, { passive: true, capture: true });
  document.addEventListener("visibilitychange", onVisible); window.addEventListener("storage", onStorage);
  dlg?.querySelector("[data-idle-stay]")?.addEventListener("click", () => { mark(); try { localStorage.setItem(ACT_KEY, String(now())); } catch {} maybePing(true); });
  dlg?.querySelector("[data-idle-leave]")?.addEventListener("click", () => leave());
  dlg?.addEventListener("cancel", (e) => { e.preventDefault(); mark(); maybePing(true); }); // Esc = «Остаться»
  try { localStorage.removeItem(OUT_KEY); localStorage.setItem(ACT_KEY, String(now())); } catch {}
  schedule();
  return { check, stop() { clearTimeout(timer); for (const ev of EVENTS) window.removeEventListener(ev, onEvent, { capture: true }); document.removeEventListener("visibilitychange", onVisible); window.removeEventListener("storage", onStorage); } };
}
