// Spec 021, ядро отбора кандидатов. Сети нет, «сейчас» приходит аргументом —
// иначе тесты зависели бы от дня запуска.
//
// ВОРОТА SC-003 (T005) написаны ДО реализации и обязаны падать на отборе с общим порогом.
// Общий порог просто выключил бы маленький источник, а именно в маленьких раньше всего видно новое.
import { test } from "node:test";
import assert from "node:assert/strict";
import { rankSample } from "../shared/idea-ranking.js";
import { mergeThresholds } from "../shared/thresholds.js";

const TH = mergeThresholds(null);
const NOW = Date.parse("2026-11-12T12:00:00Z");
const DAY = 86_400_000;

/** Элемент возрастом ageDays суток с показателем value. */
const item = (id, value, ageDays = 1) => ({
  externalId: String(id),
  url: "https://example.invalid/" + id,
  title: "item " + id,
  value,
  publishedAt: new Date(NOW - ageDays * DAY).toISOString(),
});

// Два раздела, различающиеся по аудитории примерно в сто раз.
// Обычные значения и один выброс — отношение выброса к медиане у обоих ОДИНАКОВО по построению.
const ORDINARY = [1000, 1200, 1400, 1500, 1600, 1700, 1800, 1900, 2000];
const channelSmall = [...ORDINARY.map((v, i) => item("s" + i, v)), item("s-spike", 9000)];
const channelBig = [...ORDINARY.map((v, i) => item("b" + i, v * 100)), item("b-spike", 900_000)];

const rank = (items, opts = {}) => rankSample(items, { now: NOW, thresholds: TH, ...opts });

test("ВОРОТА SC-003: кандидат появляется из КАЖДОГО раздела, как бы ни различалась аудитория", () => {
  const small = rank(channelSmall);
  const big = rank(channelBig);

  const passedOf = (r) => r.items.filter((i) => i.candidate).map((i) => i.externalId);
  assert.deepEqual(passedOf(small), ["s-spike"], "из маленького раздела кандидат обязан быть");
  assert.deepEqual(passedOf(big), ["b-spike"], "из большого раздела кандидат обязан быть");

  // фон у каждого свой, и он отличается в сто раз
  assert.equal(small.background, 1650);
  assert.equal(big.background, 165_000);

  // а отношение к собственному фону — одинаковое
  const ratioSmall = small.items.find((i) => i.externalId === "s-spike").ratio;
  const ratioBig = big.items.find((i) => i.externalId === "b-spike").ratio;
  assert.ok(Math.abs(ratioSmall - ratioBig) < 1e-9, `отношения разошлись: ${ratioSmall} и ${ratioBig}`);
});

test("ВОРОТА SC-003: общий порог на двух разделах сразу ВЫКЛЮЧАЕТ маленький — ради этого ворота и есть", () => {
  // Та же реализация, но выборка одна на оба раздела: это и есть «общий порог».
  const pooled = rank([...channelSmall, ...channelBig]);
  const fromSmall = pooled.items.filter((i) => i.candidate && i.externalId.startsWith("s"));

  assert.equal(fromSmall.length, 0,
    "на общей выборке маленький раздел не даёт никого — поэтому фон обязан считаться по разделу");
  assert.ok(pooled.items.some((i) => i.candidate && i.externalId.startsWith("b")),
    "большой раздел на общей выборке кандидатов даёт — перекос именно в эту сторону");
});

// ---------- T008: контрольные значения из contracts/ranking.md ----------

import {
  NOW as FNOW, controlSample, controlSamplePlusOutlier,
  noMetricItems, crowdfundingSample, staleItems,
} from "./helpers/fixture-ideas.js";

const rankF = (items, opts = {}) => rankSample(items, { now: FNOW, thresholds: TH, ...opts });

test("контрольная выборка: фон 3; при кратности 3 кандидат один, при 1,5 — два", () => {
  const base = rankF(controlSample());
  assert.equal(base.background, 3, "медиана выборки 1,1,2,2,3,3,4,5,30");
  assert.equal(base.seen, 9);
  assert.equal(base.passed, 1, "порог 9 проходит только 30");

  const soft = rankF(controlSample(), { thresholdMult: 1.5 });
  assert.equal(soft.passed, 2, "порог 4,5 проходят 5 и 30");
});

test("устойчивость медианы (D3): добавление элемента 3000 не сдвигает фон", () => {
  const r = rankF(controlSamplePlusOutlier());
  assert.equal(r.background, 3, "со средним порог вырос бы более чем в сто раз и не прошёл бы никто");
  assert.equal(r.passed, 2, "теперь проходят 30 и 3000");
});

// ---------- T009: правило отсутствия ----------

test("нет показателя или нет возраста — элемент НЕ кандидат и НЕ ноль", () => {
  const r = rankF([...controlSample(), ...noMetricItems()]);

  assert.equal(r.noMetric, 3, "три элемента без показателя считаются отдельно");
  assert.equal(r.seen, 12);
  // Подстановка `?? 0` сделала бы из них три нуля, и медиана двенадцати элементов стала бы 2.
  assert.equal(r.background, 3, "элементы без показателя в фон не входят");

  for (const id of ["no-value", "no-value-undef", "no-age"]) {
    const row = r.items.find((i) => i.externalId === id);
    assert.equal(row.metric, null, id + ": показателя нет, а не ноль");
    assert.equal(row.candidate, false, id + ": не кандидат");
  }
});

