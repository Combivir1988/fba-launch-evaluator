// Кто из конкурентов какие ключи держит (spec 017, этап 3). Считается по текстам листингов, которые уже лежат
// в кэше этапа 2 — новых загрузок и кредитов не нужно.
// Покрытие меряем ПО СЛОВАМ, а не по точной фразе: Amazon индексирует слова, и «stainless steel dog bowl»
// находится по запросу «dog bowl stainless». Если считать по фразе, почти всё выглядит непокрытым, и мера бесполезна.

const STOP = new Set(["a", "an", "the", "for", "and", "or", "with", "of", "in", "on", "to", "by", "at", "from", "your", "you", "our", "is", "are", "it", "its", "that", "this", "as", "per", "x"]);

/** Слова текста: нижний регистр, без пунктуации, простое множественное число приводится к единственному. */
export function tokens(text) {
  const out = new Set();
  for (const raw of String(text || "").toLowerCase().split(/[^a-z0-9а-яё]+/i)) {
    if (!raw || STOP.has(raw)) continue;
    out.add(raw);
    if (raw.length > 3 && raw.endsWith("s") && !raw.endsWith("ss")) out.add(raw.slice(0, -1)); // bowls → bowl
  }
  return out;
}
/** Значимые слова ключа: по ним и проверяем покрытие. */
export const phraseTokens = (phrase) => [...tokens(phrase)].filter((w) => !/^\d+$/.test(w) || String(phrase).includes(w));

const fieldsOf = (l) => ({
  title: tokens(l?.title),
  bullets: tokens((l?.bullets || []).join(" ")),
  specs: tokens((l?.specs || []).map((s) => `${s?.k} ${s?.v}`).join(" ")),
});
/** Ключ покрыт полем, только если в поле есть ВСЕ его значимые слова. */
const covers = (set, words) => words.length > 0 && words.every((w) => set.has(w));

/**
 * @param {object} o { keywords, listings, own, th } — own необязателен: без него колонок «я» нет вовсе (spec 017, FR-008)
 * @returns {{ items, listings, fetchedAt, own }}
 */
export function coverage({ keywords = [], listings = {}, own = null, th } = {}) {
  const t = th?.stage3 || {};
  const mustAt = typeof t.mustHaveShare === "number" ? t.mustHaveShare : 0.6;
  const whiteAt = typeof t.whiteSpaceShare === "number" ? t.whiteSpaceShare : 0.05;

  const pages = Object.values(listings || {}).filter((l) => l && !l.error && (l.title || l.bullets?.length));
  const parsed = pages.map(fieldsOf);
  const n = parsed.length;
  const fetchedAt = pages.reduce((a, l) => (l.fetchedAt && (!a || l.fetchedAt > a) ? l.fetchedAt : a), null);
  const ownFields = own && !own.error ? fieldsOf(own) : null;

  const weights = keywords.map((k) => k.weight || 0).sort((a, b) => a - b);
  const medianWeight = weights.length ? weights[Math.floor(weights.length / 2)] : 0;

  const items = keywords.map((k) => {
    const words = phraseTokens(k.phrase);
    let inTitle = 0, inBullets = 0, inSpecs = 0;
    for (const f of parsed) { if (covers(f.title, words)) inTitle++; if (covers(f.bullets, words)) inBullets++; if (covers(f.specs, words)) inSpecs++; }
    const titleShare = n ? inTitle / n : null;
    const anyShare = n ? parsed.filter((f) => covers(f.title, words) || covers(f.bullets, words) || covers(f.specs, words)).length / n : null;
    return {
      phrase: k.phrase, weight: k.weight || 0, buys: Boolean(k.buys), words,
      inTitle, inBullets, inSpecs, titleShare, anyShare,
      mustHave: n > 0 && titleShare >= mustAt,
      whiteSpace: n > 0 && titleShare <= whiteAt && (k.weight || 0) >= medianWeight,
      own: ownFields ? { inTitle: covers(ownFields.title, words), inBullets: covers(ownFields.bullets, words), inSpecs: covers(ownFields.specs, words) } : null,
    };
  });

  return { items, listings: n, fetchedAt, own: ownFields ? { asin: own.asin || null, fetchedAt: own.fetchedAt || null } : null };
}
