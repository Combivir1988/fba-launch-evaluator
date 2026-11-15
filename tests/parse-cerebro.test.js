import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCerebro, suggestCluster, isCerebroHeaders, competitorStats, suggestClusterInfo, hasPerfScore, effectiveScore, brandMatcher, annotateKeywords } from "../shared/parse-cerebro.js";
import { readCsv, CEREBRO } from "./helpers.js";

const rows = readCsv(CEREBRO);

test("Cerebro: заголовки, ASIN-строки, границы", () => {
  assert.equal(isCerebroHeaders(Object.keys(rows[0])), true);
  const c = parseCerebro(rows, { coreKeyword: "car sound deadening mat", brands: ["KILMAT", "Siless"] });
  const asinRow = c.keywords.find((k) => k.phrase === "b0751cbxbt");
  assert.equal(asinRow.isAsin, true);
  assert.equal(asinRow.sv, 294);
  const gd = c.keywords.find((k) => k.phrase === "garage door insulation");
  assert.equal(gd.sv, 12217);
  assert.equal(gd.bid, 0.73);
  assert.equal(gd.competingProducts, 3000);
  assert.equal(gd.competingIsBound, true);
  const branded = c.keywords.find((k) => k.phrase.includes("siless"));
  assert.equal(branded.isBranded, true);
  assert.ok(c.keywords[0].sv >= c.keywords[1].sv, "сортировка по SV");
});

test("Cerebro: автокластер исключает ASIN/бренды и берёт релевантные", () => {
  const c = parseCerebro(rows, { coreKeyword: "sound deadening mat", brands: ["KILMAT", "Siless", "Noico"] });
  const cl = suggestCluster(c.keywords, { coreKeyword: "sound deadening mat", minSv: 100 });
  assert.ok(cl.length > 0);
  for (const p of cl) {
    assert.ok(!/^b0/i.test(p), "нет ASIN");
    assert.ok(!/kilmat|siless|noico/i.test(p), "нет брендов");
    assert.ok(/deaden|sound|mat/.test(p), p);
  }
});

test("Cerebro multi-ASIN: Ranking Competitors → кластер по правилу «≥ 3 конкурентов», сортировка/поля", () => {
  const rows = [
    { "Keyword Phrase": "urinal screen deodorizer", "Search Volume": "20,000", "Keyword Sales": "1,200", "Ranking Competitors (count)": "8", "Competitor Rank (avg)": "5", "H10 PPC Sugg. Bid": "1.4" },
    { "Keyword Phrase": "urinal cakes", "Search Volume": "9,000", "Keyword Sales": "600", "Ranking Competitors (count)": "6", "Competitor Rank (avg)": "12" },
    { "Keyword Phrase": "bathroom air freshener", "Search Volume": "50,000", "Keyword Sales": "50", "Ranking Competitors (count)": "1", "Competitor Rank (avg)": "180" },
    { "Keyword Phrase": "tenkaiwick urinal screen", "Search Volume": "3,000", "Keyword Sales": "100", "Ranking Competitors (count)": "5", "Competitor Rank (avg)": "9" },
    { "Keyword Phrase": "b077pnbddd", "Search Volume": "300", "Ranking Competitors (count)": "8" },
    { "Keyword Phrase": "urinal mat", "Search Volume": "80", "Ranking Competitors (count)": "4" },
  ];
  const c = parseCerebro(rows, { coreKeyword: "urinal screen deodorizer", brands: ["TenkaiWick"] });
  assert.equal(c.flags.multiAsin, true);
  assert.equal(c.flags.maxCompetitors, 8);
  assert.equal(c.keywords.find((k) => k.phrase === "urinal cakes").rankingCompetitors, 6);
  assert.equal(c.keywords.find((k) => k.phrase === "urinal cakes").keywordSales, 600);
  const cl = suggestCluster(c.keywords, { coreKeyword: "urinal screen deodorizer", minSv: 100 });
  assert.ok(cl.includes("urinal screen deodorizer") && cl.includes("urinal cakes"), cl.join(","));
  assert.ok(!cl.includes("bathroom air freshener"), "1 конкурент в топе → не релевантно, несмотря на 50k SV");
  assert.ok(!cl.includes("tenkaiwick urinal screen"), "брендовый запрос исключён");
  assert.ok(!cl.includes("b077pnbddd"), "ASIN исключён");
  assert.ok(!cl.includes("urinal mat"), "SV 80 < порога 100");
  const cl2 = suggestCluster(c.keywords, { coreKeyword: "urinal screen deodorizer", minSv: 50, minCompetitors: 4 });
  assert.ok(cl2.includes("urinal mat"), "порог SV и минимум конкурентов настраиваются");
});

