// Ядро статистики: итог одного анализа (spec 018).
// ВОРОТА SC-003 — главный тест спеки: показатели считаются ПЕРЕСЧЁТОМ, а не чтением сохранённого в core.results.
// Реализация, которая берёт готовый результат, выглядит правильной, работает быстрее и проходит всё остальное —
// падает она только здесь. На живых данных 2026-11-02 эта разница стоила 68 % против 17 %.
import { test } from "node:test";
import assert from "node:assert/strict";
import { analysisOutcome, hasData } from "../shared/stats-outcome.js";
import { staleAnalysis, STALE_EXPECTED } from "./helpers/fixture-stale-analysis.js";
import { emptyDraftAnalysis, brokenAnalysis } from "./helpers/fixture-analysis.js";

test("ворота SC-003: вердикт берётся из пересчёта, а не из core.results", () => {
  const doc = staleAnalysis();
  assert.equal(doc.results.verdict.ceiling, STALE_EXPECTED.storedCeiling, "подложка должна содержать расходящийся снимок");

  const o = analysisOutcome(doc);
  assert.equal(o.verdict.ceiling, STALE_EXPECTED.ceiling);
  assert.equal(o.verdict.decisiveGate, STALE_EXPECTED.decisiveGate);
  // расхождение видно (FR-008), но на цифры не влияет
  assert.equal(o.stored.ceiling, STALE_EXPECTED.storedCeiling);
  assert.notEqual(o.verdict.ceiling, o.stored.ceiling);
});

test("hasData: пустой черновик не идёт в статистику, заполненный идёт (FR-010)", () => {
  assert.equal(hasData(staleAnalysis()), true);
  assert.equal(hasData(emptyDraftAnalysis()), false);
  assert.equal(hasData(null), false);
});

test("повреждённые агрегаты: пересчёт бросает, и бросок читаемый (FR-012)", () => {
  const doc = brokenAnalysis();
  assert.equal(hasData(doc), true, "отчёт как будто есть — иначе анализ отсеялся бы раньше, как пустой черновик");
  assert.throws(() => analysisOutcome(doc), (e) => typeof e?.message === "string" && e.message.length > 0);
});

// Размер — не косметика: на 1,7 КБ держится решение кэшировать итоги (D1). Разрастание ломает его молча,
// и заметно это стало бы только на двух сотнях анализов в проде.
test("итог одного анализа укладывается в 4 КБ (замер — 1,7 КБ)", () => {
  const bytes = Buffer.byteLength(JSON.stringify(analysisOutcome(staleAnalysis())), "utf8");
  assert.ok(bytes < 4096, `итог вырос до ${bytes} байт — кэш итогов рассчитан на ~1,7 КБ`);
});
