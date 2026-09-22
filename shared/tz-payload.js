// Этап 2 (spec 010, D9): факты для ТЗ производителю — из расчётов этапа 1 и 2. AI пишет текст только по этим фактам;
// каждое число в ТЗ должно встречаться среди чисел пейлоада, иначе строка помечается «проверьте число».
import { round } from "./num.js";
import { valueLabel } from "./config-stats.js";

const r3 = (v) => (typeof v === "number" ? round(v, 3) : null), r2 = (v) => (typeof v === "number" ? round(v, 2) : null);
const pct = (v) => (typeof v === "number" ? round(v * 100, 1) : null);

export function buildTzPayload(analysis) {
  const R = analysis?.results || {}; const st = R.config?.whole; const inp = analysis?.inputs || {}; const poe = analysis?.aggregates?.poe;
  const val = (f, v) => ({ value: v.label ?? valueLabel(f, v.value), ...(typeof v.value === "number" ? { number: v.value } : {}), revenueSharePct: pct(v.share), listingSharePct: pct(v.listingShare), listings: v.count, avgPrice: r2(v.avgPrice), premium: Boolean(v.premium) });
  return {
    niche: analysis?.niche || "", coreKeyword: analysis?.coreKeyword || "",
    listingsAnalyzed: st?.asins ?? 0,
    configuration: (st?.fields || []).map((f) => ({
      field: f.name, unit: f.unit, coveragePct: pct(f.coverage),
      dominant: f.values[0] ? val(f, f.values[0]) : null,
      alternatives: f.values.slice(1, 4).map((v) => val(f, v)),
      premium: f.values.filter((v) => v.premium).slice(0, 3).map((v) => val(f, v)),
    })),
    prices: {
      nicheMedian: r2(R.criterion1?.items?.["1b"]?.value ?? null), myPrice: r2(R.effective?.price ?? null),
      segments: (R.priceSegments?.segments || []).map((s) => ({ label: s.label, min: r2(s.min), max: r2(s.max), revenueSharePct: pct(s.weightShare), listingsSharePct: pct(s.itemsShare) })),
    },
    reviews: poe?.pdr ? {
      negative: (poe.pdr.negative || []).slice(0, 8).map((t) => ({ topic: t.topic, mentionsPct: r2(t.pct), examples: (t.verbatims || []).slice(0, 2) })),
      positive: (poe.pdr.positive || []).slice(0, 6).map((t) => ({ topic: t.topic, mentionsPct: r2(t.pct) })),
      returns: (poe.pdr.returns || []).slice(0, 5).map((t) => ({ topic: t.topic, pct: r2(t.pct) })),
    } : null,
    regulatory: (R.regulatory?.triggers || []).map((t) => ({ agency: t.agency, kind: t.kind === "claim" ? "обещание в листингах" : "тип товара", title: t.title, meaning: t.meaning })),
    patents: analysis?.patents ? { status: analysis.patents.status, summary: analysis.patents.summary, items: (analysis.patents.items || []).slice(0, 5).map((x) => ({ number: x.number, risk: x.risk, overlap: x.overlap, designAround: x.designAround })) } : null,
    differentiation: (analysis?.ai?.differentiation || []).slice(0, 6).map((d) => ({ hypothesis: d.hypothesis, evidence: d.evidence, specRequirement: d.specRequirement })),
    batch: { units: R.budget?.batchUnits ?? null, unitsPerDay: inp.unitsPerDay ?? null, leadDays: R.budget?.leadDays ?? null },
    myBrand: inp.myBrand || "",
  };
}

/** Все числа пейлоада в формах, в которых они могут встретиться в тексте (целое, 1–2 знака, проценты от долей). */
export function collectTzNumbers(payload) {
  const out = new Set();
  const add = (v) => { if (typeof v !== "number" || !Number.isFinite(v)) return; for (const x of [v, Math.round(v), round(v, 1), round(v, 2)]) out.add(x); if (v > 0 && v <= 1) { out.add(Math.round(v * 100)); out.add(round(v * 100, 1)); } };
  const walk = (n) => { if (Array.isArray(n)) n.forEach(walk); else if (n && typeof n === "object") Object.values(n).forEach(walk); else add(n); };
  walk(payload); return out;
}

const NUM_RE = /\d+(?:[.,]\d+)?/g;
/** Строка ТЗ «не проверена», если в требовании/обосновании есть число ≥ 10 или с дробной частью, которого нет среди чисел пейлоада. */
export function markUnverified(tz, numbers) {
  const rows = (tz?.rows || []).map((row) => {
    const text = `${row.requirement || ""} ${row.rationale || ""}`;
    const found = [...text.matchAll(NUM_RE)].map((m) => Number(m[0].replace(",", "."))).filter((n) => Number.isFinite(n) && (n >= 10 || !Number.isInteger(n)));
    return { ...row, unverified: found.some((n) => !numbers.has(n) && !numbers.has(round(n, 1)) && !numbers.has(Math.round(n))) };
  });
  return { ...tz, rows };
}
