// Spec 027: analysisId едет в теле КАЖДОГО запуска — по паре «анализ + вид операции» сервер узнаёт,
// что двое запускают одно и то же, и заводит работу один раз. Без него правило нереализуемо.
// AI-анализ и патентный скан как фоновые задачи сервера: POST → { jobId } → EventSource /api/jobs/:id/events
// (replay событий + автопереподключение). Результат не теряется при обрыве сети или перезагрузке страницы.
import { buildAiPayload } from "/shared/ai-payload.js";
import { reconcile } from "/shared/verdict-rules.js";
import { api } from "/js/api.js";

const JOB_KEY = (analysisId, type) => `fba_job:${type}:${analysisId}`;
export const pendingJob = {
  get: (analysisId, type) => { try { return JSON.parse(localStorage.getItem(JOB_KEY(analysisId, type)) || "null"); } catch { return null; } },
  set: (analysisId, type, job) => localStorage.setItem(JOB_KEY(analysisId, type), JSON.stringify(job)),
  clear: (analysisId, type) => localStorage.removeItem(JOB_KEY(analysisId, type)),
};

async function startJob(url, body) {
  try {
    const j = await api("POST", url, body);
    if (!j?.jobId) throw new Error("Сервер не вернул jobId");
    return j; // { jobId, joined? } — joined означает, что работа ЧУЖАЯ и уже идёт (spec 027)
  } catch (e) {
    if (e.status === 401) throw Object.assign(new Error("Сеанс истёк — войдите заново"), { code: "auth" });
    if (e.code === "rate_limited") throw Object.assign(new Error(`Лимит запросов: повторите через ${e.retryAfter || 60} с`), { code: "rate_limited" });
    if (e.code === "draining") throw Object.assign(new Error(e.message), { code: "draining", retryable: true });
    throw e;
  }
}

/** Подписка на задачу: события идут в handlers; резолвится результатом done или бросает ошибку. */
export function waitJob(jobId, handlers = {}) {
  return new Promise((resolve, reject) => {
    const es = new EventSource(`/api/jobs/${encodeURIComponent(jobId)}/events`); // сеанс — в cookie, в URL ничего секретного
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
      try { const j = await api("GET", `/api/jobs/${encodeURIComponent(jobId)}`);
        if (j.status === "done") finish(() => resolve(j.result)); else if (j.status === "error") finish(() => reject(Object.assign(new Error(j.error?.message || "Ошибка задачи"), { code: j.error?.code }))); }
      catch {}
    });
    es.onerror = async () => {
      if (finished) return;
      retries++; handlers.onReconnect?.(retries);
      // EventSource переподключится сам; если задача пропала (404 после рестарта сервера) — заканчиваем
      if (retries % 3 === 0) {
        try { await api("GET", `/api/jobs/${encodeURIComponent(jobId)}`, undefined, { noRedirect: true }); }
        catch (e) {
          if (e.status === 404) finish(() => reject(Object.assign(new Error("Задача потеряна (сервер перезапускался) — запустите заново"), { code: "lost" })));
          else if (e.status === 401) finish(() => reject(Object.assign(new Error("Сеанс истёк — войдите заново"), { code: "auth" })));
        }
      }
    };
  });
}

/** Запуск AI-анализа (или продолжение уже запущенной задачи, если передан resumeJobId). */
export async function runAi(analysis, { onThinking, onProgress, onMeta, onReconnect, onJoined, effort, model, resumeJobId } = {}) {
  let jobId = resumeJobId;
  if (!jobId) {
    const payload = buildAiPayload(analysis);
    const r = await startJob("/api/analyze", { analysisId: analysis.id, niche: analysis.niche, coreKeyword: analysis.coreKeyword, locale: "ru", payload, options: { ...(effort ? { effort } : {}), ...(model ? { model } : {}) } });
    jobId = r.jobId; if (r.joined) onJoined?.(r.joined);
    pendingJob.set(analysis.id, "analyze", { jobId, startedAt: Date.now() });
  }
  try {
    const done = await waitJob(jobId, { onThinking, onProgress, onMeta, onReconnect });
    const ai = reconcile(done.verdict, analysis.results.verdict, analysis.results);
    return { ...ai, model: done.model, provider: done.provider || null, usage: done.usage, durationMs: done.durationMs, createdAt: new Date().toISOString(), staleSince: null, jobId, ...(done.compacted ? { compacted: true } : {}) };
  } finally { pendingJob.clear(analysis.id, "analyze"); }
}

/** Патентный скан как задача. */
export async function runPatentScan(analysis, body, { onStage, onReconnect, onJoined, resumeJobId } = {}) {
  let jobId = resumeJobId;
  if (!jobId) { const r = await startJob("/api/patents/scan", { ...body, analysisId: analysis.id }); jobId = r.jobId; if (r.joined) onJoined?.(r.joined); pendingJob.set(analysis.id, "patents", { jobId, startedAt: Date.now() }); }
  try { const done = await waitJob(jobId, { onStage, onReconnect }); return done.scan; }
  finally { pendingJob.clear(analysis.id, "patents"); }
}

/** Задачи этапа 2 (spec 010): схема полей / извлечение характеристик / ТЗ. type: config_schema | config_extract | config_tz. Возвращает данные события done. */
export async function runConfigJob(analysis, type, url, body, { onStage, onReconnect, onJoined, resumeJobId } = {}) {
  let jobId = resumeJobId;
  if (!jobId) { const r = await startJob(url, { ...body, analysisId: analysis.id }); jobId = r.jobId; if (r.joined) onJoined?.(r.joined); pendingJob.set(analysis.id, type, { jobId, startedAt: Date.now() }); }
  try { return await waitJob(jobId, { onStage, onReconnect }); }
  finally { pendingJob.clear(analysis.id, type); }
}