test("порог «конкурентов в топе» по умолчанию: число ASIN в multi-ASIN Cerebro минус один; single-ASIN — порог настроек", async () => {
  const { defaultMinCompetitors } = await import("../shared/parse-cerebro.js");
  assert.equal(defaultMinCompetitors({ flags: { multiAsin: true, maxCompetitors: 5 } }, 3), 4);
  assert.equal(defaultMinCompetitors({ flags: { multiAsin: true, maxCompetitors: 2 } }, 3), 1);
  assert.equal(defaultMinCompetitors({ flags: { multiAsin: true, maxCompetitors: 1 } }, 3), 3, "один ASIN — правило не имеет смысла, остаётся порог настроек");
  assert.equal(defaultMinCompetitors({ flags: { multiAsin: false, maxCompetitors: null } }, 3), 3); assert.equal(defaultMinCompetitors(null, 3), 3);
});

test("брендовые запросы: бренды с апострофом и двумя словами, бренды из POE и исключённых, «голова» бренда отдельным словом; общие слова не считаются брендом", async () => {
  const { brandMatcher, knownBrands } = await import("../shared/parse-cerebro.js");
  const is = brandMatcher(["Ling's moment", "Mandy's", "Melorca&Guilla", "Floroom", "Generic", "(без бренда)", "NOW Foods", "Villa Como", "Real Touch"], "artificial flower");
  for (const p of ["lings moment artificial wedding flowers", "ling's moment flowers", "mandy rose", "melorca guilla plants", "royal blue floroom artificial flowers", "now foods vitamins", "villa como decor", "real touch artificial flowers"]) assert.equal(is(p), true, p);
  for (const p of ["artificial flower", "gan mao ling plum flower", "generic artificial flowers", "whole foods fresh flowers", "now flowers", "unbranded flowers"]) assert.equal(is(p), false, p);
  const kb = knownBrands({ xray: { asins: [{ brand: "KILMAT" }, { brand: "(без бренда)" }, { brand: "KILMAT" }] }, poe: { asinMetrics: [{ brand: "Floroom" }, { brand: "" }] }, excludedBrands: ["Yatim"] });
  assert.deepEqual(kb, ["KILMAT", "Floroom", "Yatim"]);
  const c = parseCerebro([{ "Keyword Phrase": "floroom artificial flowers", "Search Volume": "591" }, { "Keyword Phrase": "artificial flowers", "Search Volume": "9000" }], { coreKeyword: "artificial flowers", brands: kb });
  assert.deepEqual(Object.fromEntries(c.keywords.map((k) => [k.phrase, k.isBranded])), { "floroom artificial flowers": true, "artificial flowers": false });
});

test("competitorStats: сколько фраз подходит под порог и сколько у них Competitor Performance Score 10", () => {
  const kw = (phrase, rc, sv, score, extra = {}) => ({ phrase, rankingCompetitors: rc, sv, performanceScore: score, isAsin: false, isBranded: false, ...extra });
  const list = [kw("a", 9, 5000, 10), kw("b", 9, 50, 10), kw("c", 8, 900, 4), kw("d", 3, 900, 0), kw("e", 9, 900, 10, { isBranded: true }), kw("f", 9, 900, 10, { isAsin: true })];
  const s10 = competitorStats(list, { minScore: 10, minSv: 100 });
  assert.equal(s10.fits, 2, "бренды и ASIN не считаются"); assert.equal(s10.fitsBySv, 1, "фраза с SV 50 отсеяна");
  assert.equal(s10.perfect, 2, "score 10 — то же, что фильтр Competitor Performance в Cerebro"); assert.equal(s10.maxCompetitors, 9);
  assert.equal(competitorStats(list, { minScore: 4, minSv: 100 }).fits, 3, "под 4 проходит и фраза со score 4");
  assert.equal(competitorStats([], {}).fits, 0);
});

test("кластер по Competitor Performance Score: берём фразы, где конкуренты стоят высоко, порог сам смягчается", () => {
  const kw = (phrase, score, sv, extra = {}) => ({ phrase, performanceScore: score, sv, rankingCompetitors: 9, relevance: 1, isAsin: false, isBranded: false, isCore: false, ...extra });
  const many = [...Array(20)].map((_, i) => kw("fraza " + i, 10, 500 + i));
  const info = suggestClusterInfo([...many, kw("mus", 2, 5000)], { coreKeyword: "fraza", minSv: 100, minScore: 10, want: 15 });
  assert.equal(info.byScore, true); assert.equal(info.score, 10); assert.equal(info.steppedDown, false);
  assert.equal(info.phrases.length, 20, "фраза со score 2 не попала"); assert.ok(!info.phrases.includes("mus"));

  // в узкой нише десятки почти нет — порог смягчается сам
  const narrow = [kw("a", 10, 900), ...[...Array(18)].map((_, i) => kw("b" + i, 6, 300 + i)), kw("c", 2, 800)];
  const soft = suggestClusterInfo(narrow, { coreKeyword: "a b c", minSv: 100, minScore: 10, want: 15 });
  assert.equal(soft.steppedDown, true); assert.equal(soft.score, 6, "ступень 10 → 8 → 6");
  assert.equal(soft.phrases.length, 19); assert.ok(!soft.phrases.includes("c"), "score 2 всё равно за бортом");

  // старая выгрузка без колонки score — прежнее правило по числу конкурентов
  const old = [{ phrase: "x", sv: 900, rankingCompetitors: 9, relevance: 1, isAsin: false, isBranded: false, isCore: false },
               { phrase: "y", sv: 900, rankingCompetitors: 2, relevance: 1, isAsin: false, isBranded: false, isCore: false }];
  const legacy = suggestClusterInfo(old, { coreKeyword: "x y", minSv: 100, minCompetitors: 8 });
  assert.equal(legacy.byScore, false); assert.deepEqual(legacy.phrases, ["x"]);
});

