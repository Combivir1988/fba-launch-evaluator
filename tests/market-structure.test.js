// US4 (spec 020): вывод о структуре рынка. Направление — ТОЛЬКО из отчёта с историей;
// уровень концентрации — из отчёта по листингам. Без истории вывод не делается.
import { test } from "node:test";
import assert from "node:assert/strict";
import { marketStructure } from "../shared/market-structure.js";
import { mergeThresholds } from "../shared/thresholds.js";

const TH = mergeThresholds(null);
/** POE с историей: у каждого показателя есть current / qoq / yoy. */
const poe = (svGrowth, top5now, top5yoy) => ({
  nicheSummary: { searchVolumeGrowthT360: svGrowth },
  launchPotential: { top5BrandsClickShareT360: { current: top5now, qoq: top5now, yoy: top5yoy } },
});
const ms = (p, hhi) => marketStructure({ poe: p, competition: { hhi } }, TH);

test("спрос растёт, концентрация падает — есть место для входа", () => {
  const r = ms(poe(0.35, 0.40, 0.55), 1200);
  assert.equal(r.verdict, "room");
  assert.ok(r.demandDirection.value > 0);
  assert.ok(r.concentrationDirection.value < 0, "доля топ-5 снизилась за год");
  assert.equal(r.concentrationLevel, 1200);
});

test("спрос растёт и концентрация растёт — лидеров труднее подвинуть", () => {
  const r = ms(poe(0.30, 0.62, 0.48), 2800);
  assert.equal(r.verdict, "consolidating");
});

test("сильная фрагментация названа отдельно", () => {
  const r = ms(poe(0.02, 0.30, 0.30), 700);
  assert.equal(r.verdict, "fragmented");
});

test("спрос падает — и это сказано, а не замаскировано", () => {
  const r = ms(poe(-0.25, 0.50, 0.50), 2000);
  assert.equal(r.verdict, "shrinking");
});

test("без отчёта с историей вывод НЕ делается", () => {
  const r = marketStructure({ poe: null, competition: { hhi: 1800 } }, TH);
  assert.equal(r.verdict, null, "направления без истории не существует");
  assert.equal(r.demandDirection, null);
  assert.equal(r.concentrationDirection, null);
  assert.equal(r.concentrationLevel, 1800, "уровень из отчёта по листингам остаётся");
  assert.ok(r.note, "сказано, почему вывода нет");
});

test("история есть, но значения за год отсутствуют — вывода тоже нет", () => {
  const p = poe(0.3, 0.4, null);
  const r = ms(p, 1500);
  assert.equal(r.verdict, null);
  assert.ok(r.note);
});

test("нет отчёта по листингам — уровень неизвестен, но направление считается", () => {
  const r = marketStructure({ poe: poe(0.3, 0.4, 0.55), competition: { hhi: null } }, TH);
  assert.equal(r.concentrationLevel, null);
  assert.ok(r.verdict, "направление от уровня не зависит");
});

test("под выводом названы все числа, из которых он получен", () => {
  const r = ms(poe(0.35, 0.40, 0.55), 1200);
  assert.ok(r.demandDirection.label && typeof r.demandDirection.value === "number");
  assert.ok(r.concentrationDirection.now !== undefined && r.concentrationDirection.yearAgo !== undefined);
  assert.ok(r.text && r.text.length > 20, "вывод сформулирован словами");
});

test("несколько ниш POE: направление берётся по числу брендов и помечено как замена", () => {
  // merge-poe.js обнуляет историю долей кликов при объединении ниш: доли двух разных ниш
  // берутся от разных знаменателей и не складываются. Но число брендов складывается честно.
  const p = {
    nicheSummary: { searchVolumeGrowthT360: 1.3 },
    launchPotential: {
      top5BrandsClickShareT360: { current: 0.54, qoq: null, yoy: null, recomputed: true },
      brandCountT360: { current: 26, qoq: 23, yoy: 31 },
    },
  };
  const r = marketStructure({ poe: p, competition: { hhi: 2100 } }, TH);
  assert.ok(r.verdict, "вывод обязан быть: данные для направления есть, просто другие");
  assert.equal(r.concentrationDirection.proxy, true, "замена помечена");
  assert.equal(r.concentrationDirection.proxyOf, "число брендов");
  assert.match(r.concentrationDirection.reason, /несколько ниш POE/);
  assert.equal(r.concentrationDirection.now, 26);
  assert.equal(r.concentrationDirection.yearAgo, 31);
  assert.equal(r.verdict, "consolidating", "брендов стало меньше при растущем спросе");
});

test("нет ни долей за год, ни истории числа брендов — вывода нет, и причина названа точно", () => {
  const p = {
    nicheSummary: { searchVolumeGrowthT360: 1.3 },
    launchPotential: { top5BrandsClickShareT360: { current: 0.54, qoq: null, yoy: null, recomputed: true } },
  };
  const r = marketStructure({ poe: p, competition: { hhi: 2100 } }, TH);
  assert.equal(r.verdict, null);
  assert.match(r.note, /несколько ниш POE/, "причина настоящая, а не «в отчёте нет значений»");
});

test("обычный случай замену не включает", () => {
  const r = ms(poe(0.35, 0.40, 0.55), 1200);
  assert.equal(r.concentrationDirection.proxy, false);
});

test("спрос растёт, а расстановка сил стоит — это НЕ «ничего не меняется»", () => {
  const r = ms(poe(1.3, 0.50, 0.50), 2100);
  assert.equal(r.verdict, "growing_flat");
  assert.match(r.text, /[Сс]прос растёт/, "про растущий спрос обязано быть сказано прямо");
  assert.doesNotMatch(r.text, /^Спрос и расстановка сил почти не меняются/, "это было бы неправдой");
});

test("а вот когда и спрос стоит — тогда действительно steady", () => {
  const r = ms(poe(0.01, 0.50, 0.50), 2100);
  assert.equal(r.verdict, "steady");
});
