// Этап 2 (spec 010, D3–D6, D9): задачи схема / извлечение / ТЗ с подменёнными Scrapfly и AI; кэш не перезагружается; частичный результат при кредитах; DOCX; маршруты.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import zlib from "node:zlib";
import { schemaStream, extractStream, tzStream } from "../server/config-jobs.js";
import { buildTzDocx, tzFileName } from "../server/tz-docx.js";
import { configFromEnv } from "../server/claude.js";
import { startApp } from "./helpers/app.js";

const fixture = (asin) => JSON.parse(readFileSync(new URL(`./fixtures/scrapfly-${asin}.json`, import.meta.url), "utf8"));
const res = (status, body) => new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const collect = async (gen) => { const ev = []; for await (const e of gen) ev.push(e); return ev; };
const last = (ev, name) => ev.filter((e) => e.event === name).at(-1)?.data;
const asin = (i) => "B0" + String(i).padStart(8, "0");
const live = { ...configFromEnv({ OPENROUTER_API_KEY: "k", AI_PROVIDER: "openrouter" }), scrapflyKey: "sf" };
const schema = { fields: [{ id: "material", name: "Материал", type: "choice", unit: "", options: ["латекс", "шёлк", "пластик"], hint: "" }, { id: "count", name: "Количество", type: "number", unit: "шт", options: [], hint: "" }] };

test("schemaStream (live, подмены): грузит только недостающие страницы, события fetch/ai, done со схемой и новыми страницами", async () => {
  const j = fixture("B0BZHHSV52"); const fetched = [];
  const fetchImpl = async (u) => { const a = new URL(u).searchParams.get("url").split("/dp/")[1]; fetched.push(a); return res(200, j); };
  const aiJson = async ({ schema: s, user }) => { assert.equal(s, (await import("../server/config-prompts.js")).FIELDS_SCHEMA); assert.match(user, /Ниша: hydrangea/); assert.match(user, /Листингов: 4/); return { fields: [{ id: "material", name: "Материал", type: "choice", unit: "", options: ["латекс", "шёлк", "Латекс"], hint: "" }, { id: "stems", name: "Стеблей", type: "number", unit: "шт", options: [], hint: "" }, { id: "use", name: "Назначение", type: "text", unit: "", options: [], hint: "" }] }; };
  const cached = { [asin(1)]: { asin: asin(1), fetchedAt: "2026-09-22T00:00:00Z", title: "cached", bullets: [], specs: [] } };
  const ev = await collect(schemaStream({ niche: "hydrangea", coreKeyword: "hydrangea", asins: [asin(1), asin(2), asin(3), asin(4)], listings: cached, options: {} }, live, { fetchImpl, aiJson, concurrency: 2 }));
  assert.deepEqual(fetched.sort(), [asin(2), asin(3), asin(4)], "страница из кэша не перезагружается");
  const stages = ev.filter((e) => e.event === "stage").map((e) => e.data.stage); assert.ok(stages.includes("fetch") && stages.includes("ai")); assert.equal(ev.at(-1).event, "done");
  const d = ev.at(-1).data; assert.equal(d.schema.fields.length, 3); assert.deepEqual(d.schema.fields[0].options, ["латекс", "шёлк"], "дубль значения убран"); assert.deepEqual(Object.keys(d.listings).sort(), [asin(2), asin(3), asin(4)], "в done — только новые страницы"); assert.equal(d.cost, 93);
  assert.equal(d.schema.model, live.openrouterModel); assert.equal(d.schema.basedOn, 4);
});

test("schemaStream: без ASIN — error; мало загрузилось — error с partial", async () => {
  const e1 = await collect(schemaStream({ asins: [] }, live, {})); assert.equal(e1[0].event, "error"); assert.equal(e1[0].data.code, "bad_request");
  const e2 = await collect(schemaStream({ niche: "x", asins: [asin(1), asin(2), asin(3)], listings: {} }, live, { fetchImpl: async () => res(422, "asp") }));
  assert.equal(last(e2, "stage").stage, "partial"); assert.equal(Object.keys(last(e2, "stage").listings).length, 3); assert.equal(e2.at(-1).event, "error"); assert.equal(e2.at(-1).data.code, "asp");
});

