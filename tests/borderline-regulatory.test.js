import { test } from "node:test";
import assert from "node:assert/strict";
import { borderline } from "../shared/borderline.js";
import { regulatoryTriggers, REG_RULES } from "../shared/regulatory.js";
import { mergeThresholds } from "../shared/thresholds.js";
import { fixtureAnalysis } from "./helpers/fixture-analysis.js";
import { entryFixture } from "./helpers/entry-fixture.js";

const TH = mergeThresholds();
const R0 = (over = {}) => ({ criterion1: { items: {} }, economics: { pending: true }, traffic: {}, competition: { reviewBarrier: {} }, budget: null, scorecard: {}, ...over });
const c1 = (items) => ({ items: Object.fromEntries(Object.entries(items).map(([k, v]) => [k, { value: v, source: "xray" }])) });

test("SC-005: в список попадает всё, что в пределах 15 % от порога, и ничего за пределами", () => {
  const b = borderline(R0({ criterion1: c1({ "1a": 540_000, "1b": 28.5, "1c": 9000, "1d": 320, "1e": 0.26, "1f": 0.20, "1h": 0.12 }) }), TH);
  assert.deepEqual(b.items.map((i) => i.id).sort(), ["1a", "1b", "1b-low", "1d", "1e"].sort(), "1c, 1f и 1h далеко от порогов; 1b близка и к $30, и к $25");
  const at = (id) => b.items.find((i) => i.id === id);
  assert.equal(at("1a").side, "pass"); assert.match(at("1a").text, /сейчас \$540.000 — «OK»; порог \$500.000; оценка сменится на «не OK» при снижении на 7,4 %/);
  assert.equal(at("1b").side, "fail"); assert.match(at("1b").text, /«погранично».*сменится на «OK» при росте на 5,3 %/);
  assert.equal(at("1e").side, "fail"); assert.match(at("1e").text, /26 %.*порог 25 %.*при снижении на 3,8 %/); assert.equal(at("1d").side, "fail");
  assert.ok(Math.abs(b.items[0].distancePct) <= Math.abs(b.items.at(-1).distancePct), "ближайшие к порогу — первыми");
  for (const i of b.items) assert.ok(Math.abs(i.distancePct) <= 0.15);
  assert.equal(borderline(R0({ criterion1: c1({ "1a": 574_999 }) }), TH).items.length, 1); assert.equal(borderline(R0({ criterion1: c1({ "1a": 575_001 }) }), TH).items.length, 0);
  assert.equal(borderline(R0({ criterion1: c1({ "1a": 540_000 }) }), mergeThresholds({ borderline: { pct: 0.05 } })).items.length, 0, "ширина полосы — порог из вкладки «Пороги»");
});

test("пограничные: экономика помечена как закупочная; значение на самом пороге; бюджет против пика; достижимость", () => {
  const eco = { pending: false, cheapSegment: false, gate1: { margin0: 0.31, net0: 15.0 }, roi: 1.55, breakEvenCvr: 0.125, criterion2: { "2j": { status: "ok", value: 0.21 }, "2k": { status: "fail", value: 0.10 } } };
  const b = borderline(R0({ economics: eco, budget: { basis: "cash", budget: 10_000, need: 10_800 }, scorecard: { total: 61 },
    entry: { reach: { ok: true, requiredShare: 0.045 }, cohort: { ok: true, shareP75: 0.044 } } }), TH);
  const ids = b.items.map((i) => i.id); for (const id of ["g1-margin", "g1-profit", "roi", "g2-cvr", "2j", "budget", "score-go", "reach"]) assert.ok(ids.includes(id), id); assert.equal(ids.includes("2k"), false);
  assert.ok(b.items.filter((i) => i.economic).every((i) => ["g1-margin", "g1-profit", "roi", "g2-cvr", "2j", "budget"].includes(i.id)));
  assert.match(b.items.find((i) => i.id === "g1-profit").text, /прямо на пороге/); assert.match(b.items.find((i) => i.id === "budget").text, /«не хватает».*\$10.800/); assert.equal(b.items.find((i) => i.id === "budget").label, "Бюджет против пика вложений");
  assert.equal(b.items.find((i) => i.id === "g2-cvr").side, "fail"); assert.equal(b.items.find((i) => i.id === "reach").side, "fail");
  const cheap = borderline(R0({ economics: { ...eco, cheapSegment: true, gate1: { margin0: 0.41, net0: 6 } } }), TH); assert.equal(cheap.items.some((i) => i.id === "g1-profit"), false); assert.match(cheap.items.find((i) => i.id === "g1-margin").text, /порог 40 %/);
  const real = fixtureAnalysis().results.borderline; assert.ok(real.items.length >= 2); assert.ok(real.items.some((i) => i.id === "1b"));
});

