// История анализов — общая, на сервере (spec 002, US2). Документ передаётся двумя частями: лёгкая `core` (часто)
// и тяжёлая `aggregates` (только при загрузке файлов). Старая локальная история (IndexedDB) читается только для переноса.
import { api } from "/js/api.js";
import { splitDoc, joinDoc } from "/shared/analysis.js";

const enc = encodeURIComponent;

export const history = {
  /** → { total, items } — без документов. opts: { mine, q } */
  list({ mine = false, q = "", limit = 300 } = {}) {
    const p = new URLSearchParams(); if (mine) p.set("mine", "1"); if (q) p.set("q", q); p.set("limit", String(limit));
    return api("GET", "/api/analyses?" + p.toString());
  },
  async count() { return (await api("GET", "/api/analyses?limit=1")).total; },
  /** → { doc, meta } ; meta: { version, createdBy, updatedBy, createdAt, updatedAt } */
  async get(id) { const r = await api("GET", `/api/analyses/${enc(id)}`); return { doc: joinDoc(r.core, r.aggregates), meta: r.meta }; },
  /** Сохранить лёгкую часть. baseVersion = null — создать. → { version, updatedAt }. При чужой правке бросает ApiError code "conflict". */
  saveCore(doc, baseVersion, { force = false } = {}) { return api("PUT", `/api/analyses/${enc(doc.id)}`, { baseVersion, core: splitDoc(doc).core, force }); },
  saveAggregates(doc, baseVersion, { force = false } = {}) { return api("PUT", `/api/analyses/${enc(doc.id)}/aggregates`, { baseVersion, aggregates: doc.aggregates || {}, force }); },
  /** «Сохранить как копию» → { id, version } */
  versions(id) { return api("GET", `/api/analyses/${enc(id)}/versions`); },
  restore(id, vid) { return api("POST", `/api/analyses/${enc(id)}/versions/${enc(vid)}/restore`).then((r) => ({ doc: joinDoc(r.core, r.aggregates), meta: r.meta, aggregatesRestored: r.aggregatesRestored })); },
  copy(doc) { const { core, aggregates } = splitDoc(doc); return api("POST", `/api/analyses/${enc(doc.id)}/copy`, { core, aggregates }); },
  delete(id) { return api("DELETE", `/api/analyses/${enc(id)}`); },
  /** Идемпотентный импорт целого документа → { id, imported } */
  importOne(doc) { return api("POST", "/api/analyses/import", { analysis: doc }); },
  async importMany(docs, onProgress) {
    let added = 0, skipped = 0, failed = 0;
    for (let i = 0; i < docs.length; i++) {
      try { const r = await this.importOne(docs[i]); r.imported ? added++ : skipped++; } catch (e) { console.warn("import", docs[i]?.id, e); failed++; }
      onProgress?.(i + 1, docs.length);
    }
    return { added, skipped, failed };
  },
  /** Вся история с документами — для экспорта одним файлом (последовательно, чтобы не перегружать сервер). */
  async getAllFull(onProgress) {
    const { items } = await this.list({ limit: 500 }); const out = [];
    for (let i = 0; i < items.length; i++) { try { out.push((await this.get(items[i].id)).doc); } catch (e) { console.warn("export", items[i].id, e); } onProgress?.(i + 1, items.length); }
    return out;
  },
};

// ---------- локальная история версии 001 (только чтение) ----------
const DB = "fba-launch-evaluator", STORE = "analyses";
export const localHistory = {
  readAll() {
    return new Promise((resolve) => {
      let req; try { req = indexedDB.open(DB); } catch { return resolve([]); }
      req.onupgradeneeded = () => { try { req.transaction.abort(); } catch {} }; // базы не было — не создаём
      req.onerror = () => resolve([]);
      req.onsuccess = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) { db.close(); return resolve([]); }
        const t = db.transaction(STORE, "readonly"); const g = t.objectStore(STORE).getAll();
        g.onsuccess = () => { db.close(); resolve(g.result || []); };
        g.onerror = () => { db.close(); resolve([]); };
      };
    });
  },
};