test("extractStream (live, подмены): пачки по batchSize, таблица с нормализацией, failed для незагруженных, ручные клетки сохранены", async () => {
  const j = fixture("B0BZHGDPMK"); const asins = Array.from({ length: 7 }, (_, i) => asin(i + 1));
  const fetchImpl = async (u) => (u.includes(asin(7)) ? res(422, "asp") : res(200, j));
  const batches = [];
  const aiJson = async ({ user }) => { const ids = [...user.matchAll(/ASIN (B0\d{8})/g)].map((m) => m[1]); batches.push(ids); return { items: ids.map((a) => ({ asin: a, values: [{ field: "material", value: "Латекс", source: "bullets" }, { field: "count", value: a === asin(2) ? "нет данных" : "5 pcs", source: a === asin(2) ? "none" : "specs" }] })) }; };
  const prev = { rows: { [asin(1)]: { status: "ok", values: { material: { value: "шёлк", source: "manual" } } } }, cost: 10 };
  const ev = await collect(extractStream({ niche: "hydrangea", schema, asins, listings: {}, prevTable: prev, batchSize: 3 }, live, { fetchImpl, aiJson, aiParallel: 1 }));
  assert.equal(ev.at(-1).event, "done"); const d = ev.at(-1).data;
  assert.deepEqual(batches.map((b) => b.length), [3, 3], "6 загруженных страниц → 2 пачки по 3");
  assert.equal(d.table.rows[asin(1)].values.material.value, "шёлк", "ручная клетка сохранена"); assert.equal(d.table.rows[asin(1)].values.material.source, "manual");
  assert.deepEqual(d.table.rows[asin(3)].values.material, { value: "латекс", source: "bullets" }); assert.deepEqual(d.table.rows[asin(3)].values.count, { value: 5, source: "specs" });
  assert.deepEqual(d.table.rows[asin(2)].values.count, { value: null, source: null });
  assert.equal(d.table.rows[asin(7)].status, "failed"); assert.deepEqual(d.table.failed, [asin(7)]);
  assert.equal(d.table.cost, 10 + 26 * 6); assert.equal(Object.keys(d.listings).length, 7, "новые страницы (включая ошибочную) уходят в кэш");
  assert.ok(Math.abs(d.table.coverage.count - 5 / 7) < 1e-9);
  const ai = ev.filter((e) => e.event === "stage" && e.data.stage === "ai"); assert.equal(ai.at(-1).data.done, 2);
});

test("extractStream: кредиты закончились посреди загрузки → partial + error credits; ошибка одной пачки AI не валит задачу", async () => {
  const j = fixture("B0BZHGDPMK"); let k = 0;
  const credits = async () => (++k <= 2 ? res(200, j) : res(402, "quota"));
  const ev = await collect(extractStream({ niche: "x", schema, asins: [asin(1), asin(2), asin(3), asin(4)], listings: {} }, live, { fetchImpl: credits, concurrency: 1 }));
  assert.equal(ev.at(-1).event, "error"); assert.equal(ev.at(-1).data.code, "credits"); assert.equal(ev.at(-1).data.retryable, false);
  const partial = last(ev, "stage"); assert.equal(partial.stage, "partial"); assert.equal(Object.keys(partial.listings).length, 2, "загруженное до ошибки не пропало");
  let calls = 0; const aiJson = async ({ user }) => { calls++; if (calls === 1) throw Object.assign(new Error("boom"), { code: "upstream" }); const ids = [...user.matchAll(/ASIN (B0\d{8})/g)].map((m) => m[1]); return { items: ids.map((a) => ({ asin: a, values: [{ field: "material", value: "шёлк", source: "title" }] })) }; };
  const ev2 = await collect(extractStream({ niche: "x", schema, asins: [asin(1), asin(2)], listings: {}, batchSize: 1 }, live, { fetchImpl: async () => res(200, j), aiJson, aiParallel: 1, aiPauseMs: 0 }));
  assert.equal(ev2.at(-1).event, "done"); const t = ev2.at(-1).data.table; assert.equal(calls, 3, "первая пачка: ошибка + повтор; вторая: одна попытка");
  assert.equal(t.rows[asin(1)].values.material.value, "шёлк"); assert.equal(t.aiErrors, undefined);
});

