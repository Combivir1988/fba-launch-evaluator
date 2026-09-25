import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parsePatentHtml, estimateExpiry, searchGooglePatents, patentScanStream, QUERIES_SCHEMA, ASSESS_SCHEMA } from "../server/patents.js";
import { buildPatentsDocx, patentsFileName } from "../server/patents-docx.js";
import zlib from "node:zlib";
import { configFromEnv } from "../server/claude.js";
import { validateVerdict } from "../shared/validate-verdict.js";
import { newAnalysis } from "../shared/analysis.js";
import { compute } from "../shared/compute.js";
import { FIX } from "./helpers.js";

/** Текст document.xml из .docx (тот же разбор, что в config-jobs.test.js). */
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


test("parsePatentHtml: реальная карточка US9309657B2 (кейс Urinal Mat из скилла)", () => {
  const d = parsePatentHtml(readFileSync(join(FIX, "patent_US9309657B2.html"), "utf8"));
  assert.equal(d.title, "Floor mat");
  assert.match(d.abstract, /moppable floor mat/i);
  assert.ok(d.independentClaims.length >= 1 && d.independentClaims.length <= 3);
  assert.match(d.independentClaims[0], /^1\. A moppable floor mat/);
  assert.equal(d.totalClaims, 25);
  assert.equal(d.priorityDate, "2012-09-14");
  assert.equal(d.expiration, "2033-09-17");
  assert.match(d.legalStatus, /Expired/);
  assert.equal(d.assignee, "New Pig Corp");
  assert.equal(estimateExpiry({ ...d, type: "PATENT" }), "2033-09-17");
  assert.equal(estimateExpiry({ priorityDate: "2015-06-01", type: "PATENT" }), "2035-06-01");
  assert.equal(estimateExpiry({ grantDate: "2020-01-15", type: "DESIGN" }), "2035-01-15");
});

test("searchGooglePatents: разбор XHR-ответа", async () => {
  const fake = async () => new Response(JSON.stringify({ results: { total_num_results: 2, cluster: [{ result: [
    { id: "patent/US1B2/en", patent: { title: " Urinal <b>screen</b>", snippet: "A screen &hellip;", priority_date: "2019-01-01", filing_date: "2020-01-01", grant_date: "2022-01-01", publication_number: "US1B2", assignee: "Acme", inventor: "X" } },
    { id: "patent/US2B2/en", patent: { title: "Other", publication_number: "US2B2" } } ] }] } }), { status: 200 });
  const r = await searchGooglePatents("urinal screen", { fetchImpl: fake });
  assert.equal(r.total, 2);
  assert.equal(r.items[0].title, "Urinal screen");
  assert.equal(r.items[0].snippet, "A screen …");
  assert.equal(r.items[0].url, "https://patents.google.com/patent/US1B2/en");
  assert.equal(r.items[1].priorityDate, null);
});

test("patentScanStream (mock): stage-события, done со сканом по схеме; критерий 8 → 🟡 допущение", async () => {
  const cfg = configFromEnv({ MOCK_AI: "1" });
  const ev = []; for await (const e of patentScanStream({ niche: "urinal screen deodorizer", coreKeyword: "urinal screen deodorizer", feature: "enzyme odor neutralizer" }, cfg)) ev.push(e);
  const names = ev.map((e) => e.event);
  assert.ok(names.filter((n) => n === "stage").length >= 4);
  const done = ev.find((e) => e.event === "done"); assert.ok(done, JSON.stringify(ev.at(-1)));
  const scan = done.data.scan;
  assert.equal(scan.status, "unsure");
  assert.ok(scan.items.length >= 3 && scan.items[0].risk === "med");
  assert.ok(scan.queries[0].url.includes("patents.google.com"));
  assert.ok(scan.disclaimer.includes("Не является юридическим заключением"));
  // интеграция с критерием 8
  const a = newAnalysis({ niche: "n", coreKeyword: "k" }); a.patents = scan;
  const R = compute(a);
  assert.equal(R.challenger.items["8"].kind, "assumed");
  assert.equal(R.challenger.items["8"].status, "warn");
  assert.equal(R.challenger.mandatoryOk, false, "допущение не засчитывается как зелёный обязательный");
  assert.ok(R.verdict.reasons.some((r) => /AI-скан|допущение/.test(r)));
  // подтверждение человеком побеждает
  a.inputs.checklist.patentSearch = "clear"; const R2 = compute(a);
  assert.equal(R2.challenger.items["8"].kind, "confirmed"); assert.equal(R2.challenger.items["8"].status, "ok");
  // conflict → No-Go
  a.inputs.checklist.patentSearch = "none"; a.patents = { ...scan, status: "conflict", items: [{ ...scan.items[0], risk: "high" }] };
  assert.equal(compute(a).verdict.ceiling, "no_go");
});

