import { test } from "node:test";
import assert from "node:assert/strict";
import { parseXray } from "../shared/parse-xray.js";
import { parseCerebro, suggestCluster } from "../shared/parse-cerebro.js";
import { parsePoe } from "../shared/parse-poe.js";
import { newAnalysis } from "../shared/analysis.js";
import { compute } from "../shared/compute.js";
import { readCsv, readJson, XRAY, CEREBRO, POE } from "./helpers.js";

function fullAnalysis() {
  const xray = parseXray(readCsv(XRAY));
  const brands = [...new Set(xray.asins.map((a) => a.brand))];
  const core = "sound deadening mat";
  const cerebro = parseCerebro(readCsv(CEREBRO), { coreKeyword: core, brands });
  const a = newAnalysis({ niche: "car sound deadening mat", coreKeyword: core });
  a.aggregates = { xray, cerebro };
  a.inputs.clusterKeywords = suggestCluster(cerebro.keywords, { coreKeyword: core });
  return a;
}

test("Критерий 1 на Xray + Cerebro: источники, статусы, N из 8", () => {
  const a = fullAnalysis();
  const R = compute(a);
  const c = R.criterion1.items;
  assert.equal(c["1a"].source, "xray");
  const manual = a.aggregates.xray.asins.reduce((s, x) => s + (x.asinRevenue ?? 0), 0);
  assert.equal(Math.round(c["1a"].value), Math.round(manual), "1a = Σ ASIN Revenue");
  assert.equal(c["1a"].status, manual >= 500000 ? "ok" : manual < 250000 ? "fail" : "warn");
  assert.equal(c["1b"].source, "xray");
  assert.ok(c["1b"].value > 0);
  assert.equal(c["1c"].source, "cerebro");
  assert.ok(c["1c"].value > 0);
  assert.equal(c["1e"].source, "xray");
  assert.equal(c["1e"].brand, "KILMAT", "лидер по выручке — KILMAT");
  assert.ok(c["1e"].value > 0.25, "KILMAT доминирует → 1e НЕ OK");
  assert.equal(c["1e"].status, "fail");
  assert.ok(c["1f"].value >= c["1e"].value);
  assert.equal(c["1g"].status, "na", "без POE сезонность — нет данных");
  assert.equal(c["1h"].status, "na");
  assert.equal(R.criterion1.okCount, Object.values(c).filter((i) => i.status === "ok").length);
  assert.equal(R.gate0.level, "full");
  assert.equal(R.competition.dominant, true);
  assert.equal(R.challenger.active, true);
  assert.equal(R.economics.pending, true, "COGS не введён → экономика pending");
  assert.ok(["rework", "no_go"].includes(R.verdict.ceiling), "без экономики потолок не выше «Доработка»");
});

test("Критерий 1 только по POE: прокси-пометки, сезонность и запуски", () => {
  const poe = parsePoe(readJson(POE));
  const a = newAnalysis({ niche: poe.meta.nicheTitle, coreKeyword: poe.meta.nicheTitle });
  a.aggregates = { poe };
  const R = compute(a);
  const c = R.criterion1.items;
  assert.equal(R.gate0.level, "poe_only");
  assert.equal(c["1a"].source, "proxy");
  assert.ok(Math.abs(c["1a"].value - 144705) < 100);
  assert.equal(c["1a"].status, "fail", "прокси $145k < $500k");
  assert.equal(c["1c"].source, "proxy");
  assert.ok(c["1c"].value > 3000, "SV ниши по POE / 12 явно выше 3k");
  assert.equal(c["1c"].status, "ok");
  assert.equal(c["1b"].source, "poe");
  assert.equal(c["1b"].status, "ok", "$31.57 ≥ $30");
  assert.equal(c["1g"].source, "poe");
  assert.ok(c["1g"].value > 0 && c["1g"].value < 1);
  assert.equal(c["1h"].source, "poe");
  assert.ok(Math.abs(c["1h"].value - 9 / 24) < 1e-9);
  assert.equal(c["1h"].status, "ok", "37.5 % ≥ 30 %");
  // spec 019: подпункт 1f меряет концентрацию ниши — сумму квадратов долей ВЫРУЧКИ брендов, которой в POE нет.
  // Прокси по долям кликов сознательно не заводим (решение господаря: HHI по POE — вне зоны), поэтому в режиме
  // «только POE» подпункт честно говорит «нет данных» вместо правдоподобного, но другого по смыслу числа.
  assert.equal(c["1f"].source, null);
  assert.equal(c["1f"].value, null);
  assert.equal(c["1f"].status, "na");
  // Сама доля топ-5 брендов по кликам никуда не делась: её по-прежнему считает конкуренция, её читает критерий 5.
  assert.ok(Math.abs(R.competition.top5Share - 0.60166553) < 1e-6, "top5BrandsClickShareT360, не products");
  assert.equal(R.criterion1.proxyCount, 2);
  assert.ok(R.verdict.reasons.some((r) => r.includes("Gate 0")));
  assert.equal(R.traffic.poeConcentration.flags.adWar, false);
  assert.equal(R.competition.source, "poe");
  assert.equal(R.priceSegments.segments.length, 3);
});

