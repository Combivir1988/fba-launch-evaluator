// Spec 021 — радар товарных идей: суточный обход и сборка ленты.
//
// РАЗДЕЛ НИЧЕГО НЕ УТВЕРЖДАЕТ О ПРИГОДНОСТИ К ПРОДАЖЕ (FR-017, SC-005). Он показывает,
// что выбилось из фона собственного раздела, — и только. Большая часть того, что взлетает,
// товаром не является, и раздел, который начнёт выдавать «перспективные идеи», будет врать.
//
// РАСПИСАНИЕ (D9): таймер в процессе смотрит в БАЗУ, прошли ли сутки. Состояние — в базе,
// а не в памяти: перезапуск бывает на каждом развёртывании, и память его не переживает.
// Ленивое открытие дало бы дырки ровно в те дни, когда человек занят, — а потом лента
// сказала бы «ничего не выбилось», что неправда.
//
// ЗАМОК (образец server/stats.js:36): одно обещание на процесс — второй вызов ЖДЁТ первый,
// а не запускает свой. Площадки обходятся ПО ОДНОЙ: все сразу — это те самые 329 МБ при 0,5 ГБ.
import { mergeThresholds } from "../shared/thresholds.js";
import { rankSample, explainCandidate } from "../shared/idea-ranking.js";
import { groupCandidates } from "../shared/idea-dedupe.js";
import { fetchPage } from "./scrapfly.js";
import * as channels from "./sources/channels.js";
import * as video from "./sources/video.js";
import * as crowdfunding from "./sources/crowdfunding.js";
import { log } from "./log.js";

export const ADAPTERS = { channel: channels, video, crowdfunding };
export const PLATFORMS = Object.keys(ADAPTERS);

/** Причины отказа человеческими словами. Строки «не получилось» без причины не бывает. */
export const FAIL_TEXT = {
  rejected: "Площадка отклонила запрос",
  no_key: "Площадка отклонила прямой запрос, а обход защиты не настроен",
  credits: "Исчерпан лимит на загрузку страниц",
  rate: "Площадка попросила сбавить темп",
  asp: "Не удалось обойти проверку браузера",
  upstream: "Площадка ответила ошибкой",
  unparsed: "Ответ не разобран — похоже, разметка площадки изменилась",
  wrong_language: "Площадка ответила на другом языке",
  window_degenerate: "Отбор по дате не применился: в ответе почти нет свежего",
  no_background: "Сравнивать не с чем: слишком мало сопоставимых элементов",
  background_zero: "В разделе пока нет движения: фон равен нулю",
  cap_reached: "Достигнут суточный потолок расхода",
  network: "Не удалось связаться с площадкой",
};
const failMessage = (code, detail) => (detail ? `${FAIL_TEXT[code] ?? code}: ${detail}` : (FAIL_TEXT[code] ?? code));

/** Оценка расхода ДО запуска (FR-029). Служба предварительной оценки без выполнения НЕ даёт —
 *  проверено замером. Поэтому это ОЦЕНКА по множителям, и она помечена как оценка. */
export const COST_PER_REQUEST = { direct: 0, bypass: 1 };
export function estimateDailyCost(sources) {
  const perDay = sources.filter((s) => s.active).reduce((sum, s) =>
    sum + (ADAPTERS[s.platform]?.needsBypass ? COST_PER_REQUEST.bypass : COST_PER_REQUEST.direct), 0);
  return { perDay, perMonth: perDay * 30, estimate: true };
}

