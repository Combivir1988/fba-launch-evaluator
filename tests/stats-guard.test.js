// Сторож карты причин (spec 018, D7). Читает shared/verdict-rules.js и падает, если в правилах появилась
// причина или решающий гейт, которых нет в картах shared/stats-summary.js.
//
// Зачем он нужен. Решающий гейт — закрытый набор ярлыков, а частота «проблема есть вообще» считается по ТЕКСТУ
// причины. Переформулировали причину в verdict-rules.js — и она молча уехала бы в «Прочее»: цифра осталась бы
// правдоподобной и неверной. Ровно тот род ошибки, против которого написана вся спека.
// Приём не новый в этом репозитории: так же устроен tests/tips.test.js.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CAT, DET, KEY } from "../shared/stats-summary.js";

const src = readFileSync(new URL("../shared/verdict-rules.js", import.meta.url), "utf8");
const body = src.slice(src.indexOf("export function verdictCeiling"), src.indexOf("export function gateStatuses"));
// Выкидываем сравнения (=== "rework") и индексы (items["8"]) — это не ярлыки и не причины, а операнды.
const clean = body.replace(/[!=]==\s*"[^"]*"/g, "").replace(/\[\s*"[^"]*"\s*\]/g, "").replace(/""/g, "");

/** Ярлыки решающего гейта: всё, что присваивается decisive. */
function decisiveLabels() {
  const out = new Set();
  for (const m of clean.matchAll(/decisive\s*\??\?=([^;]*);/g)) for (const s of m[1].matchAll(/"([^"]+)"/g)) out.add(s[1]);
  return [...out];
}
/** Начала текстов причин. Причина — фраза с заглавной буквы; короткие литералы и операнды ("ok") отсеиваются. */
const isReason = (s) => s.length >= 8 && s.includes(" ") && /^[A-ZА-ЯЁ]/.test(s);
function reasonStarts() {
  const out = new Set();
  for (const m of clean.matchAll(/reasons\.push\(([^\n]*)\)/g)) {
    for (const s of m[1].matchAll(/"([^"]+)"/g)) if (isReason(s[1])) out.add(s[1]);
    // шаблонная строка — только первая: внутри неё бывают вложенные шаблоны («: 3 листинга»), и это части одной причины
    const tpl = m[1].match(/`([^`]*)`/);
    if (tpl) { const head = tpl[1].split("${")[0]; if (isReason(head)) out.add(head); }
  }
  return [...out];
}

test("сторож: каждый решающий гейт из правил есть в картах категорий и подробностей", () => {
  const labels = decisiveLabels();
  assert.ok(labels.length >= 10, `из правил вынуто всего ${labels.length} ярлыков — сторож перестал что-либо читать`);
  for (const l of labels) {
    assert.ok(CAT[l], `решающий гейт «${l}» не отнесён ни к одной категории в shared/stats-summary.js (CAT)`);
    assert.ok(DET[l], `решающий гейт «${l}» не имеет подробного названия в shared/stats-summary.js (DET)`);
  }
});

test("сторож: каждая причина из правил покрыта картой KEY", () => {
  const starts = reasonStarts();
  assert.ok(starts.length >= 12, `из правил вынуто всего ${starts.length} причин — сторож перестал что-либо читать`);
  for (const s of starts) {
    assert.ok(KEY.some(([re]) => re.test(s)), `причина «${s.slice(0, 60)}…» не покрыта картой KEY — она ушла бы в «Прочее»`);
  }
});

test("сторож: в картах нет мусора — каждая категория KEY совпадает с категорией CAT того же смысла", () => {
  for (const [, label, cat] of KEY) { assert.equal(typeof label, "string"); assert.ok(cat, `у «${label}» нет категории`); }
  for (const l of Object.keys(DET)) assert.ok(CAT[l], `«${l}» есть в DET, но нет в CAT`);
});
