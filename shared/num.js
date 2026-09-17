// Нормализация чисел/дат из экспортов Helium 10 / POE (ловушки из SKILL.md):
// «69,95» (десятичная запятая), «6 892» / «366 714,82» (неразрывный пробел U+00A0 как разделитель тысяч),
// «294,000» (US-тысячи в Cerebro), «>100,000», «N/A», «-», «n/a», BOM.

const EMPTY = new Set(["", "-", "—", "n/a", "na", "null", "undefined", "none"]);

/** Строка/число → число или null. Границы «>100,000» → 100000 (см. isBound). */
export function toNum(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  let s = String(v).replace(/^﻿/, "").trim();
  if (EMPTY.has(s.toLowerCase())) return null;
  s = s.replace(/^[<>≈~]+/, "").replace(/[$€£%]/g, "").trim();
  const neg = /^\(.*\)$/.test(s) || s.startsWith("-");
  s = s.replace(/[()\-+]/g, "");
  // пробелы (обычный, U+00A0, U+202F) — всегда разделитель тысяч
  const hadSpace = /[\s  ]/.test(s);
  s = s.replace(/[\s  ]/g, "");
  if (!s) return null;
  const commas = (s.match(/,/g) || []).length;
  const dots = (s.match(/\./g) || []).length;
  if (commas && dots) {
    // оба присутствуют: последний из них — десятичный
    if (s.lastIndexOf(",") > s.lastIndexOf(".")) s = s.replace(/\./g, "").replace(",", ".");
    else s = s.replace(/,/g, "");
  } else if (commas) {
    const parts = s.split(",");
    const usThousands = !hadSpace && parts.slice(1).every((p) => p.length === 3) && parts[0].length <= 3;
    if (commas > 1 || usThousands) s = parts.join("");        // 294,000 → 294000
    else s = parts[0] + "." + parts.slice(1).join("");         // 69,95 → 69.95
  }
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return neg ? -n : n;
}

/** true для «>100,000», «<10» — значение является границей, не точным числом. */
export function isBound(v) {
  return typeof v === "string" && /^\s*[<>]/.test(v);
}

/** Целое ≥0 или null. */
export function toInt(v) {
  const n = toNum(v);
  return n === null ? null : Math.round(n);
}

const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };

/** «Aug 22, 2017» / «2017-08-22» / «22.08.2017» → «YYYY-MM-DD» или null. */
export function parseDateEn(v) {
  if (!v) return null;
  const s = String(v).trim();
  let m = s.match(/^([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})$/);
  if (m) {
    const mo = MONTHS[m[1].toLowerCase()];
    if (mo === undefined) return null;
    return iso(Number(m[3]), mo, Number(m[2]));
  }
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return iso(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  m = s.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})$/);
  if (m) return iso(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}
function iso(y, mo, d) {
  const dt = new Date(Date.UTC(y, mo, d));
  return Number.isNaN(dt.getTime()) ? null : dt.toISOString().slice(0, 10);
}

/** Месяцев между датой и «сейчас» (для возраста листинга). */
export function monthsSince(isoDate, now = new Date()) {
  if (!isoDate) return null;
  const d = new Date(isoDate);
  if (Number.isNaN(d.getTime())) return null;
  return Math.max(0, (now - d) / (1000 * 60 * 60 * 24 * 30.4375));
}

export const nums = (arr) => arr.filter((x) => typeof x === "number" && Number.isFinite(x));
export const sum = (arr) => nums(arr).reduce((a, b) => a + b, 0);
export const mean = (arr) => { const a = nums(arr); return a.length ? sum(a) / a.length : null; };
export function median(arr) {
  const a = nums(arr).sort((x, y) => x - y);
  if (!a.length) return null;
  const mid = a.length >> 1;
  return a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2;
}
export const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
export const round = (x, d = 0) => (x === null || x === undefined || !Number.isFinite(x) ? null : Math.round(x * 10 ** d) / 10 ** d);
export const safeDiv = (a, b) => (typeof a === "number" && typeof b === "number" && b !== 0 && Number.isFinite(a / b) ? a / b : null);

/** Относительное расхождение |a−b| / max(|a|,|b|). */
export function relDelta(a, b) {
  if (typeof a !== "number" || typeof b !== "number") return null;
  const m = Math.max(Math.abs(a), Math.abs(b));
  return m === 0 ? 0 : Math.abs(a - b) / m;
}
