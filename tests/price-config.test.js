// spec 013: цена по конфигурации — аналоги по совпадению полей, ступени 100/80/60 %, взвешенные квантили, вклад полей, ориентир себестоимости, выбор пользователя.
import test from "node:test";
import assert from "node:assert/strict";
import { priceByConfig, wquantile, parseRange } from "../shared/price-config.js";
import { configStats } from "../shared/config-stats.js";
import { mergeExtraction } from "../shared/config-extract.js";
import { entryFixture } from "./helpers/entry-fixture.js";
import { withConfig } from "./helpers/config-fixture.js";
import { compute } from "../shared/compute.js";
import { economics } from "../shared/economics.js";
import { mergeThresholds } from "../shared/thresholds.js";

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

test("числовое поле с интервалами («6–15», «от 50») разбирается как диапазон", () => {
  assert.deepEqual(parseRange("6–15"), [6, 15]); assert.deepEqual(parseRange("от 50"), [50, Infinity]);
  assert.deepEqual(parseRange("до 10"), [-Infinity, 10]); assert.equal(parseRange("Ocean"), null); assert.equal(parseRange("12"), null);
});

test("нет аналогов под сочетание: вместо тупика — цена по всей области с пометкой", () => {
  const { config, stats, xray, listings } = build();
  const pc = priceByConfig({ config, stats, xray, listings, choice: { conn: "нет такого", zones: 999 }, inputs: {}, th: { minAnalogs: 5, marginMin: 0.3 } });
  assert.equal(pc.fallback, "scope", "переключились на всю область");
  assert.ok(pc.market !== null, "цена есть — иначе вместе с ней исчезала бы и кнопка «подставить в экономику»");
  assert.match(pc.warn || "", /аналогов не нашлось/);
  assert.equal(pc.analogs, 12, "в основе — все листинги области");
  const ok = priceByConfig({ config, stats, xray, listings, choice: { conn: "BT", zones: 9 }, inputs: {}, th: { minAnalogs: 5, marginMin: 0.3 } });
  assert.equal(ok.fallback, null, "когда аналоги есть, ничего не меняется");
});

test("потолок себестоимости согласован с экономикой: при COGS = потолку маржа ПОСЛЕ рекламы ровно минимальная", () => {
  const { config, stats, xray, listings } = build();
  const inputs = { referralPct: 0.15, fbaFee: 5, shippingPerUnit: 2.4, cpc: 1.2, cvr: 0.1, ppcShare: 0.7, unitsPerDay: 10 };
  const th = { minAnalogs: 5, marginMin: 0.3, cheapPrice: 25, cheapMarginMin: 0.4 };
  const pc = priceByConfig({ config, stats, xray, listings, inputs, th });
  const ad = (1.2 / 0.1) * 0.7; // стоимость заказа × доля продаж с рекламы
  assert.equal(pc.adCostPerUnit, Math.round(ad * 100) / 100); assert.equal(pc.cogsCeilingAfterAds, true);
  assert.equal(pc.cogsCeiling, Math.round((pc.market * (1 - 0.15 - 0.3) - 5 - 2.4 - ad) * 100) / 100, "реклама и доставка вычитаются");
  // главная проверка: подставляем потолок в ту же экономику, что считает дашборд
  const e = economics({ ...inputs, price: pc.market, cogs: pc.cogsCeiling }, mergeThresholds({}));
  assert.ok(Math.abs(e.marginWithAds - 0.3) < 0.002, `маржа с рекламой при COGS = потолку должна быть 30 %, получилось ${(e.marginWithAds * 100).toFixed(1)} %`);
  assert.ok(e.gate1.margin0 > 0.3, "без рекламы остаётся запас");
  assert.deepEqual(pc.cogsCeilingMissing, [], "всё задано — оговорки нет");
  // без цены клика рекламу вычесть не из чего — потолок выше и помечен
  const noAd = priceByConfig({ config, stats, xray, listings, inputs: { ...inputs, cpc: null }, th });
  assert.equal(noAd.cogsCeilingAfterAds, false); assert.ok(noAd.cogsCeilingMissing.includes("реклама (нет цены клика)"));
  assert.ok(noAd.cogsCeiling > pc.cogsCeiling);

  // доставка не задана: её не из чего вычесть, поэтому потолок выше и помечен
  const noShip = priceByConfig({ config, stats, xray, listings, inputs: { ...inputs, shippingPerUnit: null }, th });
  assert.deepEqual(noShip.cogsCeilingMissing, ["доставка до склада Amazon"]);
  assert.equal(Math.round((noShip.cogsCeiling - pc.cogsCeiling) * 100) / 100, 2.4);
  // FBA-сбор не задан — тоже оговорка
  assert.deepEqual(priceByConfig({ config, stats, xray, listings, inputs: {}, th }).cogsCeilingMissing, ["FBA-сбор", "доставка до склада Amazon", "реклама (нет цены клика)"]);

  // дешёвый сегмент: Gate 1 требует там больше, потолок считается по той же планке
  // дешёвый сегмент: порог Gate 1 без рекламы выше, и потолок берёт меньшее из двух правил
  const cheapNoAd = priceByConfig({ config, stats, xray, listings, inputs: { ...inputs, cpc: 0.05 }, th: { ...th, cheapPrice: 200 } });
  assert.equal(cheapNoAd.cogsCeilingCheap, true); assert.equal(cheapNoAd.cogsCeilingAfterAds, false, "дешёвая реклама — ограничивает Gate 1");
  assert.equal(cheapNoAd.marginMin, 0.4);
  assert.equal(cheapNoAd.cogsCeiling, Math.round((cheapNoAd.market * (1 - 0.15 - 0.4) - 5 - 2.4) * 100) / 100);
  // реклама дороже разницы планок (10 % цены) — тогда ограничивает она
  const cheapAd = priceByConfig({ config, stats, xray, listings, inputs: { ...inputs, cpc: 2.5 }, th: { ...th, cheapPrice: 200 } });
  assert.equal(cheapAd.cogsCeilingAfterAds, true, "дорогая реклама — ограничивает она");
  assert.equal(cheapAd.cogsCeiling, Math.round((cheapAd.market * (1 - 0.15 - 0.3) - 5 - 2.4 - (2.5 / 0.1) * 0.7) * 100) / 100);
  assert.ok(cheapAd.cogsCeiling < cheapNoAd.cogsCeiling);
});

