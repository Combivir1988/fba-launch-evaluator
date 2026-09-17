// История анализов — IndexedDB (store `analyses`, key `id`) без зависимостей.
const DB = "fba-launch-evaluator", STORE = "analyses", VERSION = 1;

function open() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, VERSION);
    req.onupgradeneeded = () => { const db = req.result; if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "id" }).createIndex("updatedAt", "updatedAt"); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
function tx(mode, fn) {
  return open().then((db) => new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode); const s = t.objectStore(STORE);
    const r = fn(s);
    t.oncomplete = () => { db.close(); resolve(r && "result" in r ? r.result : undefined); };
    t.onerror = () => { db.close(); reject(t.error); };
  }));
}

export const history = {
  async list() {
    const all = await tx("readonly", (s) => s.getAll());
    return (all || []).sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1)).map((a) => ({
      id: a.id, niche: a.niche, coreKeyword: a.coreKeyword, updatedAt: a.updatedAt, createdAt: a.createdAt, status: a.status,
      verdict: a.ai?.verdict || a.results?.verdict?.ceiling || null, aiDone: Boolean(a.ai), c1: a.results?.criterion1?.okCount ?? null, score: a.results?.scorecard?.total ?? null,
      sources: Object.entries(a.sources || {}).filter(([, v]) => v).map(([k]) => k),
    }));
  },
  get(id) { return tx("readonly", (s) => s.get(id)); },
  put(doc) { return tx("readwrite", (s) => s.put(doc)); },
  delete(id) { return tx("readwrite", (s) => s.delete(id)); },
  clear() { return tx("readwrite", (s) => s.clear()); },
  async getAllFull() { return (await tx("readonly", (s) => s.getAll())) || []; },
  /** Импорт без дублей: заменяем только если импортируемая версия новее. */
  async importMany(docs) {
    let added = 0, updated = 0, skipped = 0;
    for (const d of docs) {
      const cur = await this.get(d.id);
      if (!cur) { await this.put(d); added++; }
      else if ((d.updatedAt || "") > (cur.updatedAt || "")) { await this.put(d); updated++; }
      else skipped++;
    }
    return { added, updated, skipped };
  },
};
