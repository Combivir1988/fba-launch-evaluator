// AI-анализ: POST /api/analyze (SSE) → события → reconcile с правилами.
import { buildAiPayload } from "/shared/ai-payload.js";
import { reconcile } from "/shared/verdict-rules.js";

export async function runAi(analysis, { token, onThinking, onProgress, onMeta, signal, effort, model } = {}) {
  const payload = buildAiPayload(analysis);
  const res = await fetch("/api/analyze", { method: "POST", signal,
    headers: { "content-type": "application/json", "x-app-token": token },
    body: JSON.stringify({ niche: analysis.niche, coreKeyword: analysis.coreKeyword, locale: "ru", payload, options: { ...(effort ? { effort } : {}), ...(model ? { model } : {}) } }) });
  if (res.status === 401) throw Object.assign(new Error("Неверный пароль доступа"), { code: "auth" });
  if (res.status === 429) { const j = await res.json().catch(() => ({})); throw Object.assign(new Error(`Лимит запросов: повторите через ${j.retryAfter || 60} с`), { code: "rate_limited" }); }
  if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(j.message || j.error || `HTTP ${res.status}`); }
  const reader = res.body.getReader(); const dec = new TextDecoder();
  let buf = "", done = null, err = null;
  while (true) {
    const { value, done: end } = await reader.read();
    if (end) break;
    buf += dec.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf("\n\n")) >= 0) {
      const chunk = buf.slice(0, idx); buf = buf.slice(idx + 2);
      const m = chunk.match(/^event: (\w+)\ndata: ([\s\S]*)$/m); if (!m) continue;
      const ev = m[1]; let data = {}; try { data = JSON.parse(m[2]); } catch {}
      if (ev === "meta") onMeta?.(data);
      else if (ev === "thinking") onThinking?.(data.text || "");
      else if (ev === "delta") onProgress?.(data.chars || 0);
      else if (ev === "done") done = data;
      else if (ev === "error") err = data;
    }
  }
  if (err) throw Object.assign(new Error(err.message || "Ошибка AI"), { code: err.code, retryable: err.retryable });
  if (!done) throw Object.assign(new Error("Соединение прервано без результата (сервер перезапускался или превышен таймаут; повторите — на бесплатной модели ответ занимает 3–6 мин, платные отвечают за ~30 с)"), { code: "disconnected", retryable: true });
  const ai = reconcile(done.verdict, analysis.results.verdict, analysis.results);
  return { ...ai, model: done.model, provider: done.provider || null, usage: done.usage, durationMs: done.durationMs, createdAt: new Date().toISOString(), staleSince: null };
}
