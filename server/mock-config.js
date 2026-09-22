// MOCK_AI=1: детерминированные ответы для этапа 2 — схема из ключей таблицы характеристик, извлечение точным совпадением, ТЗ из фактов.
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 30) || "field";

export function mockFields({ listings }) {
  const counts = new Map();
  for (const l of listings) for (const s of l.specs || []) { if (/brand|asin|manufacturer|model|item number|date/i.test(s.k)) continue; const e = counts.get(s.k) || { n: 0, values: new Map() }; e.n++; e.values.set(s.v, (e.values.get(s.v) || 0) + 1); counts.set(s.k, e); }
  const fields = [...counts.entries()].sort((a, b) => b[1].n - a[1].n).slice(0, 12).map(([k, e]) => {
    const vals = [...e.values.keys()]; const numeric = vals.every((v) => /^\d+(\.\d+)?(\s*[a-zа-я]+)?$/i.test(v));
    if (numeric) return { id: slug(k), name: k, type: "number", unit: (vals[0].match(/[a-zа-я]+$/i) || [""])[0], options: [], hint: `таблица характеристик: ${k}` };
    if (vals.length <= 10) return { id: slug(k), name: k, type: "choice", unit: "", options: vals.slice(0, 10), hint: `таблица характеристик: ${k}` };
    return { id: slug(k), name: k, type: "text", unit: "", options: [], hint: `таблица характеристик: ${k}` };
  });
  if (fields.length < 3) fields.push({ id: "material", name: "Material", type: "choice", unit: "", options: ["Steel", "Plastic", "Wood", "Silicone"], hint: "mock" }, { id: "number_of_items", name: "Number of Items", type: "number", unit: "шт", options: [], hint: "mock" }, { id: "color", name: "Color", type: "text", unit: "", options: [], hint: "mock" });
  return { fields };
}

export function mockExtract({ schema, listings }) {
  return { items: listings.map((l) => ({ asin: l.asin, values: (schema.fields || []).map((f) => {
    const spec = (l.specs || []).find((s) => s.k === f.name || slug(s.k) === f.id);
    if (spec) return { field: f.id, value: spec.v, source: "specs" };
    const b = (l.bullets || []).find((x) => x.toLowerCase().includes(f.name.toLowerCase().split(" ")[0]));
    return b ? { field: f.id, value: b.split(":").pop().trim().slice(0, 60), source: "bullets" } : { field: f.id, value: "нет данных", source: "none" };
  }) })) };
}

export function mockTz({ payload }) {
  const rows = [];
  for (const f of payload.configuration || []) if (f.dominant) rows.push({ section: "конструкция", param: f.field, requirement: `${f.dominant.value}${f.unit ? " " + f.unit : ""}`, rationale: `${f.dominant.value} — ${f.dominant.revenueSharePct} % выручки ниши (${f.dominant.listings} листингов)`, priority: "must", source: `поле «${f.field}»` });
  for (const t of payload.reviews?.negative || []) rows.push({ section: "качество и контроль", param: t.topic, requirement: `Устранить причину жалобы «${t.topic}»`, rationale: `${t.mentionsPct} % негативных упоминаний`, priority: "should", source: "отзывы POE" });
  for (const r of payload.regulatory || []) rows.push({ section: "сертификация и маркировка", param: r.agency, requirement: `Проверить требования: ${r.title}`, rationale: r.meaning || "триггер по словам ниши", priority: "should", source: "регуляторный триггер" });
  if (rows.length < 5) rows.push({ section: "упаковка", param: "Упаковка", requirement: "Индивидуальная коробка, FNSKU-наклейка", rationale: "стандарт FBA", priority: "must", source: "правила FBA" }, { section: "качество и контроль", param: "Контроль качества", requirement: "AQL 2.5 при приёмке партии", rationale: "стандартная практика", priority: "should", source: "практика" }, { section: "комплектация", param: "Инструкция", requirement: "Инструкция на английском", rationale: "рынок US", priority: "must", source: "рынок" });
  return { title: `[MOCK] ТЗ производителю: ${payload.niche || payload.coreKeyword}`, summary: `Демонстрационное ТЗ без обращения к модели: ${payload.listingsAnalyzed} листингов, ${rows.length} требований.`, rows, openQuestions: ["Уточнить у производителя минимальную партию", "Проверить сертификаты на материалы"] };
}
