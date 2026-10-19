// Картинка ниши: по названию «dog calming diffuser» не видно, что это за товар, поэтому берём фото листинга (2026-10-19).
// Кого считаем «лицом ниши»: самый релевантный листинг выгрузки Xray — тот, что стоял выше всех в выдаче Amazon
// (колонка Display Order; «3.1.» — вариация листинга «3.»). Без Display Order — самый выручечный; без Xray — верх POE по кликам.
const up = (s) => String(s || "").toUpperCase();
const isNum = (v) => typeof v === "number" && Number.isFinite(v);
/** «3.» → 3, «3.1.» → 3.1; без номера — в конец. */
const orderOf = (a) => { const m = /^(\d+)(?:\.(\d+))?/.exec(String(a?.displayOrder || "").trim()); return m ? Number(m[1]) + (m[2] ? Number(m[2]) / 1000 : 0) : Infinity; };

/**
 * @param {object} o { xray, poe, excludedBrands }
 * @returns {{asin, imageUrl, title, brand, source}|null}
 */
export function heroListing({ xray, poe, excludedBrands = [] } = {}) {
  const ex = new Set((excludedBrands || []).map((b) => String(b).toLowerCase()));
  const ok = (a) => a?.imageUrl && !ex.has(String(a.brand || "").toLowerCase());
  const pick = (a, source) => ({ asin: up(a.asin), imageUrl: a.imageUrl, title: String(a.title || "").slice(0, 200), brand: a.brand || "", source });

  const xs = (xray?.asins || []).filter(ok);
  if (xs.length) {
    const ranked = [...xs].sort((a, b) => orderOf(a) - orderOf(b));
    if (orderOf(ranked[0]) !== Infinity) return pick(ranked[0], "xray");
    const byRevenue = [...xs].sort((a, b) => (isNum(b.asinRevenue) ? b.asinRevenue : -1) - (isNum(a.asinRevenue) ? a.asinRevenue : -1));
    return pick(byRevenue[0], "xray");
  }
  const ps = (poe?.asinMetrics || []).filter(ok);
  if (ps.length) {
    const share = (p) => (isNum(p.clickShareT90) ? p.clickShareT90 : isNum(p.clickShareT360) ? p.clickShareT360 : -1);
    return pick([...ps].sort((a, b) => share(b) - share(a))[0], "poe");
  }
  return null;
}
