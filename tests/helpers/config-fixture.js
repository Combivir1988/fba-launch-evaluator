// Этап 2 (spec 010) на реальной фикстуре: страницы — MOCK-листинги из тайтлов Xray, схема/таблица/ТЗ — детерминированные заглушки сервера.
import { mockListing } from "../../server/scrapfly.js";
import { mockFields, mockExtract, mockTz } from "../../server/mock-config.js";
import { sanitizeSchema, mergeExtraction } from "../../shared/config-extract.js";
import { configScope } from "../../shared/config-scope.js";
import { mergeThresholds } from "../../shared/thresholds.js";
import { compute } from "../../shared/compute.js";
import { buildTzPayload, collectTzNumbers, markUnverified } from "../../shared/tz-payload.js";

export function withConfig(a, { tz = true } = {}) {
  const th = mergeThresholds(a.thresholds); const scope = configScope(a, th);
  const listings = Object.fromEntries(scope.items.map((i) => [i.asin, { ...mockListing(i.asin, i.title), fetchedAt: "2026-09-22T00:00:00Z" }]));
  const all = Object.values(listings);
  const schema = sanitizeSchema({ ...mockFields({ listings: all }), proposedAt: "2026-09-22T00:00:00Z", model: "mock", editedAt: null, basedOn: all.length });
  const table = mergeExtraction({ schema, items: mockExtract({ schema, listings: all }).items, listings, asins: scope.asins, model: "mock", cost: 0, now: "2026-09-22T00:00:00Z" });
  a.aggregates.listings = listings; a.config = { schema, table }; a.results = compute(a);
  if (tz) { const payload = buildTzPayload(a); a.config.tz = markUnverified({ ...mockTz({ payload }), generatedAt: "2026-09-22T00:00:00Z", model: "mock", editedAt: null }, collectTzNumbers(payload)); }
  return a;
}
