// Spec 021 — разбор ответов площадок. Чистые функции, сети нет: проверяются на сохранённых образцах.
//
// ГЛАВНОЕ ПРАВИЛО: ответ не на том языке — это ОТКАЗ С ПРИЧИНОЙ, а не пустота (D8).
// Замер 2026-11-12: та же страница с другого адреса вернула «2 lata temu» и «wyświetleń».
// Разборщик под английский не нашёл бы там ничего и записал бы «нет данных» — честно
// по форме и неверно по сути: данные были.

const DAY_MS = 86_400_000;
const isNum = (v) => typeof v === "number" && Number.isFinite(v);

/** Пробелы всех видов, включая НЕРАЗРЫВНЫЙ: на чужом языке он служит разделителем разрядов
 *  («31 238»), и разборщик, который чистит только запятые, получил бы 31 вместо 31238 —
 *  то есть не пустоту, а неверное число, которого никакой сторож пустоты не поймает. */
const SPACES = /[\s   ]/g;

/** «4.09M», «812K», «1.68M» → число. Суффиксы K/M/B. */
export function parseCompact(s) {
  const t = String(s ?? "").replace(SPACES, "").replace(/,/g, "");
  const m = /^(\d+(?:\.\d+)?)([KMB])?$/i.exec(t);
  if (!m) return null;
  const mult = { K: 1e3, M: 1e6, B: 1e9 }[(m[2] || "").toUpperCase()] ?? 1;
  return Number(m[1]) * mult;
}

/** «66,034», «31 238», «31 238» (неразрывный) → число. */
export function parseGrouped(s) {
  const t = String(s ?? "").replace(SPACES, "").replace(/,/g, "");
  return /^\d+$/.test(t) ? Number(t) : null;
}

const AGE_UNIT_DAYS = { second: 1 / 86400, minute: 1 / 1440, hour: 1 / 24, day: 1, week: 7, month: 30.44, year: 365.25 };
const SHORT_UNIT = { s: "second", m: "minute", h: "hour", d: "day", w: "week", mo: "month", y: "year" };

/**
 * Английский относительный возраст → сутки. «20h ago», «1d ago», «2w ago», «3mo ago», «9y ago»
 * и полные формы «2 weeks ago». Чужой язык сюда НЕ попадает намеренно: его ловит сторож языка.
 */
export function parseRelativeAgeDays(s) {
  const t = String(s ?? "").trim().toLowerCase();
  let m = /^(\d+)\s*(mo|[smhdwy])\s+ago$/.exec(t);
  if (m) return Number(m[1]) * AGE_UNIT_DAYS[SHORT_UNIT[m[2]]];
  m = /^(\d+)\s+(second|minute|hour|day|week|month|year)s?\s+ago$/.exec(t);
  if (m) return Number(m[1]) * AGE_UNIT_DAYS[m[2]];
  return null;
}

/** Английский текст просмотров. «No views» — это ОТСУТСТВИЕ, а не ноль. */
export function parseViewCount(s) {
  const t = String(s ?? "").trim();
  if (/^no views$/i.test(t)) return null;
  const m = /^([\d,  \s]+)\s*views?$/i.exec(t);
  return m ? parseGrouped(m[1]) : null;
}

/** Похоже ли на английский. Сторож языка строится на этом, а не на попытке разобрать. */
const looksEnglishViews = (s) => /^no views$/i.test(String(s ?? "").trim()) || /\bviews?\b/i.test(String(s ?? ""));
const looksEnglishAge = (s) => /\bago\b/i.test(String(s ?? ""));

/** Отказ разбора: у него ВСЕГДА есть причина — строки «не разобралось» без причины не бывает. */
const fail = (code, message) => ({ items: [], dropped: 0, failCode: code, failMessage: message });

const runs = (o) => (Array.isArray(o?.runs) ? o.runs.map((r) => r?.text ?? "").join("") : (o?.simpleText ?? ""));

/** Рекурсивный сбор объектов по ключу: путь внутри ответа площадки меняется, а имя ключа — нет. */
function collect(node, key, out = []) {
  if (Array.isArray(node)) { for (const v of node) collect(v, key, out); return out; }
  if (node && typeof node === "object") {
    for (const [k, v] of Object.entries(node)) {
      if (k === key && v && typeof v === "object") out.push(v);
      else collect(v, key, out);
    }
  }
  return out;
}

// ---------- мессенджер: превью публичного канала ----------

