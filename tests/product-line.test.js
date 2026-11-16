// spec 025: предлагаемая товарная линейка — оси вариации и варианты по самой сильной из них.
//
// Приложение уже разбирает иерархию семей вариаций (parentAsin в разборе Xray), но вне разборщика
// её не читает никто. Замер на 67 живых нишах: семьи из ≥2 вариаций есть в 67 из 67, их доля
// выручки — медиана 88,6 %, у ТОП-10 по выручке медиана 5 ASIN в карточке.
//
// Фикстуры строятся здесь же хелпером, а не лежат файлами: ниши синтетические и читаются рядом
// с утверждением, которое проверяют (тот же приём, что в tests/price-distribution.test.js).
import { test } from "node:test";
import assert from "node:assert/strict";
import { productLine, AXIS_RATE_MIN, VALUE_SHARE_MIN, MIN_HEAVY_VALUES } from "../shared/product-line.js";

/**
 * Ниша из семей вариаций.
 * @param fams массив семей; семья — массив вариаций; вариация — { имя поля: значение }
 * @param opts { revenue: выручка одной вариации | функция(индекс семьи, индекс вариации) }
 */
function build(fams, { revenue = () => 1000, price = 20, fields = null } = {}) {
  const asins = [], rows = {};
  const names = new Set();
  fams.forEach((fam) => fam.forEach((v) => Object.keys(v).forEach((k) => names.add(k))));
  const defs = fields || [...names].map((n) => ({ id: n, name: n, type: "choice" }));
  fams.forEach((fam, fi) => {
    let parent = null;
    fam.forEach((vals, vi) => {
      const asin = "B0" + String(fi).padStart(4, "0") + String(vi).padStart(4, "0");
      if (vi === 0) parent = asin;
      asins.push({ asin, parentAsin: parent, isVariation: vi > 0, price,
        asinRevenue: typeof revenue === "function" ? revenue(fi, vi) : revenue, brand: "Brand" + fi, title: "" });
      rows[asin] = { status: "ok", values: Object.fromEntries(Object.entries(vals).map(([k, v]) => [k, { value: v, source: "title" }])) };
    });
  });
  return { xray: { asins }, config: { schema: { fields: defs }, table: { rows } } };
}

const call = (n, extra = {}) => productLine({ ...n, ...extra });

// ─────────────────────────────────────────────────────────────────────────────
// ВОРОТА SC-001. Пустой блок человек читает как «не посчиталось» и ищет ошибку.
// Выдуманная ось хуже: по ней закупят партию.
// ─────────────────────────────────────────────────────────────────────────────

test("SC-025-001a: ниша, где различия не повторяются, говорит это вслух", () => {
  // Семьи есть, поля внутри них меняются — но каждое значение встречается ровно один раз,
  // то есть ни одно не держит заметной доли выручки поля. Живой случай: 21 поле схемы, 8 семей, осей ноль.
  const fams = [...Array(8)].map((_, i) => [
    { Фича: "уникальная " + i + "a" },
    { Фича: "уникальная " + i + "b" },
  ]);
  const r = call(build(fams));
  assert.equal(r.status, "no_repeating", "статус назван именно этот, а не общий «линейки нет»");
  assert.equal(r.items.length, 0, "ни одного предложенного товара");
  assert.ok(r.note && r.note.length > 10, "есть человеческая фраза, а не пустота");
  assert.ok(/не строят|не стро/i.test(r.note), "сказано, что линейку здесь не строят: " + r.note);
});