export function createIdeas(db, store, { getCap = async () => 0, cfg = {}, thresholds = null, now = () => Date.now(), fetchImpl = fetch } = {}) {
  const th = mergeThresholds(thresholds);
  let running = null;   // одно обещание на процесс
  let timer = null;

  /** Обход ОДНОГО раздела. Сутки столбятся ДО запроса — это и есть защита от двойного расхода. */
  async function sweepOne(source, date) {
    const adapter = ADAPTERS[source.platform];
    if (!adapter) return { status: "failed", code: "unparsed" };
    if (!(await store.claimRun(source.id, date))) return { status: "skipped" }; // сутки уже обойдены

    const url = adapter.buildUrl(source.handle, { market: source.market });
    let res;
    try {
      res = await fetchPage(url, cfg, { headers: adapter.headers(), forceBypass: adapter.needsBypass, fetchImpl });
    } catch (e) {
      await store.failRun(source.id, date, { code: "network", message: failMessage("network", e?.message) });
      return { status: "failed", code: "network" };
    }
    if (res.cost) await store.addSpend(res.cost, date);

    if (!res.ok) {
      const code = res.error?.code === "auth" ? "rejected" : (res.error?.code || "rejected");
      await store.failRun(source.id, date, { code, message: res.error?.message || failMessage(code), spent: res.cost, via: res.via });
      return { status: "failed", code, spent: res.cost };
    }

    const parsed = adapter.parse(res.body, { now: now() });
    if (parsed.failCode) {
      await store.failRun(source.id, date, { code: parsed.failCode, message: parsed.failMessage, spent: res.cost, via: res.via });
      return { status: "failed", code: parsed.failCode, spent: res.cost };
    }

    const ranked = rankSample(parsed.items, {
      now: now(), thresholds: th,
      thresholdMult: source.threshold_mult == null ? undefined : Number(source.threshold_mult),
      requireGoalRatio: adapter.requireGoalRatio, expectsFresh: adapter.expectsFresh,
    });

    // Отбор не состоялся — это ОТКАЗ С ПРИЧИНОЙ, а не пустая лента: показывать всё подряд
    // без фона запрещено, потому что без фона «выделяется» не определено.
    if (ranked.reason) {
      await store.failRun(source.id, date, {
        code: ranked.reason, message: failMessage(ranked.reason), spent: res.cost, via: res.via });
      return { status: "failed", code: ranked.reason, spent: res.cost, seen: ranked.seen };
    }

    await store.saveItems(source.id, date, ranked.items.filter((i) => !i.candidate)
      .map((i) => ({ ...i, raw: { value: i.value, ageDays: i.ageDays } })));
    for (const c of ranked.items.filter((i) => i.candidate)) {
      await store.upsertCandidate(source.id, date, { ...c, platform: source.platform, market: source.market, background: ranked.background });
    }
    await store.finishRun(source.id, date, {
      seen: ranked.seen, passed: ranked.passed, noMetric: ranked.noMetric,
      background: { median: ranked.background, sample: ranked.sampleSize, mult: ranked.thresholdMult },
      spent: res.cost, via: res.via,
    });
    return { status: "ok", seen: ranked.seen, passed: ranked.passed, spent: res.cost };
  }

  /** Весь обход: площадки ПО ОДНОЙ, с проверкой потолка ПЕРЕД каждым источником. */
  async function sweepAll({ date = store.today() } = {}) {
    if (running) return running;
    running = (async () => {
      const cap = await getCap();
      const sources = (await store.listSources()).filter((s) => s.active);
      const out = { date, done: 0, failed: 0, skipped: 0, stoppedByCap: false };

      for (const s of sources) {
        if (cap > 0 && (await store.spentOn(date)) >= cap) {
          // Потолок достигнут: собранное сохранено, НЕСОБРАННОЕ помечено несобранным, а не пустым.
          if (await store.claimRun(s.id, date)) {
            await store.failRun(s.id, date, { code: "cap_reached", message: failMessage("cap_reached") });
          }
          out.stoppedByCap = true; out.failed++;
          continue;
        }
        const r = await sweepOne(s, date);
        if (r.status === "ok") { out.done++; await store.resetFails(s.id); }
        else if (r.status === "skipped") out.skipped++;
        else {
          out.failed++;
          const fails = await store.bumpFails(s.id);
          if (fails >= th.ideas.failsBeforePause) {
            await store.pauseSource(s.id, `${failMessage(r.code)} — ${fails} раз подряд. Раздел приостановлен, расход прекращён`);
          }
        }
      }
      try { out.cleaned = await store.cleanupItems(th.ideas.keepItemDays); } catch { out.cleaned = 0; }
      log("info", "ideas sweep", out);
      return out;
    })().finally(() => { running = null; });
    return running;
  }

  /** Прошли ли сутки — смотрим в БАЗУ. Память перезапуск не переживает, база переживает. */
  async function dueToday(date = store.today()) {
    const sources = (await store.listSources()).filter((s) => s.active);
    if (!sources.length) return false;
    const done = new Set((await store.runsOn(date)).map((r) => r.source_id));
    return sources.some((s) => !done.has(s.id));
  }

  function start({ everyMs = 60 * 60 * 1000 } = {}) {
    if (timer) return;
    timer = setInterval(() => { dueToday().then((d) => d && sweepAll()).catch((e) => log("warn", "ideas sweep failed", { err: e?.message })); }, everyMs);
    timer.unref?.();
  }
  const stop = () => { if (timer) { clearInterval(timer); timer = null; } };

  // ---------- лента ----------

  /**
   * Состояние КАЖДОГО заведённого раздела показывается всегда, даже когда он не собран.
   * «Источник не ответил» и «найдено 0» — разные вещи: ноль читается как «спроса нет»,
   * а это противоположный вывод (ворота SC-002).
   */
  async function get({ sinceDays = 7 } = {}) {
    const [sources, runs, items, cap] = await Promise.all([
      store.listSources(), store.lastRuns(), store.feed({ sinceDays }), getCap(),
    ]);
    const byId = new Map(runs.map((r) => [r.source_id, r]));
    const today = store.today();

    const sourceRows = sources.map((s) => {
      const r = byId.get(s.id);
      const collectedToday = r?.run_date && String(r.run_date).slice(0, 10) === today && r.status === "ok";
      return {
        id: s.id, platform: s.platform, handle: s.handle, title: s.title, market: s.market,
        active: s.active, pausedReason: s.paused_reason, thresholdMult: s.threshold_mult == null ? null : Number(s.threshold_mult),
        // ТРИ разных состояния, и они никогда не сливаются в одно:
        //   collected — собран; failed — не собран, причина названа; never — ещё ни разу.
        state: !r ? "never" : r.status === "ok" ? "collected" : "failed",
        collectedToday,
        lastRun: r ? {
          date: String(r.run_date).slice(0, 10), status: r.status,
          failCode: r.fail_code, failMessage: r.fail_message,
          // счётчики ОТСУТСТВУЮТ, когда обхода не было: null — это не ноль
          seen: r.seen_count, passed: r.passed_count, noMetric: r.no_metric,
          background: r.background, via: r.via, spent: r.spent == null ? null : Number(r.spent),
        } : null,
      };
    });

    const notCollected = sourceRows.filter((s) => s.state !== "collected" || !s.collectedToday);
    const spent = await store.spentOn(today);

    return {
      sources: sourceRows,
      // Раздел называет, какого источника в ленте не хватает и почему.
      notCollected: notCollected.map((s) => ({ id: s.id, title: s.title, platform: s.platform, market: s.market, reason: s.lastRun?.failMessage ?? "Ещё ни разу не собирался" })),
      complete: notCollected.length === 0,
      // Склейка КОНСЕРВАТИВНАЯ (D10): ложная склейка прячет одну из двух вещей, и человек не узнает,
      // что она была; дубль он просто отмахнёт.
      // Пояснение считается ПОСЛЕ склейки: число площадок — часть основания.
      feed: groupCandidates(items.map(feedRow)).map((c) => ({ ...c, explain: explainCandidate(c) })),
      counters: {
        seen: sumOrNull(sourceRows, "seen"), passed: sumOrNull(sourceRows, "passed"), noMetric: sumOrNull(sourceRows, "noMetric"),
        sources: sourceRows.length, collected: sourceRows.length - notCollected.length,
      },
      spend: { today: spent, cap, estimate: estimateDailyCost(sources) },
      thresholds: th.ideas,
    };
  }

  /** Сумма по собранным; null — если не собран ни один. Ноль здесь означал бы «посмотрели и не нашли». */
  function sumOrNull(rows, key) {
    const vals = rows.map((s) => s.lastRun?.[key]).filter((v) => v != null);
    return vals.length ? vals.reduce((a, b) => a + Number(b), 0) : null;
  }

  const feedRow = (c) => ({
    id: c.id, platform: c.platform, market: c.market, title: c.title, url: c.url, snippet: c.snippet,
    sourceTitle: c.source_title, publishedAt: c.published_at,
    firstSeenOn: String(c.first_seen_on).slice(0, 10), lastSeenOn: String(c.last_seen_on).slice(0, 10),
    daysHeld: c.days_held, ratio: Number(c.ratio), metric: Number(c.metric), background: Number(c.background),
    decision: c.decision, analysisId: c.analysis_id, platforms: c.platforms,
  });

  return { sweepOne, sweepAll, dueToday, start, stop, get, feedRow, thresholds: th, isRunning: () => Boolean(running) };
}
