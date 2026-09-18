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
    adsReserve: 0, budget: null, canDifferentiate: "unknown", myAsins: [], myBrand: "", evaluateAsNewEntrant: true,
    excludedBrands: [], clusterKeywords: [], clusterMinSv: null, clusterMinCompetitors: null, manualOverrides: {}, challenger: {},
    checklist: { gatedCategory: false, dangerousGoods: false, certificates: "none", patentSearch: "none", trademarkSearch: "none",
      reviewMergingSuspected: false, amazonSells: false, couponsDealsSaturation: "unknown", designTestScore: null, lifecycleMonths: null, listingsInSearch: null },
    axisManual: { brandFit: null, opRisk: null },
  };
}

export function newAnalysis(partial = {}) {
  const now = new Date().toISOString();
  return {
    id: newId(), schemaVersion: SCHEMA_VERSION, methodologyVersion: METHODOLOGY_VERSION,
    niche: "", coreKeyword: "", marketplace: "US", createdAt: now, updatedAt: now, status: "draft",
    sources: { xray: null, cerebro: null, poe: null, sqp: null },
    inputs: defaultInputs(), thresholds: {}, aggregates: {}, results: null, ai: null,
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
  out.inputs.axisManual = { ...defaultInputs().axisManual, ...(doc.inputs?.axisManual || {}) };
  out.schemaVersion = SCHEMA_VERSION;
  return out;
}

export function slug(s) {
  return String(s || "niche").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9а-яіїєґ]+/gi, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "niche";
}
export const fileStamp = (d = new Date()) => d.toISOString().slice(0, 10);
