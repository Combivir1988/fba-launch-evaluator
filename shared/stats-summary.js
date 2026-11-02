// Сводка по всем анализам (spec 018). Чистая функция от набора итогов: ни базы, ни сети.
// Перенесено из эталонного пайплайна .data/stats/2-mkdata.mjs (D9).
//
// В каждом срезе лежит СЧЁТ, а не процент (FR-013): проценты считает тот, кто рисует, и всегда печатает рядом базу.
// Карты CAT / DET / KEY вынесены наружу не для удобства, а ради сторожа tests/stats-guard.test.js:
// он читает shared/verdict-rules.js и падает, если в правилах завелась причина, которой здесь нет.

export const VLABEL = { go: "Go", go_conditional: "Go, условно", rework: "Доработка", no_go: "No-Go" };
export const VSTATUS = { go: "good", go_conditional: "warning", rework: "serious", no_go: "critical" };
const VORDER = { go: 0, go_conditional: 1, rework: 2, no_go: 3 };

/** Решающий гейт → укрупнённая категория. Ключи — закрытый набор ярлыков из verdict-rules.js. */
export const CAT = {
  "Amazon в нише": "Конкуренция", "Критерий 1": "Конкуренция", "Критерии 3–8": "Конкуренция",
  "Gate 1": "Экономика", "Gate 2": "Экономика", "Критерий 6": "Экономика",
  "Критерий 2": "Не доведён до конца", "Gate 0": "Не доведён до конца",
  "Критерий 8": "Патенты / FTO", "Gate 4": "Патенты / FTO",
  "Стоп-вопросы": "Бюджет / стоп-вопросы", "все гейты пройдены": "Всё пройдено",
};
/** Решающий гейт → название, по которому понятно, что именно не сошлось. */
export const DET = {
  "Gate 1": "Gate 1 — маржа без рекламы", "Gate 2": "Gate 2 — после рекламы", "Критерий 6": "Критерий 6 — запас экономики",
  "Критерий 1": "Критерий 1 — рыночный контекст", "Критерии 3–8": "Критерии 3–8 — мало зелёных",
  "Amazon в нише": "Amazon в нише", "Критерий 2": "COGS не введён", "Gate 0": "Gate 0 — не хватает данных",
  "Стоп-вопросы": "Стоп-вопросы", "все гейты пройдены": "Всё пройдено",
  "Критерий 8": "Критерий 8 — патент", "Gate 4": "Gate 4 — патенты",
};
/** Текст причины → короткое имя и категория. Срез «как часто проблема есть вообще» считается отсюда. */
export const KEY = [
  [/^Критерий 1 ниже порога/, "Критерий 1 ниже порога", "Конкуренция"],
  [/^Gate 3:/, "Gate 3 — мало зелёных в 3–8", "Конкуренция"],
  [/^Amazon продаёт сам/, "Amazon продаёт сам", "Конкуренция"],
  [/^Gate 1 провален/, "Gate 1 провален (маржа)", "Экономика"],
  [/^Gate 2 провален/, "Gate 2 провален (после рекламы)", "Экономика"],
  [/^Экономика на грани/, "Экономика на грани", "Экономика"],
  [/^Критерий 6/, "Критерий 6 — нет запаса экономики", "Экономика"],
  [/^Экономика не заполнена/, "COGS не введён", "Не доведён до конца"],
  [/^Критерий 8/, "Критерий 8 — патентный риск", "Патенты / FTO"],
  [/^Gate 4 \(патенты/, "Gate 4 не обсуждён", "Патенты / FTO"],
  [/^Gate 4: есть только AI-скан/, "Gate 4 — только AI-скан", "Патенты / FTO"],
  [/^Один из четырёх стоп-вопросов/, "Стоп-вопрос — «нет»", "Бюджет / стоп-вопросы"],
  [/^Gate 0/, "Gate 0 — не хватает данных", "Не доведён до конца"],
  [/^Scorecard < 40/, "Scorecard < 40 %", "Общая оценка"],
  [/^Scorecard 40–59/, "Scorecard 40–59 %", "Общая оценка"],
];

export const C1_LABELS = { "1a": "1a · Размер рынка", "1b": "1b · Средняя цена", "1c": "1c · Спрос Adj. SV", "1d": "1d · Барьер отзывов",
  "1e": "1e · Доминация бренда / Amazon", "1f": "1f · Доля топ-5 брендов", "1g": "1g · Сезонность", "1h": "1h · Успешность запусков" };
export const CH_LABELS = { 1: "Рыночный контекст", 2: "Детальная экономика", 3: "Лояльность к бренду", 4: "Уязвимость лидера",
  5: "Многоигровое поле", 6: "Запас экономики на войну", 7: "Реальная дифференциация", 8: "Patent / FTO риск" };

const cnt = (arr, f) => { const m = new Map(); for (const x of arr) { const k = f(x); if (k == null) continue; m.set(k, (m.get(k) || 0) + 1); } return m; };
const desc = (m) => [...m].map(([label, count]) => ({ label, count })).sort((x, y) => y.count - x.count || String(x.label).localeCompare(String(y.label)));

/** items: [{ id, niche, outcome }] — только те анализы, что считаются (пустые черновики и неудачи сюда не попадают). */
export function summarize(items = []) {
  const A = items.map((it) => it.outcome);
  const n = A.length;

  // «Проблема есть вообще»: одна ниша даёт по одному голосу на каждую свою причину, поэтому сумма больше 100 %.
  const hitCat = new Map(), hitOne = new Map();
  for (const a of A) {
    const seenOne = new Set(), seenCat = new Set();
    for (const rs of a.verdict?.reasons || []) {
      const m = KEY.find(([re]) => re.test(rs)); if (!m) continue;
      if (!seenOne.has(m[1])) { seenOne.add(m[1]); hitOne.set(m[1], (hitOne.get(m[1]) || 0) + 1); }
      if (!seenCat.has(m[2])) { seenCat.add(m[2]); hitCat.set(m[2], (hitCat.get(m[2]) || 0) + 1); }
    }
  }

  const c1rows = Object.entries(C1_LABELS).map(([key, label]) => {
    const s = { fail: 0, warn: 0, na: 0, ok: 0 };
    for (const a of A) { const v = a.c1?.items?.[key]; if (v && s[v] !== undefined) s[v]++; else s.na++; }
    return { key, label, ...s };
  }).sort((x, y) => y.fail - x.fail);

  const E = A.filter((a) => a.eco && !a.eco.pending); // экономика посчитана только там, где введён COGS
  const gate = (f, label) => { const m = cnt(E, f); return { label, no_go: m.get("no_go") || 0, rework: m.get("rework") || 0, pass: m.get("pass") || 0, total: E.length }; };

  const chrows = Object.keys(CH_LABELS).sort().map((key) => {
    const s = { fail: 0, ok: 0, na: 0 };
    for (const a of A) { const v = a.ch?.items?.[key]?.s; if (v === "fail") s.fail++; else if (v === "ok") s.ok++; else s.na++; }
    return { key, label: `${key} · ${CH_LABELS[key]}`, ...s };
  });

  const summary = {
    n,
    verdicts: ["go", "go_conditional", "rework", "no_go"].map((key) => ({ key, label: VLABEL[key], status: VSTATUS[key], count: A.filter((a) => a.verdict?.ceiling === key).length })),
    decisiveCat: desc(cnt(A, (a) => CAT[a.verdict?.decisiveGate] || "Прочее")),
    decisiveDet: desc(cnt(A, (a) => DET[a.verdict?.decisiveGate] || a.verdict?.decisiveGate)),
    freqCat: desc(hitCat),
    freqOne: desc(hitOne),
    c1rows,
    c1avg: n ? A.reduce((s, a) => s + (a.c1?.okCount || 0), 0) / n : 0,
    c1pass: A.filter((a) => a.c1?.pass).length,
    eco: { total: E.length, noCogs: n - E.length,
      gates: [gate((a) => a.eco.g1, "Gate 1 — маржа без рекламы"), gate((a) => a.eco.g2, "Gate 2 — после рекламы")] },
    chrows,
    scorecard: {
      avg: n ? A.reduce((s, a) => s + (a.sc?.total || 0), 0) / n : 0,
      bands: [...cnt(A, (a) => a.sc?.band)].map(([key, count]) => ({ key, count })),
      weakest: desc(cnt(A, (a) => a.sc?.weakest)),
    },
  };

  const rows = items.map(({ id, niche, outcome: a }) => ({
    id, niche,
    verdict: VLABEL[a.verdict?.ceiling] || a.verdict?.ceiling, vkey: a.verdict?.ceiling, status: VSTATUS[a.verdict?.ceiling],
    why: DET[a.verdict?.decisiveGate] || a.verdict?.decisiveGate, cat: CAT[a.verdict?.decisiveGate] || "Прочее",
    c1: a.c1?.okCount ?? null, score: a.sc?.total == null ? null : Math.round(a.sc.total),
    cogs: Boolean(a.eco && !a.eco.pending),
    changed: Boolean(a.stored && a.stored.ceiling !== a.verdict?.ceiling),
    was: a.stored?.ceiling ? VLABEL[a.stored.ceiling] : null,
  })).sort((x, y) => (VORDER[x.vkey] ?? 9) - (VORDER[y.vkey] ?? 9) || (y.score ?? 0) - (x.score ?? 0));

  return { summary, rows, mismatch: { count: rows.filter((r) => r.changed).length } };
}
