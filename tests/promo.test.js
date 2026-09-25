// spec 014: разбор промо из HTML страницы (только блоки цены и акций), цена с учётом купона, промо по нише, чеклист «Купоны/дилы» авто.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parsePromo, effectivePrice } from "../server/promo-parse.js";
import { normalizeProduct, mockListing } from "../server/scrapfly.js";
import { promoStats } from "../shared/promo-stats.js";
import { entryFixture } from "./helpers/entry-fixture.js";
import { withConfig } from "./helpers/config-fixture.js";
import { compute } from "../shared/compute.js";

const FX = readFileSync(new URL("./fixtures/amazon-promo-B00UOXMCBI.html", import.meta.url), "utf8");
const wrap = (inner) => `<html><body><nav>Prime Big Deal Days is October 6-7 <a>Subscribe & Save</a> Save 40% with coupon on other items</nav>${inner}<div id="footer_feature_div">List Price: $999.99</div></body></html>`.padEnd(600, " ");

test("реальная страница: List Price $125.99, −15 %, цена $106.99; купона/дила нет", () => {
  const p = parsePromo(FX); assert.equal(p.listPrice, 125.99); assert.equal(p.discountPct, 15); assert.equal(p.price, 106.99); assert.equal(p.coupon, null); assert.equal(p.deal, null); assert.equal(p.hasPromo, true);
});

test("купон, дил, Subscribe & Save и акции — только из своих блоков; навигация не считается промо", () => {
  const html = wrap(`<div id="apex_desktop">$24.99 with 17 percent savings <span class="savingsPercentage">-17%</span> $24.99 List Price: $29.99</div>
    <div id="promoPriceBlockMessage_feature_div"><span>Save 10% with coupon</span> <span>Buy 2, save 5%</span></div><div id="x_feature_div"></div>
    <div id="dealBadge_feature_div"><span>Limited time deal</span></div><div id="y_feature_div"></div>
    <div id="snsAccordionRowMiddle">Subscribe & Save: Save 5% now and up to 15% on repeat deliveries</div><div id="z_feature_div"></div>`);
  const p = parsePromo(html);
  assert.deepEqual(p, { v: 2, price: 24.99, listPrice: 29.99, discountPct: 17, coupon: { text: "Save 10% with coupon", value: 10, unit: "%" }, deal: "Limited time deal", sns: { min: 5, max: 15 }, promotions: ["Buy 2, save 5%"], hasPromo: true });
  const dollar = parsePromo(wrap(`<div id="apex_desktop">$40.00</div><div id="promoPriceBlockMessage_feature_div">Apply $5 coupon</div><div id="q_feature_div"></div>`)); assert.deepEqual(dollar.coupon, { text: "Apply $5 coupon", value: 5, unit: "$" }); assert.equal(dollar.listPrice, null);
  const none = parsePromo(wrap(`<div id="apex_desktop">$40.00</div><div id="promoPriceBlockMessage_feature_div"></div><div id="dealBadge_feature_div"></div><div id="q_feature_div"></div>`)); assert.equal(none.hasPromo, false); assert.equal(none.coupon, null); assert.equal(none.deal, null); assert.equal(none.listPrice, null, "List Price из футера не подхватывается");
  assert.equal(parsePromo(""), null); assert.equal(parsePromo(null), null);
});

test("effectivePrice: цена минус купон (% или $)", () => {
  assert.equal(effectivePrice(40, { coupon: { value: 10, unit: "%" } }), 36); assert.equal(effectivePrice(40, { coupon: { value: 5, unit: "$" } }), 35); assert.equal(effectivePrice(40, null), 40); assert.equal(effectivePrice(null, {}), null);
});

test("normalizeProduct получает html → promo; без html — null (старый кэш: «неизвестно», не «нет промо»)", () => {
  const l = normalizeProduct("B00UOXMCBI", { name: "x", description: "", specifications: [] }, { cost: 30, html: FX }); assert.equal(l.promo.listPrice, 125.99);
  assert.equal(normalizeProduct("B00UOXMCBI", { name: "x" }, { cost: 30 }).promo, null);
  const m = mockListing("B0000000C0", "t"); assert.ok("promo" in m && typeof m.promo.hasPromo === "boolean");
});

