import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parsePatentHtml, estimateExpiry, searchGooglePatents, patentScanStream, QUERIES_SCHEMA, ASSESS_SCHEMA } from "../server/patents.js";
import { configFromEnv } from "../server/claude.js";
import { validateVerdict } from "../shared/validate-verdict.js";
import { newAnalysis } from "../shared/analysis.js";
import { compute } from "../shared/compute.js";
import { FIX } from "./helpers.js";

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
  const cfg = configFromEnv({ MOCK_AI: "1", APP_PASSWORD: "x" });
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
  const cfg = configFromEnv({ OPENROUTER_API_KEY: "k", APP_PASSWORD: "x" });
  const searchJson = { results: { total_num_results: 1, cluster: [{ result: [{ id: "patent/US9309657B2/en", patent: { title: "Floor mat", snippet: "s", priority_date: "2012-09-14", publication_number: "US9309657B2", assignee: "New Pig" } }] }] } };
  const html = readFileSync(join(FIX, "patent_US9309657B2.html"), "utf8");
  const fetchImpl = async (url) => url.includes("/xhr/query") ? new Response(JSON.stringify(searchJson), { status: 200 }) : new Response(html, { status: 200 });
  const aiJson = async ({ schema }) => schema === QUERIES_SCHEMA ? { queries: [{ q: "urinal mat", purpose: "тип" }], concepts: ["adhesive layer"] }
    : { overall: "clear", summary: "Патент истёк", designPatentNote: "проверить", patents: [{ number: "US9309657B2", relevance: 0.8, risk: "none", claimed: "moppable mat", overlap: "нет", designAround: "не требуется" }], nextSteps: ["—"] };
  const ev = []; for await (const e of patentScanStream({ coreKeyword: "urinal mat" }, cfg, { fetchImpl, aiJson })) ev.push(e);
  const scan = ev.find((e) => e.event === "done")?.data.scan; assert.ok(scan, JSON.stringify(ev.at(-1)));
  assert.equal(scan.items[0].expired, true, "Expired - Fee Related → истёк");
  assert.equal(scan.items[0].assignee, "New Pig Corp");
  assert.equal(scan.status, "clear");
  assert.ok(validateVerdict({ overall: "clear", summary: "", designPatentNote: "", patents: [], nextSteps: [] }, ASSESS_SCHEMA).ok);
});
