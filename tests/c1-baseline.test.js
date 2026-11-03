// ВОРОТА 3 — SC-002 (spec 019). Замена подпункта 1f задумана как починка того, что не работало,
// а не как перетасовка. Если кто-то выпал из прошедших Критерий 1 — сдвинулось что-то помимо 1f,
// и это надо найти прежде, чем идти дальше.
//
// Оба замера сняты чтением живой базы (65 анализов, 2026-11-03): «до» — ПЕРЕД первой правкой в shared/,
// иначе прежних цифр не осталось бы, потому что method_hash считается по содержимому всех shared/*.js.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (n) => JSON.parse(readFileSync(new URL(`./fixtures/${n}`, import.meta.url), "utf8"));
const BEFORE = read("c1-baseline.json");
const AFTER = read("c1-after.json");
const byId = (snap) => new Map(snap.items.map((x) => [x.id, x]));

test("замеры сняты на одном и том же наборе анализов", () => {
  assert.equal(BEFORE.meta.counted, AFTER.meta.counted, "число считаемых анализов разошлось — замеры несопоставимы");
  const a = byId(BEFORE), b = byId(AFTER);
  assert.deepEqual([...a.keys()].sort(), [...b.keys()].sort());
});

test("замер «до» — это действительно прежняя методика", () => {
  // Если эти числа поедут, значит базовый замер пересняли уже новым кодом, и сравнивать нечего.
  assert.deepEqual(BEFORE.meta.c1f, { ok: 1, warn: 16, fail: 48, na: 0 });
  assert.equal(BEFORE.meta.c1Pass, 2);
  assert.equal(BEFORE.meta.c1AvgOk, 3.2);
});

test("ВОРОТА 3 · SC-002: ни одна ниша не перестала проходить Критерий 1", () => {
  const b = byId(AFTER);
  const lost = BEFORE.items.filter((x) => x.pass && !b.get(x.id).pass);
  assert.deepEqual(lost.map((x) => x.id), [], "эти ниши проходили Критерий 1 и перестали — ищите, что сдвинулось помимо 1f");
});

test("SC-001: подпункт перестал быть неразличающим", () => {
  assert.equal(BEFORE.meta.c1f.ok, 1, "до замены зелёным он был ровно в одной нише из 65");
  assert.ok(AFTER.meta.c1f.ok >= 25, `после замены зелёных ${AFTER.meta.c1f.ok}, ожидалось не меньше 25`);
  assert.equal(AFTER.meta.c1f.ok, 28);
  assert.equal(AFTER.meta.c1f.na, 0, "показатель считается везде, где считался прежний");
});

test("SC-002 · контрольные числа перехода", () => {
  assert.equal(AFTER.meta.c1Pass, 7, "проходящих Критерий 1 стало 7");
  assert.equal(AFTER.meta.c1AvgOk, 3.62);
  const a = byId(BEFORE);
  const gained = AFTER.items.filter((x) => x.pass && !a.get(x.id).pass);
  assert.equal(gained.length, 5, "новых прошедших ровно пять");
});

test("SC-003 · каждый сдвинувшийся вердикт объясняется заменой подпункта 1f", () => {
  const b = byId(AFTER);
  const moved = BEFORE.items.filter((x) => b.get(x.id).verdict !== x.verdict);
  // Вердикт, изменившийся БЕЗ смены статуса 1f, — это незамеченная ошибка, а не результат работы.
  const unexplained = moved.filter((x) => b.get(x.id).c1f === x.c1f);
  assert.deepEqual(unexplained.map((x) => x.id), [], "вердикт сдвинулся, а подпункт 1f остался прежним — сдвинулось что-то ещё");
  assert.equal(moved.length, 2, "на живых данных 2026-11-03 сдвинулись ровно два вердикта");
  for (const x of moved) {
    assert.equal(x.verdict, "rework");
    assert.equal(b.get(x.id).verdict, "go_conditional", "оба перешли из «доработка» в «условно годится»");
    assert.equal(x.gate, "Критерий 1", "и обоих останавливал именно Критерий 1");
  }
});

test("вердикты в худшую сторону не поехали", () => {
  const rank = { go: 3, go_conditional: 2, rework: 1, no_go: 0 };
  const b = byId(AFTER);
  const worse = BEFORE.items.filter((x) => rank[b.get(x.id).verdict] < rank[x.verdict]);
  assert.deepEqual(worse.map((x) => x.id), [], "послабление порога не может ухудшать вердикт — значит сдвинулось что-то ещё");
  assert.equal(AFTER.meta.verdicts.no_go, BEFORE.meta.verdicts.no_go, "число отказов не изменилось вовсе");
});
