/* Радар товарных идей (spec 021). Классический скрипт (window.FBAIdeas), без import.
   ОТДЕЛЬНЫЙ файл, а не часть render.js: render.js целиком инлайнится в автономный HTML-экспорт
   и грузится на страницах публичных ссылок — разделу, которого там нет и быть не может,
   незачем туда ехать (FR-003, SC-011). Это прецедент spec 018.

   ГЛАВНОЕ ПРАВИЛО ТЕКСТОВ (FR-017, ворота SC-005): раздел НИГДЕ не утверждает, что найденное —
   хорошая или перспективная товарная идея. Ни числом, ни словом, ни порядком сортировки,
   который читался бы как оценка. Большая часть того, что взлетает, товаром не является,
   и раздел, который начнёт выдавать «перспективные идеи», будет врать — а по нему закупят партию. */
(function () {
  "use strict";
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const fmtN = (v) => (Number.isFinite(Number(v)) ? Number(v).toLocaleString("ru-RU") : "—");
  const fmt1 = (v) => (Number.isFinite(Number(v)) ? Number(v).toLocaleString("ru-RU", { maximumFractionDigits: 1 }) : "—");
  const dt = (iso) => (iso ? new Date(iso).toLocaleDateString("ru-RU", { dateStyle: "medium" }) : "—");

  /* Словарь пояснений СВОЙ, а не в render.js — и это решено осознанно, а не по недосмотру.
     render.js целиком уезжает в публичные ссылки и в скачанный файл; положи термины радара туда —
     и слова про раздел поехали бы наружу текстом, хотя самого раздела там нет.
     Всплывающую подсказку рисует общий механизм (window.FBARender.initTips) — он слушает документ
     и работает с любым элементом, у которого есть data-tip. */
  const IDEA_TIPS = {
    "Фон раздела": "Медиана приведённого к возрасту показателя среди элементов того же обхода. Медиана, а не среднее: один виральный элемент не должен выключать отбор на весь раздел.",
    "Приведённый показатель": "Просмотры или собранные деньги, делённые на возраст в сутках. Без приведения сравнение систематически топит свежее — то, ради чего раздел и существует.",
    "Кратность порога": "Во сколько раз показатель должен превышать фон своего раздела, чтобы элемент попал в ленту. Меняется во вкладке «Пороги»; у раздела может быть своя.",
    "Без показателя": "Площадка не дала числа. Это НЕ ноль: ноль означал бы «вещь никому не интересна», а тут мы просто не знаем.",
    "Не собрано": "К площадке не удалось сходить или ответ не разобрался. Это не «ничего не нашлось» — цифр за эти сутки просто нет.",
    "Держится": "Сколько суток подряд элемент продолжает выделяться. Однодневный всплеск и то, что держится неделю, — разные вещи.",
    "Отклонение от фона": "Во сколько раз показатель выше середины своего раздела. Это мера отклонения, а не оценка товара.",
    "Расход": "Сколько потрачено на загрузку страниц. Оценка на будущее считается по числу разделов и помечена как оценка: предварительной цены без выполнения запроса служба не даёт.",
    "За последний обход": "Числа последнего УДАЧНОГО обхода этого раздела. Если обход не удался, чисел нет вовсе — и это видно отдельно.",
    "Обход защиты": "Площадка отклоняет прямой запрос, и страница берётся через посредника. Замер: это один кредит, не двадцать пять.",
  };
  const tip = (label) => (IDEA_TIPS[label] ? ` data-tip="${esc(IDEA_TIPS[label])}" tabindex="0" class="has-tip"` : "");

  const PLATFORM = {
    channel: { name: "Канал мессенджера", hint: "Поиска по площадке не существует: радар видит только названные каналы" },
    video: { name: "Тема в видео", hint: "Запрос идёт с закреплённым языком и фильтром по дате" },
    crowdfunding: { name: "Категория краудфандинга", hint: "Показывает оплаченный замысел, а не внимание" },
  };
  const pname = (p) => PLATFORM[p]?.name ?? p;

  // ---------- что раздел ДЕЛАЕТ и чего НЕ делает ----------
  const preamble = () => `<div class="panel section">
    <h2>Идеи</h2>
    <p>Раз в сутки раздел обходит заведённые разделы площадок и показывает то, что <b>выбилось из фона
    своего же раздела</b>: собрало заметно больше обычного для этого места, с поправкой на возраст.</p>
    <p class="muted">Раздел <b>не оценивает пригодность к продаже</b> и не говорит, стоит ли это продавать.
    Большая часть того, что взлетает, товаром не является. Порядок в ленте — по дате, а не по «перспективности».
    Проверка ниши — это отдельная работа во вкладке «Анализ».</p>
  </div>`;

  // ---------- состояние источников: отказ НИКОГДА не выглядит пустотой ----------
  function sourcesBlock(d) {
    const rows = d.sources.map((s) => {
      const r = s.lastRun;
      const state = !s.active
        ? `<span class="chip warn">${s.pausedReason ? "Приостановлен системой" : "Приостановлен вами"}</span>`
        : s.state === "collected" && s.collectedToday ? `<span class="chip ok">Собран сегодня</span>`
        : s.state === "never" ? `<span class="chip">Ещё не собирался</span>`
        : `<span class="chip fail">Не собран</span>`;
      // Счётчики показываются ТОЛЬКО когда обход был удачным. Ноль вместо «не собрано»
      // читался бы как «посмотрели и ничего нет» — противоположный вывод.
      const numbers = r && r.status === "ok"
        ? `${fmtN(r.seen)} обработано · ${fmtN(r.passed)} прошло · ${fmtN(r.noMetric)} <span${tip("Без показателя")}>без показателя</span>`
        : `<span class="muted"${tip("Не собрано")}>не собрано — цифр за эти сутки нет</span>`;
      const why = s.pausedReason || (r && r.status === "failed" ? r.failMessage : "");
      return `<tr>
        <td><b>${esc(s.title)}</b><div class="muted">${esc(pname(s.platform))} · ${esc(s.handle)}</div></td>
        <td>${state}${why ? `<div class="muted">${esc(why)}</div>` : ""}</td>
        <td>${numbers}</td>
        <td>${r ? esc(r.date) : "—"}${r?.via ? `<div class="muted">${r.via === "direct" ? "прямым запросом" : `<span${tip("Обход защиты")}>через обход защиты</span>`}</div>` : ""}</td>
        <td class="nowrap">
          <button data-ideas="toggle" data-id="${s.id}" data-active="${s.active ? "0" : "1"}">${s.active ? "Приостановить" : "Запустить"}</button>
          <button data-ideas="remove" data-id="${s.id}">Удалить</button>
        </td></tr>`;
    }).join("");

    const missing = d.notCollected.length
      ? `<div class="notice warn"><b>В ленте не хватает:</b> ${d.notCollected.map((s) =>
          `${esc(s.title)} — ${esc(s.reason)}`).join("; ")}. Это <b>не</b> значит, что там ничего нет: туда не удалось посмотреть.</div>`
      : `<div class="notice ok">Все заведённые разделы собраны за сегодня.</div>`;

    return `<div class="panel section">
      <h3>Откуда смотрим</h3>
      ${missing}
      <div class="tablewrap"><table><thead><tr><th>Раздел</th><th>Состояние</th><th><span${tip("За последний обход")}>За последний обход</span></th><th>Когда</th><th></th></tr></thead>
        <tbody>${rows || `<tr><td colspan="5" class="muted">Ни одного раздела не заведено.</td></tr>`}</tbody></table></div>
      ${addForm()}
    </div>`;
  }

  const addForm = () => `<details class="mt"><summary>Завести раздел</summary>
    <div class="grid2 mt">
      <label>Площадка<select id="idea-platform">${Object.entries(PLATFORM).map(([k, v]) =>
        `<option value="${k}">${esc(v.name)}</option>`).join("")}</select></label>
      <label>Адрес раздела<input id="idea-handle" placeholder="имя канала, тема или номер категории"></label>
      <label>Как назвать<input id="idea-title" placeholder="чтобы узнавать в списке"></label>
      <label>Своя кратность порога<input id="idea-mult" type="number" step="0.5" placeholder="пусто — общая"></label>
    </div>
    <p class="muted">${Object.values(PLATFORM).map((v) => esc(v.hint)).join(" · ")}</p>
    <button id="idea-add" class="primary mt">Завести</button>
  </details>`;

  // ---------- порог: ручка не крутится вслепую ----------
  function thresholdBlock(d) {
    const c = d.counters;
    const known = c.seen != null;
    return `<div class="panel section">
      <h3><span${tip("Кратность порога")}>Порог отбора</span></h3>
      <p>Кандидатом становится элемент, у которого <span${tip("Приведённый показатель")}>показатель</span> <b>в ${fmt1(d.thresholds.thresholdMult)} раза и более</b>
      выше <span${tip("Фон раздела")}>медианы своего же раздела</span>. Медиана, а не среднее: один виральный элемент не должен выключать отбор на весь раздел.</p>
      <p class="${known ? "" : "muted"}">${known
        ? `За последний обход: <b>${fmtN(c.seen)}</b> обработано, <b>${fmtN(c.passed)}</b> прошло,
           <b>${fmtN(c.noMetric)}</b> без показателя${c.collected < c.sources
             ? ` <span class="muted">(по ${fmtN(c.collected)} разделам из ${fmtN(c.sources)} — остальные не собраны)</span>` : ""}.`
        : "Ни один раздел пока не собран — считать не из чего."}</p>
      <p class="muted">Кратность меняется во вкладке «Пороги», у раздела может быть своя.</p>
    </div>`;
  }

  // ---------- лента ----------
  function feedBlock(d) {
    if (!d.feed.length) {
      return `<div class="panel section"><h3>Лента</h3><p class="muted">${d.counters.seen == null
        ? "Собранного пока нет. Как только пройдёт первый обход, здесь появится то, что выбилось из фона."
        : "За выбранный срок из фона не выбилось ничего. Это не поломка: так бывает, и это честный ответ."}</p></div>`;
    }
    const cards = d.feed.map((c) => `<div class="ideacard${c.decision === "dismissed" ? " dim" : ""}">
      <div class="ideahead">
        <a href="${esc(c.url)}" target="_blank" rel="noopener noreferrer"><b>${esc(c.title)}</b></a>
        <span class="chip">${esc(pname(c.platform))}</span>
      </div>
      ${c.snippet ? `<p class="muted">${esc(c.snippet.slice(0, 300))}</p>` : ""}
      ${c.explain ? `<details class="mt"><summary>Почему это здесь</summary>
        <ul>${c.explain.lines.map((l) => `<li>${esc(l)}</li>`).join("") || '<li class="muted">Чисел площадка не дала.</li>'}</ul>
        <p class="muted">${esc(c.explain.basis)} ${esc(c.explain.disclaimer)}</p></details>` : ""}
      <div class="muted">
        <span${tip("Отклонение от фона")}>Выше медианы своего раздела</span> в <b>${fmt1(c.ratio)}</b> раза
        (${fmtN(Math.round(c.metric))} против ${fmtN(Math.round(c.background))} в сутки) ·
        ${c.daysHeld > 1 ? `<span${tip("Держится")}>держится ${fmtN(c.daysHeld)}-е сутки</span>` : "замечено впервые"} ·
        ${esc(c.sourceTitle || "")} · появилось ${dt(c.publishedAt)}
      </div>
      <div class="mt">
        <button data-ideas="decide" data-id="${c.id}" data-decision="${c.decision === "kept" ? "none" : "kept"}">${c.decision === "kept" ? "Снять отметку" : "Интересно"}</button>
        <button data-ideas="decide" data-id="${c.id}" data-decision="${c.decision === "dismissed" ? "none" : "dismissed"}">${c.decision === "dismissed" ? "Вернуть" : "Неинтересно"}</button>
        ${c.analysisId
          ? `<span class="chip ok">Анализ создан</span>`
          : `<button data-ideas="analyse" data-id="${c.id}" data-title="${esc(c.title)}">Проверить как нишу</button>`}
      </div>
    </div>`).join("");
    return `<div class="panel section"><h3>Лента</h3>
      <p class="muted">Сверху — замеченное позже. В пределах одних суток — по тому, насколько сильно
      элемент оторвался от фона своего раздела. Это мера отклонения, а <b>не</b> оценка товара
      и не «что продавать первым».</p>${cards}</div>`;
  }

  // ---------- расход ----------
  const spendBlock = (d) => `<div class="panel section">
    <h3><span${tip("Расход")}>Расход</span></h3>
    <p>За сегодня израсходовано <b>${fmtN(d.spend.today)}</b>${d.spend.cap ? ` из потолка <b>${fmtN(d.spend.cap)}</b>` : " (потолок не задан)"}.</p>
    <p class="muted">Оценка на сутки вперёд — <b>${fmtN(d.spend.estimate.perDay)}</b>, на месяц — <b>${fmtN(d.spend.estimate.perMonth)}</b>.
    Это <b>оценка</b> по числу разделов, а не факт: предварительной цены без выполнения запроса служба не даёт.
    Фактический расход выше взят из самих ответов.</p>
  </div>`;

  function render(root, d, action) {
    try { window.FBARender?.initTips?.(); } catch {}
    root.innerHTML = preamble() + sourcesBlock(d) + thresholdBlock(d) + feedBlock(d) + spendBlock(d)
      + `<div class="panel section"><button data-ideas="sweep">Обойти сейчас</button>
         <span class="muted">Обход и так идёт раз в сутки сам; кнопка — чтобы не ждать.</span></div>`;

    root.onclick = (e) => {
      const b = e.target.closest("[data-ideas]");
      if (b) {
        const k = b.dataset.ideas;
        if (k === "toggle") return action("source", { id: b.dataset.id, patch: { active: b.dataset.active === "1" } });
        if (k === "remove") return confirm("Удалить раздел? Собранные идеи останутся.") && action("remove", { id: b.dataset.id });
        if (k === "decide") return action("decision", { id: b.dataset.id, decision: b.dataset.decision });
        if (k === "analyse") return action("analyse", { id: b.dataset.id, title: b.dataset.title });
        if (k === "sweep") return action("sweep", {});
      }
      if (e.target.id === "idea-add") {
        const mult = root.querySelector("#idea-mult").value;
        return action("add", {
          platform: root.querySelector("#idea-platform").value,
          handle: root.querySelector("#idea-handle").value,
          title: root.querySelector("#idea-title").value,
          thresholdMult: mult === "" ? null : Number(mult),
        });
      }
    };
  }

  window.FBAIdeas = { render, tips: IDEA_TIPS };
})();
