// Критерии 2–8 против доминирующего игрока (Gate 3). Активируется при Top Brand Share > 25 %.
// Статусы: kind = confirmed 🟢 | assumed 🟡 | decided 🔵 | unknown ⚪; в порог «N из 8» идут только 🟢 с status ok.
import { brandLoyalty } from "./traffic.js";

export function challenger(p) {
  const { inputs, thresholds: th, competition: comp, criterion1: c1, economics: eco, cerebro, poe, traffic: tr, xray, patents } = p;
  const t = th.challenger;
  const user = inputs.challenger || {};
  const active = Boolean(comp?.dominant);
  const items = {};

  items["1"] = { title: "Рыночный контекст", status: c1.pass ? "ok" : "fail", kind: "confirmed", value: `${c1.okCount}/8`, note: c1.pass ? "Критерий 1 пройден" : `Критерий 1 ниже порога (${c1.okCount} из 8)` };
  const c2 = eco?.criterion2Summary;
  items["2"] = c2 && !c2.pending ? { title: "Детальная экономика", status: c2.pass ? "ok" : "fail", kind: "confirmed", value: `${c2.okCount}/11`, note: c2.mandatoryOk ? "2f/2j/2k OK" : "2f/2j/2k не все OK" }
    : { title: "Детальная экономика", status: "pending", kind: "unknown", value: null, note: "ожидает COGS и переменных менеджера" };

  // 3 — Лояльность к бренду
  {
    const u = user["3"];
    let it = { title: "Лояльность к бренду", status: "na", kind: "unknown", value: null, note: "нет данных: нужен SV «бренд + ключ» (Cerebro/Magnet)" };
    const bl = brandLoyalty(cerebro, comp?.topBrand, tr?.svCore);
    if (bl) it = { ...it, status: bl.ratio < t.loyaltyOk ? "ok" : bl.ratio > t.loyaltyFail ? "fail" : "warn", kind: "confirmed", value: bl.ratio, note: `SV с «${comp.topBrand}» ${bl.brandedSv.toLocaleString("ru-RU")} / SV core ${tr.svCore.toLocaleString("ru-RU")} = ${(bl.ratio * 100).toFixed(1)} % (по фразам Cerebro)` };
    items["3"] = applyUser(it, u);
  }
  // 4 — Уязвимость по качеству
  {
    const u = user["4"];
    let it = { title: "Уязвимость лидера по качеству", status: "na", kind: "unknown", value: null, note: "нет данных: «Customers say» лидера или POE отзывы" };
    const leader = comp?.brands?.[0];
    const rating = leader?.rating ?? (poe?.asinMetrics || []).find((a) => a.brand === comp?.topBrand)?.rating ?? null;
    const topNeg = poe?.pdr?.negative?.[0];
    if (topNeg || rating !== null) {
      const complaint = topNeg && topNeg.pct >= t.complaintMinPct;
      const status = complaint ? "ok" : rating !== null && rating > t.leaderRatingSafe ? "fail" : "warn";
      it = { ...it, status, kind: topNeg ? "confirmed" : "assumed", value: topNeg?.pct ?? null,
        note: (topNeg ? `системная жалоба ниши: «${topNeg.topic}» ${topNeg.pct}% упоминаний` : "") + (rating !== null ? `${topNeg ? "; " : ""}рейтинг лидера ${rating.toFixed(1)}` : "") };
    }
    items["4"] = applyUser(it, u);
  }
  // 5 — Многоигровое поле
  {
    const n = comp?.brandsOver10pct, top5 = comp?.top5Share;
    let it = { title: "Многоигровое поле", status: "na", kind: "unknown", value: null, note: "нет данных о долях брендов" };
    if (typeof n === "number" && typeof top5 === "number") {
      const a = n >= t.playersMin ? "ok" : n <= 1 ? "fail" : "warn";
      const b = top5 < t.top5Ok ? "ok" : top5 > t.top5Fail ? "fail" : "warn";
      const status = a === "ok" && b === "ok" ? "ok" : a === "fail" || b === "fail" ? "fail" : "warn";
      it = { title: it.title, status, kind: "confirmed", value: n, note: `5a: ${n} брендов с долей > 10 %; 5b: топ-5 = ${(top5 * 100).toFixed(0)} %; игроков с ≥100 отзывов: ${comp.playersOver100}` };
    }
    items["5"] = applyUser(it, user["5"]);
  }
  // 6 — Запас экономики (обязателен) = 2f/2j/2k
  items["6"] = c2 && !c2.pending
    ? { title: "Запас экономики на войну", mandatory: true, status: c2.mandatoryOk ? "ok" : "fail", kind: "confirmed", value: null, note: c2.mandatoryOk ? "2f, 2j, 2k — все OK" : "хотя бы один из 2f/2j/2k не OK → критерий красный" }
    : { title: "Запас экономики на войну", mandatory: true, status: "pending", kind: "unknown", value: null, note: "ожидает Критерий 2" };
  // 7 — Реальная дифференциация (решение пользователя)
  {
    const u = user["7"];
    const it = { title: "Реальная дифференциация", status: "na", kind: "unknown", value: null, note: "опишите измеримое требование ТЗ, закрывающее жалобу из критерия 4" };
    items["7"] = applyUser(it, u, "decided");
  }
  // 8 — Patent/FTO (обязателен)
  {
    const ps = inputs.checklist?.patentSearch || "none";
    const map = { clear: ["ok", "патентов не найдено (USPTO/Google Patents)"], design_around: ["ok", "есть явный design-around"], conflict: ["fail", "прямое совпадение с живым патентом"], unsure: ["warn", "есть похожие патенты — нужна оценка юриста"], none: ["na", "поиск не проводился — Gate 4 не обсуждён"] };
    let [status, note] = map[ps] || map.none;
    let kind = status === "na" ? "unknown" : "confirmed";
    if (ps === "none" && patents?.status) {
      // AI-скан — только 🟡 допущение: подтверждение (🟢) ставит человек/поверенный через поле «Патенты / FTO»
      const hi = (patents.items || []).filter((x) => x.risk === "high").length, med = (patents.items || []).filter((x) => x.risk === "med").length;
      status = patents.status === "conflict" ? "fail" : patents.status === "unsure" ? "warn" : "ok"; kind = "assumed";
      note = `AI-скан Google Patents (${new Date(patents.createdAt).toLocaleDateString("ru-RU")}): ${patents.status === "conflict" ? `есть ${hi} патент(ов) с высоким риском` : patents.status === "unsure" ? `${med} патент(ов) с частичным пересечением — нужна проверка поверенным` : "явных пересечений по независимым claims не найдено"}; подтвердите статус вручную`;
    }
    items["8"] = applyUser({ title: "Patent / FTO риск", mandatory: true, status, kind, value: null, note }, user["8"]);
  }

  const greenCount = Object.values(items).filter((i) => i.status === "ok" && i.kind === "confirmed").length;
  const mandatoryOk = items["6"].status === "ok" && items["8"].status === "ok" && items["8"].kind === "confirmed";
  const pending = Object.values(items).some((i) => i.status === "pending");
  return { active, items, greenCount, total: 8, passCount: t.passCount, mandatoryOk, pending,
    pass: active ? greenCount >= t.passCount && mandatoryOk : null,
    gate4Discussed: items["8"].status !== "na", patentScanOnly: items["8"].kind === "assumed",
    note: active ? `Top Brand ${(comp.topBrandShare * 100).toFixed(0)} % > 25 % — доминирующий игрок, критерии 3–8 обязательны` : "доминирующего бренда нет (Top Brand ≤ 25 %) — критерии 3–8 справочно" };
}

function applyUser(it, u, defaultKind = "confirmed") {
  if (!u || !u.status || u.status === "auto") return it;
  const kind = u.kind || defaultKind;
  return { ...it, status: u.status, kind, note: (u.note ? u.note : it.note) + " (задано пользователем)", userSet: true, value: u.value ?? it.value };
}