test("SC-025-001b: поле из сотен уникальных значений осью НЕ становится", () => {
  // Живые случаи: «Уникальные фичи» — 95,8 % семей, 334 разных значения, весомых ноль;
  // «Аромат» — 95,8 % семей, 328 значений, весомых ноль. Частота смены сама по себе обманывает:
  // поле, где у каждого листинга своё значение, меняется почти в каждой семье.
  // Аромат меняется в КАЖДОЙ семье, Размер — только в половине: без защиты «Аромат» побеждает
  // по частоте и становится осью. Если бы частоты были равны, сортировка по числу весомых значений
  // спасала бы сама, и ворота проверяли бы не то (поймано проверкой подлогом).
  const fams = [...Array(24)].map((_, i) => {
    const sizes = i % 2 ? ["S", "S", "L"] : ["M", "M", "M"]; // меняется только в половине семей
    return [0, 1, 2].map((vi) => ({ Аромат: "запах-" + i + "-" + vi, Размер: sizes[vi] }));
  });
  const r = call(build(fams));
  const aroma = r.axes.concat(r.axisRejected).find((a) => a.name === "Аромат");
  assert.ok(aroma.rate > (r.axes.find((a) => a.name === "Размер")?.rate ?? 0),
    "по частоте «Аромат» впереди — значит отсечь его может только второе условие");

  const chosen = r.axes.find((a) => a.chosen);
  assert.ok(chosen, "ось выбрана");
  assert.equal(chosen.name, "Размер", "выбрана нормальная ось, а не поле из сотен значений");

  const rejected = r.axisRejected.find((a) => a.name === "Аромат");
  assert.ok(rejected, "поле из уникальных значений ОТКЛОНЕНО и это видно, а не молча исчезло");
  assert.equal(rejected.reason, "no_repeating_values", "названа причина отказа");
  assert.ok(rejected.rate >= AXIS_RATE_MIN, "по частоте оно прошло бы — отсекло именно второе условие");
  assert.ok(rejected.distinct > 10, "у него действительно много разных значений");

  assert.equal(r.status, "ok");
  assert.ok(r.items.length >= 2, "линейка построена по следующей оси");
  for (const it of r.items) assert.equal(it.axisName, "Размер");

  // Ось не может быть одновременно принятой и отклонённой: иначе интерфейс покажет её дважды
  // и с противоположным смыслом. Без этой проверки подлог оставлял код противоречивым незаметно.
  const inAxes = new Set(r.axes.map((a) => a.id));
  for (const rej of r.axisRejected) assert.ok(!inAxes.has(rej.id), "отклонённая ось не стоит среди принятых: " + rej.name);
});

// ─────────────────────────────────────────────────────────────────────────────
// ВОРОТА SC-002. Наивный подсчёт «дырок спроса» на живых нишах выдаёт duct (201 851 SV)
// в нише joist tape — это duct tape, чужой товар — наравне с 20x20x1 в нише фильтров,
// настоящим размером. Примерно половина на половину.
// ─────────────────────────────────────────────────────────────────────────────

test("SC-025-002: чужое слово из ключей варианта не порождает", () => {
  const fams = [...Array(10)].map((_, i) => [
    { Материал: i < 5 ? "foam" : "rubber" },
    { Материал: i < 5 ? "rubber" : "foam" },
  ]);
  const n = build(fams);
  const cerebro = { keywords: [
    { phrase: "duct tape heavy duty", sv: 201_851, isAsin: false, isBranded: false },
    { phrase: "gorilla tape", sv: 98_901, isAsin: false, isBranded: false },
    { phrase: "foam joist tape", sv: 4_000, isAsin: false, isBranded: false },
  ] };
  const r = call(n, { cerebro, brands: ["Gorilla"] });

  const values = r.items.map((i) => String(i.value).toLowerCase());
  assert.ok(!values.includes("duct"), "варианта «duct» нет: это чужой товар, а не значение поля");
  assert.ok(!values.includes("gorilla"), "варианта «gorilla» нет: это чужой бренд");
  for (const it of r.items) {
    assert.ok(["foam", "rubber"].includes(String(it.value)),
      "каждое значение взято из таблицы характеристик, а не из ключей: " + it.value);
  }
  // у значения, которое В ключах есть, объём назван — источник всё-таки работает
  const foam = r.items.find((i) => i.value === "foam");
  assert.ok(foam, "вариант foam предложен");
  assert.equal(foam.demand.checked, true, "для текстового значения латиницей спрос проверялся");
  assert.ok(foam.demand.sv > 0, "объём найден и назван");
});

// ─────────────────────────────────────────────────────────────────────────────
// Пороги и устойчивость
// ─────────────────────────────────────────────────────────────────────────────

