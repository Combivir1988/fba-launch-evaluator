// Загрузка файлов: определение типа по заголовкам → парсеры shared/.
import { parseXray, isXrayHeaders } from "/shared/parse-xray.js";
import { parseCerebro, isCerebroHeaders } from "/shared/parse-cerebro.js";
import { parsePoe, isPoeJson } from "/shared/parse-poe.js";
import { parseSqp, isSqpHeaders } from "/shared/parse-sqp.js";

function readText(file) {
  return new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(String(r.result)); r.onerror = () => reject(r.error); r.readAsText(file, "utf-8"); });
}
function csv(text) {
  const res = window.Papa.parse(text, { header: true, skipEmptyLines: true, transformHeader: (h) => h.replace(/^﻿/, "") });
  return res.data;
}

/**
 * @returns {{kind: 'xray'|'cerebro'|'poe'|'sqp', data: object, meta: object}}
 */
export async function detectAndParse(file, ctx = {}) {
  const text = await readText(file);
  const trimmed = text.trimStart();
  if (trimmed.startsWith("{")) {
    const obj = JSON.parse(trimmed);
    if (isPoeJson(obj)) { const data = parsePoe(obj); return { kind: "poe", data, meta: { fileName: file.name, rows: data.asinMetrics.length, nicheId: data.meta.nicheId, nicheTitle: data.meta.nicheTitle, capturedAt: data.meta.capturedAt, lastUpdated: data.meta.lastUpdated, loadedAt: new Date().toISOString() } }; }
    if (obj.type === "fba-launch-evaluator/analysis" || obj.type === "fba-launch-evaluator/history") return { kind: "import", data: obj, meta: { fileName: file.name } };
    throw new Error(`${file.name}: JSON не распознан (ожидался POE schemaVersion 1 или экспорт приложения)`);
  }
  // SQP: первая строка служебная `ASIN or Product=[...]`
  let body = text;
  const firstLine = text.slice(0, text.indexOf("\n"));
  if (/^﻿?ASIN or Product=|^﻿?Brand=|Reporting Range=/.test(firstLine)) body = text.slice(text.indexOf("\n") + 1);
  let rows = csv(body);
  if (!rows.length) throw new Error(`${file.name}: пустой CSV`);
  const headers = Object.keys(rows[0]);
  if (isXrayHeaders(headers)) { const data = parseXray(rows); return { kind: "xray", data, meta: { fileName: file.name, rows: data.asins.length, rowsTotal: data.flags.rowsTotal, duplicatesDropped: data.flags.duplicatesDropped, loadedAt: new Date().toISOString() } }; }
  if (isCerebroHeaders(headers)) { const data = parseCerebro(rows, { coreKeyword: ctx.coreKeyword, brands: ctx.brands }); return { kind: "cerebro", data, meta: { fileName: file.name, rows: data.keywords.length, loadedAt: new Date().toISOString() }, rawRows: rows }; }
  if (isSqpHeaders(headers)) { const data = parseSqp(rows); return { kind: "sqp", data, meta: { fileName: file.name, rows: data.rows.length, loadedAt: new Date().toISOString() } }; }
  throw new Error(`${file.name}: не похоже на Xray / Cerebro / SQP (заголовки: ${headers.slice(0, 5).join(", ")}…)`);
}

/** Переразбор Cerebro при смене core-ключа/брендов (нужны сырые строки). */
export function reparseCerebro(rawRows, ctx) { return parseCerebro(rawRows, ctx); }
