// Spec 027: опознание длительной операции и сравнение её параметров.
//
// Здесь живёт ответ на два вопроса: «это та же самая операция?» (ключ) и «чем параметры
// запустившего отличаются от моих?» (набор и расхождения). Жизненный цикл работ — забота
// server/jobs.js; разделено намеренно, чтобы одно не тянуло за собой другое.
//
// В shared/ этому файлу не место: он серверный, а новый файл там изменил бы method_hash
// (server/stats.js) и устаревил бы все сохранённые итоги статистики — перерасчёт ради ничего.

/** Ключ операции: вид + анализ. Разделитель \u0000 не встречается ни в именах видов, ни в UUID.
 *  null — идентификатора нет (вкладка, открытая до обновления): правило к такому запросу не применяется,
 *  и это НЕ молча — маршрут обязан отметить случай в журнале (FR-014). */
export function jobKey({ type, analysisId } = {}) {
  if (typeof type !== "string" || !type) return null;
  if (typeof analysisId !== "string" || !analysisId.trim()) return null;
  return `${type}\u0000${analysisId.trim()}`;
}

// ---------- параметры операции ----------
// Сравнивается КОРОТКИЙ ИМЕНОВАННЫЙ набор, а НЕ тело запроса. В теле едет listings — кэш уже
// загруженных страниц, у двух людей он законно разный (один грузил, другой нет). Сравнение тел
// давало бы расхождение ВСЕГДА, то есть сообщение перестало бы что-либо значить — ровно та примета,
// по которой spec 019 переписала подпункт 1f, а spec 024 отказалась от условного сообщения.
// НИКОГДА не сравниваются: listings, payload, prevTable, prevSchema.

const ASIN_RE = /^B0[A-Z0-9]{8}$/; // та же чистка, что в config-jobs.js: сравнивать надо ГОДНЫЕ ASIN
const countAsins = (list) => (Array.isArray(list)
  ? new Set(list.map((a) => String(a?.asin ?? a).toUpperCase().trim()).filter((a) => ASIN_RE.test(a))).size
  : null);
const model = (b) => b?.options?.model ?? null;
/** Отпечаток схемы — ОТСОРТИРОВАННЫЕ идентификаторы полей, а не вся схема: порядок полей и подсказки
 *  меняются при правке руками, а операция от этого другой не становится; состав полей — становится. */
const fieldsOf = (b) => (Array.isArray(b?.schema?.fields)
  ? b.schema.fields.map((f) => String(f?.id ?? "")).filter(Boolean).sort().join(",") || null
  : null);
const keyword = (b) => String(b?.coreKeyword || b?.niche || "").trim() || null;

const BY_TYPE = {
  config_schema: (b) => ({ model: model(b), asins: countAsins(b?.asins) }),
  config_extract: (b) => ({ model: model(b), asins: countAsins(b?.asins), fields: fieldsOf(b), batchSize: Number(b?.batchSize) || null }),
  config_promo: (b) => ({ asins: countAsins(b?.asins) }),
  config_tz: (b) => ({ model: model(b) }),
  analyze: (b) => ({ model: model(b) }),
  patents: (b) => ({ model: model(b), keyword: keyword(b) }),
};

/** Набор параметров операции. Поля, которых у вида нет, в набор НЕ попадают — иначе сравнение
 *  показывало бы расхождение «было null, стало null». */
export function paramsOf(type, body) {
  const make = BY_TYPE[type];
  return make ? make(body || {}) : {};
}

const NAMES = { model: "модель", asins: "охват", fields: "схема полей", batchSize: "размер пачки", keyword: "ключевое слово" };
const show = (v) => (v === null || v === undefined || v === "" ? "не задано" : String(v));

/** Расхождения между моими параметрами и теми, с которыми работа уже идёт.
 *  ПУСТОЙ МАССИВ — нормальное и частое значение: параметры совпали. Выдумывать расхождение нельзя (FR-011). */
export function diffParams(mine, theirs) {
  const a = mine && typeof mine === "object" ? mine : {};
  const b = theirs && typeof theirs === "object" ? theirs : {};
  const out = [];
  for (const k of [...new Set([...Object.keys(a), ...Object.keys(b)])]) {
    const mv = a[k] ?? null, tv = b[k] ?? null;
    if (mv === tv) continue;                       // в том числе «нет ни там, ни там»
    out.push({ what: NAMES[k] || k, mine: show(mv), theirs: show(tv) });
  }
  return out;
}
