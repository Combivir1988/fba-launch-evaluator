// Этап 2 (spec 010): схемы структурированного вывода и промпты для трёх шагов — схема полей ниши, извлечение по листингам, ТЗ производителю.
// Все числа в ТЗ — из переданных фактов; модель ничего не додумывает: нет в тексте — «нет данных».

export const FIELDS_SCHEMA = { type: "object", additionalProperties: false, required: ["fields"], properties: {
  fields: { type: "array", minItems: 3, maxItems: 25, items: { type: "object", additionalProperties: false, required: ["id", "name", "type", "unit", "options", "hint"], properties: {
    id: { type: "string", description: "латиница, snake_case, уникально: connection_type, target_zones" },
    name: { type: "string", description: "название поля по-русски, коротко: «Тип подключения»" },
    type: { type: "string", description: "choice | number | text" },
    unit: { type: "string", description: "единица для числа (шт, см, кг, Вт) или пустая строка" },
    options: { type: "array", items: { type: "string" }, description: "для choice — 2–20 допустимых значений по-русски: ВСЕ варианты, встретившиеся в листингах, а не только частые (или общепринятые термины: Bluetooth, USB-C); для остальных — пустой список" },
    hint: { type: "string", description: "как искать это в листинге, 1 фраза" } } } } } };

export const EXTRACT_SCHEMA = { type: "object", additionalProperties: false, required: ["items"], properties: {
  items: { type: "array", items: { type: "object", additionalProperties: false, required: ["asin", "values"], properties: {
    asin: { type: "string" },
    values: { type: "array", items: { type: "object", additionalProperties: false, required: ["field", "value", "source"], properties: {
      field: { type: "string", description: "id поля из схемы" },
      value: { type: "string", description: "для choice — одно из значений списка, а если реальное значение в списке отсутствует — дословно из текста; для number — число (можно с единицей); для text — коротко; если в тексте листинга этого поля нет вообще — строго «нет данных»" },
      source: { type: "string", description: "где найдено: title | bullets | specs | aplus; none — если «нет данных»" } } } } } } } } };

export const TZ_SECTIONS = ["конструкция", "материалы", "комплектация", "размеры и вес", "функции", "упаковка", "качество и контроль", "сертификация и маркировка", "отличия от конкурентов"];
export const TZ_SCHEMA = { type: "object", additionalProperties: false, required: ["title", "summary", "rows", "openQuestions"], properties: {
  title: { type: "string" }, summary: { type: "string", description: "2–4 предложения: что за товар, на кого ориентирован, главная идея конфигурации" },
  rows: { type: "array", minItems: 5, maxItems: 60, items: { type: "object", additionalProperties: false, required: ["section", "param", "requirement", "rationale", "priority", "source"], properties: {
    section: { type: "string", description: "один из разделов: " + TZ_SECTIONS.join(" | ") }, param: { type: "string", description: "параметр: «Ударные зоны»" },
    requirement: { type: "string", description: "измеримое требование производителю" }, rationale: { type: "string", description: "обоснование с числом из фактов: «9 зон — 58 % выручки ниши»" },
    priority: { type: "string", description: "must — обязательно, should — желательно" }, source: { type: "string", description: "откуда факт: поле «…» / отзывы POE / регуляторный триггер / патентный скан / цены" } } } },
  openQuestions: { type: "array", items: { type: "string" }, description: "что уточнить у производителя или проверить до заказа" } } };

const RULES = "Отвечай по-русски, кратко, без markdown. Только JSON по схеме.";

export const SYS_FIELDS = `Ты продуктовый аналитик Amazon FBA. По тексту листингов самых продаваемых товаров ниши составь СХЕМУ ХАРАКТЕРИСТИК, по которым различаются товары этой ниши и которые влияют на выбор покупателя: конструкция, материалы, размеры/вес, комплектация, питание/подключение, функции и режимы, аудитория, гарантия, уникальные фичи.
Правила: 1) 8–20 полей, только то, что реально встречается в листингах ниши (не общие «Бренд», «Цена», «Рейтинг»). 2) Для каждого поля выбери тип: choice — конечный список вариантов (2–20 значений: перечисли ВСЕ варианты, встретившиеся в переданных листингах — например все размеры и все классы MERV, — объедини только синонимы: «Bluetooth», «Bluetooth 5.0», «BT» → одно значение); number — измеримая величина с единицей; text — свободный короткий текст (только когда список невозможен). 3) Названия полей и варианты — по-русски (общепринятые технические термины можно оставить: Bluetooth, USB-C, IPX7). 4) id — латиницей snake_case, уникальный. 5) hint — где это обычно написано в листинге. 6) Если передана ТЕКУЩАЯ СХЕМА — это повторный проход: сохрани id, названия и типы существующих полей без изменений (по ним уже извлечена таблица), расширь их списки значений всеми встретившимися вариантами, добавь недостающие поля новыми id, убирай поле только если оно явно не относится к нише. ${RULES}`;

export const SYS_EXTRACT = `Ты извлекаешь характеристики товаров из текста листингов Amazon по заданной схеме полей.
Правила: 1) Для каждого листинга и КАЖДОГО поля схемы дай значение. 2) Поле choice — одно значение ТОЧНО из списка вариантов, если оно там есть; если в тексте есть значение этого поля, но в списке его нет (например, размер 20x25x4 или MERV 13, когда в списке только MERV 8 и 11) — верни его ДОСЛОВНО как в тексте, а не «нет данных». «Нет данных» — только когда в тексте листинга этого поля вообще нет. Не выбирай «наиболее вероятное» из списка вместо реального значения. 3) Поле number — число как в тексте (можно с единицей: «12.5 lb»); переводить единицы не нужно. 4) Поле text — коротко, дословно по листингу. 5) source — где именно найдено (title / bullets / specs / aplus); для «нет данных» — none. 6) Ничего не додумывай по картинкам, бренду или похожим товарам — только текст, который передан. ${RULES}`;

