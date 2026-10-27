// Оценка листинга числом (spec 017, этап 3): покрытие ключей, лимиты полей, пустые повторы и запрещённые обещания.
// Чистая и синхронная: пересчитывается в браузере на каждую правку, без сервера и без AI. Текст пишет модель —
// принимаем его мы, и принимать на глаз нечего.

import { tokens, phraseTokens } from "./listing-coverage.js";

const str = (v) => String(v ?? "");
/** Backend search terms Amazon меряет в БАЙТАХ, а не в знаках. */
export const bytesOf = (s) => (typeof TextEncoder !== "undefined" ? new TextEncoder().encode(str(s)).length : Buffer.byteLength(str(s), "utf8"));

/** Запреты собираются из фактов, а не из вкуса: рискованные патенты и регуляторные триггеры. */
export function listingBans({ patents, regulatory } = {}) {
  const out = [];
  for (const p of patents?.items || []) {
    if (p.risk !== "high" && p.risk !== "med") continue;
    const text = str(p.claimed).trim(); if (!text) continue;
    out.push({ text, why: `патент ${p.number} (риск ${p.risk === "high" ? "высокий" : "средний"})` });
  }
  // Регуляторика: запрещаем не «тип товара», а ОБЕЩАНИЕ (kind: claim) — именно оно требует регистрации и ловится модератором.
  for (const r of regulatory?.triggers || []) {
    if (r.kind !== "claim") continue;
    for (const w of r.words || []) { const text = str(w).trim(); if (text) out.push({ text, why: `${str(r.agency || "регуляторика")}: ${str(r.title || "обещание требует регистрации")}` }); }
  }
  return out;
}

const FIELDS = [
  { id: "title", label: "Тайтл", limit: "titleMax", unit: "знаков" },
  { id: "highlights", label: "Item Highlights", limit: "highlightsMax", unit: "знаков" },
  { id: "bullets", label: "Буллеты", limit: "bulletMax", unit: "знаков", each: true },
  { id: "description", label: "Описание", limit: null, unit: "знаков" },
  { id: "backendTerms", label: "Backend search terms", limit: "backendBytes", unit: "байт", bytes: true },
];

/**
 * @param {object} o { listing, keywords, bans, th }
 * @returns {{ coverage, limits, repeats, bans, ok }}
 */
export function scoreListing({ listing = {}, keywords = [], bans = [], th } = {}) {
  const t = th?.stage3 || {};
  const text = {
    title: str(listing.title), highlights: str(listing.highlights),
    bullets: (listing.bullets || []).map(str), description: str(listing.description), backendTerms: str(listing.backendTerms),
  };
  const all = [text.title, text.highlights, text.bullets.join(" "), text.description, text.backendTerms].join(" \n ");
  const allTokens = tokens(all);
  const frontTokens = tokens([text.title, text.highlights, text.bullets.join(" "), text.description].join(" \n "));

  // Покрытие: ключ засчитан, если все его значимые слова есть где-то в листинге. Вес важнее числа — 50 мелких ключей не заменят одного большого.
  let count = 0, weight = 0, weightTotal = 0;
  const items = keywords.map((k) => {
    const words = phraseTokens(k.phrase);
    const covered = words.length > 0 && words.every((w) => allTokens.has(w));
    const inTitle = words.length > 0 && words.every((w) => tokens(text.title).has(w));
    weightTotal += k.weight || 0;
    if (covered) { count++; weight += k.weight || 0; }
    return { phrase: k.phrase, weight: k.weight || 0, buys: Boolean(k.buys), sells: Boolean(k.sells), covered, inTitle, missing: words.filter((w) => !allTokens.has(w)) };
  });

  const limits = [];
  for (const f of FIELDS) {
    const max = f.limit ? Number(t[f.limit]) || null : null;
    if (f.each) {
      text.bullets.forEach((b, i) => limits.push({ field: `${f.label} ${i + 1}`, used: b.length, max, unit: f.unit, ok: !max || b.length <= max }));
      continue;
    }
    const used = f.bytes ? bytesOf(text[f.id]) : str(text[f.id]).length;
    limits.push({ field: f.label, used, max, unit: f.unit, ok: !max || used <= max });
  }

  // Слово, уже стоящее в тайтле или буллетах, в backend terms тратит байты впустую — Amazon индексирует его и так.
  const repeats = [...tokens(text.backendTerms)].filter((w) => frontTokens.has(w)).sort();

  const hits = bans.map((b) => ({ ...b, hit: banHit(allTokens, b.text) })).filter((b) => b.hit);

  const share = keywords.length ? count / keywords.length : null;
  const weightShare = weightTotal > 0 ? weight / weightTotal : null;
  return {
    coverage: { count, total: keywords.length, share, weight, weightTotal, weightShare, items },
    limits, repeats, bans: hits,
    ok: limits.every((l) => l.ok) && hits.length === 0,
  };
}

/** Запрет сработал: одно-два слова — по точному совпадению слова, длинная формулировка — по заметной общей части. */
function banHit(textTokens, banText) {
  const words = [...tokens(banText)];
  if (!words.length) return false;
  const have = words.filter((w) => textTokens.has(w)).length;
  return words.length <= 2 ? have === words.length : have / words.length >= 0.8;
}
