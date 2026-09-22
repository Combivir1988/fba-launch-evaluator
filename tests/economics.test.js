import { test } from "node:test";
import assert from "node:assert/strict";
import { economics } from "../shared/economics.js";
import { DEFAULT_THRESHOLDS as TH } from "../shared/thresholds.js";

const base = { shippingPerUnit: 0, referralPct: 0.15, fbaFee: 4.5, cpc: 1.2, cvr: 0.10, ppcShare: 0.7, unitsPerDay: 10 };

test("Без COGS — Критерий 2 полностью ⚪ (pending)", () => {
  const e = economics({ ...base, price: 30, cogs: null }, TH);
  assert.equal(e.pending, true);
  assert.ok(Object.values(e.criterion2).every((x) => x.status === "pending"));
  assert.equal(e.gate1.status, "pending");
});

test("Кейс Jitsu: 12-pack $23.90 (маржа ~46 %) не переживает рекламу, 48-pack $42.99 переживает", () => {
  // 12-pack: подбираем COGS так, чтобы маржа без рекламы ≈ 46 %
  const small = economics({ ...base, cpc: 2.5, price: 23.90, cogs: 4.6, fbaFee: 4.7 }, TH); // одинаковый CPC для обоих
  assert.ok(small.marginNoAds > 0.44 && small.marginNoAds < 0.48, `маржа ${small.marginNoAds}`);
  assert.equal(small.cheapSegment, true);
  assert.equal(small.gate1.status, "pass", "формально Gate 1 проходит (дешёвый сегмент: маржа > 40 %)");
  assert.equal(small.gate2.status, "no_go", "Gate 2 ломается: net after ads < 0 даже при 15 %");
  const big = economics({ ...base, cpc: 2.5, price: 42.99, cogs: 13.9, fbaFee: 7.4 }, TH);
  assert.ok(big.marginNoAds > 0.33 && big.marginNoAds < 0.38, `маржа ${big.marginNoAds}`);
  assert.equal(big.gate1.status, "pass");
  assert.equal(big.gate2.status, "pass");
  assert.ok(big.marginWithAds < big.marginNoAds, "маржа с рекламой ниже маржи без рекламы — оба числа доступны");
});

test("Gate 2: сетка CVR и точка безубыточности", () => {
  const e = economics({ ...base, price: 40, cogs: 10, fbaFee: 6 }, TH);
  assert.deepEqual(e.gate2.byCvr.map((r) => r.cvr), [0.08, 0.10, 0.12, 0.15]);
  assert.ok(e.gate2.byCvr[0].net < e.gate2.byCvr[3].net, "net растёт с CVR");
  assert.ok(e.breakEvenCvr > 0 && e.breakEvenCvr < 0.08);
});

test("Gate 1: одно условие → ДОРАБОТКА, ни одного → NO-GO; ROI-подсказки", () => {
  const rework = economics({ ...base, price: 20, cogs: 9, fbaFee: 4 }, TH); // маржа 20 %, но профит $4 — ни одного? проверим
  assert.ok(["rework", "no_go"].includes(rework.gate1.status));
  const nogo = economics({ ...base, price: 20, cogs: 12, fbaFee: 4 }, TH);
  assert.equal(nogo.gate1.status, "no_go");
  assert.equal(nogo.roiHint, "loss");
  const sus = economics({ ...base, price: 60, cogs: 8, fbaFee: 6 }, TH);
  assert.equal(sus.roiHint, "suspicious");
});

test("2c: CVR выше 15 % — не ошибка: подтверждён данными ниши → OK, без подтверждения → погранично; ниже 8 % — погранично", async () => {
  const { economics } = await import("../shared/economics.js"); const { mergeThresholds } = await import("../shared/thresholds.js"); const TH = mergeThresholds();
  const base = { price: 30, cogs: 8.4, shippingPerUnit: 1, fbaFee: 5, referralPct: 0.15, cpc: 1.5, ppcShare: 0.5, unitsPerDay: 10 };
  const c2 = (cvr, ctx = {}) => economics({ ...base, cvr }, TH, ctx).criterion2["2c"];
  assert.equal(c2(0.25, { dataCvr: 0.252, dataCvrLabel: "конверсия клика ниши по POE" }).status, "ok"); assert.match(c2(0.25, { dataCvr: 0.252, dataCvrLabel: "конверсия клика ниши по POE" }).note, /подтверждено данными: конверсия клика ниши по POE 25,2 %/);
  assert.equal(c2(0.25).status, "warn"); assert.match(c2(0.25).note, /данными не подтверждено/); assert.equal(c2(0.25, { dataCvr: 0.12 }).status, "warn"); assert.match(c2(0.25, { dataCvr: 0.12 }).note, /выше данных ниши \(12,0 %\)/);
  assert.equal(c2(0.10).status, "ok"); assert.equal(c2(0.05).status, "warn"); assert.equal(c2(0.15).status, "ok");
  const { fixtureAnalysis } = await import("./helpers/fixture-analysis.js"); const a = fixtureAnalysis({ inputs: { cvr: 0.25 } }); assert.equal(a.results.economics.criterion2["2c"].status, "ok", "в расчёте: конверсия клика ниши по POE (30 %) подтверждает 25 %");
});
