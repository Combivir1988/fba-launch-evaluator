// Сводка по всем анализам (spec 018). Проверка SC-002: цифры раздела обязаны совпадать с эталонным
// пайплайном .data/stats/, снятым на живых данных 2026-11-02.
//
// Фикстура tests/fixtures/stats-outcomes.json — те же 65 итогов, но обезличенные: названия ниш в публичный
// репозиторий не едут, они заменены на «ниша NN». На цифры это не влияет: сводка названий не считает.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { summarize, CAT, DET } from "../shared/stats-summary.js";

const read = (n) => JSON.parse(readFileSync(new URL(`./fixtures/${n}`, import.meta.url), "utf8"));
const ITEMS = read("stats-outcomes.json");
const REF = read("stats-reference.json");
const S = summarize(ITEMS);
// Порядок внутри одинакового счёта у эталонного скрипта случайный (как легли ключи Map), у нас — по алфавиту.
// SC-002 про числа, а не про порядок: сравниваем, приведя обе стороны к одному порядку.
const norm = (a) => [...a].sort((x, y) => y.count - x.count || String(x.label).localeCompare(String(y.label)));

test("SC-002: вердикты и расхождение сохранённого с пересчитанным", () => {
  assert.equal(S.summary.n, REF.n);
  assert.deepEqual(S.summary.verdicts, REF.verdicts);
  assert.equal(S.mismatch.count, REF.changed, "17 анализов на 2026-11-02 считаются сегодня иначе, чем записано у них в results");
});

test("SC-002: решающая причина — по категориям и подробно по гейтам (FR-015)", () => {
  assert.deepEqual(norm(S.summary.decisiveCat), norm(REF.decisiveCat));
  assert.deepEqual(norm(S.summary.decisiveDet), norm(REF.decisiveDet));
  const sum = S.summary.decisiveCat.reduce((a, b) => a + b.count, 0);
  assert.equal(sum, S.summary.n, "решающая причина у анализа ровно одна — категории обязаны давать в сумме 100 %");
  assert.ok(!S.summary.decisiveCat.some((d) => d.label === "Прочее"), "появилась причина без категории — см. tests/stats-guard.test.js");
});

test("SC-002: «проблема есть вообще» — другой срез, сумма больше 100 % (FR-016)", () => {
  assert.deepEqual(norm(S.summary.freqCat), norm(REF.freqCat));
  assert.deepEqual(norm(S.summary.freqOne), norm(REF.freqOne));
  const sum = S.summary.freqCat.reduce((a, b) => a + b.count, 0);
  assert.ok(sum > S.summary.n, "у ниши бывает несколько проблем сразу — иначе срез повторял бы решающую причину");
  const dec = new Map(S.summary.decisiveCat.map((d) => [d.label, d.count]));
  for (const f of S.summary.freqCat) if (dec.has(f.label)) assert.ok(f.count >= dec.get(f.label), `${f.label}: «есть вообще» не может быть реже, чем «решающая»`);
});

test("SC-002: Критерий 1 по восьми подпунктам (FR-017)", () => {
  assert.deepEqual(S.summary.c1rows, REF.c1rows);
  assert.equal(Math.round(S.summary.c1avg * 10) / 10, Math.round(REF.c1avg * 10) / 10);
  assert.equal(S.summary.c1pass, REF.c1pass);
  for (const r of S.summary.c1rows) assert.equal(r.fail + r.warn + r.na + r.ok, S.summary.n, `${r.key}: сумма состояний не равна базе`);
});

test("SC-002: экономика по гейтам, решётка критериев, Scorecard (FR-018…FR-020)", () => {
  assert.deepEqual(S.summary.eco, REF.eco);
  assert.equal(S.summary.eco.total + S.summary.eco.noCogs, S.summary.n, "без введённого COGS экономика не считается — это отдельное число, а не ноль");
  assert.deepEqual(S.summary.chrows, REF.chrows);
  assert.deepEqual(S.summary.scorecard, REF.scorecard);
});

