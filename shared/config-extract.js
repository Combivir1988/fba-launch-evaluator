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
  // значение есть в тексте, но его нет в списке схемы: сохраняем как есть с пометкой — оно попадёт в диаграммы своей группой, менеджер может добавить его в список или объединить
  return { value: String(raw).trim().slice(0, 60), unlisted: true };
}

/** Значения без дублей (первое написание побеждает), без пустых, не больше 12. */
function uniqOptions(list) { const seen = new Set(); const out = []; for (const o of list || []) { const t = String(o ?? "").trim().slice(0, 60); const k = normKey(t); if (!t || seen.has(k)) continue; seen.add(k); out.push(t); if (out.length >= 20) break; } return out; }

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
/** Текст листинга по местам поиска: характеристики (самое надёжное) → тайтл → буллеты. */
const textParts = (l) => [["specs", (l?.specs || []).map((x) => `${x.k}: ${x.v}`).join(" \n ")], ["title", String(l?.title || "")], ["bullets", (l?.bullets || []).join(" \n ")]];
const esc = (t) => String(t).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** Название бренда из текста убираем: «Fresh Products» давал запах «Fresh», «Blue Cakes» — запах «Blue». */
const withoutBrand = (text, brand) => (brand && String(brand).length > 2 ? String(text).replace(new RegExp(esc(brand), "gi"), " ") : String(text));

/** Все числа, стоящие рядом с единицей поля: «24 Pack», «Pack of 24», «12.5 lb». → массив чисел */
function numbersFromText(field, text) {
  const unit = String(field.unit || "").trim();
  const qty = /(?:count|quantity|pack|кол|штук|колич)/i.test(`${field.id} ${field.name} ${unit}`);
  const words = [unit, ...(qty ? ["pack", "pcs", "pieces", "count", "pc", "ct", "шт"] : [])].filter(Boolean).map(esc);
  if (!words.length) return [];
  const tail = `(?:${words.join("|")})`;
  const out = [];
  for (const re of [new RegExp(`(\\d+(?:[.,]\\d+)?)\\s*[-\u2013]?\\s*${tail}\\b`, "gi"), new RegExp(`${tail}\\s*of\\s*(\\d+(?:[.,]\\d+)?)`, "gi")]) {
    for (const m of String(text).matchAll(re)) { const n = parseNumber(m[1]); if (n !== null) out.push(n); }
  }
  return out;
}

/** Значения списка поля, встретившиеся в тексте (по границам слов). */
function choicesFromText(field, text) {
  return (field.options || []).filter((o) => { const t = String(o).trim(); if (t.length < 3) return false;
    return new RegExp(`(^|[^\\p{L}\\p{N}])${esc(t)}([^\\p{L}\\p{N}]|$)`, "iu").test(text); });
}

/** Поля, у которых единица измерения совпадает с другим полем схемы (длина/ширина/толщина в дюймах): числа из текста им не раздаём — перепутаем. */
const ambiguousUnits = (fields) => {
  const seen = new Map();
  for (const f of fields) { if (f.type !== "number") continue; const u = String(f.unit || "").toLowerCase().trim(); if (!u) continue; seen.set(u, (seen.get(u) || 0) + 1); }
  return new Set([...seen.entries()].filter(([, n]) => n > 1).map(([u]) => u));
};

/**
 * Добор пустых клеток из текста листингов — без AI и без кредитов (2026-09-27, ужесточено после замера точности).
 * Заполняем ТОЛЬКО когда доказательство однозначно: в тексте ровно одно значение (для чисел — одно число рядом с единицей поля,
 * для списка — ровно одно значение списка), название бренда из текста вырезано, поля с общей единицей (длина/ширина) пропускаются.
 * Трогаются только пустые клетки; ручные значения и ответы модели не переписываются. Источник помечается как у AI плюс auto: true.
 * @returns {{ rows, filled: number }}
 */