test("Ручное переопределение метрики побеждает и помечается", () => {
  const a = fullAnalysis();
  a.inputs.manualOverrides = { "1g": { value: 0.2, note: "по скрину Cerebro" } };
  const R = compute(a);
  assert.equal(R.criterion1.items["1g"].source, "manual");
  assert.equal(R.criterion1.items["1g"].status, "ok");
});

test("Xray + POE одной ниши: сверка источников считается", () => {
  const poe = parsePoe(readJson(POE));
  const a = fullAnalysis();
  a.aggregates.poe = poe; // разные ниши намеренно — проверяем только механику расхождения
  const R = compute(a);
  assert.ok(R.reconciliation.length >= 2);
  assert.ok(R.reconciliation.every((x) => ["noise", "borderline", "conflict"].includes(x.level)));
  assert.ok(typeof R.criterion1.items["1a"].proxyDelta === "number");
});

test("Amazon как продавец: авто по Xray, «нет» пользователя переопределяет, «да» включает", () => {
  const a = fullAnalysis();
  const auto = compute(a).competition;
  assert.equal(auto.amazonSellsSource, auto.amazonSells ? "xray" : "auto");
  a.inputs.checklist.amazonSells = "no"; const no = compute(a).competition;
  assert.equal(no.amazonSells, false); assert.equal(no.amazonSellsSource, "user");
  a.inputs.checklist.amazonSells = "yes"; const yes = compute(a);
  assert.equal(yes.competition.amazonSells, true); assert.equal(yes.criterion1.items["1e"].status, "fail");
  assert.match(yes.criterion1.items["1e"].note, /вручную/);
});

// ---------- spec 022, ВОРОТА SC-001: подпункт 1d судится по МЕДИАНЕ ----------

import { criterion1 } from "../shared/criterion1.js";
import { mergeThresholds } from "../shared/thresholds.js";
import { REVIEWS_AGREE_OK, REVIEWS_AGREE_FAIL, REVIEWS_SKEWED_WARN, REVIEWS_SKEWED_OK } from "./helpers/reviews-fixture.js";

const TH022 = mergeThresholds(null);
const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
const median022 = (a) => { const s = [...a].sort((x, y) => x - y); return s.length % 2 ? s[s.length >> 1] : (s[(s.length >> 1) - 1] + s[s.length >> 1]) / 2; };

/** Минимальный контекст: подпункт 1d читает только competition.reviewBarrier. */
const c1of = (reviews, overrides = {}) => criterion1({
  xray: null, cerebro: null, poe: null, traffic: null, thresholds: TH022,
  inputs: { manualOverrides: overrides },
  competition: { source: "xray", reviewBarrier: { avg: mean(reviews), median: median022(reviews), leaderReviews: Math.max(...reviews), tier: null } },
}).items["1d"];

test("ВОРОТА SC-001: статус подпункта «Отзывы по нише» определяет МЕДИАНА", () => {
  // Среднее валит, медиана нет — статус следует медиане.
  const warn = c1of(REVIEWS_SKEWED_WARN);          // медиана 900, среднее 14 270
  assert.equal(warn.status, "warn", "среднее 14 270 дало бы fail; решать должна медиана 900");

  const ok = c1of(REVIEWS_SKEWED_OK);              // медиана 130, среднее 7 590
  assert.equal(ok.status, "ok", "среднее 7 590 дало бы fail; медиана 130 проходит с запасом");

  // Среднее по-прежнему показывается как число — его не прячут.
  assert.equal(Math.round(warn.value), 14270);
  assert.equal(warn.median, 900);
  // И видно, какая величина решила.
  assert.equal(warn.decidedBy, "median");
});

test("ВОРОТА SC-001: где медиана и среднее согласны, не меняется НИЧЕГО", () => {
  // Это доказательство, что затронуто только то, что должно быть затронуто.
  assert.equal(c1of(REVIEWS_AGREE_OK).status, "ok", "медиана 200 = среднее 200");
  assert.equal(c1of(REVIEWS_AGREE_FAIL).status, "fail", "медиана 2000 = среднее 2000");
});

test("SC-001: правило отсутствия — ноль отзывов и отсутствие данных это разное", () => {
  const none = criterion1({
    xray: null, cerebro: null, poe: null, traffic: null, thresholds: TH022, inputs: { manualOverrides: {} },
    competition: { source: "xray", reviewBarrier: { avg: null, median: null, leaderReviews: null, tier: null } },
  }).items["1d"];
  assert.equal(none.value, null);
  assert.equal(none.status, "na", "данных нет — это не «ноль отзывов»");

  // Медианы нет, среднее есть — судим по тому, что есть, и говорим об этом.
  const onlyAvg = criterion1({
    xray: null, cerebro: null, poe: null, traffic: null, thresholds: TH022, inputs: { manualOverrides: {} },
    competition: { source: "xray", reviewBarrier: { avg: 150, median: null, leaderReviews: 150, tier: null } },
  }).items["1d"];
  assert.equal(onlyAvg.status, "ok");
  assert.equal(onlyAvg.decidedBy, "value", "медианы нет — решало среднее, и это названо");
});

test("SC-001: введённое вручную значение главнее медианы", () => {
  const it = c1of(REVIEWS_SKEWED_OK, { "1d": { value: 5000 } });
  assert.equal(it.value, 5000);
  assert.equal(it.status, "fail", "ручной ввод решает сам");
  assert.equal(it.decidedBy, "value");
});
