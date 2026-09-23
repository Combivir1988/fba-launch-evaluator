// Этап 2 (spec 010): область ASIN, нормализация значений и слияние таблицы, статистика «характеристика → выручка», факты для ТЗ.
import test from "node:test";
import assert from "node:assert/strict";
import { configScope, topForSchema, isFresh, freshListings } from "../shared/config-scope.js";
import { normalizeValue, parseNumber, sanitizeSchema, mergeExtraction, setCell, renameOption } from "../shared/config-extract.js";
import { configStats, NO_DATA } from "../shared/config-stats.js";
import { buildTzPayload, collectTzNumbers, markUnverified } from "../shared/tz-payload.js";
import { mergeThresholds } from "../shared/thresholds.js";
import { newAnalysis } from "../shared/analysis.js";
import { compute } from "../shared/compute.js";
import { buildSnapshot } from "../shared/share-snapshot.js";

const th = mergeThresholds({});
const asin = (i) => "B0" + String(i).padStart(8, "0");
function xray(n = 8) {
  // выручка убывает с номером; бренд Zed — исключаемый; цены: нечётные дороже
  return { asins: Array.from({ length: n }, (_, i) => ({ asin: asin(i + 1), title: `Boxing machine ${i + 1}`, brand: i === 2 ? "Zed" : "Br" + (i % 3), price: 60 + (i % 2) * 50, asinRevenue: (n - i) * 10_000, asinSales: 100 })), flags: {}, columns: {} };
}
const schema = { fields: [
  { id: "conn", name: "Тип подключения", type: "choice", unit: null, options: ["Bluetooth", "проводное", "автономное"], hint: "" },
  { id: "zones", name: "Количество ударных зон", type: "number", unit: "шт", options: [], hint: "" },
  { id: "note", name: "УТП", type: "text", unit: null, options: [], hint: "" },
] };

test("configScope: уникальные ASIN без исключённых брендов, по выручке, предел maxAsins", () => {
  const a = newAnalysis(); a.aggregates.xray = xray(8); a.aggregates.xray.asins.push({ ...a.aggregates.xray.asins[0] }); // дубль
  a.inputs.excludedBrands = ["zed"];
  const s = configScope(a, th);
  assert.equal(s.asins.length, 7); assert.equal(s.excluded, 1); assert.equal(s.asins[0], asin(1)); assert.ok(!s.asins.includes(asin(3)));
  const capped = configScope(a, mergeThresholds({ config: { maxAsins: 3 } }));
  assert.deepEqual(capped.asins, [asin(1), asin(2), asin(4)]); assert.equal(capped.capped, true); assert.equal(capped.total, 7);
  assert.equal(topForSchema(s, mergeThresholds({ config: { topForSchema: 2 } })).length, 2);
  assert.deepEqual(configScope(newAnalysis(), th), { asins: [], items: [], excluded: 0, capped: false, total: 0 });
});

test("isFresh / freshListings: свежесть кэша 30 дней, страницы с ошибкой не годятся", () => {
  const now = Date.parse("2026-09-22T00:00:00Z");
  const ok = { asin: "A", fetchedAt: "2026-09-01T00:00:00Z", title: "x" }, old = { asin: "B", fetchedAt: "2026-08-01T00:00:00Z" }, bad = { asin: "C", fetchedAt: "2026-09-21T00:00:00Z", error: { code: "asp" } };
  assert.equal(isFresh(ok, th, now), true); assert.equal(isFresh(old, th, now), false); assert.equal(isFresh(bad, th, now), false); assert.equal(isFresh(null, th, now), false);
  assert.deepEqual(Object.keys(freshListings({ A: ok, B: old, C: bad }, ["A", "B", "C", "D"], th, now)), ["A"]);
});

