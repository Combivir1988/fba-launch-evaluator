// Spec 027: одна операция одного анализа выполняется один раз.
// ВОРОТА НАПИСАНЫ ДО РЕЕСТРА и без него обязаны падать (T010).
//
// SC-001 и SC-002 стоят рядом НАМЕРЕННО: они ловят ПРОТИВОПОЛОЖНЫЕ вырождения —
// отсутствие правила и правило, блокирующее лишнее. Замок, который ставит всё
// в одну очередь, не лучше его отсутствия.
//
// Ключи здесь строятся В ТЕСТЕ строками: реестр проверяется как «один ключ — одна работа»,
// независимо от того, как ключ собирается из запроса (это отдельная забота, D3).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { startApp } from "./helpers/app.js";
import { startJob, listJobs, cancelJob, keyBusy } from "../server/jobs.js";
import { paramsOf, diffParams } from "../server/job-params.js";
import { joinedNote } from "../public/js/joined-note.js";

let T, base, h;
before(async () => {
  // MOCK_DELAY_MS — шов, без которого ворота SC-001 уровня 1 НЕЧЕГО НАБЛЮДАТЬ: в mock-режиме работа
  // целиком укладывается в микрозадачи и завершается раньше, чем сервер возьмёт второй запрос,
  // поэтому второй честно не находит идущей работы. Обнаружено замером при написании ворот (2026-11-20).
  T = await startApp({ RATE_LIMIT_PER_HOUR: "1000", MOCK_DELAY_MS: "60" });
  base = T.base;
  h = (await T.userWithSession({ login: "one", name: "Первый" })).headers;
});
after(async () => { await T.close(); });

// ---------- вспомогательное ----------
const asin = (i) => "B0" + String(i).padStart(8, "0");
const post = (path, body, headers = h) => fetch(base + path, { method: "POST", headers, body: JSON.stringify(body) });
const schema = { fields: [{ id: "material", name: "Материал", type: "choice", unit: "", options: ["латекс"], hint: "" }] };

/** Ждёт, пока задача перестанет выполняться (все четыре выхода).
 *  Сдаётся через 5 с и не держит цикл событий: ворота обязаны ПАДАТЬ, а не висеть. */
const waitEnd = (job) => new Promise((res) => {
  if (!job || typeof job !== "object") return res("нет задачи");
  const t0 = Date.now();
  const t = setInterval(() => {
    if (job.status !== "running") { clearInterval(t); res(job.status); }
    else if (Date.now() - t0 > 5000) { clearInterval(t); res("не дождались"); }
  }, 5);
  t.unref?.();
});

/** Фабрика, считающая свои вызовы. */
const counting = (box, body) => { box.calls = 0; return async function* (signal) { box.calls++; yield* body(signal); }; };
const succeeds = () => async function* () { yield { event: "done", data: { ok: true } }; };
const fails = () => async function* () { throw new Error("упало намеренно"); };
const hangs = () => async function* (signal) {
  await new Promise((_, rej) => signal.addEventListener("abort", () => rej(new Error("отменено")), { once: true }));
  yield { event: "done", data: {} };
};

// =====================================================================
// T003 — SC-001, уровень 2: реестр. Два запуска с одним ключом = один прогон.
// =====================================================================
test("SC-001 уровень 2: два запуска с одним ключом дают одну работу, фабрика вызвана ОДИН раз", async () => {
  const key = "config_extract\u0000a-sc001-unit";
  const box = {};
  const a = startJob("config_extract", counting(box, hangs()), { userName: "Первый" }, { key, params: { model: "m" } });
  const b = startJob("config_extract", counting({}, hangs()), { userName: "Второй" }, { key, params: { model: "m" } });

  assert.equal(a.job.id, b.job.id, "второй запуск обязан вернуть ТУ ЖЕ работу");
  assert.equal(a.joined, null, "первый ни к кому не присоединялся");
  assert.ok(b.joined, "второй обязан получить сведения о присоединении");
  assert.equal(b.joined.startedBy, "Первый", "названо имя того, кто запустил");
  assert.equal(box.calls, 1, "фабрика (= прогон = обращение к AI) обязана быть вызвана РОВНО ОДИН раз");

  cancelJob(a.job.id); await waitEnd(a.job);
});

