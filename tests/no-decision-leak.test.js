// ВОРОТА 2 — SC-006 (spec 019). Летаргия описывает конкурента, но ничего не решает.
//
// Почему проверка устроена так, а не «удалить поля и сравнить»: расчёт — чистый конвейер, выкинуть поле
// из середины нельзя, не переписав его. Зато если хоть одно решающее правило читает летаргию, то сдвиг
// её порогов ОБЯЗАН что-то сдвинуть. Тест, который невозможно провалить, ничего не доказывает.
import { test } from "node:test";
import assert from "node:assert/strict";
import { compute } from "../shared/compute.js";
import { fixtureAnalysis } from "./helpers/fixture-analysis.js";
import { niche, deadListingNiche } from "./helpers/fixture-brands.js";
import { newAnalysis } from "../shared/analysis.js";

/** Пороги, при которых ярлык получает КАЖДЫЙ бренд: денег не требуем, любой индекс считаем гигантским. */
const ABSURD = { smooth: 3, moneyMin: 0, giantMin: 0, tiredMin: 0, efficientMax: 99 };
/** И зеркально — пороги, при которых не получает никто. */
const UNREACHABLE = { smooth: 0.0001, moneyMin: 1.1, giantMin: 1e9, tiredMin: 1e9, efficientMax: -1 };

/** Всё, кроме самой летаргии. Сравниваем целиком, а не выбранные поля: так не забудешь то, о чём не подумал. */
function withoutLethargy(results) {
  const r = JSON.parse(JSON.stringify(results));
  delete r.computedAt;
  if (r.competition) {
    delete r.competition.lethargyRevenueShare;
    for (const b of r.competition.brands || []) { delete b.reviewsShare; delete b.lethargy; delete b.lethargyLabel; }
  }
  return r;
}

const withLethargy = (a, lethargy) => {
  const copy = JSON.parse(JSON.stringify(a));
  copy.thresholds = { ...(copy.thresholds || {}), lethargy };
  return compute(copy);
};

function assertNoLeak(a, what) {
  const base = compute(JSON.parse(JSON.stringify(a)));
  const all = withLethargy(a, ABSURD);
  const none = withLethargy(a, UNREACHABLE);

  // сначала убедимся, что пороги действительно сдвинулись — иначе тест ничего не проверяет
  const labels = (R) => (R.competition.brands || []).map((b) => b.lethargyLabel).filter(Boolean);
  if (labels(base).length) {
    assert.ok(labels(all).every((l) => l === "giant"), `${what}: при абсурдных порогах все бренды обязаны стать гигантами`);
    assert.ok(labels(none).every((l) => l === "normal"), `${what}: при недостижимых порогах гигантов быть не должно`);
    assert.notDeepEqual(labels(all), labels(none), `${what}: ярлыки не сдвинулись — проверять нечего`);
  }

  assert.deepEqual(withoutLethargy(all), withoutLethargy(base), `${what}: сдвиг порогов летаргии изменил решение`);
  assert.deepEqual(withoutLethargy(none), withoutLethargy(base), `${what}: сдвиг порогов летаргии изменил решение`);
}

test("ВОРОТА 2 · SC-006: на полном анализе ничего не меняется", () => {
  assertNoLeak(fixtureAnalysis(), "полный анализ (Xray + Cerebro + POE)");
});

test("ВОРОТА 2 · SC-006: и при активном ценовом диапазоне тоже", () => {
  assertNoLeak(fixtureAnalysis({ inputs: { priceMin: 20, priceMax: 60 } }), "ценовой диапазон");
});

test("ВОРОТА 2 · SC-006: и в нише, где летаргия выражена резко", () => {
  const a = newAnalysis({ niche: "мёртвый листинг", coreKeyword: "dead" });
  a.aggregates = { xray: deadListingNiche() };
  Object.assign(a.inputs, { price: 25, cogs: 5 });
  assertNoLeak(a, "ниша с мёртвым листингом");
});

test("ВОРОТА 2 · SC-006: и в ровно сбалансированной нише", () => {
  const a = newAnalysis({ niche: "баланс", coreKeyword: "balanced" });
  a.aggregates = { xray: niche({ A: [[50_000, 500]], B: [[30_000, 300]], C: [[20_000, 200]] }) };
  Object.assign(a.inputs, { price: 25, cogs: 5 });
  assertNoLeak(a, "сбалансированная ниша");
});

test("летаргия не упомянута ни в одном правиле вердикта", async () => {
  // Второй, независимый от поведения способ: правила вердикта просто не знают такого слова.
  const { readFileSync } = await import("node:fs");
  const { fileURLToPath } = await import("node:url");
  const src = readFileSync(fileURLToPath(new URL("../shared/verdict-rules.js", import.meta.url)), "utf8");
  for (const word of ["lethargy", "lethargyLabel", "lethargyRevenueShare", "reviewsShare"]) {
    assert.ok(!src.includes(word), `правила вердикта упоминают «${word}» — показатель перестал быть описательным`);
  }
});
