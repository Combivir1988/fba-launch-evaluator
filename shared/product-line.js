// spec 025: предлагаемая товарная линейка — не один товар, а набор.
//
// Весь этап 2 отвечает на вопрос «какой ОДИН товар делать». Рынок устроен иначе, и приложение это
// уже разобрало: разбор Xray строит иерархию семей вариаций (parentAsin), но ВНЕ разборщика её
// до сих пор не читал никто. Замер на 67 живых нишах: семьи из ≥2 вариаций есть в 67 из 67,
// их доля выручки — медиана 88,6 %, у ТОП-10 по выручке медиана 5 ASIN в карточке, одиночек 10 %.
//
// Три числа ниже выбраны замером и живут ЗДЕСЬ, рядом с правилом: они описывают устройство рынка,
// а не вкус человека, и в настройки не выносятся.
import { median } from "./num.js";
import { revenueOf } from "./config-scope.js";
import { priceByConfig } from "./price-config.js";
import { brandMatcher } from "./parse-cerebro.js";

/** Ось меняется не меньше чем в такой доле семей.
 *  Замер: 65 полей из 207 имеют два весомых значения при частоте НИЖЕ этого порога — это поля,
 *  делящие РЫНОК, а не линейку одной марки. «Управление» меняется в НУЛЕ семей: на рынке есть
 *  кнопка и пульт, но ни одна марка не делает оба в одной карточке. */
export const AXIS_RATE_MIN = 0.2;

/** Значение весомо, если держит такую долю выручки ПОЛЯ (не всей ниши — знаменатель здесь главное:
 *  при выручке ниши получалось 36 значений медианой, то есть 36 ASIN).
 *  Замер по самой сильной оси: 10 % → медиана 3 значения (максимум 4), 5 % → 5, 15 % → 2.
 *  Новички входят с медианой 2 ASIN в карточке, старожилы держат 3, ТОП-10 по выручке — 5. */
export const VALUE_SHARE_MIN = 0.1;

/** Ось годится только при двух весомых значениях — и это защита, а не формальность.
 *  Поле, где у каждого листинга СВОЁ уникальное значение, меняется почти в каждой семье и получает
 *  максимальную частоту: «Уникальные фичи» — 95,8 % семей, 334 разных значения, весомых НОЛЬ;
 *  «Аромат» — 95,8 %, 328 значений, весомых ноль. Частота смены сама по себе обманывает. */
export const MIN_HEAVY_VALUES = 2;

const NOTES = {
  no_xray: "Нет выгрузки Xray — вариации товаров брать неоткуда. Загрузите отчёт Xray по нише.",
  no_variations: "В выгрузке Xray вариации не размечены: каждый товар стоит в своей карточке. Это про данные, а не про рынок — проверьте, что выгрузка сделана с иерархией вариаций.",
  no_stage2: "Вариации в нише есть, но характеристики товаров ещё не извлечены. Пройдите шаги 1 и 2 этапа 2 — тогда станет видно, ПО ЧЕМУ марки делают варианты.",
  no_differences: "Вариации есть, но товары внутри одной карточки по извлечённым характеристикам не различаются. Либо различие не в тех полях, что в схеме, либо оно не попало в текст листингов.",
  no_repeating: "Линейку в этой нише не строят: различия между вариациями у каждой марки свои и не повторяются от карточки к карточке. Предлагать вариант по такому различию не из чего.",
};

/** Фраза для удачного исхода: какая ось выбрана и на чём это основано.
 *  Пустая строка здесь была бы седьмым, безымянным состоянием. */
const okNote = (c) => `Линейку в этой нише строят по характеристике «${c.field.name}»: она меняется внутри карточки в ${c.variesIn} семьях из ${c.ofFamilies}, и ${c.heavy.length} её значения держат заметную долю выручки.`;

const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const has = (v) => v !== null && v !== undefined && v !== "";

/** Значение поля у листинга. Пустая клетка («нет данных») отдельным значением НЕ считается:
 *  иначе неполнота таблицы выглядела бы как вариативность. */
const valueAt = (rows, asin, fieldId) => {
  const r = rows[asin];
  if (!r || r.status === "failed") return null;
  const v = r.values?.[fieldId]?.value;
  return has(v) ? v : null;
};

/** Семьи вариаций из иерархии Xray: ключ — родительский ASIN. */
function familiesOf(asins) {
  const fam = new Map();
  for (const a of asins) {
    if (!a?.asin) continue;
    const p = a.parentAsin || a.asin;
    if (!fam.has(p)) fam.set(p, { parent: p, members: [], revenue: 0 });
    const f = fam.get(p);
    f.members.push(a.asin);
    f.revenue += revenueOf(a);
  }
  return [...fam.values()];
}

