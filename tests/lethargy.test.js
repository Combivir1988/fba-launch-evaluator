// US2 (spec 019): летаргия брендов. ВОРОТА 1 (SC-007) написаны ДО реализации и обязаны упасть без неё.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { competition, lethargyIndex, lethargyLabelOf } from "../shared/competition.js";
import { mergeThresholds } from "../shared/thresholds.js";
import { niche, balancedNiche, noReviewsNiche, deadListingNiche } from "./helpers/fixture-brands.js";

const TH = mergeThresholds(null);
const L = TH.lethargy;
const comp = (xray, inputs = {}) => competition({ xray, poe: null, inputs: { checklist: {}, ...inputs }, thresholds: TH });
const SAMPLE = JSON.parse(readFileSync(new URL("./fixtures/lethargy-sample.json", import.meta.url), "utf8"));

test("ВОРОТА 1 · SC-007: сбалансированный бренд даёт ровно 1,00 при любом размере доли", () => {
  // Единственный способ поймать расчёт, где к числителю и знаменателю прибавлены РАЗНЫЕ величины:
  // значения останутся правдоподобными, и иначе ошибка не всплывёт никогда (D7).
  for (const share of [0.01, 0.03, 0.10, 0.30]) {
    assert.equal(lethargyIndex(share, share, L.smooth), 1, `доля ${share}: индекс обязан быть ровно 1`);
  }
  // и то же самое на настоящем проходе по листингам, а не только на чистой функции
  for (const share of [0.01, 0.03, 0.10, 0.30]) {
    const b = comp(balancedNiche(share)).brands.find((x) => x.brand === "Balanced");
    assert.ok(Math.abs(b.lethargy - 1) < 1e-12, `доля ${share}: получено ${b.lethargy}`);
  }
});

test("ВОРОТА 1 · равенство держится при любом коэффициенте сглаживания", () => {
  // Если контракт соблюдён, значение коэффициента на «сбалансированный = 1» не влияет вовсе.
  for (const s of [0, 0.005, 0.01, 0.05, 0.2]) {
    for (const share of [0.01, 0.1, 0.5]) assert.equal(lethargyIndex(share, share, s), 1);
  }
});

test("T021 · контрольные значения таблицы-образца", () => {
  for (const b of SAMPLE.brands) {
    const got = lethargyIndex(b.reviewsShare, b.revenueShare, SAMPLE.smooth);
    assert.ok(Math.abs(got - b.lethargy) < 5e-5, `${b.brand}: ожидалось ${b.lethargy}, получено ${got.toFixed(4)}`);
    assert.equal(lethargyLabelOf(b.revenueShare, got, SAMPLE.thresholds), b.label, `${b.brand}: ярлык`);
  }
});

test("T021 · Zonkie: высокий индекс без денег ярлыка не даёт", () => {
  // Главная строка образца. Индекс 2,70 выше, чем у KMC (2,31), но доля выручки 5,9 % не дотягивает
  // до порога по деньгам. Если здесь окажется giant — порог по деньгам не работает (D8).
  const z = SAMPLE.brands.find((b) => b.brand === "Zonkie");
  const k = SAMPLE.brands.find((b) => b.brand === "KMC");
  assert.ok(z.lethargy > k.lethargy, "у Zonkie индекс выше");
  assert.equal(lethargyLabelOf(z.revenueShare, z.lethargy, SAMPLE.thresholds), "normal");
  assert.equal(lethargyLabelOf(k.revenueShare, k.lethargy, SAMPLE.thresholds), "giant");
});

test("D8 · мёртвый листинг гигантом не становится", () => {
  const byBrand = Object.fromEntries(comp(deadListingNiche()).brands.map((b) => [b.brand, b]));
  assert.ok(byBrand.Dead.lethargy > 5, "индекс у него огромный");
  assert.ok(byBrand.Dead.share < 0.02, "а денег почти нет");
  assert.equal(byBrand.Dead.lethargyLabel, "normal", "ярлык гиганта достаётся только тем, у кого есть что отнимать");
});

test("доля отзывов считается на том же наборе, что и доля выручки", () => {
  const r = comp(niche({ A: [[50_000, 300]], B: [[30_000, 600]], C: [[20_000, 100]] }));
  const by = Object.fromEntries(r.brands.map((b) => [b.brand, b]));
  assert.ok(Math.abs(by.B.reviewsShare - 0.6) < 1e-12, "600 из 1000 отзывов");
  assert.ok(Math.abs(by.B.share - 0.3) < 1e-12, "30 000 из 100 000 выручки");
  assert.equal(by.B.reviewsSum, 600);
  // (0.6 + 0.01) / (0.3 + 0.01) = 1.9677…
  assert.ok(Math.abs(by.B.lethargy - 0.61 / 0.31) < 1e-12);
  assert.equal(by.B.lethargyLabel, "tired", "деньги есть, индекс в пограничной полосе");
});

test("ни одного отзыва в нише — индекс не считается ни у кого, и это не ноль", () => {
  const r = comp(noReviewsNiche());
  for (const b of r.brands) {
    assert.equal(b.reviewsShare, null);
    assert.equal(b.lethargy, null);
    assert.equal(b.lethargyLabel, null);
  }
  assert.equal(r.lethargyRevenueShare, null, "долю денег у летаргичных тоже считать не из чего");
});

test("T027 · доля денег у летаргичных марок: порог по деньгам здесь не применяется", () => {
  // A: деньги 50 %, отзывы 10 % -> эффективен. B: деньги 10 %, отзывы 50 % -> летаргичен и крупен.
  // C: деньги 40 %, отзывы 40 % -> ровно сбалансирован.
  const r = comp(niche({ A: [[50_000, 100]], B: [[10_000, 500]], C: [[40_000, 400]] }));
  const by = Object.fromEntries(r.brands.map((b) => [b.brand, b]));
  assert.equal(by.B.lethargyLabel, "giant");
  assert.ok(Math.abs(by.C.lethargy - 1) < 1e-12);
  // в долю денег входит только B
  assert.ok(Math.abs(r.lethargyRevenueShare - 0.1) < 1e-12, `получено ${r.lethargyRevenueShare}`);
});

test("T028 · показатель различает ниши, а не одинаков у всех", () => {
  const spread = [
    comp(niche({ A: [[90_000, 100]], B: [[10_000, 50]] })).lethargyRevenueShare,
    comp(niche({ A: [[50_000, 900]], B: [[50_000, 100]] })).lethargyRevenueShare,
    comp(niche({ A: [[20_000, 800]], B: [[80_000, 200]] })).lethargyRevenueShare,
  ];
  assert.equal(new Set(spread).size, spread.length, `значения совпали: ${spread.join(", ")} — показатель ничего не различает`);
});

test("исключённые бренды и свой бренд не участвуют в летаргии", () => {
  const xray = niche({ Mine: [[50_000, 900]], A: [[25_000, 50]], B: [[25_000, 50]] });
  const r = comp(xray, { myBrand: "Mine", evaluateAsNewEntrant: false });
  assert.ok(!r.brands.some((b) => b.brand === "Mine"), "свой бренд — не барьер и не цель");
  for (const b of r.brands) assert.ok(Math.abs(b.lethargy - 1) < 1e-12, "оставшиеся двое ровно сбалансированы между собой");
});
