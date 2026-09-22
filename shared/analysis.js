// Документ анализа: создание, миграции схемы, slug для имён файлов.
import { METHODOLOGY_VERSION } from "./thresholds.js";

export const SCHEMA_VERSION = 1;

export function newId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return "a-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
}

export function defaultInputs() {
  return {
    price: null, cogs: null, cogsConfirmed: false, shippingPerUnit: 0, referralPct: 0.15, fbaFee: 0, cpc: null,
    cvr: 0.10, ppcShare: 0.70, targetAcos: 0.30, unitsPerDay: 10, productionDays: 30, shippingDays: 30, receivingDays: 15,
    priceMin: null, priceMax: null, // ценовой диапазон анализа (spec 003): null — вся ниша
    // помесячный сценарий и барьер отзывов (spec 005): null — значение по умолчанию из порогов / из данных ниши
    horizonMonths: null, rampMonths: null, startSalesMonthly: null, firstBatchUnits: null, startupCosts: 0, reviewRate: null, vineReviews: null,
    adsReserve: 0, budget: null, canDifferentiate: "unknown", myAsins: [], myBrand: "", evaluateAsNewEntrant: true,
    excludedBrands: [], clusterKeywords: [], clusterMinSv: null, clusterMinCompetitors: null, manualOverrides: {}, challenger: {}, patentFeature: "",
    checklist: { gatedCategory: false, dangerousGoods: false, certificates: "none", patentSearch: "none", trademarkSearch: "none",
      reviewMergingSuspected: false, amazonSells: "auto", couponsDealsSaturation: "unknown", designTestScore: null, lifecycleMonths: null, listingsInSearch: null },
    axisManual: { brandFit: null, opRisk: null },
  };
}

export function newAnalysis(partial = {}) {
  const now = new Date().toISOString();
  return {
    id: newId(), schemaVersion: SCHEMA_VERSION, methodologyVersion: METHODOLOGY_VERSION,
    niche: "", coreKeyword: "", marketplace: "US", createdAt: now, updatedAt: now, status: "draft",
    sources: { xray: null, cerebro: null, poe: null, sqp: null },
    inputs: defaultInputs(), thresholds: {}, aggregates: {}, results: null, ai: null, patents: null, config: null,
    ...partial,
  };
}

/** Приводит документ старой версии к текущей. */
export function migrate(doc) {
  if (!doc || typeof doc !== "object") throw new Error("Пустой документ");
  const v = doc.schemaVersion ?? 0;
  if (v > SCHEMA_VERSION) throw new Error(`Файл из более новой версии (schemaVersion ${v})`);
  const out = { ...newAnalysis(), ...doc, inputs: { ...defaultInputs(), ...(doc.inputs || {}) } };
  out.inputs.checklist = { ...defaultInputs().checklist, ...(doc.inputs?.checklist || {}) };
  if (typeof out.inputs.checklist.amazonSells === "boolean") out.inputs.checklist.amazonSells = out.inputs.checklist.amazonSells ? "yes" : "auto"; // старые документы
  out.inputs.axisManual = { ...defaultInputs().axisManual, ...(doc.inputs?.axisManual || {}) };
  out.schemaVersion = SCHEMA_VERSION;
  return out;
}

/** Сводка для списка истории — считается из лёгкой части документа (одинаково в браузере и на сервере). */
export function metaFromCore(core = {}) {
  const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  return {
    niche: String(core.niche || "").slice(0, 200), coreKeyword: String(core.coreKeyword || "").slice(0, 200),
    verdict: core.ai?.verdict || core.results?.verdict?.ceiling || null,
    c1: num(core.results?.criterion1?.okCount), score: num(core.results?.scorecard?.total),
    sources: Object.entries(core.sources || {}).filter(([, v]) => v).map(([k]) => k),
    aiDone: Boolean(core.ai), patentsDone: Boolean(core.patents), configDone: Boolean(core.config?.table),
  };
}

/** Серверное хранение (spec 002, R2): лёгкая часть `core` (поля, пороги, результаты, AI, патенты) меняется часто,
 *  тяжёлая `aggregates` (разобранные отчёты, до нескольких MB) — только при загрузке файлов. */
export function splitDoc(analysis) {
  const { aggregates, ...core } = analysis;
  return { core, aggregates: aggregates || {}, meta: metaFromCore(core) };
}
export function joinDoc(core, aggregates) { return { ...core, aggregates: aggregates || {} }; }

/** Подпись содержимого без служебных меток времени — чтобы не сохранять документ, в котором ничего не изменилось. */
export function coreSignature(core) {
  return JSON.stringify(core, (k, v) => (k === "updatedAt" || k === "computedAt" ? undefined : v));
}

export function slug(s) {
  return String(s || "niche").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9а-яіїєґ]+/gi, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "niche";
}
export const fileStamp = (d = new Date()) => d.toISOString().slice(0, 10);