/** Дата здесь АБСОЛЮТНАЯ (ISO с зоной) — от языка не зависит, ловушки D8 нет. */
export function parseChannelPreview(html, { now = Date.now() } = {}) {
  const text = String(html ?? "");
  const blocks = text.split("tgme_widget_message_wrap").slice(1);
  if (!blocks.length) return fail("unparsed", "В ответе нет ни одного поста — похоже, разметка площадки изменилась");

  const items = []; let dropped = 0;
  for (const b of blocks) {
    const post = /data-post="([^"]+)"/.exec(b)?.[1];
    const when = /<time datetime="([^"]+)"/.exec(b)?.[1];
    if (!post || !when) { dropped++; continue; }
    const views = /class="tgme_widget_message_views">([^<]+)</.exec(b)?.[1];
    const body = /class="tgme_widget_message_text[^"]*"[^>]*>([\s\S]*?)<\/div>/.exec(b)?.[1] ?? "";
    items.push({
      externalId: post,
      url: "https://t.me/" + post,
      title: stripTags(body).slice(0, 200) || post,
      snippet: stripTags(body).slice(0, 600),
      value: views == null ? null : parseCompact(views),
      publishedAt: new Date(when).toISOString(),
    });
  }
  if (!items.length) return fail("unparsed", "Посты в ответе есть, но ни один не разобрался");
  return { items, dropped, failCode: null, failMessage: null, now };
}

const stripTags = (s) => String(s).replace(/<br\s*\/?>/gi, " ").replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ")
  .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
  .replace(/\s+/g, " ").trim();

// ---------- видео: страница поиска по теме ----------

/**
 * Возраст здесь ОТНОСИТЕЛЬНЫЙ и на языке площадки. Поэтому сначала сторож языка,
 * и только потом разбор: иначе чужой язык вернул бы пустую выборку, выглядящую как
 * «ничего не нашлось».
 */
export function parseVideoSearch(data, { now = Date.now() } = {}) {
  const found = collect(data, "videoRenderer");
  if (!found.length) return fail("unparsed", "В ответе нет ни одного ролика — похоже, разметка площадки изменилась");

  const texts = found.map((v) => ({ views: v.viewCountText?.simpleText ?? "", age: v.publishedTimeText?.simpleText ?? "" }));
  const english = texts.filter((t) => looksEnglishViews(t.views) || looksEnglishAge(t.age)).length;
  if (english * 2 < texts.length) {
    const sample = texts.find((t) => t.views || t.age);
    return fail("wrong_language",
      "Площадка ответила на другом языке (например «" + (sample?.age || sample?.views) + "») — язык запроса не закрепился");
  }

  const items = []; let dropped = 0;
  for (const v of found) {
    const id = v.videoId;
    if (!id) { dropped++; continue; }
    const ageDays = parseRelativeAgeDays(v.publishedTimeText?.simpleText);
    items.push({
      externalId: id,
      url: "https://www.youtube.com/watch?v=" + id,
      title: runs(v.title),
      channel: runs(v.ownerText),
      snippet: runs(v.detailedMetadataSnippets?.[0]?.snippetText).slice(0, 600),
      value: parseViewCount(v.viewCountText?.simpleText),
      publishedAt: ageDays === null ? null : new Date(now - ageDays * DAY_MS).toISOString(),
    });
  }
  if (!items.length) return fail("unparsed", "Ролики в ответе есть, но ни один не разобрался");
  return { items, dropped, failCode: null, failMessage: null, now };
}

// ---------- краудфандинг: лента категории ----------

/**
 * Сумма берётся ТОЛЬКО из приведённого к одной валюте числового поля: в одном ответе измерены
 * четыре валюты, и сравнивать «собрано» между ними бессмысленно. Соседнее поле с долларовой
 * суммой приходит СТРОКОЙ — проверка «это число?» отбросила бы его молча у всех проектов сразу.
 */
export function parseCrowdfundingFeed(data, { now = Date.now() } = {}) {
  const list = Array.isArray(data?.projects) ? data.projects : null;
  if (!list) return fail("unparsed", "В ответе нет ленты проектов — похоже, площадка изменила формат");
  if (!list.length) return fail("unparsed", "Лента проектов пуста");

  const items = []; let dropped = 0;
  for (const p of list) {
    const id = p?.id, url = p?.urls?.web?.project;
    if (id == null || !url) { dropped++; continue; }
    const launched = isNum(p.launched_at) ? new Date(p.launched_at * 1000).toISOString() : null;
    items.push({
      externalId: String(id),
      url,
      title: String(p.name ?? ""),
      snippet: String(p.blurb ?? "").slice(0, 600),
      value: isNum(p.converted_pledged_amount) ? p.converted_pledged_amount : null,
      pledged: isNum(p.pledged) ? p.pledged : null,
      goal: isNum(p.goal) ? p.goal : null,
      backers: isNum(p.backers_count) ? p.backers_count : null,
      currency: p.currency ?? null,
      publishedAt: launched,
    });
  }
  if (!items.length) return fail("unparsed", "Проекты в ответе есть, но ни один не разобрался");
  const currencies = [...new Set(items.map((i) => i.currency).filter(Boolean))];
  return { items, dropped, failCode: null, failMessage: null, currencies, now };
}
