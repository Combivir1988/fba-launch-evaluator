// Минимальная валидация AIVerdict по shared/ai-verdict.schema.json (без внешних зависимостей):
// required, type, enum, items, additionalProperties:false, minItems/maxItems.
export function validateVerdict(obj, schema) {
  const errors = [];
  walk(obj, schema, "$", errors);
  return { ok: errors.length === 0, errors };
}

function walk(v, s, path, errors) {
  if (!s) return;
  const type = s.type;
  if (type === "object") {
    if (!v || typeof v !== "object" || Array.isArray(v)) { errors.push(`${path}: ожидался object`); return; }
    for (const k of s.required || []) if (!(k in v)) errors.push(`${path}.${k}: отсутствует`);
    for (const [k, val] of Object.entries(v)) {
      const ps = s.properties?.[k];
      if (!ps) { if (s.additionalProperties === false) errors.push(`${path}.${k}: лишнее поле`); continue; }
      walk(val, ps, `${path}.${k}`, errors);
    }
  } else if (type === "array") {
    if (!Array.isArray(v)) { errors.push(`${path}: ожидался array`); return; }
    if (s.minItems !== undefined && v.length < s.minItems) errors.push(`${path}: минимум ${s.minItems} элементов`);
    if (s.maxItems !== undefined && v.length > s.maxItems) errors.push(`${path}: максимум ${s.maxItems} элементов`);
    v.forEach((x, i) => walk(x, s.items, `${path}[${i}]`, errors));
  } else if (type === "string") {
    if (typeof v !== "string") errors.push(`${path}: ожидалась строка`);
    else if (s.enum && !s.enum.includes(v)) errors.push(`${path}: «${v}» не из ${s.enum.join("|")}`);
  } else if (type === "number" || type === "integer") {
    if (typeof v !== "number") errors.push(`${path}: ожидалось число`);
  } else if (type === "boolean") {
    if (typeof v !== "boolean") errors.push(`${path}: ожидался boolean`);
  }
}

/** Схема для API structured outputs: без minItems/maxItems/$schema/title. */
export function apiSchema(schema) {
  const strip = (s) => {
    if (Array.isArray(s)) return s.map(strip);
    if (!s || typeof s !== "object") return s;
    const out = {};
    for (const [k, v] of Object.entries(s)) {
      if (["minItems", "maxItems", "$schema", "title"].includes(k)) continue;
      out[k] = strip(v);
    }
    return out;
  };
  return strip(schema);
}
