// Синтетические ниши для spec 019: концентрация и летаргия на крайних случаях.
// Листинги собираются вручную, потому что нужны ровные доли — на реальном экспорте
// контрольное число пришлось бы подгонять под данные вместо того, чтобы проверять формулу.

let seq = 0;
const asin = () => "B0" + String(++seq).padStart(8, "0").replace(/0/g, "X").slice(0, 8);

/** Один листинг в форме, которую отдаёт parseXray (лишние поля расчёту не нужны). */
export function listing({ brand, revenue, reviews = 0, price = 25, sales = null, rating = 4.5 }) {
  const a = asin();
  return { asin: a, parentAsin: a, isVariation: false, displayOrder: null, title: brand + " " + a,
    brand, price, asinSales: sales ?? Math.round(revenue / price), parentSales: null, recentPurchases: null,
    asinRevenue: revenue, parentRevenue: null, bsr: null, fees: null, activeSellers: 1,
    rating, reviews, reviewVelocity: null, category: "Test", seller: "Third party", fulfillment: "FBA",
    creationDate: null, url: null };
}

/** Ниша из перечня «бренд → [выручка, отзывы]»; по одному листингу на бренд, если не сказано иначе. */
export function niche(spec) {
  const asins = [];
  for (const [brand, rows] of Object.entries(spec)) {
    for (const [revenue, reviews] of rows) asins.push(listing({ brand, revenue, reviews }));
  }
  return { asins, flags: { rowsTotal: asins.length, hasAsinSales: true, duplicatesDropped: 0, amazonSells: false }, columns: {} };
}

// ---------- крайние случаи ----------

/** Один бренд держит всё: концентрация обязана упереться в потолок шкалы. */
export const singleBrandNiche = () => niche({ OnlyOne: [[100_000, 500]] });

/** Четыре равных бренда: концентрация = 4 × 25² = 2500, ровно на пороге «концентрирован». */
export const fourEqualNiche = () => niche({ A: [[25_000, 100]], B: [[25_000, 100]], C: [[25_000, 100]], D: [[25_000, 100]] });

/** Ни одного отзыва во всей нише: доли отзывов не существует, индекс не считается ни у кого. */
export const noReviewsNiche = () => niche({ A: [[60_000, 0]], B: [[30_000, 0]], C: [[10_000, 0]] });

/** Меньше пяти листингов: доля топ-5 листингов равна единице, и рядом обязан стоять размер выборки. */
export const threeListingsNiche = () => niche({ A: [[50_000, 100]], B: [[30_000, 80]], C: [[20_000, 60]] });

/** Бренд с отзывами и почти без выручки — мёртвый листинг. Ярлыка гиганта получать не должен. */
export const deadListingNiche = () => niche({
  Alive: [[70_000, 50]],
  Fading: [[29_000, 100]],
  Dead: [[1_000, 850]], // доля выручки 1 %, доля отзывов больше 80 %
});

/** Сбалансированный бренд: доля отзывов в точности равна доле выручки — индекс обязан быть ровно 1,00. */
export function balancedNiche(share) {
  const total = 100_000, totalReviews = 10_000;
  const rest = 1 - share;
  return niche({
    Balanced: [[total * share, totalReviews * share]],
    Rest: [[total * rest, totalReviews * rest]],
  });
}
