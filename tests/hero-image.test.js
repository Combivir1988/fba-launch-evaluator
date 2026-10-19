// Фото ниши: кого берём «лицом» и что показываем в шапке анализа.
import { test } from "node:test";
import assert from "node:assert/strict";
import { heroListing } from "../shared/hero-image.js";
import { fixtureAnalysis } from "./helpers/fixture-analysis.js";

const row = (o) => ({ asin: "B0" + String(o.n).padStart(8, "0"), brand: o.brand || "Br", title: "t" + o.n, imageUrl: o.img === false ? null : "https://m.media-amazon.com/images/I/" + o.n + ".jpg", displayOrder: o.order ?? null, asinRevenue: o.rev ?? null });
const xray = (rows) => ({ asins: rows });

test("лицо ниши — самый верхний листинг выдачи (Display Order), вариация не обгоняет родителя", () => {
  const h = heroListing({ xray: xray([row({ n: 1, order: "7.", rev: 90000 }), row({ n: 2, order: "3.1." }), row({ n: 3, order: "3." })]) });
  assert.equal(h.asin, "B000000003"); assert.equal(h.source, "xray");
  assert.equal(h.imageUrl, "https://m.media-amazon.com/images/I/3.jpg");
});

test("без Display Order берём самый выручечный; листинги без фото и исключённые бренды пропускаются", () => {
  const noOrder = heroListing({ xray: xray([row({ n: 1, rev: 1000 }), row({ n: 2, rev: 50000 }), row({ n: 3, rev: 7000 })]) });
  assert.equal(noOrder.asin, "B000000002");
  const skips = heroListing({ xray: xray([row({ n: 1, order: "1.", img: false }), row({ n: 2, order: "2.", brand: "Чужой" }), row({ n: 3, order: "3." })]), excludedBrands: ["чужой"] });
  assert.equal(skips.asin, "B000000003", "исключённый бренд не становится лицом ниши");
});

test("без Xray берём верх POE по кликам; если фото нет нигде — null, а не пустая картинка", () => {
  const poe = { asinMetrics: [{ asin: "B0POE00001", brand: "A", title: "a", imageUrl: "https://m.media-amazon.com/images/I/p1.jpg", clickShareT90: 0.02 },
    { asin: "B0POE00002", brand: "B", title: "b", imageUrl: "https://m.media-amazon.com/images/I/p2.jpg", clickShareT360: 0.09 }] };
  assert.equal(heroListing({ poe }).asin, "B0POE00002");
  assert.equal(heroListing({ poe }).source, "poe");
  assert.equal(heroListing({ xray: xray([row({ n: 1, order: "1.", img: false })]), poe: { asinMetrics: [] } }), null);
  assert.equal(heroListing({}), null);
});

test("на реальной выгрузке фото находится и попадает в результаты расчёта", () => {
  const a = fixtureAnalysis();
  const h = a.results.hero;
  assert.ok(h && /^https:\/\//.test(h.imageUrl), "фото ниши: " + JSON.stringify(h));
  assert.match(h.asin, /^B0[A-Z0-9]{8}$/);
  assert.ok(a.aggregates.xray.asins.some((x) => x.asin === h.asin), "лицо ниши — листинг из этой же выгрузки");
});
