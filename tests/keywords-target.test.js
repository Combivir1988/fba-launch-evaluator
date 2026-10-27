// spec 017, этап 3: целевые ключи из Cerebro × POE × SQP.
import { test } from "node:test";
import assert from "node:assert/strict";
import { targetKeywords, normPhrase } from "../shared/keywords-target.js";
import { mergeThresholds } from "../shared/thresholds.js";

const TH = mergeThresholds();
const cerebro = (ks) => ({ keywords: ks });
const kw = (phrase, sv, over = {}) => ({ phrase, sv, isBranded: false, isAsin: false, relevance: 1, ...over });

test("объединение по фразе: регистр и лишние пробелы — это один и тот же ключ", () => {
  const r = targetKeywords({
    cerebro: cerebro([kw("Dog  Bowl", 5000)]),
    poe: { searchTermMetrics: [{ term: "dog bowl", svT360: 120000, clickShareT360: 0.2, convT360: 0.1 }] },
    sqp: { rows: [{ query: "DOG BOWL", volume: 4800, impressions: 1000, clicks: 100, purchases: 7 }] },
    th: TH,
  });
  assert.equal(r.items.length, 1);
  const it = r.items[0];
  assert.equal(it.phrase, "dog bowl");
  assert.equal(it.sv, 5000, "объём берём из Cerebro, он точнее");
  assert.equal(it.svSource, "cerebro");
  assert.equal(it.clickShare, 0.2);
  assert.equal(it.buys, true, "в SQP есть покупки");
  assert.equal(normPhrase(" Dog   BOWL "), "dog bowl");
});

test("ключи с покупками идут впереди более объёмных, но пустых", () => {
  const r = targetKeywords({
    cerebro: cerebro([kw("big traffic", 90000), kw("small buyer", 1000)]),
    sqp: { rows: [{ query: "small buyer", volume: 1000, impressions: 500, clicks: 80, purchases: 12 },
                  { query: "big traffic", volume: 90000, impressions: 9000, clicks: 400, purchases: 0 }] },
    th: TH,
  });
  assert.deepEqual(r.items.map((i) => i.phrase), ["small buyer", "big traffic"]);
  assert.equal(r.items[0].buys, true);
  assert.equal(r.items[1].trafficOnly, true, "клики есть, покупок нет — это только трафик");
});

test("без Cerebro вес берётся из POE: год делим на 12, и об этом сказано", () => {
  const r = targetKeywords({ poe: { searchTermMetrics: [{ term: "cat tree", svT360: 240000, clickShareT360: 0.3 }] }, th: TH });
  assert.equal(r.items[0].sv, 20000);
  assert.equal(r.items[0].svSource, "poe");
  assert.equal(r.hasVolume, false);
  assert.match(r.note, /объёмов поиска нет/);
});

test("чужие бренды и ASIN-фразы в свой листинг не берём", () => {
  const r = targetKeywords({
    cerebro: cerebro([kw("kilmat sound mat", 8000, { isBranded: true }), kw("b0751cbxbt", 500, { isAsin: true }), kw("sound deadening mat", 7000)]),
    brands: ["Noico"],
    sqp: { rows: [{ query: "noico mat", volume: 3000, impressions: 10, clicks: 1, purchases: 1 }] },
    th: TH,
  });
  assert.deepEqual(r.items.map((i) => i.phrase), ["sound deadening mat"]);
  assert.equal(r.dropped.branded, 2, "и помеченный Cerebro, и найденный по списку брендов");
  assert.equal(r.dropped.asin, 1);
});

test("берём не больше topKeywords и считаем общий вес; без источников — честная причина", () => {
  const many = Array.from({ length: 80 }, (_, i) => kw("key " + i, 1000 - i));
  const r = targetKeywords({ cerebro: cerebro(many), th: mergeThresholds({ stage3: { topKeywords: 10 } }) });
  assert.equal(r.items.length, 10);
  assert.equal(r.total, 80);
  assert.equal(r.items[0].phrase, "key 0", "самый объёмный первым");
  assert.equal(r.weightTotal, r.items.reduce((s, i) => s + i.weight, 0));
  const empty = targetKeywords({ th: TH });
  assert.equal(empty.items.length, 0);
  assert.match(empty.note, /нет ни одного источника ключей/);
});
