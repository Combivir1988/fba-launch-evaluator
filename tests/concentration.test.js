// US1 (spec 019): концентрация ниши. Тесты написаны ДО реализации и обязаны упасть без неё.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripNew } from "./helpers/results-hash.js";
import { compute } from "../shared/compute.js";
import { parseXray } from "../shared/parse-xray.js";
import { parseCerebro, suggestCluster } from "../shared/parse-cerebro.js";
import { newAnalysis } from "../shared/analysis.js";
import { readCsv, XRAY, CEREBRO } from "./helpers.js";
/** Полный анализ на живых фикстурах — на нём и считается отпечаток в остальных тестах. */
function fullAnalysisForHash() {
  const xray = parseXray(readCsv(XRAY));
  const brands = [...new Set(xray.asins.map((a) => a.brand))];
  const core = "sound deadening mat";
  const cerebro = parseCerebro(readCsv(CEREBRO), { coreKeyword: core, brands });
  const a = newAnalysis({ niche: "car sound deadening mat", coreKeyword: core });
  a.aggregates = { xray, cerebro };
  a.inputs.clusterKeywords = suggestCluster(cerebro.keywords, { coreKeyword: core });
  Object.assign(a.inputs, { price: 24.99, cogs: 4.37 });
  return a;
}

import { competition } from "../shared/competition.js";
import { criterion1 } from "../shared/criterion1.js";
import { DEFAULT_THRESHOLDS, mergeThresholds } from "../shared/thresholds.js";
import { niche, singleBrandNiche, fourEqualNiche, threeListingsNiche } from "./helpers/fixture-brands.js";

const TH = mergeThresholds(null);
const comp = (xray, inputs = {}) => competition({ xray, poe: null, inputs: { checklist: {}, ...inputs }, thresholds: TH });

test("T007 · формула: сумма квадратов долей выручки брендов в процентах", () => {
  // 50 / 30 / 20 процентов -> 2500 + 900 + 400
  const r = comp(niche({ A: [[50_000, 10]], B: [[30_000, 10]], C: [[20_000, 10]] }));
  assert.equal(Math.round(r.hhi), 3800);
});

test("T007 · один бренд держит всё — потолок шкалы", () => {
  assert.equal(Math.round(comp(singleBrandNiche()).hhi), 10_000);
});

test("T007 · четыре равных бренда дают ровно порог «концентрирован»", () => {
  const r = comp(fourEqualNiche());
  assert.equal(Math.round(r.hhi), 2500);
  // 2500 — это уже fail: порог включительный («не меньше hhiFail»)
  const c1 = criterion1({ xray: fourEqualNiche(), poe: null, cerebro: null, inputs: { checklist: {} }, thresholds: TH, competition: r, traffic: null });
  assert.equal(c1.items["1f"].status, "fail");
});

test("T007 · SC-008: считается на том же виде, что и остальная конкуренция", () => {
  // Дорогой бренд держит половину ниши, но в коридор $10–$30 не попадает.
  const xray = niche({ Cheap1: [[25_000, 10]], Cheap2: [[25_000, 10]], Pricey: [[50_000, 10]] });
  for (const a of xray.asins) a.price = a.brand === "Pricey" ? 99 : 20;

  const whole = comp(xray);
  const band = comp({ ...xray, asins: xray.asins.filter((a) => a.price >= 10 && a.price <= 30) });

  assert.equal(Math.round(whole.hhi), 3750, "по всей нише: 25² + 25² + 50²");
  assert.equal(Math.round(band.hhi), 5000, "в коридоре остались двое по половине: 50² + 50²");
  assert.equal(band.listingCount, 2, "размер выборки — это выборка вида, а не всей ниши");
  assert.notEqual(whole.hhi, band.hhi, "иначе показатель считается мимо вида");
});

test("T007 · исключённые бренды и режим «я уже в нише» вычтены", () => {
  const xray = niche({ Mine: [[50_000, 10]], A: [[25_000, 10]], B: [[25_000, 10]] });
  const full = comp(xray);
  const excluded = comp(xray, { excludedBrands: ["Mine"] });
  const incumbent = comp(xray, { myBrand: "Mine", evaluateAsNewEntrant: false });

  assert.equal(Math.round(full.hhi), 3750);
  assert.equal(Math.round(excluded.hhi), 5000, "без исключённого бренда остаются двое по половине");
  assert.equal(Math.round(incumbent.hhi), 5000, "свой бренд — не барьер, из концентрации он уходит");
});

test("T008 · поясняющие числа: доля топ-5 листингов и размер выборки", () => {
  // Пять листингов из десяти держат 60 % денег.
  const xray = niche({
    A: [[20_000, 10], [10_000, 10]], B: [[15_000, 10], [5_000, 10]], C: [[10_000, 10], [5_000, 10]],
    D: [[10_000, 10], [5_000, 10]], E: [[10_000, 10], [10_000, 10]],
  });
  const r = comp(xray);
  assert.equal(r.listingCount, 10);
  // пять крупнейших: 20 + 15 + 10 + 10 + 10 = 65 из 100
  assert.ok(Math.abs(r.top5ListingShare - 0.65) < 1e-9, `получено ${r.top5ListingShare}`);
});