test("строки ниш: вердикт, причина, расхождение — и ни слова об авторе (FR-022, FR-023)", () => {
  assert.equal(S.rows.length, REF.n);
  const order = { "No-Go": 3, "Доработка": 2, "Go, условно": 1, "Go": 0 };
  for (let i = 1; i < S.rows.length; i++) assert.ok(order[S.rows[i - 1].verdict] <= order[S.rows[i].verdict], "строки идут от лучшего вердикта к худшему");
  assert.equal(S.rows.filter((r) => r.changed).length, REF.changed);
  for (const r of S.rows.filter((r) => r.changed)) assert.ok(r.was && r.was !== r.verdict, "у изменившегося вердикта показан прежний");
  const keys = new Set(S.rows.flatMap((r) => Object.keys(r)));
  for (const forbidden of ["author", "createdBy", "updatedBy", "by", "user"]) assert.ok(!keys.has(forbidden), `в строке есть поле «${forbidden}» — раздел отвечает про ниши, а не оценивает людей`);
});

test("крайние случаи: пустой набор и набор из одного итога", () => {
  const e = summarize([]);
  assert.equal(e.summary.n, 0);
  assert.equal(e.summary.c1avg, 0, "деления на ноль нет");
  assert.equal(e.summary.scorecard.avg, 0);
  assert.deepEqual(e.summary.decisiveCat, []);
  assert.deepEqual(e.rows, []);
  assert.equal(e.mismatch.count, 0);

  const one = summarize([ITEMS[0]]);
  assert.equal(one.summary.n, 1);
  assert.equal(one.summary.verdicts.reduce((a, b) => a + b.count, 0), 1);
  for (const r of one.summary.c1rows) assert.equal(r.fail + r.warn + r.na + r.ok, 1);
});

test("карты категорий покрывают весь закрытый набор решающих гейтов", () => {
  for (const l of Object.keys(CAT)) assert.ok(DET[l], `«${l}» есть в CAT, но нет в DET`);
});

test("US5: срез «пороги, которые ничего не различают» ловит 1f, 1g и критерий 7 (FR-024)", () => {
  const b = S.summary.blind;
  const by = Object.fromEntries(b.map((x) => [x.key + "/" + x.kind, x]));
  // Фикстура — ЗАМОРОЖЕННЫЙ снимок до spec 019: тогда 1f мерил долю топ-5 брендов и был зелёным в 1 нише из 65.
  // Именно это наблюдение и породило spec 019; здесь оно проверяет сам срез, а не текущее состояние методики.
  assert.ok(by["1f/Критерий 1"], "1f зелёный в 1 анализе из 65 — порог его фактически требует вместе со всеми");
  assert.equal(by["1f/Критерий 1"].greenIn, 1);
  assert.equal(by["1f/Критерий 1"].of, S.summary.n);
  assert.ok(by["1g/Критерий 1"], "1g — тот же случай");
  const seven = by["7/Критерии 1–8"];
  assert.ok(seven, "критерий 7 не заполнен ни разу");
  assert.equal(seven.na, S.summary.n);
  assert.match(seven.why, /почти никто не заполняет/, "диагноз другой: не «порог строг», а «показатель не вводят»");

  // нормально работающий подпункт в список не попадает
  const working = S.summary.c1rows.find((r) => r.ok > S.summary.n * 0.1 && r.ok < S.summary.n * 0.9);
  assert.ok(working, "в эталоне есть подпункт, который что-то различает");
  assert.ok(!b.some((x) => x.key === working.key && x.kind === "Критерий 1"), `${working.key} различает ниши и в список попадать не должен`);
  for (const x of b) assert.ok(x.greenIn <= S.summary.n * 0.05 || x.greenIn >= S.summary.n * 0.95, `${x.label} попал в список зря`);
});