test("spec 025: пороги выбраны замером и названы человеку", () => {
  assert.equal(AXIS_RATE_MIN, 0.2, "ось меняется не меньше чем в 20 % семей");
  assert.equal(VALUE_SHARE_MIN, 0.1, "значение держит не меньше 10 % выручки ПОЛЯ");
  assert.equal(MIN_HEAVY_VALUES, 2, "ось годится только при двух весомых значениях");

  const fams = [...Array(10)].map(() => [{ Цвет: "red" }, { Цвет: "blue" }]);
  const r = call(build(fams));
  assert.deepEqual(r.thresholds, { axisRate: 0.2, valueShare: 0.1, minHeavyValues: 2 },
    "числа, по которым принято решение, видны без чтения кода");
});

test("spec 025: поле, делящее РЫНОК, осью не становится", () => {
  // Живой случай: «Управление» меняется в НУЛЕ семей — на рынке есть кнопка и пульт,
  // но ни одна марка не делает оба в одной карточке. Это сегмент рынка, а не ось линейки.
  // Таких полей 65 из 207 на живых данных.
  const fams = [...Array(10)].map((_, i) => [
    { Управление: i < 5 ? "кнопка" : "пульт", Цвет: "red" },
    { Управление: i < 5 ? "кнопка" : "пульт", Цвет: "blue" },
  ]);
  const r = call(build(fams));
  assert.ok(!r.axes.some((a) => a.name === "Управление"), "поле с нулевой частотой в оси не попало");
  assert.ok(!r.axisRejected.some((a) => a.name === "Управление"), "и в отклонённые тоже: оно даже не кандидат");
  assert.equal(r.axes.find((a) => a.chosen).name, "Цвет");
});

test("spec 025: «нет данных» отдельным значением не считается", () => {
  // Иначе неполнота таблицы выглядела бы как вариативность.
  const fams = [...Array(10)].map(() => [{ Цвет: "red" }, { Цвет: null }]);
  const r = call(build(fams));
  assert.ok(!r.axes.some((a) => a.name === "Цвет"),
    "пустая клетка не делает поле осью: различия нет, есть пробел в данных");
});

test("spec 025: порядок осей устойчив", () => {
  // Без устойчивого порядка один анализ при двух открытиях дал бы разные линейки.
  const fams = [...Array(10)].map(() => [{ A: "x", B: "p" }, { A: "y", B: "q" }]);
  const n = build(fams);
  const a = call(n), b = call(JSON.parse(JSON.stringify(n)));
  assert.deepEqual(a.axes.map((x) => x.name), b.axes.map((x) => x.name));
  assert.equal(a.axes.find((x) => x.chosen).name, b.axes.find((x) => x.chosen).name);
});

// ─────────────────────────────────────────────────────────────────────────────
// Шесть статусов: у каждого своя фраза. Склейка запрещена — причины разные,
// и выводы человека из них разные.
// ─────────────────────────────────────────────────────────────────────────────

test("spec 025: шесть исходов различимы и ни один не повторяет другой", () => {
  const seen = new Map();
  const put = (r) => { assert.ok(r.note, "у статуса " + r.status + " есть фраза"); seen.set(r.status, r.note); };

  put(productLine({}));                                                        // no_xray
  put(call(build([[{ Цвет: "red" }], [{ Цвет: "blue" }]])));                   // no_variations: семьи по одному
  put(productLine({ xray: build([[{ Цвет: "r" }, { Цвет: "b" }]]).xray }));    // no_stage2
  put(call(build([...Array(10)].map(() => [{ Цвет: "red" }, { Цвет: "red" }])))); // no_differences
  put(call(build([...Array(8)].map((_, i) => [{ Ф: "u" + i + "a" }, { Ф: "u" + i + "b" }])))); // no_repeating
  put(call(build([...Array(10)].map(() => [{ Цвет: "red" }, { Цвет: "blue" }])))); // ok

  assert.deepEqual([...seen.keys()].sort(),
    ["no_differences", "no_repeating", "no_stage2", "no_variations", "no_xray", "ok"].sort());
  assert.equal(new Set(seen.values()).size, 6, "шесть РАЗНЫХ фраз: склейки нет");
});

