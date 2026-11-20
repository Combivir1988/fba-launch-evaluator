// Фоновые задачи (AI-анализ, патентный скан): результат не привязан к HTTP-соединению.
// Клиент получает jobId, подписывается на SSE /api/jobs/:id/events (с replay всех событий) и может
// переподключаться/перезагружать страницу — задача доживёт до конца, результат хранится TTL.
import { randomUUID } from "node:crypto";
import { log } from "./log.js";

const TTL_MS = Number(process.env.JOB_TTL_MS) || 60 * 60 * 1000;
const jobs = new Map();

// Spec 027: какая работа идёт по какой паре «анализ + вид операции». Пока работа выполняется,
// повторный запуск той же пары не заводит вторую, а присоединяется к идущей: AI вызывается один раз,
// страницы оплачиваются один раз, перезаписывать нечего.
//
// ⚠️ РЕЕСТР ЖИВЁТ В ПАМЯТИ ЭТОГО ПРОЦЕССА. При двух и более экземплярах сервера правило
// перестанет работать МОЛЧА: каждый процесс будет видеть только свои работы. На 2026-11-20
// экземпляр один — измерено поведением (/api/health отдаёт process.uptime(); двенадцать запросов
// подряд дали один монотонный ряд, расхождение «момента старта» 1 с — округление секунд).
// Если экземпляров станет больше, замок надо переносить в базу — это первое, что сломается.
const byKey = new Map();

export function listJobs() { return [...jobs.values()].map((j) => ({ id: j.id, type: j.type, status: j.status, createdAt: j.createdAt })); }
export function getJob(id) { return jobs.get(id) || null; }

/** Запускает генератор событий как задачу. `factory(signal)` → async iterable {event, data}.
 *  Возвращает `{ job, joined }`: `joined === null` — работа заведена, иначе это ЧУЖАЯ идущая работа,
 *  к которой мы присоединились, и `joined` несёт факты о ней (кто запустил, когда, с какими параметрами).
 *  Расхождения параметров считает вызывающий — здесь только жизненный цикл работ (spec 027, D1).
 *
 *  ⚠️ ПОИСК ПО КЛЮЧУ И РЕГИСТРАЦИЯ — ОДИН СИНХРОННЫЙ УЧАСТОК, без единого `await` между ними.
 *  Однопоточность Node делает его атомарным; вставленный сюда `await` (например, чтобы дочитать имя
 *  из базы) ВЕРНЁТ ГОНКУ — имя берётся только из meta, которое уже в памяти. */
export function startJob(type, factory, meta = {}, { key = null, params = null } = {}) {
  if (key) {
    const running = byKey.get(key);
    if (running && running.status === "running") return { job: running, joined: { startedBy: running.meta?.userName ?? null, startedAt: running.createdAt, params: running.params ?? null } };
  }
  const job = { id: randomUUID(), type, status: "running", createdAt: Date.now(), events: [], listeners: new Set(), result: null, error: null, meta, key, params, ac: new AbortController() };
  jobs.set(job.id, job);
  if (key) byKey.set(key, job);
  const push = (event, data) => { const ev = { event, data, seq: job.events.length }; job.events.push(ev); for (const fn of job.listeners) { try { fn(ev); } catch {} } };
  (async () => {
    try {
      for await (const ev of factory(job.ac.signal)) {
        push(ev.event, ev.data);
        if (ev.event === "done") { job.status = "done"; job.result = ev.data; }
        if (ev.event === "error") { job.status = "error"; job.error = ev.data; }
      }
      if (job.status === "running") { job.status = "error"; job.error = { code: "upstream", message: "Задача завершилась без результата", retryable: true }; push("error", job.error); }
    } catch (e) {
      job.status = "error"; job.error = { code: "upstream", message: e?.message || String(e), retryable: true }; push("error", job.error);
      log("error", "job failed", { id: job.id, type, message: e?.message });
    } finally {
      // Единственное место, через которое проходят ВСЕ четыре выхода: успех, ошибка, отмена, обрыв.
      // Снимаем запись СИНХРОННО и НЕМЕДЛЕННО — не внутри setTimeout ниже: задача живёт ещё час,
      // чтобы вернувшийся человек получил результат, а запись с таким же сроком заперла бы операцию на час.
      // Удаляем ПО СОВПАДЕНИЮ ЗНАЧЕНИЯ: если под ключом уже лежит более новая работа — не трогаем,
      // иначе завершившаяся старая сняла бы замок с только что начатой.
      if (job.key && byKey.get(job.key) === job) byKey.delete(job.key);
      push("end", { status: job.status });
      setTimeout(() => jobs.delete(job.id), TTL_MS).unref?.();
    }
  })();
  return { job, joined: null };
}

export function cancelJob(id) { const j = jobs.get(id); if (!j || j.status !== "running") return false; j.ac.abort(); return true; }

/** Занят ли ключ. Для тестов: показывает, что запись СНИМАЕТСЯ, а не копится (spec 027). */
export const keyBusy = (key) => byKey.has(key);

/** Активных задач (для graceful shutdown). */
export const runningCount = () => [...jobs.values()].filter((j) => j.status === "running").length;

/** Подписка SSE: replay всех событий, затем live. Событие ошибки отдаём как job_error —
 *  имя "error" у EventSource зарезервировано под обрыв соединения. Возвращает функцию отписки. */
export function subscribe(job, res, fromSeq = 0) {
  const send = (ev) => { if (!res.writableEnded) res.write(`id: ${ev.seq}\nevent: ${ev.event === "error" ? "job_error" : ev.event}\ndata: ${JSON.stringify(ev.data)}\n\n`); };
  for (const ev of job.events) if (ev.seq >= fromSeq) send(ev);
  if (job.status !== "running") { return () => {}; }
  const fn = (ev) => send(ev);
  job.listeners.add(fn);
  return () => job.listeners.delete(fn);
}