test("T008 · меньше пяти листингов: доля равна единице, и рядом обязан быть размер выборки", () => {
  const r = comp(threeListingsNiche());
  assert.equal(r.top5ListingShare, 1, "все листинги и есть топ-5");
  assert.equal(r.listingCount, 3, "без этого числа первая величина вводит в заблуждение");
});

test("T008 · нет данных Xray — значение null, а не ноль", () => {
  const r = competition({ xray: null, poe: null, inputs: { checklist: {} }, thresholds: TH });
  assert.equal(r.hhi, null);
  assert.equal(r.top5ListingShare, null);
  assert.equal(r.listingCount, null);
});

test("T010 · подпункт 1f берёт значение и статус из концентрации", () => {
  const mk = (spec) => {
    const xray = niche(spec);
    const c = comp(xray);
    return { c, c1: criterion1({ xray, poe: null, cerebro: null, inputs: { checklist: {} }, thresholds: TH, competition: c, traffic: null }) };
  };
  // раздроблена: десять равных по 10 % -> 1000
  const frag = mk(Object.fromEntries("ABCDEFGHIJ".split("").map((b) => [b, [[10_000, 10]]])));
  assert.equal(Math.round(frag.c.hhi), 1000);
  assert.equal(frag.c1.items["1f"].value, frag.c.hhi, "значение подпункта — это концентрация");
  assert.equal(frag.c1.items["1f"].status, "ok");

  // умеренная: 30/30/20/20 -> 900+900+400+400 = 2600 ... берём мягче
  const mid = mk({ A: [[30_000, 10]], B: [[25_000, 10]], C: [[25_000, 10]], D: [[20_000, 10]] });
  assert.equal(Math.round(mid.c.hhi), 2550);
  assert.equal(mid.c1.items["1f"].status, "fail");

  const warn = mk({ A: [[25_000, 10]], B: [[25_000, 10]], C: [[25_000, 10]], D: [[13_000, 10]], E: [[12_000, 10]] });
  assert.ok(warn.c.hhi >= TH.criterion1.hhiOk && warn.c.hhi < TH.criterion1.hhiFail, `hhi ${warn.c.hhi} должен быть в пограничной полосе`);
  assert.equal(warn.c1.items["1f"].status, "warn");
});

test("T010 · поясняющие числа доехали до подпункта", () => {
  const xray = threeListingsNiche();
  const c = comp(xray);
  const c1 = criterion1({ xray, poe: null, cerebro: null, inputs: { checklist: {} }, thresholds: TH, competition: c, traffic: null });
  assert.equal(c1.items["1f"].extra.listingCount, 3);
  assert.equal(c1.items["1f"].extra.top5ListingShare, 1);
  assert.match(c1.items["1f"].threshold, /раздроблена/, "описание порога обязано смениться вместе с единицей");
  assert.equal(c1.items["1f"].unit, "", "единица больше не процент");
});

test("D4 · прежняя доля топ-5 брендов осталась живой — её читает критерий 5", () => {
  const r = comp(niche({ A: [[50_000, 10]], B: [[25_000, 10]], C: [[25_000, 10]] }));
  assert.equal(r.top5Share, 1, "три бренда — это и есть топ-5");
  assert.equal(typeof r.brandsOver10pct, "number");
  assert.equal(DEFAULT_THRESHOLDS.challenger.top5Ok, 0.30, "пороги критерия 5 не трогаем");
});

// ---------- spec 022, ВОРОТА SC-002: барьер меряется стоимостью входа ----------

import { effectiveReviewBarrier } from "../shared/competition.js";
import { MOAT_CASES, MOAT_NO_COHORT } from "./helpers/reviews-fixture.js";

const MOAT_TH = mergeThresholds(null).reviewsMoat;

test("ВОРОТА SC-002: уровень барьера считается по МЕДИАНЕ отзывов когорты", () => {
  for (const c of MOAT_CASES) {
    const r = effectiveReviewBarrier({ leaderReviews: c.leader, cohortReviewMedian: c.median }, MOAT_TH);
    assert.equal(r.tier, c.expect, `${c.label}: лидер ${c.leader}, медиана когорты ${c.median}`);
    assert.equal(r.basis, "cohort");
    assert.equal(r.leaderReviews, c.leader, "число лидера никуда не девается");
    assert.equal(r.cohortReviewMedian, c.median);
  }
});

test("ВОРОТА SC-002: пересчёт НЕ обязан всегда смягчать", () => {
  // Эти два случая — причина, по которой правило «во сколько раз ниже лидера» было отвергнуто.
  const byRatio = MOAT_CASES.find((c) => c.leader === 40_981);
  assert.equal(byRatio.median / byRatio.leader < 0.05, true, "по отношению к лидеру это 3,6 %");
  assert.equal(effectiveReviewBarrier({ leaderReviews: byRatio.leader, cohortReviewMedian: byRatio.median }, MOAT_TH).tier,
    "medium", "и всё равно не «пробиваем»: вход стоил больше тысячи отзывов");

  const confirms = MOAT_CASES.find((c) => c.leader === 4203);
  assert.equal(effectiveReviewBarrier({ leaderReviews: confirms.leader, cohortReviewMedian: confirms.median }, MOAT_TH).tier,
    "moat", "когорта ПОДТВЕРЖДАЕТ барьер");
});