test("promoStats: доли по выручке, средняя скидка, насыщенность как в чеклисте; неизвестные промо не считаются «нет промо»", () => {
  const asins = ["A1", "A2", "A3", "A4", "A5"]; const xray = asins.map((a, i) => ({ asin: a, asinRevenue: [50000, 30000, 10000, 5000, 5000][i], price: 20 }));
  const P = (o) => ({ price: 20, listPrice: null, discountPct: null, coupon: null, deal: null, sns: null, promotions: [], hasPromo: false, ...o });
  const listings = { A1: { fetchedAt: "2026-09-23T10:00:00Z", promo: P({ coupon: { value: 10, unit: "%" }, hasPromo: true }) }, A2: { fetchedAt: "2026-09-22T10:00:00Z", promo: P({ deal: "Limited time deal", discountPct: 20, listPrice: 25, hasPromo: true }) }, A3: { fetchedAt: "2026-09-22T10:00:00Z", promo: P({}) }, A4: { fetchedAt: "2026-09-22T10:00:00Z" } /* без promo — неизвестно */, A5: { error: { code: "asp" } } };
  const s = promoStats(listings, xray, asins);
  assert.equal(s.n, 4); assert.equal(s.known, 3); assert.equal(s.coupon.count, 1); assert.ok(Math.abs(s.coupon.revShare - 50000 / 90000) < 1e-9); assert.equal(s.coupon.avgValuePct, 10);
  assert.equal(s.deal.count, 1); assert.equal(s.discount.avgPct, 20); assert.ok(Math.abs(s.hotRevShare - 80000 / 90000) < 1e-9); assert.equal(s.saturation, "high"); assert.equal(s.snapshotAt, "2026-09-23T10:00:00Z");
  assert.ok(Math.abs(s.activeRevShare - 80000 / 90000) < 1e-9, "активные скидки: купон + дил");
  // Ниша без купонов и дилов, но с акциями «купи N» и ценой ниже List Price: насыщенность считается по ним, а не «мало» (basswood sheets, 2026-09-24)
  const soft = { A1: { fetchedAt: "2026-09-24T10:00:00Z", promo: P({ promotions: ["Save 5% on 4 select item(s)"], hasPromo: true }) }, A2: { fetchedAt: "2026-09-24T10:00:00Z", promo: P({ listPrice: 25, discountPct: 20, hasPromo: true }) }, A3: { fetchedAt: "2026-09-24T10:00:00Z", promo: P({ sns: { min: 5, max: 5 }, hasPromo: true }) } };
  const s2 = promoStats(soft, xray, ["A1", "A2", "A3"]);
  assert.equal(s2.hotRevShare, 0, "купонов и дилов нет"); assert.equal(s2.promotions.count, 1); assert.ok(Math.abs(s2.activeRevShare - 80000 / 90000) < 1e-9, "акция и скидка от List Price считаются");
  assert.equal(s2.saturation, "high", "по активным скидкам, а не по одним купонам");
  const snsOnly = promoStats({ A1: { fetchedAt: "2026-09-24T10:00:00Z", promo: P({ sns: { min: 5, max: 5 }, hasPromo: true }) } }, xray, ["A1"]);
  assert.equal(snsOnly.activeRevShare, 0, "Subscribe & Save — подписка, в насыщенность не идёт"); assert.equal(snsOnly.saturation, "low");
  assert.equal(promoStats({}, xray, asins), null); assert.equal(promoStats({ A1: { fetchedAt: "x" } }, xray, ["A1"]).known, 0);
});

test("compute: промо по нише в results.config.promo; чеклист «Купоны/дилы» берёт авто-значение, ручное — главнее", () => {
  const a = withConfig(entryFixture(), { tz: false }); const P = a.results.config.promo; assert.ok(P && P.known > 0, "MOCK-листинги несут промо"); assert.ok(["high", "mid", "low"].includes(P.saturation));
  assert.equal(a.inputs.checklist.couponsDealsSaturation, "unknown", "входы не меняются"); assert.equal(P.appliedToChecklist, true);
  if (P.saturation === "high") assert.ok(Object.values(a.results.scorecard.axes).some((ax) => /купонов/.test(ax.note || "")), "scorecard увидел авто-значение чеклиста");
  a.inputs.checklist.couponsDealsSaturation = "low"; a.results = compute(a); assert.equal(a.results.config.promo.appliedToChecklist, undefined);
  const plain = entryFixture(); assert.equal(plain.results.config, null); assert.equal(plain.results.priceConfig, null);
});

test("Subscribe & Save: берётся не первый (пустой) блок, а тот, где есть подписка; процент — хоть из текста доставки", () => {
  const empty = '<div id="snsAccordionRowMiddle" style="display:none;">Loading recommendations for you</div><div id="a_feature_div"></div>';
  const real = '<div id="snsAccordionRowMiddle">Subscribe &amp; Save</div><div id="b_feature_div"></div>';
  const delivery = 'Get it with your next Subscribe &amp; Save delivery, Oct 5, with 10% savings';
  const p = parsePromo(wrap(`<div id="apex_desktop">$38.90</div>${empty}${real}<div>${delivery}</div>`));
  assert.deepEqual(p.sns, { min: 10, max: 10 }, "пустая заготовка не мешает, процент найден в доставке");
  assert.equal(p.hasPromo, true);
  const navOnly = parsePromo(wrap('<div id="apex_desktop">$38.90</div><div id="nav-xshop">Subscribe &amp; Save</div><div id="c_feature_div"></div>'));
  assert.equal(navOnly.sns, null, "меню магазина подпиской не считается");
  const noPct = parsePromo(wrap('<div id="apex_desktop">$38.90</div><div id="snsAccordionRowMiddle">Subscribe &amp; Save</div><div id="d_feature_div"></div>'));
  assert.deepEqual(noPct.sns, { min: null, max: null }, "подписка есть, процент неизвестен");
});