test("patentScanStream: реальный поиск и AI подменяются (fetchImpl/aiJson), результат по схеме", async () => {
  const cfg = configFromEnv({ OPENROUTER_API_KEY: "k" });
  const searchJson = { results: { total_num_results: 1, cluster: [{ result: [{ id: "patent/US9309657B2/en", patent: { title: "Floor mat", snippet: "s", priority_date: "2012-09-14", publication_number: "US9309657B2", assignee: "New Pig" } }] }] } };
  const html = readFileSync(join(FIX, "patent_US9309657B2.html"), "utf8");
  const fetchImpl = async (url) => url.includes("/xhr/query") ? new Response(JSON.stringify(searchJson), { status: 200 }) : new Response(html, { status: 200 });
  const aiJson = async ({ schema }) => schema === QUERIES_SCHEMA ? { queries: [{ q: "urinal mat", purpose: "тип" }], concepts: ["adhesive layer"] }
    : { overall: "clear", summary: "Патент истёк", designPatentNote: "проверить", patents: [{ number: "US9309657B2", relevance: 0.8, risk: "none", claimed: "moppable mat", overlap: "нет", designAround: "не требуется" }], nextSteps: ["—"] };
  const ev = []; for await (const e of patentScanStream({ coreKeyword: "urinal mat" }, cfg, { fetchImpl, aiJson })) ev.push(e);
  const scan = ev.find((e) => e.event === "done")?.data.scan; assert.ok(scan, JSON.stringify(ev.at(-1)));
  assert.equal(scan.items[0].expired, true, "Expired - Fee Related → истёк");
  assert.equal(scan.items[0].relevance, 0.8, "доля остаётся долей");
  assert.equal(scan.items[0].assignee, "New Pig Corp");
  assert.equal(scan.status, "clear");
  assert.ok(validateVerdict({ overall: "clear", summary: "", designPatentNote: "", patents: [], nextSteps: [] }, ASSESS_SCHEMA).ok);
});

test("релевантность патента в процентах приводится к доле (иначе в таблице «9 500 %»)", async () => {
  const searchJson = { results: { total_num_results: 1, cluster: [{ result: [{ id: "patent/US9309657B2/en", patent: { title: "Floor mat", snippet: "s", priority_date: "2012-09-14", publication_number: "US9309657B2", assignee: "New Pig" } }] }] } };
  const html = readFileSync(join(FIX, "patent_US9309657B2.html"), "utf8");
  const fetchImpl = async (url) => (url.includes("/xhr/query") ? new Response(JSON.stringify(searchJson), { status: 200 }) : new Response(html, { status: 200 }));
  const aiJson = async ({ schema }) => (schema === QUERIES_SCHEMA ? { queries: [{ q: "urinal mat", purpose: "тип" }], concepts: ["adhesive layer"] }
    : { overall: "unsure", summary: "с", designPatentNote: "д", nextSteps: [], patents: [{ number: "US9309657B2", relevance: 95, risk: "high", claimed: "c", overlap: "o", designAround: "d" }] });
  const cfg = configFromEnv({ OPENROUTER_API_KEY: "k" });
  const ev = []; for await (const e of patentScanStream({ coreKeyword: "urinal mat" }, cfg, { fetchImpl, aiJson })) ev.push(e);
  const scan = ev.find((e) => e.event === "done")?.data.scan;
  assert.equal(scan.items[0].relevance, 0.95, "95 — это проценты, а не 9500 %");
});

test("патентный ландшафт: белые пятна, держатели и плотность попадают в скан и в DOCX", async () => {
  const scan = { createdAt: "2026-09-25T10:00:00Z", status: "unsure", summary: "с", feature: "фильтр-корзина", model: "m", source: "Google Patents",
    items: [{ number: "US11076721B2", risk: "high", relevance: 0.9, claimed: "внутренняя корзина с ситом", overlap: "полное", designAround: "убрать признак «перфорированное сито» — фильтровать отдельным мешком", assignee: "Eternal East", priorityDate: "2018-01-01", expired: false, pending: false }],
    holders: [{ name: "Joyoung", focus: "смешивание и нагрев", patents: ["US8342079B2"] }],
    hotAreas: [{ area: "фильтрация", density: "high", note: "плотно закрыта" }, { area: "таймер", density: "low", note: "общая техника" }],
    whiteSpaces: [{ area: "ультразвуковая очистка", why: "в США claims нет", howToUse: "сделать отличие и запатентовать самим" }],
    designHits: [{ number: "USD878847S", title: "Nut milk machine", assignee: "Eternal East" }], designPatentNote: "сверить силуэт",
    nextSteps: ["заказать FTO"], queries: [{ q: "nut milk maker filter basket", purpose: "тип товара" }], disclaimer: "не юридическое заключение" };
  const buf = await buildPatentsDocx(scan, { niche: "nut milk maker", coreKeyword: "nut milk", date: "2026-09-25", preparedBy: "Тестер" });
  assert.equal(buf.toString("latin1", 0, 2), "PK");
  const xml = docxXml(buf);
  for (const t of ["Патентный ландшафт", "Белые пятна", "ультразвуковая очистка", "Joyoung", "минное поле", "Eternal East", "USD878847S", "nut milk maker filter basket"]) assert.ok(xml.includes(t), "в файле нет: " + t);
  assert.match(patentsFileName({ niche: "nut milk maker", date: "2026-09-25" }), /Patents-nut-milk-maker-2026-09-25\.docx/);
});
