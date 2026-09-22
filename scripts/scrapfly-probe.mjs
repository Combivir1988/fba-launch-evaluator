// Проба Scrapfly для этапа 2 (spec 010): загрузить страницы Amazon по ASIN и показать, что вернула модель извлечения «product».
// Ключ — только из переменной окружения SCRAPFLY_API_KEY (в репозиторий и вывод не попадает). Запуск: node scripts/scrapfly-probe.mjs B0XXXXXXXX [B0YYYYYYYY …]
import { writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const KEY = process.env.SCRAPFLY_API_KEY;
if (!KEY) { console.error("нет SCRAPFLY_API_KEY в окружении"); process.exit(1); }
const asins = [...new Set(process.argv.slice(2).filter((a) => /^B0[A-Z0-9]{8}$/.test(a)))];
if (!asins.length) { console.error("укажите ASIN"); process.exit(1); }
const out = join(tmpdir(), "scrapfly-probe"); mkdirSync(out, { recursive: true });
for (const asin of asins) {
  const url = `https://api.scrapfly.io/scrape?key=${encodeURIComponent(KEY)}&url=${encodeURIComponent("https://www.amazon.com/dp/" + asin)}&asp=true&country=us&render_js=false&extraction_model=product`;
  const t0 = Date.now(); const r = await fetch(url); const j = await r.json().catch(() => ({}));
  const d = j.result?.extracted_data?.data || {}; const cost = j.context?.cost?.total ?? j.result?.cost?.total;
  writeFileSync(join(out, asin + ".json"), JSON.stringify(j));
  console.log(`${asin}: HTTP ${r.status} · ${Date.now() - t0} ms · кредитов ${cost ?? "?"} · «${(d.name || "").slice(0, 80)}» · характеристик ${(d.specifications || []).length} · изображений ${(d.images || []).length} · вариантов ${(d.variants || []).length} · цена ${d.offers?.[0]?.price ?? "—"}`);
}
console.log("ответы сохранены в", out);