/** Латиница без цифр: только такие значения имеет смысл искать среди слов ключей.
 *  Замер: у числовых и размерных значений 83,0 % без найденного объёма против 39,0 % у латиницы —
 *  виновата не кириллица, а ЧИСЛА («20x20x1» распадается в мусор, «12» сопоставлять со словом бессмысленно). */
const LATIN_WORD = /^[a-z][a-z\s/&'-]*$/i;
function demandKind(field, label) {
  if (field?.type === "number") return "numeric";
  const t = String(label).trim();
  if (!t) return "empty";
  if (/\d/.test(t)) return "numeric";
  if (!LATIN_WORD.test(t)) return "nonlatin";
  return "latin";
}

/** Словарь «слово → суммарный объём поиска» по небрендовым фразам выгрузки ключей. */
function svIndex(cerebro, brands, coreKeyword) {
  if (!cerebro?.keywords?.length) return null;
  const isBrand = brandMatcher(brands || [], coreKeyword || "");
  const idx = new Map();
  for (const k of cerebro.keywords) {
    if (k.isAsin || k.isBranded || !(k.sv > 0)) continue;
    if (isBrand(k.phrase)) continue;
    for (const w of String(k.phrase).toLowerCase().split(/[^a-z0-9]+/).filter((x) => x.length > 2)) {
      idx.set(w, (idx.get(w) || 0) + k.sv);
    }
  }
  return idx;
}

function demandFor(field, label, idx) {
  const kind = demandKind(field, label);
  if (kind === "numeric") return { demand: { sv: null, checked: false }, note: "размерные и числовые значения в ключах не ищутся: «12» или «20x20x1» со словом запроса не сопоставить" };
  if (!idx) return { demand: { sv: null, checked: false }, note: "выгрузка ключей не загружена — спрос не проверялся" };
  if (kind === "nonlatin") return { demand: { sv: null, checked: false }, note: "значение записано не латиницей — в англоязычных ключах его не найти" };
  const words = String(label).toLowerCase().split(/[^a-z0-9]+/).filter((x) => x.length > 2);
  const hits = words.filter((w) => idx.has(w));
  if (!hits.length) return { demand: { sv: null, checked: true }, note: "в ключах это слово не встречается — это не нулевой спрос, а отсутствие совпадения" };
  return { demand: { sv: hits.reduce((s, w) => s + idx.get(w), 0), checked: true }, note: null };
}

/**
 * @param o { xray, config, stats, cerebro, brands, listings, inputs, th }
 *   stats — results.config.whole (статистика этапа 2); без неё цены вариантов не считаются.
 * @returns см. specs/025-product-line-proposal/data-model.md
 */
export function productLine({ xray, config, stats = null, cerebro = null, brands = [], listings = {}, inputs = {}, th = {} } = {}) {
  const thresholds = { axisRate: AXIS_RATE_MIN, valueShare: VALUE_SHARE_MIN, minHeavyValues: MIN_HEAVY_VALUES };
  const base = { status: "no_xray", note: NOTES.no_xray, families: null, axes: [], axisRejected: [], items: [], thresholds, stage2: false };

  const asins = xray?.asins || [];
  if (!asins.length) return base;

  const fams = familiesOf(asins);
  const multi = fams.filter((f) => f.members.length >= 2);
  const totalRevenue = fams.reduce((s, f) => s + f.revenue, 0);
  const families = {
    total: fams.length,
    multi: multi.length,
    revenueShare: totalRevenue > 0 ? multi.reduce((s, f) => s + f.revenue, 0) / totalRevenue : 0,
    medianSize: median(fams.map((f) => f.members.length)) ?? 0,
  };
  const out = { ...base, families };

  if (!multi.length) return { ...out, status: "no_variations", note: NOTES.no_variations };

  const rows = config?.table?.rows || {};
  const fields = config?.schema?.fields || [];
  if (!fields.length || !Object.keys(rows).length) return { ...out, status: "no_stage2", note: NOTES.no_stage2 };
  out.stage2 = true;

  const byAsin = new Map(asins.map((a) => [a.asin, a]));
  const known = Object.keys(rows);

  // Кандидаты: частота смены ВНУТРИ семьи + распределение выручки ПОЛЯ по значениям.
  const cands = [];
  let anyVaries = false;
  for (const f of fields) {
    if (f.type === "text") continue; // свободный текст осью быть не может по построению
    let varies = 0;
    for (const fam of multi) {
      const vals = new Set(fam.members.map((a) => valueAt(rows, a, f.id)).filter(has).map(String));
      if (vals.size >= 2) varies++;
    }
    if (varies > 0) anyVaries = true;
    const rate = varies / multi.length;
    if (rate < AXIS_RATE_MIN) continue;

    const groups = new Map();
    let fieldRev = 0;
    for (const asin of known) {
      const v = valueAt(rows, asin, f.id);
      if (v === null) continue;
      const w = byAsin.has(asin) ? revenueOf(byAsin.get(asin)) : 0;
      fieldRev += w;
      const k = String(v);
      const g = groups.get(k) || { value: v, label: k, revenue: 0, count: 0 };
      g.revenue += w; g.count++;
      groups.set(k, g);
    }
    if (fieldRev <= 0 || groups.size < 2) continue;
    const vals = [...groups.values()].map((g) => ({ ...g, share: g.revenue / fieldRev }))
      .sort((a, b) => b.share - a.share || b.count - a.count || String(a.label).localeCompare(String(b.label), "ru"));
    const heavy = vals.filter((v) => v.share >= VALUE_SHARE_MIN);
    cands.push({ field: f, rate, variesIn: varies, ofFamilies: multi.length, distinct: groups.size, vals, heavy });
  }

  if (!anyVaries) return { ...out, status: "no_differences", note: NOTES.no_differences };

  // Выбор оси и выбор значений — ОДНА операция (D1): ось годится только при двух весомых значениях.
  // Порядок устойчив: частота, затем число весомых значений, затем имя поля — иначе один анализ
  // при двух открытиях дал бы разные линейки.
  const sorted = cands.slice().sort((a, b) =>
    b.rate - a.rate || b.heavy.length - a.heavy.length || String(a.field.name).localeCompare(String(b.field.name), "ru"));
  const good = sorted.filter((c) => c.heavy.length >= MIN_HEAVY_VALUES);
  const chosen = good[0] || null;

  out.axes = good.map((c) => ({
    id: c.field.id, name: c.field.name, unit: c.field.unit || null,
    variesIn: c.variesIn, ofFamilies: c.ofFamilies, rate: c.rate,
    heavyValues: c.heavy.length, distinct: c.distinct, chosen: c === chosen,
  }));
  // Отказ обязан быть виден: иначе «Аромат, 95,8 % семей» просто исчезает из списка без объяснения.
  out.axisRejected = sorted.filter((c) => c.heavy.length < MIN_HEAVY_VALUES).map((c) => ({
    id: c.field.id, name: c.field.name, rate: c.rate, distinct: c.distinct, reason: "no_repeating_values",
  }));

  if (!chosen) return { ...out, status: "no_repeating", note: NOTES.no_repeating };

  // Главный товар — конфигурация человека (по умолчанию доминанта), чтобы в этапе 2 не было
  // двух разных представлений о том, какой товар мы делаем (FR-020).
  const choice = config?.priceChoice || {};
  const picked = has(choice[chosen.field.id]) ? String(choice[chosen.field.id]) : String(chosen.heavy[0].label);
  const idx = svIndex(cerebro, brands, inputs.coreKeyword);

  const priceFor = (value) => {
    if (!stats) return { price: null, note: "характеристики извлечены не полностью — цену аналогов для этого сочетания не посчитать" };
    // Значение оси обязано совпасть точно: иначе аналогами варианта «3 шт» становятся листинги с 1 шт
    // (ступени смягчения спускаются до «2 из 4», и сама ось в совпавшие не входит), и все варианты
    // линейки получают одну цену. На живых нишах это было 8 ниш из 18.
    const pc = priceByConfig({ config, stats, xray, listings, choice: { ...choice, [chosen.field.id]: value }, inputs, th, requireFields: [chosen.field.id] });
    if (!pc || !isNum(pc.market)) return { price: null, note: "аналогов с таким сочетанием характеристик в нише нет — цена не выдумывается" };
    return { price: { market: pc.market, entry: pc.entry, ceiling: pc.ceiling, analogs: pc.analogs, matchWords: pc.matchWords, fallback: Boolean(pc.fallback) }, note: null };
  };

  const mainFirst = chosen.heavy.slice().sort((a, b) =>
    (String(b.label) === picked ? 1 : 0) - (String(a.label) === picked ? 1 : 0) || b.share - a.share);

  out.items = mainFirst.map((v, i) => {
    const { price, note } = priceFor(v.value);
    const d = demandFor(chosen.field, v.label, idx);
    const st = (stats?.fields || []).find((x) => x.id === chosen.field.id);
    const sv = (st?.values || []).find((x) => String(x.label) === String(v.label));
    return {
      role: i === 0 ? "main" : "variant",
      axisId: chosen.field.id, axisName: chosen.field.name,
      value: v.value, label: v.label,
      share: v.share, listings: v.count,
      premium: Boolean(sv?.premium),
      price, priceNote: note,
      demand: d.demand, demandNote: d.note,
    };
  });

  return { ...out, status: "ok", note: okNote(chosen) };
}