export const SYS_TZ = `Ты составляешь техническое задание (ТЗ) производителю для товара Private Label на Amazon FBA по ФАКТАМ, которые передало приложение: доминирующая конфигурация ниши (какие значения характеристик собирают выручку), «премиальные» значения (доля выручки выше доли листингов при цене выше медианы), цены и сегменты, темы негативных и позитивных отзывов ниши, регуляторные триггеры, итог патентного скана, гипотезы дифференциации, размер первой партии.
Правила: 1) База — доминирующая конфигурация: по каждому полю требование с доминирующим значением (priority must), если факты не говорят обратного. 2) Где отличаться — из негативных отзывов и гипотез дифференциации: измеримые требования (should или must, если жалоба массовая). 3) Позитивные темы — «что не сломать». 4) Регуляторные триггеры и патенты — требования к сертификации, маркировке, проверке до заказа (без юридических выводов). 5) КАЖДОЕ число в требовании и обосновании бери ТОЛЬКО из переданных фактов и указывай источник; если факта нет — формулируй без числа или вынеси в openQuestions. 6) Не упоминай бренды-конкуренты в требованиях. 7) 15–40 строк, группируй по разделам схемы. ${RULES}`;

/** Текст листинга для промпта (ограничен по длине). */
export function listingText(l, { maxBullets = 12, maxSpecs = 25, maxChars = 2200 } = {}) {
  if (!l || l.error) return `ASIN ${l?.asin || "?"}: страница не загружена`;
  const parts = [`ASIN ${l.asin}`, `Тайтл: ${l.title}`, l.brand ? `Бренд: ${l.brand}` : "", l.price !== null && l.price !== undefined ? `Цена: $${l.price}` : "",
    l.bullets?.length ? "Буллеты:\n- " + l.bullets.slice(0, maxBullets).join("\n- ") : "", l.specs?.length ? "Характеристики:\n" + l.specs.slice(0, maxSpecs).map((s) => `${s.k}: ${s.v}`).join("\n") : "",
    l.variants?.length ? `Варианты: ${l.variants.slice(0, 10).join("; ")}` : "", l.aplus ? `A+: ${l.aplus}` : ""].filter(Boolean);
  return parts.join("\n").slice(0, maxChars);
}

export function schemaText(schema) {
  return (schema?.fields || []).map((f) => `${f.id} — «${f.name}» (${f.type}${f.unit ? ", " + f.unit : ""})${f.type === "choice" ? ": " + f.options.join(" | ") : ""}${f.hint ? " — " + f.hint : ""}`).join("\n");
}

export function fieldsUser({ niche, coreKeyword, listings, prevSchema = null }) {
  const prev = prevSchema?.fields?.length ? `\nТЕКУЩАЯ СХЕМА (сохрани id, названия и типы этих полей; расширь списки значений):\n${schemaText(prevSchema)}\n` : "";
  return `Ниша: ${niche || coreKeyword}\nГлавный ключ: ${coreKeyword || "—"}\nЛистингов: ${listings.length}\n${prev}\n` + listings.map((l) => listingText(l, { maxBullets: 6, maxSpecs: 18, maxChars: 1300 })).join("\n\n---\n\n");
}
export function extractUser({ niche, schema, listings }) {
  return `Ниша: ${niche}\n\nСХЕМА ПОЛЕЙ (id — название (тип): варианты):\n${schemaText(schema)}\n\nЛИСТИНГИ:\n\n` + listings.map((l) => listingText(l)).join("\n\n---\n\n");
}
export function tzUser({ niche, coreKeyword, payload }) {
  return `Ниша: ${niche || coreKeyword}\nГлавный ключ: ${coreKeyword || "—"}\n\nФАКТЫ (JSON):\n${JSON.stringify(payload)}`;
}

/** Раздел ТЗ из свободного текста модели → один из TZ_SECTIONS (модели любят «Материалы и конструкция», «Упаковка/маркировка» и т. п.). */
const SECTION_HINTS = [[/сертиф|маркиров|compliance|fda|ce\b|ul\b|safety|безопас/i, "сертификация и маркировка"], [/упаков|коробк|packag/i, "упаковка"], [/качеств|контрол|aql|тест|провер/i, "качество и контроль"], [/материал|ткан|металл|пластик|latex|silicone|material/i, "материалы"],
  [/комплект|в комплекте|аксессуар|включ|accessor|includ/i, "комплектация"], [/размер|вес|габарит|dimension|weight|size/i, "размеры и вес"], [/функци|режим|feature|function|mode|подключ|bluetooth|app/i, "функции"], [/отлич|конкурент|дифференц|уник|usp|differ/i, "отличия от конкурентов"]];
export function normalizeSection(raw) {
  const t = String(raw || "").trim().toLowerCase(); if (TZ_SECTIONS.includes(t)) return t;
  for (const [re, sec] of SECTION_HINTS) if (re.test(t)) return sec;
  return "конструкция";
}
export const normalizePriority = (raw) => (/^(must|обяз|высок|high|critical|критич|1)/i.test(String(raw || "").trim()) ? "must" : "should");