// 2026-11-14. Потолок себестоимости считался ТОЛЬКО от цены аналогов такой же конфигурации. На живом разборе
// аналоги брали $29,99, а человек планировал $65 — и подсказка под COGS писала «маржа недостижима даже при
// бесплатном товаре», пока соседний блок показывал маржу 44,2 %. Теперь есть второй потолок — при цене,
// по которой приложение считает экономику. Обе величины считает ОДНА функция, разойтись им нельзя.
test("потолок себестоимости: отдельно при цене аналогов и при цене из панели", () => {
  const { config, stats, xray, listings } = build();
  const th = { minAnalogs: 5, marginMin: 0.3, cheapPrice: 25, cheapMarginMin: 0.4 };
  const base = { referralPct: 0.15, fbaFee: 5, shippingPerUnit: 2 };

  const noPrice = priceByConfig({ config, stats, xray, listings, inputs: base, th });
  assert.equal(noPrice.cogsCeilingAtPrice, null, "цена не задана — второго потолка нет, выдуманного числа не появляется");

  // цена аналогов и цена в панели совпадают → оба потолка совпадают
  const same = priceByConfig({ config, stats, xray, listings, inputs: { ...base, price: noPrice.market }, th });
  assert.equal(same.cogsCeilingAtPrice.ceiling, same.cogsCeiling, "одна цена — один ответ");
  assert.equal(same.cogsCeiling, noPrice.cogsCeiling, "потолок при цене аналогов от панели не зависит");

  // панель вдвое дороже аналогов → потолок выше, и при цене аналогов он НЕ изменился
  const rich = priceByConfig({ config, stats, xray, listings, inputs: { ...base, price: noPrice.market * 2 }, th });
  assert.equal(rich.cogsCeiling, noPrice.cogsCeiling, "цена аналогов — факт о рынке, панель его не двигает");
  assert.ok(rich.cogsCeilingAtPrice.ceiling > noPrice.cogsCeiling, "по своей цене платить за товар можно больше");
  assert.equal(rich.cogsCeilingAtPrice.price, Math.round(noPrice.market * 2 * 100) / 100, "названа та самая цена");

  // формула при своей цене — та же, что и при цене аналогов (реклама не задана: цены клика нет)
  const p = rich.cogsCeilingAtPrice.price;
  assert.equal(rich.cogsCeilingAtPrice.ceiling, Math.round((p * (1 - 0.15 - 0.3) - 5 - 2) * 100) / 100);

  // дешёвый сегмент определяется по ТОЙ цене, о которой идёт речь, а не по цене аналогов
  const cheap = priceByConfig({ config, stats, xray, listings, inputs: { ...base, price: 20 }, th });
  assert.equal(cheap.cogsCeilingAtPrice.marginMin, 0.4, "при $20 действует повышенная планка дешёвого сегмента");
  assert.equal(cheap.cogsCeilingCheap, false, "а аналоги по $100 дешёвым сегментом не стали");
});