test("ВОРОТА SC-002: когорты нет — уровень по лидеру, и это названо", () => {
  const r = effectiveReviewBarrier({ leaderReviews: MOAT_NO_COHORT.leader, cohortReviewMedian: null }, MOAT_TH);
  assert.equal(r.tier, "moat");
  assert.equal(r.basis, "leader", "«нечем опровергнуть» и «барьер подтверждён» — разные вещи");
  assert.equal(r.cohortReviewMedian, null);
  // Замер 2026-11-14: таких анализов 25 из 43.
});

test("SC-002: новых порогов не вводится — шкала та же, что у сырого уровня", () => {
  // Границы 500 / 2000 берутся из reviewsMoat и ничем не подменяются.
  assert.equal(effectiveReviewBarrier({ leaderReviews: 9999, cohortReviewMedian: 499 }, MOAT_TH).tier, "breakable");
  assert.equal(effectiveReviewBarrier({ leaderReviews: 9999, cohortReviewMedian: 500 }, MOAT_TH).tier, "medium");
  assert.equal(effectiveReviewBarrier({ leaderReviews: 9999, cohortReviewMedian: 2000 }, MOAT_TH).tier, "medium");
  assert.equal(effectiveReviewBarrier({ leaderReviews: 9999, cohortReviewMedian: 2001 }, MOAT_TH).tier, "moat");
});

test("SC-002: нет ни лидера, ни когорты — уровня нет, а не «пробиваем»", () => {
  const r = effectiveReviewBarrier({ leaderReviews: null, cohortReviewMedian: null }, MOAT_TH);
  assert.equal(r.tier, null, "отсутствие данных не превращается в вывод");
  assert.equal(r.basis, "leader");
});

test("spec 022: критерий 5 не тронут — он читает top5Share, а не барьер отзывов", () => {
  // Сосед опасный: правка «заодно» утащила бы его за собой, и это заметили бы не сразу.
  const src = readFileSync(new URL("../shared/challenger.js", import.meta.url), "utf8");
  assert.ok(!/reviewBarrier|reviewBarrierEffective/.test(src),
    "challenger.js стал читать барьер отзывов — критерий 5 про другое");
  assert.ok(/top5Share/.test(src), "а top5Share он читать должен");
});

test("spec 022: Scorecard снимает баллы по ДЕЙСТВУЮЩЕМУ уровню, а не по сырому", () => {
  const sc = readFileSync(new URL("../shared/scorecard.js", import.meta.url), "utf8");
  assert.ok(/reviewBarrierEffective/.test(sc),
    "Scorecard считает по лидеру, а на экране показано другое — два ответа об одной нише");
});

test("ВОРОТА SC-003: кроме статуса 1d и его прямых следствий не сдвинулось НИЧЕГО", () => {
  // Хэш отвечает «совпало / не совпало» и не говорит, ЧТО разошлось. Эти ворота отвечают именно на это:
  // они сравнивают два расчёта — по медиане и по среднему — и перечисляют все различия поимённо.
  // Разрешено ровно четыре: сам статус 1d и то, что из него механически следует.
  const base = fullAnalysisForHash();
  const byMedian = stripNew(compute(base));
  const byMean = stripNew(compute(base));
  // воспроизводим прежнее правило на уже посчитанном результате: статус 1d по среднему
  const it = byMean.criterion1.items["1d"];
  const t = mergeThresholds(null).criterion1;
  it.status = it.value < t.reviewsOk ? "ok" : it.value > t.reviewsFail ? "fail" : "warn";
  byMean.criterion1.redItems = Object.entries(byMean.criterion1.items).filter(([, x]) => x.status === "fail").map(([k]) => k);
  byMean.criterion1.failCount = byMean.criterion1.redItems.length;

  const diffs = [];
  const walk = (a, b, path) => {
    if (a === null || b === null || typeof a !== "object" || typeof b !== "object") {
      if (JSON.stringify(a) !== JSON.stringify(b)) diffs.push(path);
      return;
    }
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) walk(a[k], b[k], path ? path + "." + k : k);
  };
  walk(byMean, byMedian, "");

  const allowed = ["criterion1.items.1d.status", "criterion1.items.1d.note", "criterion1.failCount"];
  const unexpected = diffs.filter((d) => !allowed.some((a) => d.startsWith(a)) && !d.startsWith("criterion1.redItems"));
  assert.deepEqual(unexpected, [], "сдвинулось что-то помимо 1d и его следствий: " + unexpected.join(", "));
  assert.ok(diffs.some((d) => d === "criterion1.items.1d.status"), "а сам статус 1d обязан был измениться — иначе проверяем не то");
});