test("AI перегружен после загрузки страниц: оплаченные страницы уходят в partial перед ошибкой; повтор AI спасает задачу", async () => {
  const j = fixture("B0BZHGDPMK"); const fetchImpl = async () => res(200, j); const asins = [asin(1), asin(2), asin(3)];
  const overloaded = async () => { throw Object.assign(new Error("модель перегружена"), { code: "upstream", retryable: true }); };
  const ev = await collect(schemaStream({ niche: "x", asins, listings: {} }, live, { fetchImpl, aiJson: overloaded, aiPauseMs: 0 }));
  assert.equal(ev.at(-1).event, "error"); const partial = last(ev, "stage"); assert.equal(partial.stage, "partial"); assert.equal(Object.keys(partial.listings).length, 3, "три загруженные страницы отданы клиенту");
  let n = 0; const flaky = async () => { if (++n < 3) throw Object.assign(new Error("busy"), { code: "upstream", retryable: true }); return { fields: [{ id: "a", name: "A", type: "text", unit: "", options: [], hint: "" }, { id: "b", name: "B", type: "text", unit: "", options: [], hint: "" }, { id: "c", name: "C", type: "text", unit: "", options: [], hint: "" }] }; };
  const ev2 = await collect(schemaStream({ niche: "x", asins, listings: {} }, live, { fetchImpl, aiJson: flaky, aiPauseMs: 0 })); assert.equal(ev2.at(-1).event, "done"); assert.equal(n, 3, "две неудачи, третья попытка удалась");
  n = 0; const parseErr = async () => { n++; throw Object.assign(new Error("не по схеме"), { code: "parse" }); };
  const ev3 = await collect(schemaStream({ niche: "x", asins, listings: {} }, live, { fetchImpl, aiJson: parseErr, aiPauseMs: 0 })); assert.equal(ev3.at(-1).data.code, "parse"); assert.equal(n, 2, "ошибка разбора — один повтор, не три");
  const ev4 = await collect(extractStream({ niche: "x", schema, asins, listings: {} }, live, { fetchImpl, aiJson: overloaded, aiPauseMs: 0, aiParallel: 1 }));
  assert.equal(ev4.at(-1).event, "done", "извлечение: ошибка пачки не валит задачу"); assert.equal(ev4.at(-1).data.table.aiErrors.length, 1); assert.equal(Object.keys(ev4.at(-1).data.listings).length, 3);
});

test("extractStream / schemaStream / tzStream в MOCK: без сети и ключей, детерминированно", async () => {
  const cfg = configFromEnv({ MOCK_AI: "1" }); const asins = [asin(1), asin(2), asin(3), asin(4)]; const deny = async () => { throw new Error("сети быть не должно"); };
  const s = await collect(schemaStream({ niche: "mock", asins, listings: {} }, cfg, { fetchImpl: deny, aiJson: deny })); assert.equal(s.at(-1).event, "done"); assert.ok(s.at(-1).data.schema.fields.length >= 3); assert.equal(s.at(-1).data.schema.model, "mock");
  const e = await collect(extractStream({ niche: "mock", schema: s.at(-1).data.schema, asins, listings: s.at(-1).data.listings }, cfg, { fetchImpl: deny, aiJson: deny })); assert.equal(e.at(-1).event, "done");
  const t = e.at(-1).data.table; assert.equal(Object.keys(t.rows).length, 4); assert.ok(Object.values(t.coverage).some((c) => c > 0)); assert.equal(t.cost, 0);
  const payload = { niche: "mock", listingsAnalyzed: 4, configuration: [{ field: "Материал", unit: "", dominant: { value: "Steel", revenueSharePct: 61.5, listings: 3 } }], reviews: { negative: [{ topic: "ржавеет", mentionsPct: 12.5 }] }, regulatory: [] };
  const z = await collect(tzStream({ niche: "mock", payload }, cfg, {})); assert.equal(z.at(-1).event, "done"); const tz = z.at(-1).data.tz;
  assert.ok(tz.rows.length >= 5); assert.equal(tz.rows[0].unverified, false, "61,5 % и 3 листинга — из фактов"); assert.equal(tz.model, "mock"); assert.ok(tz.generatedAt);
});