export function fillFromText({ schema, rows, listings = {} }) {
  const all = schema?.fields || [];
  const ambiguous = ambiguousUnits(all);
  const fields = all.filter((f) => (f.type === "number" && !ambiguous.has(String(f.unit || "").toLowerCase().trim())) || f.type === "choice");
  let filled = 0;
  for (const [asin, row] of Object.entries(rows || {})) {
    const l = listings[asin]; if (!l || l.error || row.status === "failed") continue;
    for (const f of fields) {
      const cell = row.values?.[f.id];
      if (cell?.source === "manual") continue;
      // Клетку, добранную из текста раньше, пересчитываем заново: правила могли стать строже, и старая догадка должна уйти.
      if (cell && cell.value !== null && cell.value !== undefined && !cell.auto) continue;
      if (cell?.auto) { row.values[f.id] = { value: null, source: null }; filled--; }
      // Смотрим ВЕСЬ текст сразу: в характеристиках часто стоит «Number of Items: 1», а в тайтле «50 Pack» —
      // такое противоречие заполнять нельзя, берём значение только когда весь листинг говорит одно и то же.
      const hits = [];
      for (const [where, rawText] of textParts(l)) {
        if (!rawText) continue;
        const text = withoutBrand(rawText, l.brand);
        for (const v of f.type === "number" ? numbersFromText(f, text) : choicesFromText(f, text)) hits.push({ v, where });
      }
      // Количество в упаковке продавец пишет в тайтле («50 Pack»), а в характеристиках часто стоит «Number of Items: 1» —
      // при расхождении верим тайтлу, как это делает и модель.
      const fromTitle = hits.filter((h) => h.where === "title");
      const pool = f.type === "number" && fromTitle.length && new Set(fromTitle.map((h) => h.v)).size === 1 ? fromTitle : hits;
      const uniq = [...new Set(pool.map((h) => (typeof h.v === "number" ? h.v : String(h.v).toLowerCase())))];
      if (uniq.length !== 1) continue; // ноль — нечего брать, больше одного — противоречие, гадать нельзя
      const hit = pool[0];
      const n = normalizeValue(f, hit.v); if (n.value === null) continue;
      row.values = row.values || {};
      row.values[f.id] = { value: n.value, source: hit.where, auto: true, ...(n.unlisted ? { unlisted: true } : {}) };
      filled++;
    }
  }
  return { rows, filled };
}

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
      row.values[f.id] = n.unlisted ? { value: n.value, source, unlisted: true } : { value: n.value, source };
    }
  }
  fillFromText({ schema, rows, listings }); // то, что модель пропустила, но что прямо написано в тексте
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
  const n = normalizeValue(f, raw);
  const rows = { ...table.rows, [asin]: { status: table.rows?.[asin]?.status || "ok", values: { ...(table.rows?.[asin]?.values || {}), [fieldId]: n.unlisted ? { value: n.value, source: "manual", unlisted: true } : { value: n.value, source: "manual" } } } };
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
    if (c && c.value === from) { const { unlisted, ...rest } = c; rows[asin] = { ...r, values: { ...r.values, [fieldId]: { ...rest, value: String(to || "").trim() || null } } }; } else rows[asin] = r;
  }
  const out = { ...table, rows }; const sch = { ...schema, fields, editedAt: new Date().toISOString() }; out.coverage = coverage(out, sch);
  return { schema: sch, table: out };
}

/** Значения полей-выбора, встреченные в таблице вне списка схемы: { [fieldId]: [{ value, count }] } — подсказка менеджеру, что добавить в список. */
export function unlistedValues(schema, table) {
  const out = {};
  for (const f of schema?.fields || []) { if (f.type !== "choice") continue; const m = new Map();
    for (const r of Object.values(table?.rows || {})) { const c = r.values?.[f.id]; if (c && c.value !== null && c.value !== undefined && !f.options.includes(c.value)) m.set(c.value, (m.get(c.value) || 0) + 1); }
    if (m.size) out[f.id] = [...m.entries()].map(([value, count]) => ({ value, count })).sort((a, b) => b.count - a.count); }
  return out;
}
