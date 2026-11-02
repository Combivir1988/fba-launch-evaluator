// Итог одного анализа для раздела «Статистика» (spec 018). Чистая функция: ни базы, ни сети, ни process.
//
// Главное правило спеки (FR-007): всё здесь считается ПЕРЕСЧЁТОМ текущим compute(). Сохранённый в документе
// результат читается ровно в одном поле — `stored` — и нужен только чтобы ПОКАЗАТЬ расхождение (FR-008).
// На цифры он не влияет никогда: в базе лежит снимок на момент расчёта, а методика с тех пор менялась.
//
// Перенесено из эталонного пайплайна .data/stats/1-recompute.mjs (D9) — не переписано заново.
// Размер итога — около 1,7 КБ (замер на 65 живых анализах); на этом числе стоит решение кэшировать
// итог по анализу, а сводку считать на лету (D1). Тест держит потолок в 4 КБ.
import { compute } from "./compute.js";

/** Есть ли в документе хоть один загруженный отчёт. Пустой черновик — это не «ниша не прошла», и в статистику он не идёт (FR-010). */
export function hasData(doc) {
  const a = doc?.aggregates || {};
  return Boolean(a.xray?.asins?.length || a.cerebro?.keywords?.length || a.poe);
}

const statuses = (items) => Object.fromEntries(Object.entries(items || {}).map(([k, v]) => [k, v.status]));

/** Документ анализа → компактный итог. Бросает, если пересчёт не удался (разбирается вызывающим: FR-012). */
export function analysisOutcome(doc) {
  const r = compute(doc);
  const stored = doc?.results?.verdict?.ceiling ? { ceiling: doc.results.verdict.ceiling } : null;
  return {
    verdict: { ceiling: r.verdict.ceiling, decisiveGate: r.verdict.decisiveGate, reasons: r.verdict.reasons || [] },
    amazon: r.amazon ? { present: r.amazon.present, level: r.amazon.level, blocks: r.amazon.blocks } : null,
    c1: { okCount: r.criterion1?.okCount, pass: r.criterion1?.pass, red: r.criterion1?.redItems || [], items: statuses(r.criterion1?.items) },
    eco: r.economics ? { pending: r.economics.pending, g1: r.economics.gate1?.status, g2: r.economics.gate2?.status } : null,
    ch: r.challenger ? { active: r.challenger.active, pass: r.challenger.pass, green: r.challenger.greenCount,
      items: Object.fromEntries(Object.entries(r.challenger.items || {}).map(([k, v]) => [k, { s: v.status, t: v.title }])) } : null,
    budget: r.budget ? { status: r.budget.status, quick: r.budget.quickScreenStatus } : null,
    sc: r.scorecard ? { total: r.scorecard.total, band: r.scorecard.band, weakest: r.scorecard.weakest } : null,
    gate0: r.gate0?.level ?? null,
    stored,
  };
}
