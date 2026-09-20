// Снимает контрольные отпечатки расчёта (tests/helpers/results-hash.js) — запускать ДО намеренной смены методики, значения вписывать в тесты.
import { fixtureAnalysis } from "../tests/helpers/fixture-analysis.js";
import { resultsHash } from "../tests/helpers/results-hash.js";
import { compute } from "../shared/compute.js";
import { newAnalysis } from "../shared/analysis.js";
import { parsePoe } from "../shared/parse-poe.js";
import { readJson, POE } from "../tests/helpers.js";

const poeOnly = newAnalysis({ niche: "u", coreKeyword: "urinal screen deodorizer" });
poeOnly.aggregates = { poe: parsePoe(readJson(POE)) }; Object.assign(poeOnly.inputs, { price: 24.99, cogs: 4.37 });
console.log(JSON.stringify({ full: resultsHash(fixtureAnalysis().results), poeOnly: resultsHash(compute(poeOnly)), empty: resultsHash(compute(newAnalysis({ niche: "e" }))) }));
