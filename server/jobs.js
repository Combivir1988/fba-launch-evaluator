// Фоновые задачи (AI-анализ, патентный скан): результат не привязан к HTTP-соединению.
// Клиент получает jobId, подписывается на SSE /api/jobs/:id/events (с replay всех событий) и может
// переподключаться/перезагружать страницу — задача доживёт до конца, результат хранится TTL.
import { randomUUID } from "node:crypto";
import { log } from "./log.js";

const TTL_MS = Number(process.env.JOB_TTL_MS) || 60 * 60 * 1000;
const jobs = new Map();

export function listJobs() { return [...jobs.values()].map((j) => ({ id: j.id, type: j.type, status: j.status, createdAt: j.createdAt })); }
export function getJob(id) { return jobs.get(id) || null; }

/** Запускает генератор событий как задачу. `factory(signal)` → async iterable {event, data}. */
export function startJob(type, factory, meta = {}) {
  const job = { id: randomUUID(), type, status: "running", createdAt: Date.now(), events: [], listeners: new Set(), result: null, error: null, meta, ac: new AbortController() };
  jobs.set(job.id, job);
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
      push("end", { status: job.status });
      setTimeout(() => jobs.delete(job.id), TTL_MS).unref?.();
    }
  })();
  return job;
}

export function cancelJob(id) { const j = jobs.get(id); if (!j || j.status !== "running") return false; j.ac.abort(); return true; }

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