const titles = (list) => ({ asins: list.map((t, i) => ({ asin: "B0TEST000" + i, title: t })) });
const ids = (r) => r.triggers.map((t) => t.id);

test("SC-006: регулируемые ниши дают нужный триггер", () => {
  const dis = regulatoryTriggers({ niche: "disinfectant spray", coreKeyword: "disinfectant spray for home" }); assert.ok(ids(dis).includes("epa-pesticide")); assert.ok(ids(dis).includes("epa-claim"));
  assert.equal(dis.triggers.find((t) => t.id === "epa-pesticide").kind, "product"); assert.equal(dis.triggers.find((t) => t.id === "epa-claim").kind, "claim"); assert.equal(dis.triggers[0].where.head, true);
  assert.ok(ids(regulatoryTriggers({ niche: "vitamin d3 supplement", coreKeyword: "vitamin d3" })).includes("fda-supplement"));
  const teether = regulatoryTriggers({ niche: "baby teether", coreKeyword: "silicone baby teether" }); assert.ok(ids(teether).includes("cpsc-children")); assert.match(teether.triggers.find((t) => t.id === "cpsc-children").meaning, /CPSIA/);
  assert.ok(ids(regulatoryTriggers({ coreKeyword: "bluetooth speaker" })).includes("fcc-radio")); assert.ok(ids(regulatoryTriggers({ coreKeyword: "power bank 20000mah" })).some((x) => x === "ul-electrical" || x === "dot-hazmat"));
  assert.ok(ids(regulatoryTriggers({ coreKeyword: "cutting board" })).includes("fda-foodcontact")); assert.ok(ids(regulatoryTriggers({ coreKeyword: "flower seeds for planting" })).includes("usda-plants"));
});

test("SC-006: нейтральная ниша — ложных срабатываний нет; одно случайное слово в одном заголовке тревогу не поднимает", () => {
  const neutral = regulatoryTriggers({ niche: "candle stick holder", coreKeyword: "candle stick holder", xray: titles(["Gold Candlestick Holders Set of 3 for Taper Candles", "Black Metal Candle Stick Holder for Table Centerpiece", "Glass Taper Candle Holders Wedding Decor", "Wooden Picture Frame 8x10 Rustic"]) });
  assert.deepEqual(ids(neutral), []); assert.equal(neutral.checked.titles, 4); assert.match(neutral.note, /не юридическая проверка/);
  const many = Array.from({ length: 30 }, (_, i) => `Steel Garden Hose Reel Wall Mount Model ${i}`);
  assert.deepEqual(ids(regulatoryTriggers({ coreKeyword: "garden hose reel", xray: titles([...many, "Garden Hose Reel for Kids Play Area"]) })), [], "1 заголовок из 31 — меньше 10 %");
  assert.deepEqual(ids(regulatoryTriggers({})), []); assert.equal(regulatoryTriggers({}).checked.titles, 0);
  const bike = fixtureAnalysis().results.regulatory; assert.ok(Array.isArray(bike.triggers)); assert.ok(bike.checked.titles > 50);
});

test("обещание в заголовках конкурентов — отдельный тип «claim» с долей заголовков и примерами", () => {
  const t = ["Yoga Mat Antibacterial Non Slip 6mm", "Thick Yoga Mat Antimicrobial Surface Kills 99% Germs", "Yoga Mat for Women Eco Friendly TPE", "Extra Wide Yoga Mat", "Travel Yoga Mat Foldable", "Cork Yoga Mat Natural"];
  const r = regulatoryTriggers({ niche: "yoga mat", coreKeyword: "yoga mat", xray: titles(t) }); const claim = r.triggers.find((x) => x.id === "epa-claim");
  assert.ok(claim); assert.equal(claim.kind, "claim"); assert.equal(claim.where.head, false); assert.equal(claim.where.titles, 2); assert.ok(Math.abs(claim.where.titleShare - 2 / 6) < 1e-9); assert.equal(claim.examples.length, 2);
  assert.ok(claim.words.some((w) => /antibacterial|antimicrobial/i.test(w))); assert.match(claim.meaning, /От обещания можно отказаться/); assert.equal(ids(r).includes("epa-pesticide"), false, "сам товар пестицидом не является");
});

test("таблица правил: у каждого правила ведомство, тип, смысл; идентификаторы уникальны; результат попадает в расчёт", () => {
  assert.ok(REG_RULES.length >= 18); assert.equal(new Set(REG_RULES.map((r) => r.id)).size, REG_RULES.length);
  for (const r of REG_RULES) { assert.ok(r.agency && r.title && r.meaning.length > 60, r.id); assert.ok(["product", "claim"].includes(r.kind)); assert.ok(r.re instanceof RegExp && !r.re.global); }
  const a = entryFixture(); assert.ok(a.results.regulatory.checked.titles > 0); assert.ok(a.results.regulatory.checked.terms > 0);
});