test("ТЗ: ответ не по схеме повторяется один раз; вольные раздел и приоритет нормализуются", async () => {
  const { normalizeSection, normalizePriority } = await import("../server/config-prompts.js");
  assert.equal(normalizeSection("Материалы и конструкция"), "материалы"); assert.equal(normalizeSection("Упаковка/маркировка"), "сертификация и маркировка"); assert.equal(normalizeSection("Packaging"), "упаковка"); assert.equal(normalizeSection("что-то"), "конструкция"); assert.equal(normalizeSection("функции"), "функции");
  assert.equal(normalizePriority("Must"), "must"); assert.equal(normalizePriority("обязательно"), "must"); assert.equal(normalizePriority("high"), "must"); assert.equal(normalizePriority("should"), "should"); assert.equal(normalizePriority(""), "should");
  let n = 0; const aiJson = async () => { if (++n === 1) throw Object.assign(new Error("Ответ не по схеме: rows[0].section"), { code: "parse" }); return { title: "ТЗ", summary: "s", rows: [{ section: "Материалы", param: "p", requirement: "r", rationale: "x", priority: "Высокий", source: "s" }, { section: "", param: "", requirement: "", rationale: "", priority: "", source: "" }], openQuestions: [] }; };
  const ev = await collect(tzStream({ niche: "x", payload: { niche: "x", configuration: [] } }, live, { aiJson })); assert.equal(ev.at(-1).event, "done"); assert.equal(n, 2, "один повтор после ошибки разбора");
  const tz = ev.at(-1).data.tz; assert.equal(tz.rows.length, 1, "пустые строки отброшены"); assert.equal(tz.rows[0].section, "материалы"); assert.equal(tz.rows[0].priority, "must");
  n = 0; const always = async () => { n++; throw Object.assign(new Error("не по схеме"), { code: "parse" }); };
  const ev2 = await collect(tzStream({ niche: "x", payload: { niche: "x" } }, live, { aiJson: always })); assert.equal(ev2.at(-1).event, "error"); assert.equal(ev2.at(-1).data.code, "parse"); assert.equal(n, 2, "не больше двух попыток при ошибке разбора");
});

test("tzStream (live, подмена AI): постпроверка чисел помечает выдуманные значения", async () => {
  const payload = { niche: "x", configuration: [{ field: "Зоны", dominant: { value: "9", number: 9, revenueSharePct: 58.2, listings: 12 } }] };
  const aiJson = async ({ schema: s }) => { assert.ok(s.required.includes("rows")); return { title: "ТЗ", summary: "s", rows: [
    { section: "конструкция", param: "Зоны", requirement: "9 зон", rationale: "9 зон — 58,2 % выручки", priority: "must", source: "поле «Зоны»" },
    { section: "функции", param: "Режимы", requirement: "не меньше 12 режимов", rationale: "как у лидеров", priority: "should", source: "—" },
    { section: "размеры и вес", param: "Вес", requirement: "не больше 3.5 кг", rationale: "удобство", priority: "weird", source: "" } ], openQuestions: ["MOQ?"] }; };
  const ev = await collect(tzStream({ niche: "x", payload }, live, { aiJson })); const tz = ev.at(-1).data.tz;
  assert.deepEqual(tz.rows.map((r) => r.unverified), [false, false, true], "12 есть в фактах (листингов 12), 3.5 — нет"); assert.equal(tz.rows[2].priority, "should"); assert.deepEqual(tz.openQuestions, ["MOQ?"]);
});

/** Достаём word/document.xml из zip без библиотек: локальные заголовки (deflate или stored). */
function docxXml(buf) {
  let off = 0;
  while (off + 30 <= buf.length && buf.readUInt32LE(off) === 0x04034b50) {
    const method = buf.readUInt16LE(off + 8), csize = buf.readUInt32LE(off + 18), nlen = buf.readUInt16LE(off + 26), xlen = buf.readUInt16LE(off + 28);
    const name = buf.toString("utf8", off + 30, off + 30 + nlen); const start = off + 30 + nlen + xlen;
    const flags = buf.readUInt16LE(off + 6); assert.equal(flags & 8, 0, "data descriptor не поддержан тестом");
    if (name === "word/document.xml") { const data = buf.subarray(start, start + csize); return (method === 8 ? zlib.inflateRawSync(data) : data).toString("utf8"); }
    off = start + csize;
  }
  throw new Error("word/document.xml не найден");
}

test("buildTzDocx: валидный DOCX с разделами, строками, пометкой непроверенных чисел и открытыми вопросами", async () => {
  const tz = { title: "ТЗ производителю: тест", summary: "Кратко о товаре.", rows: [
    { section: "конструкция", param: "Зоны", requirement: "9 зон", rationale: "58 % выручки", priority: "must", source: "поле «Зоны»", unverified: false },
    { section: "качество и контроль", param: "AQL", requirement: "AQL 2.5", rationale: "практика", priority: "should", source: "практика", unverified: true } ], openQuestions: ["Срок производства?"] };
  const buf = await buildTzDocx(tz, { niche: "boxing machine", coreKeyword: "boxing machine", preparedBy: "Тестер", date: "2026-09-22", listingsAnalyzed: 61 });
  assert.ok(Buffer.isBuffer(buf) && buf.length > 2000); assert.equal(buf.toString("latin1", 0, 2), "PK");
  const xml = docxXml(buf);
  for (const s of ["ТЗ производителю: тест", "Кратко о товаре.", "Конструкция", "Качество и контроль", "9 зон", "58 % выручки", "обязательно", "желательно", "число не подтверждено расчётом", "Срок производства?", "boxing machine", "Тестер", "листингов в анализе: 61"]) assert.ok(xml.includes(s), "в документе нет: " + s);
  assert.equal(tzFileName({ niche: "Boxing Machine Pro", date: "2026-09-22" }), "TZ-boxing-machine-pro-2026-09-22.docx");
});