test("normalizeValue: выбор только из списка (регистр, частичное совпадение), числа из строк, «нет данных»", () => {
  const f = schema.fields[0];
  assert.deepEqual(normalizeValue(f, "bluetooth"), { value: "Bluetooth" });
  assert.deepEqual(normalizeValue(f, "Bluetooth 5.0 app"), { value: "Bluetooth" });
  assert.deepEqual(normalizeValue(f, "нет данных"), { value: null }); assert.deepEqual(normalizeValue(f, ""), { value: null }); assert.deepEqual(normalizeValue(f, null), { value: null });
  assert.deepEqual(normalizeValue(f, "USB-C"), { value: "USB-C", unlisted: true }, "значение вне списка сохраняется с пометкой, а не теряется");
  const n = schema.fields[1];
  assert.deepEqual(normalizeValue(n, "9 зон"), { value: 9 }); assert.deepEqual(normalizeValue(n, "12.5 lb"), { value: 12.5 }); assert.deepEqual(normalizeValue(n, "1,5 кг"), { value: 1.5 }); assert.deepEqual(normalizeValue(n, 7), { value: 7 });
  assert.deepEqual(normalizeValue(n, "много"), { value: null, raw: "много" });
  assert.equal(parseNumber("N/A"), null);
  assert.deepEqual(normalizeValue(schema.fields[2], "  светится  "), { value: "светится" });
});

test("sanitizeSchema: id латиницей и уникальные, ≤ 25 полей, выбор без дублей, выбор с одним значением → текст", () => {
  const s = sanitizeSchema({ fields: [
    { id: "Тип", name: "Тип", type: "choice", options: ["A", "a", " B "] }, { id: "tip", name: "Тип 2", type: "choice", options: ["один"] }, { name: "", type: "text" },
    ...Array.from({ length: 30 }, (_, i) => ({ id: "f" + i, name: "F" + i, type: "weird" })),
  ] });
  assert.equal(s.fields.length, 25);
  assert.deepEqual(s.fields[0], { id: "f1", name: "Тип", type: "choice", unit: null, options: ["A", "B"], hint: "" });
  assert.equal(s.fields[1].type, "text"); assert.deepEqual(s.fields[1].options, []);
  assert.equal(new Set(s.fields.map((f) => f.id)).size, 25); assert.equal(s.fields[2].type, "text");
});

function listingsFor(asins) { return Object.fromEntries(asins.map((a) => [a, { asin: a, fetchedAt: "2026-09-22T00:00:00Z", title: "t", bullets: [], specs: [] }])); }

test("mergeExtraction: нормализация, источник, failed для незагруженных, ручные клетки сохраняются, покрытие", async () => {
  const asins = [asin(1), asin(2), asin(3), asin(4)];
  const listings = listingsFor([asin(1), asin(2), asin(3)]); // 4-й не загрузился
  const items = [
    { asin: asin(1), values: [{ field: "conn", value: "bluetooth", source: "bullets" }, { field: "zones", value: "9 zones", source: "specs" }, { field: "note", value: "нет данных", source: "title" }] },
    { asin: asin(2), values: [{ field: "conn", value: "USB", source: "specs" }, { field: "zones", value: 6, source: "manual" }] },
  ];
  const t = mergeExtraction({ schema, items, listings, asins, model: "m", cost: 90 });
  assert.deepEqual(t.rows[asin(1)].values.conn, { value: "Bluetooth", source: "bullets" }); assert.deepEqual(t.rows[asin(1)].values.zones, { value: 9, source: "specs" });
  assert.deepEqual(t.rows[asin(1)].values.note, { value: null, source: null });
  assert.deepEqual(t.rows[asin(2)].values.conn, { value: "USB", source: "specs", unlisted: true });
  assert.equal(t.rows[asin(2)].values.zones.source, null, "источник manual от AI не принимается");
  assert.equal(t.rows[asin(3)].status, "failed", "загружен, но AI ничего не вернул → failed"); assert.equal(t.rows[asin(4)].status, "failed"); assert.deepEqual(t.failed, [asin(3), asin(4)]);
  assert.equal(t.coverage.conn, 0.5, "значение вне списка — тоже данные"); assert.equal(t.coverage.zones, 0.5); assert.equal(t.cost, 90);
  // ручная правка и повторное извлечение
  const t2 = setCell(t, schema, asin(2), "conn", "проводное"); assert.deepEqual(t2.rows[asin(2)].values.conn, { value: "проводное", source: "manual" }); assert.equal(t2.coverage.conn, 0.5);
  assert.deepEqual(setCell(t, schema, asin(2), "conn", "оптика").rows[asin(2)].values.conn, { value: "оптика", source: "manual", unlisted: true });
  const { unlistedValues } = await import("../shared/config-extract.js"); assert.deepEqual(unlistedValues(schema, t), { conn: [{ value: "USB", count: 1 }] });
  const adopted = renameOption(schema, t, "conn", "USB", "USB"); assert.ok(adopted.schema.fields[0].options.includes("USB")); assert.equal(adopted.table.rows[asin(2)].values.conn.unlisted, undefined, "добавили в список — пометка снята"); assert.deepEqual(unlistedValues(adopted.schema, adopted.table), {});
  const t3 = mergeExtraction({ schema, prevTable: t2, items: [{ asin: asin(2), values: [{ field: "conn", value: "Bluetooth", source: "title" }] }], listings, asins: [asin(2)], cost: 30 });
  assert.equal(t3.rows[asin(2)].values.conn.value, "проводное", "ручное значение не перезаписано"); assert.equal(t3.cost, 120); assert.equal(t3.rows[asin(1)].values.conn.value, "Bluetooth", "прежние строки сохранены");
  // переименование/объединение значения
  const r = renameOption(schema, t3, "conn", "проводное", "Bluetooth");
  assert.deepEqual(r.schema.fields[0].options, ["Bluetooth", "автономное"]); assert.equal(r.table.rows[asin(2)].values.conn.value, "Bluetooth");
  const d = renameOption(schema, t3, "conn", "Bluetooth", ""); assert.equal(d.table.rows[asin(1)].values.conn.value, null); assert.deepEqual(d.schema.fields[0].options, ["проводное", "автономное"]);
});

