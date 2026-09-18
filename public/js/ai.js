// AI-анализ и патентный скан как фоновые задачи сервера: POST → { jobId } → EventSource /api/jobs/:id/events
// (replay событий + автопереподключение). Результат не теряется при обрыве сети или перезагрузке страницы.
import { buildAiPayload } from "/shared/ai-payload.js";
import { reconcile } from "/shared/verdict-rules.js";

const JOB_KEY = (analysisId, type) => `fba_job:${type}:${analysisId}`;
export const pendingJob = {
  get: (analysisId, type) => { try { return JSON.parse(localStorage.getItem(JOB_KEY(analysisId, type)) || "null"); } catch { return null; } },
  set: (analysisId, type, job) => localStorage.setItem(JOB_KEY(analysisId, type), JSON.stringify(job)),
  clear: (analysisId, type) => localStorage.removeItem(JOB_KEY(analysisId, type)),
};

async function startJob(url, body, token) {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json", "x-app-token": token }, body: JSON.stringify(body) });
  if (res.status === 401) throw Object.assign(new Error("Неверный пароль доступа"), { code: "auth" });
  if (res.status === 429) { const j = await res.json().catch(() => ({})); throw Object.assign(new Error(`Лимит запросов: повторите через ${j.retryAfter || 60} с`), { code: "rate_limited" }); }
  if (res.status === 503) throw Object.assign(new Error("Сервер перезапускается — повторите через несколько секунд"), { code: "draining", retryable: true });
  if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(j.message || j.error || `HTTP ${res.status}`); }
  const j = await res.json();
  if (!j.jobId) throw new Error("Сервер не вернул jobId");
  return j.jobId;
}

/** Подписка на задачу: события идут в handlers; резолвится результатом done или бросает ошибку. */
export function waitJob(jobId, token, handlers = {}) {
  return new Promise((resolve, reject) => {
    const es = new EventSource(`/api/jobs/${encodeURIComponent(jobId)}/events?token=${encodeURIComponent(token)}`);
    let finished = false; let retries = 0;
    const finish = (fn) => { if (finished) return; finished = true; es.close(); fn(); };
    const on = (name, fn) => es.addEventListener(name, (e) => { let d = {}; try { d = JSON.parse(e.data); } catch {} fn(d); });
    on("meta", (d) => handlers.onMeta?.(d));
    on("thinking", (d) => handlers.onThinking?.(d.text || ""));
    on("delta", (d) => handlers.onProgress?.(d.chars || 0));
    on("stage", (d) => handlers.onStage?.(d));
    on("done", (d) => finish(() => resolve(d)));
    on("job_error", (d) => finish(() => reject(Object.assign(new Error(d.message || "Ошибка задачи"), { code: d.code, retryable: d.retryable })))); // не "error": это встроенное событие EventSource (обрыв соединения)
    on("end", async () => {
      // поток закрыт без done/error → проверим состояние задачи
      if (finished) return;
      try { const j = await fetch(`/api/jobs/${encodeURIComponent(jobId)}?token=${encodeURIComponent(token)}`).then((r) => r.json());
        if (j.status === "done") finish(() => resolve(j.result)); else if (j.status === "error") finish(() => reject(Object.assign(new Error(j.error?.message || "Ошибка задачи"), { code: j.error?.code }))); }
      catch {}
    });
    es.onerror = async () => {
      if (finished) return;
      retries++; handlers.onReconnect?.(retries);
      // EventSource переподключится сам; если задача пропала (404 после рестарта сервера) — заканчиваем
      if (retries % 3 === 0) { try { const r = await fetch(`/api/jobs/${encodeURIComponent(jobId)}?token=${encodeURIComponent(token)}`); if (r.status === 404) finish(() => reject(Object.assign(new Error("Задача потеряна: сервер перезапустился до завершения — запустите анализ ещё раз"), { code: "lost", retryable: true }))); } catch {} }
    };
  });
}

/** Запуск AI-анализа (или продолжение уже запущенной задачи, если передан resumeJobId). */
export async function runAi(analysis, { token, onThinking, onProgress, onMeta, onReconnect, effort, model, resumeJobId } = {}) {
  let jobId = resumeJobId;
  if (!jobId) {
    const payload = buildAiPayload(analysis);
    jobId = await startJob("/api/analyze", { niche: analysis.niche, coreKeyword: analysis.coreKeyword, locale: "ru", payload, options: { ...(effort ? { effort } : {}), ...(model ? { model } : {}) } }, token);
    pendingJob.set(analysis.id, "analyze", { jobId, startedAt: Date.now() });
  }
  try {
    const done = await waitJob(jobId, token, { onThinking, onProgress, onMeta, onReconnect });
    const ai = reconcile(done.verdict, analysis.results.verdict, analysis.results);
    return { ...ai, model: done.model, provider: done.provider || null, usage: done.usage, durationMs: done.durationMs, createdAt: new Date().toISOString(), staleSince: null, jobId };
  } finally { pendingJob.clear(analysis.id, "analyze"); }
}

/** Патентный скан как задача. */
export async function runPatentScan(analysis, body, { token, onStage, onReconnect, resumeJobId } = {}) {
  let jobId = resumeJobId;
  if (!jobId) { jobId = await startJob("/api/patents/scan", body, token); pendingJob.set(analysis.id, "patents", { jobId, startedAt: Date.now() }); }
  try { const done = await waitJob(jobId, token, { onStage, onReconnect }); return done.scan; }
  finally { pendingJob.clear(analysis.id, "patents"); }
}