let T, base, h;
before(async () => { T = await startApp({}); base = T.base; h = (await T.userWithSession({ login: "cfg-tester", name: "Тестер" })).headers; });
after(async () => { await T.close(); });

test("маршруты: health.scrapfly, 400 без asins/schema/payload, задача схема→извлечение в MOCK через SSE, DOCX вложением, без сеанса 401", async () => {
  const health = await fetch(`${base}/api/health`).then((r) => r.json()); assert.equal(health.scrapfly, true, "в MOCK Scrapfly считается настроенным");
  assert.equal((await fetch(`${base}/api/config/schema`, { method: "POST", headers: h, body: JSON.stringify({ niche: "x", asins: [] }) })).status, 400);
  assert.equal((await fetch(`${base}/api/config/extract`, { method: "POST", headers: h, body: JSON.stringify({ niche: "x", asins: [asin(1)], schema: { fields: [] } }) })).status, 400);
  assert.equal((await fetch(`${base}/api/config/tz`, { method: "POST", headers: h, body: JSON.stringify({ niche: "x" }) })).status, 400);
  assert.equal((await fetch(`${base}/api/config/schema`, { method: "POST", headers: { "content-type": "application/json", "x-requested-with": "fba" }, body: JSON.stringify({ asins: [asin(1)] }) })).status, 401);
  const asins = [asin(1), asin(2), asin(3), asin(4)].map((a, i) => ({ asin: a, title: "Mock boxing machine " + i }));
  const r = await fetch(`${base}/api/config/schema`, { method: "POST", headers: h, body: JSON.stringify({ niche: "boxing machine", asins, listings: {} }) }); assert.equal(r.status, 202);
  const { jobId } = await r.json(); const text = await fetch(`${base}/api/jobs/${jobId}/events`, { headers: h }).then((x) => x.text());
  const events = [...text.matchAll(/event: (\w+)\ndata: (.*)\n/g)].map((m) => [m[1], JSON.parse(m[2])]); const names = events.map((e) => e[0]);
  assert.ok(names.includes("stage") && names.includes("done") && names.at(-1) === "end", names.join(",")); const done = events.find((e) => e[0] === "done")[1]; assert.ok(done.schema.fields.length >= 3);
  const st = await fetch(`${base}/api/jobs/${jobId}`, { headers: h }).then((x) => x.json()); assert.equal(st.type, "config_schema"); assert.equal(st.status, "done");
  const r2 = await fetch(`${base}/api/config/extract`, { method: "POST", headers: h, body: JSON.stringify({ niche: "boxing machine", asins, schema: done.schema, listings: done.listings }) }); assert.equal(r2.status, 202);
  const t2 = await fetch(`${base}/api/jobs/${(await r2.json()).jobId}/events`, { headers: h }).then((x) => x.text()); assert.ok(t2.includes("event: done")); assert.ok(!t2.includes("job_error"));
  const d = await fetch(`${base}/api/tz/docx`, { method: "POST", headers: h, body: JSON.stringify({ tz: { title: "ТЗ", rows: [{ section: "упаковка", param: "Коробка", requirement: "индивидуальная", rationale: "FBA", priority: "must", source: "правила" }] }, meta: { niche: "Boxing Machine", date: "2026-09-22" } }) });
  assert.equal(d.status, 200); assert.match(d.headers.get("content-type"), /wordprocessingml/); assert.match(d.headers.get("content-disposition"), /TZ-boxing-machine-2026-09-22\.docx/);
  const buf = Buffer.from(await d.arrayBuffer()); assert.equal(buf.toString("latin1", 0, 2), "PK"); assert.ok(docxXml(buf).includes("Коробка"));
  assert.equal((await fetch(`${base}/api/tz/docx`, { method: "POST", headers: h, body: JSON.stringify({ tz: {} }) })).status, 400);
});