// ─────────────────────────────────────────────────────────────────────────────
// Семьи и линейка
// ─────────────────────────────────────────────────────────────────────────────

test("spec 025: семьи вариаций считаются из иерархии Xray", () => {
  const fams = [[{ Ц: "a" }, { Ц: "b" }, { Ц: "c" }], [{ Ц: "a" }, { Ц: "b" }], [{ Ц: "a" }]];
  const r = call(build(fams));
  assert.equal(r.families.total, 3);
  assert.equal(r.families.multi, 2, "семей из нескольких вариаций");
  assert.equal(r.families.medianSize, 2);
  assert.ok(r.families.revenueShare > 0.8, "доля выручки у семей из нескольких вариаций");
});

test("spec 025: вариант отличается от главного ровно по одной оси", () => {
  const fams = [...Array(12)].map((_, i) => [
    { Цвет: "red", Размер: i % 2 ? "S" : "L" },
    { Цвет: "blue", Размер: i % 2 ? "S" : "L" },
  ]);
  const r = call(build(fams));
  const main = r.items.find((i) => i.role === "main");
  assert.ok(main, "главный товар есть");
  const axis = r.axes.find((a) => a.chosen).id;
  for (const v of r.items.filter((i) => i.role === "variant")) {
    assert.equal(v.axisId, axis, "вариант отличается по ВЫБРАННОЙ оси");
    assert.notEqual(v.value, main.value, "и значение у него другое");
  }
});

test("spec 025: число вариантов — весомые значения минус главный", () => {
  // Порог 10 % даёт на живых нишах медиану 3 весомых значения, то есть главный + 2 варианта = 3 ASIN.
  const fams = [...Array(15)].map((_, i) => [
    { Набор: ["1 шт", "3 шт", "6 шт"][i % 3] },
    { Набор: ["3 шт", "6 шт", "1 шт"][i % 3] },
  ]);
  const r = call(build(fams));
  const heavy = r.axes.find((a) => a.chosen).heavyValues;
  assert.equal(r.items.length, heavy, "всего товаров = весомых значений");
  assert.equal(r.items.filter((i) => i.role === "variant").length, heavy - 1, "главный занимает одно из них");
});

// ─────────────────────────────────────────────────────────────────────────────
// Поле обязано доехать до результата. `compute()` собирает результат явным перечнем ключей,
// и поле, которого там нет, молча не появится в интерфейсе, а ни один тест не упадёт.
// Случалось дважды: launchPlan (spec 020) и reviewBarrierEffective (spec 022).
// ─────────────────────────────────────────────────────────────────────────────

test("spec 025: productLine доезжает до собранного результата", async () => {
  const { fixtureAnalysis } = await import("./helpers/fixture-analysis.js");
  const { compute } = await import("../shared/compute.js");
  const r = compute(fixtureAnalysis());
  assert.ok(Object.prototype.hasOwnProperty.call(r, "productLine"), "ключ productLine есть в результате");
  assert.ok(r.productLine && typeof r.productLine.status === "string", "и в нём определённый статус");
  assert.deepEqual(r.productLine.thresholds, { axisRate: 0.2, valueShare: 0.1, minHeavyValues: 2 });
  assert.ok(r.productLine.note && r.productLine.note.length > 10, "ответ не бывает пустым");
});

// ─────────────────────────────────────────────────────────────────────────────
// ВОРОТА SC-005. Предлагаемая линейка — замысел СВОЕГО товара, как ТЗ производителю
// и этап 3, а не рыночные данные вроде диаграмм этапа 2. Наружу не отдаётся,
// и это проверяется СОДЕРЖИМЫМ снимка, а не кодом показа.
// ─────────────────────────────────────────────────────────────────────────────