// =====================================================================
// T018 — СТОРОЖ. Инвариант «одна работа на ключ» принадлежит startJob, но маршрут обязан
// ключ ПЕРЕДАТЬ, а клиент — прислать analysisId. Забыть можно в семи местах, поэтому забывание
// роняет тест, а не остаётся на памяти. Читаем исходники: регулярка проверяется подлогом (T046).
//
// Урок spec 021: сторож, чья регулярка совпадала с ЗАКОММЕНТИРОВАННОЙ строкой, давал ложную
// уверенность. Поэтому строки комментариев отбрасываются явно.
// =====================================================================
test("сторож: ни один маршрут не заводит работу без ключа, ни один запуск не уходит без analysisId", () => {
  const live = (text, re) => text.split("\n").map((l, i) => ({ n: i + 1, l }))
    .filter(({ l }) => re.test(l) && !/^\s*(\/\/|\*|\/\*)/.test(l) && !/^\s*import\s/.test(l));

  const server = readFileSync(new URL("../server/index.js", import.meta.url), "utf8");
  const routes = live(server, /\bstartJob\s*\(/);
  assert.equal(routes.length, 3, `в server/index.js ожидалось 3 живых вызова startJob (analyze, patents, configJob на четыре маршрута), найдено ${routes.length}`);
  for (const { n, l } of routes) assert.match(l, /\bkey:\s*keyOf\(/, `server/index.js:${n} заводит работу БЕЗ ключа — правило «одна операция за раз» на этом маршруте не действует`);

  const client = readFileSync(new URL("../public/js/ai.js", import.meta.url), "utf8");
  const launches = live(client, /await\s+startJob\s*\(/);
  assert.equal(launches.length, 3, `в public/js/ai.js ожидалось 3 живых запуска (вердикт, патенты, общий путь этапа 2), найдено ${launches.length}`);
  for (const { n, l } of launches) assert.match(l, /analysisId/, `public/js/ai.js:${n} запускает работу БЕЗ analysisId — сервер не сможет узнать, что это та же операция`);
});

// =====================================================================
// T004 — SC-001, уровень 1: через HTTP, БЕЗ ожидания ответа на первый запрос.
// Контрольный пример I. Проверка «запрос → дождались → запрос» этот дефект
// не поймала бы НИКОГДА: гонка живёт между проверкой и регистрацией.
// =====================================================================
test("SC-001 уровень 1 (пример I): два одновременных POST дают один jobId и одну задачу", async () => {
  const analysisId = "a-sc001-http";
  const body = { niche: "boxing machine", analysisId, asins: [asin(1), asin(2)], schema, listings: {} };
  const was = new Set(listJobs().filter((j) => j.type === "config_extract").map((j) => j.id));

  const [r1, r2] = await Promise.all([post("/api/config/extract", body), post("/api/config/extract", body)]);
  assert.equal(r1.status, 202); assert.equal(r2.status, 202);
  const j1 = await r1.json(), j2 = await r2.json();

  assert.equal(j1.jobId, j2.jobId, "оба одновременных запроса обязаны получить ОДИН идентификатор работы");
  const made = listJobs().filter((j) => j.type === "config_extract" && !was.has(j.id));
  assert.equal(made.length, 1, `на два одновременных запроса заведено работ: ${made.length}, а должна быть одна`);
});

// =====================================================================
// T005 — SC-002, пример D: разные операции одного анализа НЕ блокируются.
// =====================================================================
test("SC-002 (пример D): схема и ТЗ по одному анализу идут параллельно", async () => {
  const analysisId = "a-sc002-same";
  const [r1, r2] = await Promise.all([
    post("/api/config/schema", { niche: "x", analysisId, asins: [asin(1), asin(2), asin(3)], listings: {} }),
    post("/api/config/tz", { niche: "x", analysisId, payload: { price: 1 } }),
  ]);
  assert.equal(r1.status, 202); assert.equal(r2.status, 202);
  const j1 = await r1.json(), j2 = await r2.json();

  assert.notEqual(j1.jobId, j2.jobId, "разные операции одного анализа обязаны идти РАЗНЫМИ работами");
  assert.equal(j1.joined, undefined, "схема ни к кому не присоединялась");
  assert.equal(j2.joined, undefined, "ТЗ ни к кому не присоединялось");
});

// =====================================================================
// T006 — SC-002, пример E: одна операция РАЗНЫХ анализов НЕ блокируется.
// =====================================================================
test("SC-002 (пример E): одно извлечение по двум разным анализам идёт параллельно", async () => {
  const body = (analysisId) => ({ niche: "x", analysisId, asins: [asin(4), asin(5)], schema, listings: {} });
  const [r1, r2] = await Promise.all([
    post("/api/config/extract", body("a-sc002-one")),
    post("/api/config/extract", body("a-sc002-two")),
  ]);
  const j1 = await r1.json(), j2 = await r2.json();

  assert.notEqual(j1.jobId, j2.jobId, "разные анализы обязаны идти РАЗНЫМИ работами");
  assert.equal(j1.joined, undefined);
  assert.equal(j2.joined, undefined);
});

// =====================================================================
// T039 — ВОРОТА SC-004 (часть вторая): человек видит ТЕКСТОМ, что прогон не его.
// Проверяется содержимое самого текста плюс то, что он подключён во всех шести запусках.
// =====================================================================
test("SC-004: текст называет имя, время и расхождения — и не выдумывает их, когда их нет", () => {
  const now = Date.UTC(2026, 10, 20, 12, 0, 0);
  const t1 = joinedNote({ startedBy: "Анна", startedAt: now - 3 * 60000, differs: [{ what: "модель", mine: "deepseek", theirs: "gemma" }] }, now);
  assert.match(t1, /Анна/, "названо имя запустившего");
  assert.match(t1, /3 мин назад/, "названо, когда запущено");
  assert.match(t1, /модель — у вас «deepseek», в работе «gemma»/, "названо расхождение");
  assert.match(t1, /Отмена прервёт работу и у Анны?/, "сказано, что отмена заденет и его");

  const t2 = joinedNote({ startedBy: "Анна", startedAt: now, differs: [] }, now);
  assert.match(t2, /Параметры совпадают/, "при совпадении так и сказано");
  assert.doesNotMatch(t2, /расходятся/, "несуществующее расхождение выдумывать нельзя");
  assert.match(t2, /только что/, "запущено меньше минуты назад");
});

test("сторож: сообщение о чужом прогоне подключено во всех шести запусках", () => {
  const app = readFileSync(new URL("../public/js/app.js", import.meta.url), "utf8");
  const hooks = app.split("\n").filter((l) => /onJoined:/.test(l) && !/^\s*(\/\/|\*)/.test(l));
  assert.equal(hooks.length, 6, `ожидалось 6 мест с onJoined (4 операции этапа 2 + вердикт + патенты), найдено ${hooks.length}`);
  assert.match(app, /import \{ joinedNote \} from "\.\/joined-note\.js"/, "текст берётся из общего модуля, а не пишется на месте");
});

// =====================================================================
// T045-сторож — запись СНИМАЕТСЯ, а не копится. Нужен потому, что замером подлогом выяснилось:
// «не запирать после ошибки» держится ДВУМЯ независимыми механизмами (снятие записи и проверка
// «работа ещё выполняется»), и каждого по отдельности достаточно. Значит само снятие ворота SC-003
// не стерегут — его стережёт этот тест. Без него снятие могло бы молча перестать работать,
// и ключи копились бы в памяти до перезапуска.
// =====================================================================
test("запись снимается после завершения, а не копится в памяти", async () => {
  for (const [i, f] of [succeeds(), fails()].entries()) {
    const key = `analyze a-leak-${i}`;
    assert.equal(keyBusy(key), false, "до запуска ключ свободен");
    const j = startJob("analyze", f, { userName: "Кто-то" }, { key, params: {} });
    assert.equal(keyBusy(key), true, "пока работа идёт, ключ занят");
    await waitEnd(j.job);
    assert.equal(keyBusy(key), false, "после завершения ключ обязан освободиться СРАЗУ, а не по истечении срока хранения");
  }
});

// =====================================================================
// T027 — запись снимается ПО СОВПАДЕНИЮ ЗНАЧЕНИЯ. Без этого завершившаяся старая работа
// сняла бы замок с только что начатой, и третий запуск завёл бы второй прогон.
// =====================================================================
test("старая завершившаяся работа не снимает замок с новой под тем же ключом", async () => {
  const key = "config_promo\u0000a-stale";
  const a = startJob("config_promo", fails(), { userName: "Первый" }, { key, params: {} });
  await waitEnd(a.job);

  const b = startJob("config_promo", hangs(), { userName: "Второй" }, { key, params: {} });
  assert.notEqual(b.job.id, a.job.id);

  // «Догоняющее» завершение первой работы не должно тронуть запись второй.
  await new Promise((r) => setTimeout(r, 20));
  const c = startJob("config_promo", hangs(), { userName: "Третий" }, { key, params: {} });
  assert.equal(c.job.id, b.job.id, "третий обязан присоединиться ко ВТОРОЙ работе, а не завести третью");

  cancelJob(b.job.id); await waitEnd(b.job);
});

// =====================================================================
// T028 — правило покрывает ВСЕ ШЕСТЬ видов, а не один «для примера» (FR-001a).
//
// Проверка на уровне реестра, а не через HTTP, и вот почему честно: в mock-режиме работы
// config_tz и patents завершаются В МИКРОЗАДАЧАХ, то есть раньше, чем сервер возьмёт второй
// запрос, — одновременность там нечем наблюдать без новых швов в рабочем коде. Что маршруты
// передают ключ, доказывает сторож выше; что реестр работает одинаково для всех видов — здесь.
// =====================================================================
test("все шесть видов операций подчиняются правилу", async () => {
  for (const type of ["config_schema", "config_extract", "config_promo", "config_tz", "analyze", "patents"]) {
    const key = `${type}\u0000a-all-six`;
    const a = startJob(type, hangs(), { userName: "Первый" }, { key, params: { model: "m" } });
    const b = startJob(type, hangs(), { userName: "Второй" }, { key, params: { model: "m" } });
    assert.equal(b.job.id, a.job.id, `${type}: второй запуск обязан присоединиться, а не завести вторую работу`);
    assert.ok(b.joined, `${type}: обязаны быть сведения о присоединении`);
    cancelJob(a.job.id); await waitEnd(a.job);
  }
});

// =====================================================================
// T030 — контрольный пример H: вкладка, открытая до обновления, идентификатора не присылает.
// Она НЕ присоединяется молча — она вообще не попадает в реестр, потому что ключа у неё нет.
// Это СЛЕДСТВИЕ устройства (D4), а не везение, — потому и закрепляется тестом.
// =====================================================================
test("пример H: запрос без analysisId не присоединяется и заводит свою работу", async () => {
  const body = { niche: "x", asins: [asin(8), asin(9)], schema, listings: {} };
  const r1 = await post("/api/config/extract", { ...body, analysisId: "a-old-tab" });
  const j1 = await r1.json();

  const r2 = await post("/api/config/extract", body); // без analysisId — «старая вкладка»
  const j2 = await r2.json();

  assert.notEqual(j2.jobId, j1.jobId, "без идентификатора присоединяться не к чему — заводится своя работа");
  assert.equal(j2.joined, undefined, "молчаливого присоединения быть не должно");
});

// =====================================================================
// T021 — контрольные примеры A, B, C: что видит присоединившийся.
// =====================================================================
test("примеры A, B, C: совпали — расхождений нет; другая модель — одно; другой охват и схема — два", () => {
  const base = { options: { model: "m1" }, asins: [asin(1), asin(2)], schema, batchSize: 6 };
  const A = paramsOf("config_extract", base);
  assert.deepEqual(diffParams(A, paramsOf("config_extract", base)), [], "пример A: параметры совпали — расхождений быть не должно");

  const B = paramsOf("config_extract", { ...base, options: { model: "m2" } });
  const dB = diffParams(B, A);
  assert.equal(dB.length, 1, "пример B: отличается только модель");
  assert.equal(dB[0].what, "модель"); assert.equal(dB[0].mine, "m2"); assert.equal(dB[0].theirs, "m1");

  const C = paramsOf("config_extract", { ...base, asins: [asin(1)], schema: { fields: [{ id: "color" }] } });
  const whatC = diffParams(C, A).map((d) => d.what).sort();
  assert.deepEqual(whatC, ["охват", "схема полей"], "пример C: охват и схема полей");
});

// =====================================================================
// T022 — ГЛАВНАЯ ЛОВУШКА РЕШЕНИЯ D5. В теле запроса едет listings — кэш уже загруженных
// страниц, у двух людей он законно разный. Попади он в сравнение — расхождение возникало бы
// ВСЕГДА, и сообщение перестало бы что-либо значить. Та же примета, по которой spec 019
// переписала подпункт 1f, а spec 024 отказалась от условного сообщения.
// =====================================================================
test("D5: одинаковые параметры при РАЗНОМ кэше страниц не дают расхождений", () => {
  const common = { options: { model: "m" }, asins: [asin(1), asin(2)], schema, batchSize: 6 };
  const mine = paramsOf("config_extract", { ...common, listings: {}, prevTable: null });
  const theirs = paramsOf("config_extract", { ...common, listings: { [asin(1)]: { asin: asin(1), name: "уже загружено" } }, prevTable: { rows: [1, 2, 3] } });
  assert.deepEqual(diffParams(mine, theirs), [], "кэш страниц и прежняя таблица НЕ должны попадать в сравнение");
});

// =====================================================================
// T023 — расхождений нет ни у ОДНОГО из шести видов, когда параметры совпадают.
// Не один вид «для примера»: правило покрывает все шесть (FR-001a).
// =====================================================================
test("на одинаковых параметрах расхождений нет НИ У ОДНОГО из шести видов", () => {
  const body = { options: { model: "m" }, asins: [asin(1), asin(2)], schema, batchSize: 6, niche: "n", coreKeyword: "k", payload: { a: 1 }, listings: {} };
  for (const type of ["config_schema", "config_extract", "config_promo", "config_tz", "analyze", "patents"]) {
    const p = paramsOf(type, body);
    assert.ok(Object.keys(p).length > 0, `${type}: набор параметров пуст — сравнивать нечего, это ошибка`);
    assert.deepEqual(diffParams(p, paramsOf(type, body)), [], `${type}: на одинаковых параметрах расхождений быть не должно`);
  }
});

// =====================================================================
// T026 — ВОРОТА SC-004 (часть первая, по ответу сервера). Проверяется СОДЕРЖИМОЕ ответа,
// а не наличие кода (образец — SC-011a spec 021).
// =====================================================================
test("SC-004: ответ присоединившемуся несёт имя, время и перечень расхождений", async () => {
  const other = (await T.userWithSession({ login: "two", name: "Второй" })).headers;
  const analysisId = "a-sc004";
  const body = (model) => ({ niche: "x", analysisId, asins: [asin(6), asin(7)], schema, listings: {}, options: { model } });

  const r1 = await post("/api/config/extract", body("gemma"));
  const j1 = await r1.json();
  assert.equal(j1.joined, undefined, "первый ни к кому не присоединялся");

  const r2 = await post("/api/config/extract", body("deepseek"), other);
  const j2 = await r2.json();
  assert.equal(j2.jobId, j1.jobId, "второй обязан получить ТУ ЖЕ работу");
  assert.ok(j2.joined, "ответ обязан нести сведения о присоединении");
  assert.equal(j2.joined.startedBy, "Первый", "названо имя запустившего");
  assert.ok(typeof j2.joined.startedAt === "number" && j2.joined.startedAt > 0, "названо время запуска");
  assert.deepEqual(j2.joined.differs, [{ what: "модель", mine: "deepseek", theirs: "gemma" }], "названо расхождение по модели");
});

// =====================================================================
// T007 — SC-003, пример F: завершение ОШИБКОЙ освобождает ключ.
// =====================================================================
test("SC-003 (пример F): после ошибки следующий запуск начинает НОВУЮ работу", async () => {
  const key = "config_schema\u0000a-sc003-err";
  const a = startJob("config_schema", fails(), { userName: "Первый" }, { key, params: {} });
  assert.equal(await waitEnd(a.job), "error", "фабрика обязана была уронить работу");

  const b = startJob("config_schema", succeeds(), { userName: "Второй" }, { key, params: {} });
  assert.notEqual(b.job.id, a.job.id, "упавшая работа НЕ должна запирать операцию");
  assert.equal(b.joined, null, "присоединяться не к чему — та работа мертва");
  await waitEnd(b.job);
});

// =====================================================================
// T008 — SC-003, пример G: ОТМЕНА освобождает ключ.
// =====================================================================
test("SC-003 (пример G): после отмены следующий запуск начинает НОВУЮ работу", async () => {
  const key = "patents\u0000a-sc003-cancel";
  const a = startJob("patents", hangs(), { userName: "Первый" }, { key, params: {} });
  assert.equal(cancelJob(a.job.id), true);
  await waitEnd(a.job);

  const b = startJob("patents", succeeds(), { userName: "Второй" }, { key, params: {} });
  assert.notEqual(b.job.id, a.job.id, "отменённая работа НЕ должна запирать операцию");
  assert.equal(b.joined, null);
  await waitEnd(b.job);
});

// =====================================================================
// T009 — SC-003: УСПЕХ тоже освобождает. Правило запрещает одновременность,
// а не повтор (FR-007). Этот пункт отделяет «освобождать на любом выходе»
// от «освобождать только по успеху» — см. подлог T044.
// =====================================================================
test("SC-003: после успешного завершения ту же операцию можно запустить снова", async () => {
  const key = "analyze\u0000a-sc003-ok";
  const a = startJob("analyze", succeeds(), { userName: "Первый" }, { key, params: {} });
  assert.equal(await waitEnd(a.job), "done");

  const b = startJob("analyze", succeeds(), { userName: "Второй" }, { key, params: {} });
  assert.notEqual(b.job.id, a.job.id, "повтор завершившейся операции запрещать нельзя");
  assert.equal(b.joined, null);
  await waitEnd(b.job);
});
