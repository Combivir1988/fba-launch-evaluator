// US1 (spec 019): концентрация ниши. Тесты написаны ДО реализации и обязаны упасть без неё.
import { test } from "node:test";
import assert from "node:assert/strict";
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