function filledAnalysis() {
  const a = newAnalysis({ niche: "boxing machine", coreKeyword: "boxing machine" }); a.aggregates.xray = xray(8); a.inputs.excludedBrands = ["Zed"];
  const asins = configScope(a, th).asins; const listings = listingsFor(asins);
  const conn = ["Bluetooth", "Bluetooth", "проводное", "Bluetooth", "автономное", "нет данных", "проводное"]; const zones = [9, 9, 6, 9, 12, 6, null];
  const items = asins.map((x, i) => ({ asin: x, values: [{ field: "conn", value: conn[i], source: "bullets" }, { field: "zones", value: zones[i], source: "specs" }, { field: "note", value: "утп " + i, source: "title" }] }));
  a.config = { schema, table: mergeExtraction({ schema, items, listings, asins, model: "m", cost: 200 }) };
  a.aggregates.listings = listings;
  a.results = compute(a); return a;
}

test("configStats: сумма долей 100 % с сектором «нет данных», доминанта по выручке, премия, покрытие; диапазон цен", () => {
  const a = filledAnalysis(); const st = a.results.config; assert.ok(st && st.whole && st.band === null);
  const w = st.whole; assert.equal(w.asins, 7); assert.equal(w.weightLabel, "revenue");
  for (const f of w.fields) { const total = f.values.reduce((s, v) => s + v.share, 0) + f.noData.share; assert.ok(Math.abs(total - 1) < 1e-9, `${f.name}: сумма долей ${total}`); }
  const conn = w.fields.find((f) => f.id === "conn");
  assert.equal(conn.dominant.label, "Bluetooth"); assert.equal(conn.values[0].count, 3); assert.equal(conn.noData.count, 1); assert.ok(conn.coverage > 0.85 && conn.coverage < 0.86);
  // область без бренда Zed (ASIN 3, 60k): ASIN 1,2,4,5,6,7,8 → 300k; Bluetooth у ASIN 1,2,5 → 80+70+40 = 190k
  assert.ok(Math.abs(conn.values[0].share - 190_000 / 300_000) < 1e-9);
  assert.ok(conn.values[0].listingShare > 0.42 && conn.values[0].listingShare < 0.43);
  const zones = w.fields.find((f) => f.id === "zones"); assert.equal(zones.bucketed, false); assert.equal(zones.values[0].label, "9 шт"); assert.equal(zones.values[0].value, 9);
  assert.equal(zones.noData.label, undefined); assert.equal(NO_DATA, "нет данных");
  // премия: доля выручки выше доли листингов И средняя цена выше медианы поля
  const prem = conn.values.find((v) => v.premium); assert.ok(prem === undefined || (prem.share > prem.listingShare && prem.avgPrice > conn.priceMedian));
  // ценовой диапазон: только дорогие (цена 110)
  a.inputs.priceMin = 100; a.results = compute(a); const b = a.results.config.band; assert.ok(b); assert.equal(b.asins, 4, "дорогие: ASIN 2, 4, 6, 8");
  for (const f of b.fields) { const total = f.values.reduce((s, v) => s + v.share, 0) + f.noData.share; assert.ok(Math.abs(total - 1) < 1e-9); }
  assert.equal(a.results.config.whole.asins, 7, "вся ниша не зависит от диапазона");
});

