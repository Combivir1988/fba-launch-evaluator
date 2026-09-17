import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Papa from "papaparse";

const here = dirname(fileURLToPath(import.meta.url));
export const FIX = join(here, "fixtures");

export function readCsv(name, { skipFirstLine = false } = {}) {
  let text = readFileSync(join(FIX, name), "utf8");
  if (skipFirstLine) text = text.slice(text.indexOf("\n") + 1);
  const res = Papa.parse(text, { header: true, skipEmptyLines: true });
  return res.data;
}
export const readJson = (name) => JSON.parse(readFileSync(join(FIX, name), "utf8"));

export const XRAY = "Helium_10_Xray_2026-08-21.csv";
export const CEREBRO = "US_AMAZON_cerebro__2026-08-21.csv";
export const POE = "POE_urinal_screen_deodorizer_2026-09-15.json";
