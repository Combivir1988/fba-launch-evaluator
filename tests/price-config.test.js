// spec 013: цена по конфигурации — аналоги по совпадению полей, ступени 100/80/60 %, взвешенные квантили, вклад полей, ориентир себестоимости, выбор пользователя.
import test from "node:test";
import assert from "node:assert/strict";
import { priceByConfig, wquantile } from "../shared/price-config.js";
import { configStats } from "../shared/config-stats.js";
import { mergeExtraction } from "../shared/config-extract.js";
import { entryFixture } from "./helpers/entry-fixture.js";
import { withConfig } from "./helpers/config-fixture.js";
import { compute } from "../shared/compute.js";

const asin = (i) => "B0" + String(i).padStart(8, "0");
const schema = { fields: [{ id: "conn", name: "Подключение", type: "choice", unit: null, options: ["BT", "wire"], hint: "" }, { id: "zones", name: "Зоны", type: "number", unit: "шт", options: [], hint: "" }, { id: "note", name: "УТП", type: "text", unit: null, options: [], hint: "" }] };
function build() {
  // 12 листингов: BT+9 зон — 6 шт по $90–110 (лидеры), BT+6 — 3 шт по $60, wire+9 — 3 шт по $70
  const spec = [...Array(6).fill(["BT", 9, 100]), ...Array(3).fill(["BT", 6, 60]), ...Array(3).fill(["wire", 9, 70])];
  const asins = spec.map((_, i) => asin(i + 1));
  const xray = { asins: spec.map(([c, z, p], i) => ({ asin: asins[i], brand: "b", price: p + (i % 3) * 5, asinRevenue: (12 - i) * 10000, asinSales: 10 })), flags: {}, columns: {} };
  const listings = Object.fromEntries(asins.map((a, i) => [a, { asin: a, fetchedAt: "2026-09-23", title: "t", bullets: [], specs: [], promo: i === 0 ? { coupon: { value: 10, unit: "%" }, hasPromo: true } : null }]));
  const items = spec.map(([c, z], i) => ({ asin: asins[i], values: [{ field: "conn", value: c, source: "specs" }, { field: "zones", value: z, source: "specs" }, { field: "note", value: "x", source: "title" }] }));
  const config = { schema, table: mergeExtraction({ schema, items, listings, asins }) };
  const stats = configStats(config, xray, { th: { numericDistinctMax: 12 } }).whole;
  return { config, stats, xray, listings };
}

test("wquantile: взвешенная медиана и квантили", () => {
  assert.equal(wquantile([{ v: 10, w: 1 }, { v: 20, w: 1 }, { v: 100, w: 8 }], 0.5), 100); assert.equal(wquantile([{ v: 10, w: 1 }, { v: 20, w: 1 }, { v: 30, w: 1 }], 0.25), 10); assert.equal(wquantile([], 0.5), null);
});

test("по умолчанию — доминанты; аналоги с полным совпадением; медиана по выручке; текстовые поля не участвуют", () => {
  const { config, stats, xray, listings } = build();
  const pc = priceByConfig({ config, stats, xray, listings, inputs: { referralPct: 0.15, fbaFee: 5 }, th: { minAnalogs: 5, marginMin: 0.3 } });
  assert.deepEqual(pc.fields.map((f) => f.id), ["conn", "zones"]); assert.equal(pc.fields[0].value, "BT"); assert.equal(pc.fields[1].value, 9); assert.equal(pc.selectedCount, 2);
  assert.equal(pc.tier, 1); assert.equal(pc.analogs, 6); assert.ok(pc.market >= 100 && pc.market <= 110); assert.ok(pc.entry <= pc.market && pc.ceiling >= pc.market); assert.equal(pc.warn, null);
  assert.ok(pc.marketEff <= pc.market, "купон у лидера снижает цену с учётом купонов"); assert.equal(pc.cogsCeiling, Math.round((pc.market * 0.85 - 5 - pc.market * 0.3) * 100) / 100);
  assert.deepEqual(pc.contributions.map((c) => c.isDominant), [true, true]); assert.equal(pc.leaderAsin, asin(1));
});

test("выбор пользователя: другое значение → другие аналоги и вклад; «не важно» снимает поле; мало аналогов → ступень 60 % и предупреждение", () => {
  const { config, stats, xray, listings } = build();
  const wire = priceByConfig({ config, stats, xray, listings, choice: { conn: "wire" }, th: { minAnalogs: 5, marginMin: 0.3 } });
  assert.equal(wire.analogs, 3, "полное совпадение только у 3 (BT+9 совпадает лишь наполовину и не проходит даже ступень 60 %)"); assert.equal(wire.tier, 1, "ступени не помогли — берём лучшую с ≥ 3 аналогами"); assert.match(wire.warn, /аналогов мало \(3\)/);
  const c = wire.contributions.find((x) => x.id === "conn"); assert.equal(c.isDominant, false); assert.ok(c.delta < 0, "провод дешевле BT"); assert.equal(c.dominant, "BT");
  const any = priceByConfig({ config, stats, xray, listings, choice: { conn: null }, th: { minAnalogs: 5, marginMin: 0.3 } }); assert.equal(any.selectedCount, 1); assert.equal(any.analogs, 9, "9 зон у 9 листингов"); assert.equal(any.tier, 1);
  const none = priceByConfig({ config, stats, xray, listings, choice: { conn: null, zones: null }, th: {} }); assert.equal(none.market, null); assert.match(none.warn, /выберите/);
  const six = priceByConfig({ config, stats, xray, listings, choice: { conn: "BT", zones: 6 }, th: { minAnalogs: 2, marginMin: 0.3 } }); assert.equal(six.analogs, 3); assert.equal(six.tier, 1); assert.ok(six.market >= 60 && six.market <= 70);
});

test("compute: results.priceConfig есть при таблице этапа 2 и хранит выбор из config.priceChoice; без Xray/таблицы — null", () => {
  const a = withConfig(entryFixture(), { tz: false }); assert.ok(a.results.priceConfig && a.results.priceConfig.fields.length >= 2);
  const f = a.results.priceConfig.fields.find((x) => x.type === "choice" && x.values.length > 1); a.config.priceChoice = { [f.id]: f.values[1].value }; a.results = compute(a);
  assert.equal(String(a.results.priceConfig.fields.find((x) => x.id === f.id).value), String(f.values[1].value));
  assert.equal(entryFixture().results.priceConfig, null);
});