test("меньше minSample элементов в окне — отбор не делается и это сказано", () => {
  const r = rankF(controlSample().slice(0, 4));
  assert.equal(r.reason, "no_background");
  assert.equal(r.background, null);
  assert.equal(r.passed, 0);
  assert.equal(r.items.filter((i) => i.candidate).length, 0, "показывать всё подряд без фона запрещено");
});

test("больше половины раздела без движения — фон вырожден, сравнивать не с чем", () => {
  const zeros = Array.from({ length: 8 }, (_, i) => ({
    externalId: "z" + i, url: "https://example.invalid/z" + i, title: "z", value: 0,
    publishedAt: new Date(FNOW - 86_400_000).toISOString(),
  }));
  const r = rankF([...zeros, { externalId: "hit", url: "https://example.invalid/hit", title: "hit", value: 9000, publishedAt: new Date(FNOW - 86_400_000).toISOString() }]);
  assert.equal(r.reason, "background_zero");
  assert.equal(r.passed, 0, "«ещё слишком рано» — это не «вот что выделилось»");
});

test("элементы старше окна сопоставимости не входят в фон и не становятся кандидатами", () => {
  const r = rankF([...controlSample(), ...staleItems()]);
  assert.equal(r.background, 3, "старое в фон не берётся — иначе медиана считалась бы по смеси");
  assert.equal(r.outOfWindow, 3);
  for (const id of ["old-1", "old-2", "old-3"]) {
    const row = r.items.find((i) => i.externalId === id);
    assert.ok(row.ratio > TH.ideas.thresholdMult, id + ": по отношению к фону он высокий");
    assert.equal(row.candidate, false,
      id + ": и всё равно не кандидат — иначе лучший за всё время проходил бы каждые сутки до скончания века");
  }
});

// ---------- T010: особый случай краудфандинга ----------

test("краудфандинг: два условия, и второе — доля от цели", () => {
  const items = crowdfundingSample();
  const loose = rankF(items);
  const strict = rankF(items, { requireGoalRatio: true });

  assert.equal(loose.background, 4);
  assert.equal(loose.passed, 5, "по одной только скорости проходят пять: все с показателем 30");
  assert.equal(strict.passed, 2, "доля от цели отсекает троих из пяти");

  const pass = strict.items.filter((i) => i.candidate).map((i) => i.externalId).sort();
  assert.deepEqual(pass, ["k-rich", "k8"].sort());
});

test("краудфандинг: нулевая или отсутствующая цель делает второе условие невыполнимым", () => {
  const strict = rankF(crowdfundingSample(), { requireGoalRatio: true });
  for (const id of ["k-zero-goal", "k-no-goal"]) {
    const row = strict.items.find((i) => i.externalId === id);
    assert.equal(row.goalRatio, null, id + ": делить на ноль и получать «бесконечно успешный проект» нельзя");
    assert.equal(row.candidate, false, id);
    assert.ok(row.ratio >= TH.ideas.thresholdMult, id + ": по скорости он бы прошёл — отсекает именно второе условие");
  }
});

test("доля от цели к возрасту НЕ приводится — она про замысел, а не про темп", () => {
  const young = { externalId: "y", url: "https://example.invalid/y", title: "y", value: 100, pledged: 2000, goal: 1000, publishedAt: new Date(FNOW - 86_400_000).toISOString() };
  const old = { ...young, externalId: "o", publishedAt: new Date(FNOW - 30 * 86_400_000).toISOString() };
  const r = rankF([young, old, ...controlSample()], { requireGoalRatio: true });
  const a = r.items.find((i) => i.externalId === "y");
  const b = r.items.find((i) => i.externalId === "o");
  assert.equal(a.goalRatio, 2);
  assert.equal(b.goalRatio, 2, "возраст доли от цели не касается");
  assert.ok(a.metric > b.metric, "а скорость — касается");
});

// ---------- T047: пояснение словами ----------

import { explainCandidate } from "../shared/idea-ranking.js";

test("пояснение называет, на чём основано, и не оценивает пригодность к продаже", () => {
  const e = explainCandidate({
    ratio: 7.4, background: 120, metric: 888, daysHeld: 3, platforms: ["video", "crowdfunding"],
    snippet: "Складной стол для кемпинга с алюминиевой рамой, выдерживает 30 кг, складывается в чехол",
  });
  assert.ok(e.lines.join(" ").includes("7.4"), "названо отношение к фону");
  assert.ok(e.lines.some((l) => l.includes("3-е сутки")), "названа устойчивость");
  assert.ok(e.lines.some((l) => l.includes("Собранный текст")), "названо, что текст есть");
  assert.equal(e.thin, false);
  assert.ok(/замерено|построено/i.test(e.basis), "основание названо");
  assert.ok(/не вывод о пригодности/i.test(e.disclaimer));
  assert.ok(!/перспектив|хорош|стоит прод|выгодн/i.test(JSON.stringify(e)), "оценочных слов нет");
});

test("материала мало — система ГОВОРИТ об этом, а не сочиняет уверенный вывод", () => {
  const e = explainCandidate({ ratio: 5, background: 10, metric: 50, daysHeld: 1, snippet: "" });
  assert.equal(e.thin, true);
  assert.ok(/только название и числа/i.test(e.basis));
  assert.ok(!e.lines.some((l) => l.includes("Собранный текст")), "пустого текста в пояснении нет");
});

test("нет чисел — пояснение не выдумывает их", () => {
  const e = explainCandidate({ snippet: "" });
  assert.deepEqual(e.lines, []);
  assert.ok(e.basis, "но основание всё равно названо");
});
