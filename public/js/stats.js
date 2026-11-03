/* Раздел «Статистика по всем анализам» (spec 018). Классический скрипт (window.FBAStats), без import.
   Отдельный файл, а не часть render.js: render.js целиком инлайнится в автономный HTML-экспорт и грузится
   на страницах публичных ссылок — разделу, которого там нет и быть не может, незачем туда ехать.
   Требует Chart.js (window.Chart). */
(function () {
  "use strict";
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const fmtN = (v) => (Number.isFinite(Number(v)) ? Number(v).toLocaleString("ru-RU") : "—");
  const fmt1 = (v) => (Number.isFinite(Number(v)) ? Number(v).toLocaleString("ru-RU", { maximumFractionDigits: 1 }) : "—");
  const cssVar = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  const series = () => ["--s1", "--s2", "--s3", "--s4", "--s5", "--s6", "--s7", "--s8"].map(cssVar);
  const pctOf = (c, n) => (n ? (c / n) * 100 : 0);
  /** Процент НИКОГДА не печатается один: рядом всегда число и база, от которой он взят (FR-013). */
  const withBase = (c, n) => `${fmt1(pctOf(c, n))} % — ${fmtN(c)} из ${fmtN(n)}`;
  const dt = (iso) => (iso ? new Date(iso).toLocaleString("ru-RU", { dateStyle: "medium", timeStyle: "short" }) : "—");

  // ---------- кирпичики ----------
  let seq = 0;
  const pending = [];
  /** Блок: заголовок, пояснение, график и — обязательно — та же цифра таблицей (FR-021, SC-009). */
  function block(title, note, cfg, table, cls) {
    const id = "stc" + ++seq;
    pending.push({ id, cfg });
    return `<div class="stblock">
      <h3>${esc(title)}</h3>${note ? `<p class="muted">${note}</p>` : ""}
      <div class="chartbox ${cls || ""}"><canvas id="${id}"></canvas></div>
      <details class="sttable"><summary>Таблица</summary><div class="tablewrap">${table}</div></details>
    </div>`;
  }
  const rowsTable = (rows, n, what) => `<table><thead><tr><th>${esc(what || "Показатель")}</th><th>Анализов</th><th>Доля</th></tr></thead><tbody>${
    rows.map((r) => `<tr><td>${esc(r.label)}</td><td>${fmtN(r.count)}</td><td>${withBase(r.count, n)}</td></tr>`).join("")}</tbody></table>`;

  const hBar = (rows, color) => ({
    type: "bar",
    data: { labels: rows.map((r) => r.label), datasets: [{ data: rows.map((r) => r.count), backgroundColor: color || series()[0], borderRadius: 4, maxBarThickness: 26 }] },
    options: { indexAxis: "y", plugins: { legend: { display: false } }, scales: { x: { beginAtZero: true, ticks: { precision: 0 } } } },
  });
  const stacked = (labels, sets) => ({
    type: "bar",
    data: { labels, datasets: sets },
    options: { indexAxis: "y", plugins: { legend: { position: "bottom" } }, scales: { x: { stacked: true, beginAtZero: true, ticks: { precision: 0 } }, y: { stacked: true } } },
  });

  // ---------- шапка: на какой момент посчитано ----------
  function head(f, mismatch, n) {
    const bits = [`<span class="chip">посчитано на ${esc(dt(f.computedAt))}</span>`];
    if (f.recomputing) bits.push(`<span class="chip pending">идёт пересчёт${f.methodChanged ? ": изменилась методика, пересчитываются все анализы" : `: ${fmtN(f.stale)}`} — пока показаны прежние цифры</span>`);
    else if (f.recomputeError) bits.push(`<span class="chip fail">пересчёт не прошёл: ${esc(f.recomputeError)} — цифры прежние</span>`);
    else if (f.stale) bits.push(`<span class="chip warn">не досчитано: ${fmtN(f.stale)}</span>`);
    if (f.empty) bits.push(`<span class="chip na">пустых черновиков вне статистики: ${fmtN(f.empty)}</span>`);
    if (f.failed) bits.push(`<span class="chip fail">не удалось пересчитать: ${fmtN(f.failed)}</span>`);
    const fails = f.failed ? `<p class="muted">Исключены из статистики: ${(f.failures || []).map((x) => `${esc(x.niche || "без названия")} — ${esc(x.error)}`).join("; ")}.</p>` : "";
    const changed = mismatch && mismatch.count
      ? `<p class="notice info">У <b>${fmtN(mismatch.count)}</b> ${mismatch.count === 1 ? "анализа" : "анализов"} из ${fmtN(n)} сохранённый вердикт расходится с пересчитанным: методика менялась, а записанный в анализе результат остался от прежней. Здесь всё посчитано заново текущей методикой; сами анализы не тронуты — в таблице ниш такие строки помечены, и рядом стоит прежний вердикт.</p>`
      : "";
    return `<div class="panel section" id="stats-head">
      <h2>Статистика по всем анализам</h2>
      <p class="muted">Считается по ${fmtN(n)} ${n === 1 ? "анализу" : "анализам"} с данными из ${fmtN(f.total)} живых. Каждая цифра получена пересчётом текущей методикой, а не чтением сохранённого результата.</p>
      <div class="row" style="flex-wrap:wrap;gap:.4rem">${bits.join("")}</div>${fails}${changed}</div>`;
  }

  // ---------- срезы ----------
  function verdicts(s) {
    const rows = s.verdicts.filter((v) => v.count);
    const color = { good: cssVar("--ok"), warning: cssVar("--warn"), serious: cssVar("--pending"), critical: cssVar("--fail") };
    const cfg = { type: "doughnut", data: { labels: rows.map((r) => r.label), datasets: [{ data: rows.map((r) => r.count), backgroundColor: rows.map((r) => color[r.status]), borderWidth: 0 }] },
      options: { plugins: { legend: { position: "bottom" } } } };
    return block("Вердикты", `Чем закончился каждый анализ. Сумма — ${fmtN(s.n)}.`, cfg, rowsTable(s.verdicts, s.n, "Вердикт"), "short");
  }

  function decisive(s) {
    const note = "Причина, на которой анализ остановился — <b>одна на анализ</b>, поэтому доли складываются в 100 %.";
    return block("Решающая причина — по категориям", note, hBar(s.decisiveCat), rowsTable(s.decisiveCat, s.n, "Категория"), "short")
      + block("Решающая причина — подробно по гейтам", "Та же картина, но видно, какой именно гейт не сошёлся.", hBar(s.decisiveDet, series()[1]), rowsTable(s.decisiveDet, s.n, "Гейт"));
  }

  function frequency(s) {
    const sum = s.freqCat.reduce((a, b) => a + b.count, 0);
    const note = `Это <b>другой</b> срез, не решающая причина. Здесь каждая ниша голосует за <b>каждую</b> свою проблему, а не только за ту, на которой остановилась, — поэтому сумма (${fmtN(sum)}) больше ${fmtN(s.n)} и доли дают больше 100 %. Сравнение с решающей причиной и показывает, что мешает <i>везде</i>, а что действительно <i>валит</i>.`;
    return block("Как часто проблема есть вообще — по категориям", note, hBar(s.freqCat, series()[2]), rowsTable(s.freqCat, s.n, "Категория"), "short")
      + block("Как часто проблема есть вообще — поимённо", "", hBar(s.freqOne, series()[3]), rowsTable(s.freqOne, s.n, "Проблема"), "tall");
  }

  function criterion1(s) {
    const C = { fail: cssVar("--fail"), warn: cssVar("--warn"), na: cssVar("--na"), ok: cssVar("--ok") };
    const L = { fail: "не OK", warn: "погранично", na: "нет данных", ok: "OK" };
    const cfg = stacked(s.c1rows.map((r) => r.label), ["fail", "warn", "na", "ok"].map((k) => ({ label: L[k], data: s.c1rows.map((r) => r[k]), backgroundColor: C[k], borderRadius: 3 })));
    const table = `<table><thead><tr><th>Подпункт</th><th>не OK</th><th>погранично</th><th>нет данных</th><th>OK</th><th>зелёный у</th></tr></thead><tbody>${
      s.c1rows.map((r) => `<tr><td>${esc(r.label)}</td><td>${fmtN(r.fail)}</td><td>${fmtN(r.warn)}</td><td>${fmtN(r.na)}</td><td>${fmtN(r.ok)}</td><td>${withBase(r.ok, s.n)}</td></tr>`).join("")}</tbody></table>`;
    return block("Критерий 1 по восьми подпунктам",
      `Порог прошли <b>${fmtN(s.c1pass)}</b> из ${fmtN(s.n)} — ${withBase(s.c1pass, s.n)}. В среднем зелёных подпунктов: <b>${fmt1(s.c1avg)}</b> из 8.`,
      cfg, table, "tall");
  }

  function economics(s) {
    const C = { no_go: cssVar("--fail"), rework: cssVar("--pending"), pass: cssVar("--ok") };
    const L = { no_go: "NO-GO", rework: "ДОРАБОТКА", pass: "PASS" };
    const g = s.eco.gates;
    const cfg = stacked(g.map((x) => x.label), ["no_go", "rework", "pass"].map((k) => ({ label: L[k], data: g.map((x) => x[k]), backgroundColor: C[k], borderRadius: 3 })));
    const table = `<table><thead><tr><th>Гейт</th><th>NO-GO</th><th>ДОРАБОТКА</th><th>PASS</th><th>База</th></tr></thead><tbody>${
      g.map((x) => `<tr><td>${esc(x.label)}</td><td>${fmtN(x.no_go)}</td><td>${fmtN(x.rework)}</td><td>${fmtN(x.pass)}</td><td>${fmtN(x.total)}</td></tr>`).join("")}</tbody></table>`;
    return block("Экономика по Gate 1 и Gate 2",
      `Считается только там, где введён COGS: <b>${fmtN(s.eco.total)}</b> из ${fmtN(s.n)}. Ещё у <b>${fmtN(s.eco.noCogs)}</b> экономика не заполнена — это не ноль и не провал, это незаконченная работа.`,
      cfg, table, "short");
  }

  function challenger(s) {
    const C = { fail: cssVar("--fail"), na: cssVar("--na"), ok: cssVar("--ok") };
    const L = { fail: "не OK", na: "нет данных", ok: "OK" };
    const cfg = stacked(s.chrows.map((r) => r.label), ["fail", "na", "ok"].map((k) => ({ label: L[k], data: s.chrows.map((r) => r[k]), backgroundColor: C[k], borderRadius: 3 })));
    const table = `<table><thead><tr><th>Критерий</th><th>не OK</th><th>нет данных</th><th>OK</th></tr></thead><tbody>${
      s.chrows.map((r) => `<tr><td>${esc(r.label)}</td><td>${fmtN(r.fail)}</td><td>${fmtN(r.na)}</td><td>${fmtN(r.ok)}</td></tr>`).join("")}</tbody></table>`;
    return block("Критерии 1–8 (решётка)", "«Нет данных» показано наравне с «не OK»: критерий, который никто ни разу не заполнил, выглядит в сводке как пройденный, если это не назвать.", cfg, table, "tall");
  }

  function scorecard(s) {
    const BL = { go: "Go (60 % и выше)", rework: "Доработка (40–59 %)", no_go: "No-Go (ниже 40 %)" };
    const BC = { go: cssVar("--ok"), rework: cssVar("--pending"), no_go: cssVar("--fail") };
    const bands = s.scorecard.bands.map((b) => ({ label: BL[b.key] || b.key, count: b.count, key: b.key }));
    const cfg = { type: "doughnut", data: { labels: bands.map((b) => b.label), datasets: [{ data: bands.map((b) => b.count), backgroundColor: bands.map((b) => BC[b.key] || cssVar("--na")), borderWidth: 0 }] },
      options: { plugins: { legend: { position: "bottom" } } } };
    const weak = `<table><thead><tr><th>Самая слабая ось</th><th>Анализов</th><th>Доля</th></tr></thead><tbody>${
      s.scorecard.weakest.map((w) => `<tr><td>${esc(w.label)}</td><td>${fmtN(w.count)}</td><td>${withBase(w.count, s.n)}</td></tr>`).join("")}</tbody></table>`;
    return block("Scorecard", `Средний балл по всем анализам — <b>${fmt1(s.scorecard.avg)} %</b>.`, cfg, rowsTable(bands, s.n, "Полоса") + weak, "short");
  }

  // ---------- US5: пороги, которые ничего не различают ----------
  function blind(s) {
    if (!s.blind || !s.blind.length) return "";
    return `<div class="panel section" id="stats-blind">
      <h2>Пороги, которые ничего не различают</h2>
      <p class="muted">Подпункт или критерий, который зелёный почти никогда или почти всегда, занимает место в счёте зелёных, но хорошую нишу от плохой не отделяет. Это повод поправить порог или признать, что показатель не заполняется.</p>
      <ul>${s.blind.map((b) => `<li><b>${esc(b.label)}</b> <span class="muted">(${esc(b.kind)})</span> — ${esc(b.why)}.</li>`).join("")}</ul></div>`;
  }

  // ---------- US4: от процента к нише ----------
  function niches(data) {
    const s = data.summary, rows = data.rows;
    const cats = [{ label: "все", count: s.n }].concat(s.decisiveCat);
    const chips = cats.map((c, i) => `<button class="stfilter${i ? "" : " active"}" data-cat="${esc(i ? c.label : "")}">${esc(c.label)} · ${fmtN(c.count)}</button>`).join("");
    const body = rows.map((r) => `<tr data-cat="${esc(r.cat)}">
        <td>${esc(r.niche || "без названия")}</td>
        <td><span class="status ${esc({ good: "ok", warning: "warn", serious: "pending", critical: "fail" }[r.status] || "na")}">${esc(r.verdict)}</span>${r.changed ? ` <span class="chip warn" title="Сохранённый в анализе вердикт остался от прежней методики">было: ${esc(r.was)}</span>` : ""}</td>
        <td>${esc(r.why || "—")}</td><td>${esc(r.cat)}</td>
        <td>${r.c1 == null ? "—" : fmtN(r.c1) + " из 8"}</td>
        <td>${r.score == null ? "—" : fmtN(r.score) + " %"}</td>
        <td>${r.cogs ? '<span class="chip ok">есть</span>' : '<span class="chip na">нет</span>'}</td>
        <td><button data-open="${esc(r.id)}">Открыть</button></td></tr>`).join("");
    return `<div class="panel section" id="stats-niches">
      <h2>Ниши <span class="muted" style="font-weight:400;font-size:.8rem">вердикт из пересчёта, а не из сохранённого</span></h2>
      <div class="row stfilters" style="flex-wrap:wrap;gap:.3rem">${chips}</div>
      <p class="muted" id="stats-count"></p>
      <div class="tablewrap"><table id="stats-rows"><thead><tr><th>Ниша</th><th>Вердикт</th><th>Решающая причина</th><th>Категория</th><th>Критерий 1</th><th>Scorecard</th><th>COGS</th><th></th></tr></thead><tbody>${body}</tbody></table></div></div>`;
  }

  /** Фильтр по категории причины — на месте, без похода на сервер: все строки уже здесь. */
  function bindFilter(root) {
    const box = root.querySelector("#stats-niches"); if (!box) return;
    const count = box.querySelector("#stats-count");
    const apply = (cat) => {
      let shown = 0;
      for (const tr of box.querySelectorAll("tbody tr")) { const on = !cat || tr.dataset.cat === cat; tr.classList.toggle("hidden", !on); if (on) shown++; }
      count.textContent = cat ? `Показано ниш: ${fmtN(shown)} — решающая причина из категории «${cat}»` : `Показаны все ниши: ${fmtN(shown)}`;
    };
    box.querySelector(".stfilters").addEventListener("click", (e) => {
      const b = e.target.closest(".stfilter"); if (!b) return;
      for (const x of box.querySelectorAll(".stfilter")) x.classList.toggle("active", x === b);
      apply(b.dataset.cat);
    });
    apply("");
  }

  // ---------- сборка ----------
  function empty(f) {
    const box = (body) => `<div class="panel section"><h2>Статистика по всем анализам</h2>${body}</div>`;
    // Первое открытие после развёртывания: кэш итогов пуст, устарело ВСЁ, догон уже идёт в фоне.
    // Без этой ветки раздел говорит «ни в одном нет загруженных отчётов» — и это неправда (поймано на проде 2026-11-03).
    if (f.recomputing) {
      const n = f.stale || f.total;
      return box(`<p>Идёт первый расчёт: ${fmtN(n)} ${n === 1 ? "анализ" : "анализов"} считается заново текущей методикой. По замеру это около ${fmtN(Math.max(5, Math.round(n * 0.3)))} с.</p>
        <p class="muted">Нажимать ничего не нужно: обновите страницу через минуту — цифры будут на месте.</p>`);
    }
    if (f.recomputeError) {
      return box(`<p>Пересчёт не прошёл: ${esc(f.recomputeError)}.</p>
        <p class="muted">Цифр пока нет. Раздел попробует снова при следующем открытии.</p>`);
    }
    return box(`<p>Считать пока нечего. В базе ${fmtN(f.total)} ${f.total === 1 ? "анализ" : "анализов"}, но ни в одном нет загруженных отчётов${f.empty ? ` (пустых черновиков: ${fmtN(f.empty)})` : ""}${f.failed ? `, а ${fmtN(f.failed)} не удалось пересчитать` : ""}.</p>
      <p class="muted">Раздел наполнится сам, как только в анализах появятся отчёты Xray, Cerebro или POE — пересчитывать руками ничего не нужно.</p>`);
  }

  function render(root, data) {
    for (const c of Object.values(root.__charts || {})) { try { c.destroy(); } catch {} }
    root.__charts = {}; pending.length = 0;
    const s = data && data.summary;
    if (!s || !s.n) { root.innerHTML = empty((data && data.freshness) || { total: 0 }); return; }

    root.innerHTML = head(data.freshness, data.mismatch, s.n)
      + `<div class="panel section stgrid">${verdicts(s) + decisive(s) + frequency(s) + criterion1(s) + economics(s) + challenger(s) + scorecard(s)}</div>`
      + blind(s) + niches(data);
    bindFilter(root);

    if (!window.Chart) { for (const b of root.querySelectorAll(".chartbox")) b.innerHTML = '<div class="notice fail">Chart.js не загрузился — цифры доступны через «Таблица» под каждым блоком</div>'; pending.length = 0; return; }
    for (const { id, cfg } of pending) {
      const canvas = root.querySelector("#" + id); if (!canvas) continue;
      try { root.__charts[id] = new window.Chart(canvas.getContext("2d"), cfg); }
      catch (e) { console.error("stats chart", id, e); canvas.closest(".chartbox").innerHTML = '<div class="notice fail">График не отрисован — цифры есть в таблице ниже</div>'; }
    }
    pending.length = 0;
  }

  window.FBAStats = { render };
})();
