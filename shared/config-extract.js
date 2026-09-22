// Этап 2 (spec 010, D6): нормализация значений, извлечённых AI, и слияние с таблицей ASIN × поля.
// Значение поля-выбора — только из списка схемы; число разбирается из строки; непонятное → null («нет данных») + raw для менеджера.
// Ручные правки (source: "manual") повторное извлечение не трогает.
export const SOURCES = ["title", "bullets", "specs", "aplus", "manual"];
export const FIELD_TYPES = ["choice", "number", "text"];
const NONE_RE = /^\s*(нет данных|нет|н\/д|n\/a|na|none|null|unknown|not specified|—|-|–)?\s*$/i;

export const normKey = (s) => String(s ?? "").toLowerCase().replace(/[«»"'`]/g, "").replace(/\s+/g, " ").replace(/[.,;:!?]+$/, "").trim();

/** Число из строки: «12.5 lb» → 12.5, «1,5 кг» → 1.5, «9 зон» → 9. */
export function parseNumber(raw) {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  const m = String(raw ?? "").replace(/\s/g, "").match(/-?\d+(?:[.,]\d+)?/);
  if (!m) return null;
  const n = Number(m[0].replace(",", ".")); return Number.isFinite(n) ? n : null;
}

/** → { value, raw? } — value по типу поля или null. */
export function normalizeValue(field, raw) {
  if (raw === null || raw === undefined || (typeof raw === "string" && NONE_RE.test(raw))) return { value: null };
  if (field.type === "number") { const n = parseNumber(raw); return n === null ? { value: null, raw: String(raw).slice(0, 80) } : { value: n }; }
  if (field.type === "text") { const t = String(raw).trim().slice(0, 200); return t ? { value: t } : { value: null }; }
  const opts = field.options || []; const k = normKey(raw);
  const exact = opts.find((o) => normKey(o) === k); if (exact !== undefined) return { value: exact };
  const partial = opts.filter((o) => { const ok = normKey(o); return ok && k && (k.includes(ok) || ok.includes(k)); });
  if (partial.length === 1) return { value: partial[0] };
  return { value: null, raw: String(raw).slice(0, 80) };
}

/** Значения без дублей (первое написание побеждает), без пустых, не больше 12. */
function uniqOptions(list) { const seen = new Set(); const out = []; for (const o of list || []) { const t = String(o ?? "").trim().slice(0, 60); const k = normKey(t); if (!t || seen.has(k)) continue; seen.add(k); out.push(t); if (out.length >= 12) break; } return out; }

/** Схема после правок менеджера/AI: уникальные id, не больше 25 полей, значения без дублей и пустых. */
export function sanitizeSchema(schema) {
  const seen = new Set(); const fields = [];
  for (const f of schema?.fields || []) {
    if (!f || typeof f !== "object") continue;
    const name = String(f.name || "").trim().slice(0, 80); if (!name) continue;
    let id = String(f.id || "").toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40) || "f" + (fields.length + 1);
    while (seen.has(id)) id += "_"; seen.add(id);
    const type = FIELD_TYPES.includes(f.type) ? f.type : "text";
    const options = type === "choice" ? uniqOptions(f.options) : [];
    fields.push({ id, name, type: type === "choice" && options.length < 2 ? "text" : type, unit: f.unit ? String(f.unit).trim().slice(0, 20) : null, options: type === "choice" && options.length >= 2 ? options : [], hint: f.hint ? String(f.hint).trim().slice(0, 200) : "" });
    if (fields.length >= 25) break;
  }
  return { ...schema, fields };
}

/**
 * Слияние результата AI с таблицей.
 * @param {object} o { schema, prevTable, items: [{asin, values:[{field,value,source}]}], listings, asins, model, cost, now }
 */
export function mergeExtraction({ schema, prevTable = null, items = [], listings = {}, asins = [], model = "", cost = 0, now = new Date().toISOString() }) {
  const fields = schema?.fields || []; const fieldIds = new Set(fields.map((f) => f.id));
  const rows = {};
  for (const [asin, r] of Object.entries(prevTable?.rows || {})) rows[asin] = { status: r.status || "ok", values: Object.fromEntries(Object.entries(r.values || {}).filter(([k]) => fieldIds.has(k))) };
  const byAsin = new Map(items.map((it) => [String(it?.asin || "").toUpperCase(), it]));
  for (const asin of asins) {
    const row = rows[asin] || { status: "pending", values: {} }; rows[asin] = row;
    const l = listings[asin]; const it = byAsin.get(asin);
    if (!l || l.error) { row.status = "failed"; continue; }
    if (!it) { if (row.status === "pending") row.status = "failed"; continue; }
    row.status = "ok";
    const vals = new Map((it.values || []).map((v) => [v?.field, v]));
    for (const f of fields) {
      if (row.values[f.id]?.source === "manual") continue;
      const v = vals.get(f.id); const n = normalizeValue(f, v?.value);
      const source = n.value !== null && SOURCES.includes(v?.source) && v.source !== "manual" ? v.source : null;
      row.values[f.id] = n.raw !== undefined ? { value: n.value, source, raw: n.raw } : { value: n.value, source };
    }
  }
  return { rows, extractedAt: now, model, cost: (prevTable?.cost || 0) + (cost || 0), coverage: coverage({ rows }, schema), failed: Object.entries(rows).filter(([, r]) => r.status === "failed").map(([a]) => a).sort() };
}

/** Покрытие по полям: доля строк таблицы со значением. */
export function coverage(table, schema) {
  const rows = Object.values(table?.rows || {}); const out = {};
  for (const f of schema?.fields || []) out[f.id] = rows.length ? rows.filter((r) => r.values?.[f.id]?.value !== null && r.values?.[f.id]?.value !== undefined).length / rows.length : 0;
  return out;
}

/** Ручная правка клетки → новая таблица (чистая функция). */
export function setCell(table, schema, asin, fieldId, raw) {
  const f = (schema?.fields || []).find((x) => x.id === fieldId); if (!f) return table;
  const n = normalizeValue(f, raw); const v = f.type === "choice" && n.value === null && raw !== null && raw !== "" ? String(raw).trim() : n.value;
  const rows = { ...table.rows, [asin]: { status: table.rows?.[asin]?.status || "ok", values: { ...(table.rows?.[asin]?.values || {}), [fieldId]: { value: v, source: "manual" } } } };
  const out = { ...table, rows }; out.coverage = coverage(out, schema); return out;
}

/** Переименовать/объединить значение поля-выбора: схема и таблица меняются согласованно. `to` пустое — значение удаляется (клетки → «нет данных»). */
export function renameOption(schema, table, fieldId, from, to) {
  const fields = (schema?.fields || []).map((f) => {
    if (f.id !== fieldId) return f;
    const t = String(to || "").trim(); const opts = f.options.filter((o) => o !== from);
    return { ...f, options: t && !opts.includes(t) ? [...opts.slice(0, f.options.indexOf(from)), t, ...opts.slice(f.options.indexOf(from))] : opts };
  });
  const rows = {};
  for (const [asin, r] of Object.entries(table?.rows || {})) {
    const c = r.values?.[fieldId];
    rows[asin] = c && c.value === from ? { ...r, values: { ...r.values, [fieldId]: { ...c, value: String(to || "").trim() || null } } } : r;
  }
  const out = { ...table, rows }; const sch = { ...schema, fields, editedAt: new Date().toISOString() }; out.coverage = coverage(out, sch);
  return { schema: sch, table: out };
}