// ============ spec 023: бренд против куска слова ============
// Живой случай 2026-11-14: среди конкурентов ниши велосипедных шлемов есть марка MET (настоящий
// итальянский производитель). Подстрочное совпадение делало брендовыми 6 909 фраз со словом helmet
// из 6 938 — то есть всю нишу, включая сам ключ анализа. Человек отобрал 135 фраз вручную,
// и при КАЖДОМ открытии анализа все 135 выбрасывались из кластера (замер: «сохранено 135 → остаётся 0»).

// ВОРОТА SC-001. Реализация, которая ищет имя бренда внутри слова, обязана ронять этот тест —
// и ронять ИМЕННО на пунктах про helmet, а не на пунктах про «met helmet»: если падает везде,
// затронуто больше, чем задумано.
test("SC-023-001: имя бренда совпадает отдельным словом, а не куском слова", () => {
  const m = brandMatcher(["MET", "Giro", "Bell"], "bike helmet");

  // ради чего всё делается: буквы «met» внутри слова брендом не являются
  assert.equal(m("bike helmet"), false, "ключ ниши не брендовый запрос");
  assert.equal(m("helmets for adults"), false);
  assert.equal(m("kids helmet"), false);
  assert.equal(m("geometry set"), false, "«met» внутри geometry");

  // а настоящие брендовые запросы ловятся по-прежнему
  assert.equal(m("met helmet"), true, "имя отдельным словом");
  assert.equal(m("casco met"), true, "имя последним словом");
  assert.equal(m("giro bike helmet"), true);
  assert.equal(m("bell helmet"), true);
});

// ВОРОТА SC-002. Ключ анализа — это заявление человека о том, что он изучает.
// Приложение не вправе его отменить. На живых данных таких случаев было 2 из 67.
test("SC-023-002: ключ анализа никогда не брендовый", () => {
  // имя совпадает со словом ключа целиком
  const m1 = brandMatcher(["Helmet", "Giro"], "bike helmet");
  assert.equal(m1("bike helmet"), false, "слово ключа не может быть именем бренда");
  assert.equal(m1("helmet"), false);
  assert.equal(m1("giro helmet"), true, "другое имя по-прежнему ловится");

  // имя совпадает со всем ключом
  const m2 = brandMatcher(["Bike Helmet"], "bike helmet");
  assert.equal(m2("bike helmet"), false, "фраза, равная ключу, не брендовая ни при каком списке");
});

// ИЗВЕСТНЫЙ ПРОБЕЛ, оставленный осознанно. Многословное имя, написанное человеком СЛИТНО
// («amazonbasics» вместо «amazon basics»), не ловится — ни прежним правилом, ни новым.
// Замер на живых данных: таких фраз 83, из них действующее правило помечает брендовыми 24
// (их ловит «голова» имени), а 59 не помечает вовсе. Ловить их — отдельное улучшение:
// оно ДОБАВИЛО бы признак 59 фразам, а эта работа обязана быть строго сужающей (инвариант SC-023-003).
// Тест закрепляет пробел числом, чтобы его не «починили» молча вместе с чем-нибудь другим.
test("spec 023: слитная запись многословного имени не ловится — известный пробел, не регрессия", () => {
  const m = brandMatcher(["Amazon Basics", "Ling's moment"], "bike helmet");
  assert.equal(m("amazon basics air conditioner"), true, "цепочкой слов — ловится");
  assert.equal(m("lings moment pillow"), true);
  assert.equal(m("amazonbasics air conditioner"), false, "слитно — не ловится, и это осознанно");
  // «голова» двухсловного имени по-прежнему работает, если она длиннее четырёх букв
  const h = brandMatcher(["Melorca Guilla"], "bike helmet");
  assert.equal(h("melorca pillow"), true, "голова имени отдельным словом");
});

// Разметка ставится в двух местах — при разборе файла и при смене ключа или списка имён.
// Оба обязаны идти через один матчер, иначе при следующей правке они разойдутся.
test("spec 023: разбор файла и переразметка дают одинаковый признак брендовой", () => {
  const brands = ["MET", "Giro"], core = "bike helmet";
  const c = parseCerebro(rows, { coreKeyword: core, brands });
  const again = annotateKeywords(c.keywords, { coreKeyword: core, brands });
  const diff = c.keywords.filter((k, i) => k.isBranded !== again[i].isBranded);
  assert.equal(diff.length, 0, "разбор и переразметка разошлись: " + diff.slice(0, 3).map((k) => k.phrase).join(", "));
});