// ============ spec 024: цена конфигурации объясняет саму себя ============
// Живой случай: средние цены по каждой характеристике $41–74, а кнопка предлагает «Подставить $29,99».
// Ошибки нет — это две РАЗНЫЕ меры над РАЗНЫМИ наборами: «средняя цена значения» — простое среднее
// по всем листингам с ОДНОЙ характеристикой (а «взрослые» это 64 % ниши), цена конфигурации — медиана,
// ВЗВЕШЕННАЯ ВЫРУЧКОЙ, по листингам со совпадением сразу по 14 полям. Верное число выглядело опиской,
// потому что рядом не стояло ни одного из четырёх объясняющих чисел.

// ВОРОТА SC-024-002. Подстановка убирает ОДНО из четырёх — тест обязан упасть на СВОЁМ пункте.
test("SC-024-002: цена конфигурации нигде не показывается голой", () => {
  const { config, stats, xray, listings } = build();
  const pc = priceByConfig({ config, stats, xray, listings, inputs: { referralPct: 0.15, fbaFee: 5 }, th: { minAnalogs: 5, marginMin: 0.3 } });

  // 1. сколько взято аналогов
  assert.equal(typeof pc.analogs, "number");
  assert.ok(pc.analogs > 0, "число аналогов названо");

  // 2. уровень совпадения словами «совпадает K характеристик из M» — БЕЗ оценочной окраски.
  //    Ступень 0,6 на живых данных это пятнадцать ниш из восемнадцати, то есть обычный режим работы,
  //    и подавать его как проблему нельзя (research.md, D4).
  assert.ok(pc.matchWords, "уровень совпадения отдан словами");
  assert.equal(typeof pc.matchFields, "number");
  assert.equal(typeof pc.matchOf, "number");
  assert.equal(pc.matchWords, `${pc.matchFields} из ${pc.matchOf}`);
  assert.ok(pc.matchFields <= pc.matchOf);

  // 3. мера — медиана, ВЗВЕШЕННАЯ ВЫРУЧКОЙ, а не средняя цена и не простая медиана
  assert.equal(pc.priceMeasure, "weighted-median");

  // 4. сосредоточенность денег: какая доля выручки группы у самых тяжёлых и по какой они цене.
  //    БЕЗУСЛОВНО: «три аналога держат больше 30 %» верно в 17 нишах из 18, любой порог тут
  //    не различает ничего — это постоянное пояснение, а не сигнал тревоги (research.md, D3).
  assert.ok(pc.concentration, "сосредоточенность посчитана");
  assert.equal(typeof pc.concentration.topShare, "number");
  assert.equal(typeof pc.concentration.topPrice, "number");
  assert.equal(typeof pc.concentration.top3Share, "number");
  assert.ok(pc.concentration.topShare > 0 && pc.concentration.topShare <= 1);
  assert.ok(pc.concentration.top3Share >= pc.concentration.topShare);
});

test("spec 024: контрольные значения сосредоточенности", () => {
  const { config, stats, xray, listings } = build();
  const pc = priceByConfig({ config, stats, xray, listings, inputs: {}, th: { minAnalogs: 5, marginMin: 0.3 } });
  // самый тяжёлый аналог и его цена берутся из той же группы, по которой считалась цена
  const heavy = xray.asins.filter((a) => pc.analogAsins.includes(a.asin)).sort((a, b) => b.asinRevenue - a.asinRevenue)[0];
  assert.equal(pc.concentration.topPrice, heavy.price, "названа цена самого тяжёлого аналога");
  const tot = xray.asins.filter((a) => pc.analogAsins.includes(a.asin)).reduce((s, a) => s + a.asinRevenue, 0);
  assert.ok(Math.abs(pc.concentration.topShare - heavy.asinRevenue / tot) < 1e-4, "доля округлена до сотых процента — этого хватает для подписи");
});
