// Копирует UMD-сборки в public/vendor (без сборочного шага; файлы коммитятся,
// чтобы автономный HTML-экспорт и офлайн-работа не зависели от CDN).
import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "public", "vendor");
mkdirSync(out, { recursive: true });
const files = [
  ["node_modules/chart.js/dist/chart.umd.js", "chart.umd.js"],
  ["node_modules/papaparse/papaparse.min.js", "papaparse.min.js"],
];
for (const [src, dst] of files) {
  copyFileSync(join(root, src), join(out, dst));
  console.log("vendored", dst);
}