test("configStats: числовое поле с большим разбросом → интервалы; без выручки доли по числу листингов; без таблицы → null", () => {
  const a = newAnalysis(); a.aggregates.xray = { asins: Array.from({ length: 20 }, (_, i) => ({ asin: asin(i + 1), brand: "b", price: 10 + i, asinRevenue: null, asinSales: null })), flags: {}, columns: {} };
  const sch = { fields: [{ id: "w", name: "Вес", type: "number", unit: "кг", options: [] }] }; const asins = a.aggregates.xray.asins.map((x) => x.asin);
  const items = asins.map((x, i) => ({ asin: x, values: [{ field: "w", value: i + 0.5, source: "specs" }] }));
  a.config = { schema: sch, table: mergeExtraction({ schema: sch, items, listings: listingsFor(asins), asins }) };
  const st = configStats(a.config, a.aggregates.xray, { th: th.config }); assert.equal(st.whole.weightLabel, "count");
  const f = st.whole.fields[0]; assert.equal(f.bucketed, true); assert.ok(f.values.length >= 3 && f.values.length <= 5); assert.ok(/–|от/.test(f.values[0].label));
  assert.ok(Math.abs(f.values.reduce((s, v) => s + v.share, 0) - 1) < 1e-9);
  assert.equal(configStats(null, a.aggregates.xray, { th: th.config }), null); assert.equal(configStats({ schema: sch, table: { rows: {} } }, a.aggregates.xray, { th: th.config }), null);
});

test("buildTzPayload / markUnverified: факты из этапов 1–2, числа ТЗ сверяются с пейлоадом", () => {
  const a = filledAnalysis(); a.aggregates.poe = { pdr: { negative: [{ topic: "Слабое крепление", pct: 23.4, verbatims: ["falls off", "weak"] }], positive: [{ topic: "Подсветка", pct: 40, verbatims: [] }], returns: [] } };
  a.patents = { status: "clear", summary: "чисто", items: [] }; a.ai = { differentiation: [{ hypothesis: "H", evidence: "E", specRequirement: "S" }] };
  const p = buildTzPayload(a);
  assert.equal(p.listingsAnalyzed, 7); assert.equal(p.configuration[0].dominant.value, "Bluetooth"); assert.ok(Math.abs(p.configuration[0].dominant.revenueSharePct - 63.3) < 1e-9);
  assert.equal(p.reviews.negative[0].topic, "Слабое крепление"); assert.equal(p.reviews.negative[0].examples.length, 2); assert.equal(p.differentiation.length, 1); assert.equal(p.patents.status, "clear");
  const nums = collectTzNumbers(p); assert.ok(nums.has(63.3) && nums.has(23.4) && nums.has(9));
  const tz = markUnverified({ rows: [
    { requirement: "9 ударных зон", rationale: "9 зон — 63,3 % выручки ниши" },
    { requirement: "Гарантия 24 месяца", rationale: "лидеры дают 24" },
    { requirement: "3 режима", rationale: "мелкие числа не проверяются" },
  ] }, nums);
  assert.deepEqual(tz.rows.map((r) => r.unverified), [false, true, false]);
});

test("снимок ссылки: без ТЗ и кэша страниц, диаграммы и таблица остаются", () => {
  const a = filledAnalysis(); a.config.tz = { title: "ТЗ", rows: [{ param: "x" }] };
  const s = buildSnapshot(a, { mode: "full" });
  assert.equal(s.analysis.config.tz, undefined); assert.equal(s.analysis.aggregates.listings, undefined);
  assert.ok(s.analysis.config.table && s.analysis.results.config.whole.fields.length === 3);
  assert.ok(a.config.tz, "исходный анализ не тронут");
  const ne = buildSnapshot(a, { mode: "no_economics" }); assert.ok(ne.analysis.results.config.whole.fields[0].values[0].avgPrice !== undefined, "рыночные цены — не закупочная экономика");
});
