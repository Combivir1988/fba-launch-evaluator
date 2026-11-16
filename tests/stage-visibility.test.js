// Сторож состава этапов. Принадлежность секции этапу объявлена ОДИН раз — множествами
// STAGE2/STAGE3 в render.js. Раньше тот же состав был записан вторым списком в app.css
// селекторами по id, и секция «Предлагаемая товарная линейка» (spec 025) попала в множество,
// но не в список: в этапе 1 она показывалась, в этапе 2 пряталась — ровно наоборот.
// Ни один тест этого не ловил: jsdom не применяет CSS, а порядок в DOM был правильный.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import { entryFixture } from "./helpers/entry-fixture.js";
import { withConfig } from "./helpers/config-fixture.js";
import { compute } from "../shared/compute.js";

const RENDER = readFileSync(new URL("../public/js/render.js", import.meta.url), "utf8");
const CSS = readFileSync(new URL("../public/css/app.css", import.meta.url), "utf8");

const setOf = (name) => {
  const head = `const ${name} = new Set([`;
  const i = RENDER.indexOf(head);
  assert.ok(i >= 0, `в render.js нет множества ${name}`);
  const j = RENDER.indexOf("]", i + head.length);
  return RENDER.slice(i + head.length, j).split(",").map((x) => x.trim().replace(/^["']|["']$/g, "")).filter(Boolean);
};

function draw(a) {
  const dom = new JSDOM(`<!doctype html><html><body><div id="d"></div></body></html>`, { pretendToBeVisual: true, runScripts: "outside-only" });
  const w = dom.window; w.matchMedia = () => ({ matches: false }); w.HTMLCanvasElement.prototype.getContext = () => ({});
  class Chart { constructor() {} destroy() {} } Chart.defaults = { color: "", borderColor: "", font: {}, plugins: { legend: { labels: {} } } }; w.Chart = Chart;
  w.eval(RENDER);
  const el = w.document.getElementById("d");
  w.FBARender.render(el, a, {});
  return el;
}

test("каждая секция помечена своим этапом, и метка взята из множеств render.js", () => {
  const s2 = setOf("STAGE2"), s3 = setOf("STAGE3");
  assert.ok(s2.includes("productLine"), "линейка обязана быть в STAGE2");
  const a = withConfig(entryFixture()); a.results = compute(a);
  const el = draw(a);
  const secs = [...el.querySelectorAll("section[data-section]")];
  assert.ok(secs.length > 10);
  for (const sec of secs) {
    const id = sec.dataset.section;
    const want = s3.includes(id) ? "3" : s2.includes(id) ? "2" : "1";
    assert.equal(sec.dataset.secStage, want, `секция ${id} помечена этапом ${sec.dataset.secStage}, а по множествам это этап ${want}`);
  }
});

test("состав этапов НЕ продублирован в app.css: правила видимости не перечисляют секции по id", () => {
  const rules = CSS.split("\n").filter((l) => /\.dash\[data-stage=/.test(l));
  assert.ok(rules.length >= 3, "правила видимости этапов пропали из app.css");
  for (const r of rules) {
    const ids = (r.match(/#sec-[a-zA-Z]+/g) || []).filter((x) => x !== "#sec-hero");
    assert.deepEqual(ids, [], `в app.css состав этапа снова записан по id (${ids.join(", ")}) — это второй источник правды, из-за него секция линейки показывалась не в том этапе`);
  }
});
