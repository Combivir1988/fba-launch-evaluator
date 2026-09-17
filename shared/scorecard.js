// 5-осевой scorecard (0–10 на ось, веса 25/25/25/15/10). Итоговый % и полоса.
import { clamp } from "./num.js";

export function scorecard(p) {
  const { thresholds: th, criterion1: c1, economics: eco, competition: comp, traffic: tr, inputs, challenger: ch } = p;
  const w = th.scorecard.weights;
  const axes = {};

  // Market: 1a, 1c, 1h, 1g + трафик
  {
    const pts = [];
    const sc = { ok: 10, warn: 5, fail: 1 };
    for (const k of ["1a", "1c", "1g", "1h"]) { const s = c1.items[k].status; if (s !== "na") pts.push(sc[s]); }
    if (tr?.status && tr.status !== "na") pts.push(sc[tr.status]);
    axes.market = { score: pts.length ? avg(pts) : null, note: `1a/1c/1g/1h + трафик (${pts.length} сигналов)` };
  }
  // Competition: top-5 share по шкале + отзывы + доминация
  {
    let s = null; const notes = [];
    if (typeof comp?.top5Share === "number") {
      const x = comp.top5Share; s = x < 0.30 ? 9.5 : x < 0.45 ? 7 : x < 0.65 ? 4 : 1; notes.push(`топ-5 ${(x * 100).toFixed(0)} %`);
      const tier = comp.reviewBarrier?.tier; if (tier === "moat") { s -= 2; notes.push("ров отзывов лидера непробиваем"); } else if (tier === "medium") { s -= 1; notes.push("средний барьер отзывов"); }
      if (comp.dominant) { s -= 1; notes.push("доминирующий бренд"); }
      if (comp.amazonSells) { s -= 2; notes.push("Amazon продаёт сам"); }
      s = clamp(s, 0, 10);
    }
    axes.competition = { score: s, note: notes.join("; ") || "нет данных" };
  }
  // Economics
  {
    let s = null; let note = "ожидает COGS (прикидка, не гейт)";
    if (eco && !eco.pending) {
      const g1 = { pass: 8, rework: 5, no_go: 1 }[eco.gate1.status] ?? 5;
      const g2 = { pass: 10, rework: 5, no_go: 0, pending: 5 }[eco.gate2.status] ?? 5;
      s = clamp((g1 + g2) / 2 + (eco.roiHint === "ok" ? 1 : eco.roiHint === "loss" ? -2 : 0), 0, 10);
      note = `Gate 1 ${eco.gate1.status}, Gate 2 ${eco.gate2.status}, ROI ${eco.roi !== null ? Math.round(eco.roi * 100) + " %" : "—"}`;
    }
    axes.economics = { score: s, note, pending: !eco || eco.pending };
  }
  // Brand-fit — ручная ось
  axes.brandFit = { score: numOr(inputs.axisManual?.brandFit, 5), note: inputs.axisManual?.brandFit != null ? "задано пользователем" : "по умолчанию 5 — задайте в панели «Риски»" };
  // Operational risk — из чеклиста (10 = низкий риск)
  {
    const c = inputs.checklist || {};
    let s = 8; const notes = [];
    if (c.gatedCategory) { s -= 2; notes.push("закрытая категория"); }
    if (c.dangerousGoods) { s -= 2; notes.push("опасные товары"); }
    if (c.certificates && c.certificates !== "none") { s -= 1; notes.push(`сертификаты: ${c.certificates}`); }
    if (c.patentSearch === "conflict") { s -= 4; notes.push("патентный конфликт"); } else if (c.patentSearch === "none") { s -= 1; notes.push("патенты не проверены"); }
    if (c.reviewMergingSuspected) { s -= 1; notes.push("склейка отзывов у конкурентов"); }
    if (c.couponsDealsSaturation === "high") { s -= 1; notes.push("много купонов/дилов"); }
    if (typeof c.lifecycleMonths === "number" && c.lifecycleMonths < th.checklist.lifecycleMonthsMin) { s -= 2; notes.push("короткий жизненный цикл"); }
    if (inputs.axisManual?.opRisk != null) { s = Number(inputs.axisManual.opRisk); notes.push("задано пользователем"); }
    axes.opRisk = { score: clamp(s, 0, 10), note: notes.join("; ") || "риски не отмечены" };
  }

  let total = 0, weightUsed = 0;
  for (const [k, ax] of Object.entries(axes)) if (ax.score !== null) { total += ax.score * w[k]; weightUsed += w[k]; }
  const pct = weightUsed ? (total / weightUsed) * 10 : null; // нормируем на использованные веса
  const b = th.scorecard.bands;
  const band = pct === null ? null : pct >= b.goPriority ? "go_priority" : pct >= b.go ? "go" : pct >= b.rework ? "rework" : "no_go";
  const weakest = Object.entries(axes).filter(([, a]) => a.score !== null).sort((x, y) => x[1].score - y[1].score)[0]?.[0] ?? null;
  return { axes, weights: w, total: pct, band, weakest, weightUsed, complete: weightUsed >= 0.999 };
}
const avg = (a) => a.reduce((x, y) => x + y, 0) / a.length;
const numOr = (v, d) => (v === null || v === undefined || v === "" ? d : Number(v));