test("SC-025-005: линейки нет ни в публичной ссылке, ни в автономном HTML", async () => {
  const { fixtureAnalysis } = await import("./helpers/fixture-analysis.js");
  const { buildSnapshot, stripProductLine, findProductLineLeaks } = await import("../shared/share-snapshot.js");

  const a = fixtureAnalysis();
  assert.ok(a.results.productLine, "в самом анализе линейка посчитана");

  for (const mode of ["full", "no_economics"]) {
    const s = buildSnapshot(a, { mode, preparedBy: "Анна" });
    assert.equal(s.analysis.results.productLine, undefined, mode + ": поля линейки в снимке нет");
    assert.deepEqual(findProductLineLeaks(s, a), [], mode + ": ловушка молчит");
    if (a.results.productLine.note) {
      assert.equal(JSON.stringify(s).includes(a.results.productLine.note), false, mode + ": вывода о линейке в снимке нет");
    }
  }

  // Автономный HTML кладёт в файл ВЕСЬ документ анализа — там вырезать надо тоже.
  const forHtml = stripProductLine(JSON.parse(JSON.stringify(a)));
  assert.equal(forHtml.results.productLine, undefined);
  assert.ok(a.results.productLine, "исходный документ не тронут");
});

test("ловушка линейки ловит утечку, если её когда-нибудь сломают", async () => {
  const { fixtureAnalysis } = await import("./helpers/fixture-analysis.js");
  const { buildSnapshot, findProductLineLeaks } = await import("../shared/share-snapshot.js");
  const a = fixtureAnalysis();
  const bad = buildSnapshot(a, { mode: "full", preparedBy: "Анна" });
  bad.analysis.results.productLine = JSON.parse(JSON.stringify(a.results.productLine)); // имитируем регресс
  const leaks = findProductLineLeaks(bad, a);
  assert.ok(leaks.includes("results.productLine"), JSON.stringify(leaks));
});

// Цена варианта обязана считаться по аналогам, У КОТОРЫХ ЭТО ЗНАЧЕНИЕ ЕСТЬ.
// Без этого ступени смягчения (1 / 0,8 / 0,6) спускались до «совпадает 2 из 4», значение оси
// в число совпавших не входило, и аналогами варианта «3 шт» становились листинги с 1 шт.
// На живых нишах это давало ОДНУ И ТУ ЖЕ цену всем вариантам в 8 нишах из 18 (разброс 3,7 %);
// после починки — 1 ниша из 18, медианный разброс 104,8 %.
test("spec 025: цена варианта считается по листингам с ЭТИМ значением оси", () => {
  // Девять полей одинаковы у всех, различается только Набор. Когда точного совпадения не хватает
  // (здесь порог аналогов поднят до 20), расчёт спускается на ступень 0,8 — и девяти одинаковых полей
  // хватает, чтобы аналогами варианта «6 шт» стали листинги с «1 шт». Это и есть живая поломка:
  // у 8 ниш из 18 ВСЕ варианты получали одну цену (разброс 3,7 %); после починки — 1 ниша, разброс 104,8 %.
  const common = Object.fromEntries([...Array(9)].map((_, i) => ["P" + i, "общее"]));
  const fams = [...Array(12)].map(() => [{ Набор: "1 шт", ...common }, { Набор: "6 шт", ...common }]);
  const n = build(fams, { price: 10 });
  for (const a of n.xray.asins) {
    a.price = n.config.table.rows[a.asin].values["Набор"].value === "6 шт" ? 50 : 10;
    a.asinRevenue = 1000;
  }
  const stats = { fields: n.config.schema.fields.map((f) => ({ id: f.id, values: [] })) };
  // Человек выбрал конфигурацию целиком — так и бывает в живом анализе. Именно поэтому в расчёт цены
  // идут ВСЕ поля, ступени смягчения срабатывают, и без требования совпасть по оси аналоги размываются.
  n.config.priceChoice = { "Набор": "1 шт", ...common };
  const r = call(n, { stats, th: { minAnalogs: 20 } });
  const byLabel = Object.fromEntries(r.items.map((i) => [i.label, i.price?.market]));
  assert.ok(byLabel["1 шт"] && byLabel["6 шт"], "цены посчитаны у обоих: " + JSON.stringify(byLabel));
  assert.notEqual(byLabel["1 шт"], byLabel["6 шт"], "цены РАЗНЫЕ — иначе цена не отвечает на свой вопрос");
  assert.equal(byLabel["1 шт"], 10, "цена «1 шт» взята по листингам с «1 шт»");
  assert.equal(byLabel["6 шт"], 50, "цена «6 шт» взята по листингам с «6 шт»");
});
