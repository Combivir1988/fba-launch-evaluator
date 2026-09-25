// Патентный ландшафт → DOCX: подробная версия того, что в дашборде показано кратко (spec 001, 2026-09-25).
// Строится из присланного скана: сервер ничего не читает из базы и ничего не пересчитывает.
import { Document, Packer, Paragraph, Table, TableRow, TableCell, TextRun, HeadingLevel, WidthType, ShadingType, BorderStyle } from "docx";
import { slug, fileStamp } from "../shared/analysis.js";

const RISK = { high: "высокий", med: "средний", low: "низкий", none: "нет" };
const DENSITY = { high: "высокая — минное поле", med: "средняя", low: "низкая — почти свободно" };
const STATUS = { conflict: "есть красные флаги", unsure: "требует проверки", clear: "явных пересечений нет" };
const border = { style: BorderStyle.SINGLE, size: 4, color: "BBBBBB" };
const cell = (text, { bold = false, width, shade } = {}) => new TableCell({
  width: width ? { size: width, type: WidthType.PERCENTAGE } : undefined,
  shading: shade ? { type: ShadingType.CLEAR, fill: shade, color: "auto" } : undefined,
  margins: { top: 60, bottom: 60, left: 90, right: 90 },
  children: [new Paragraph({ children: [new TextRun({ text: String(text ?? ""), bold, size: 18 })] })],
});
const table = (head, rows, widths) => new Table({
  width: { size: 100, type: WidthType.PERCENTAGE },
  borders: { top: border, bottom: border, left: border, right: border, insideHorizontal: border, insideVertical: border },
  rows: [new TableRow({ tableHeader: true, children: head.map((h, i) => cell(h, { bold: true, width: widths[i], shade: "EFEFEC" })) }),
    ...rows.map((r) => new TableRow({ children: r.map((c, i) => cell(c, { width: widths[i] })) }))],
});
const h1 = (t) => new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun(t)] });
const p = (t, size = 20) => new Paragraph({ children: [new TextRun({ text: String(t ?? ""), size })] });
const pct = (v) => (typeof v === "number" && Number.isFinite(v) ? Math.round(Math.min(1, v > 1 ? v / 100 : v) * 100) + " %" : "—");

/** → Buffer .docx с полным патентным ландшафтом. */
export async function buildPatentsDocx(scan, meta = {}) {
  const items = Array.isArray(scan?.items) ? scan.items : [];
  const date = meta.date || fileStamp();
  const children = [];
  children.push(new Paragraph({ heading: HeadingLevel.TITLE, children: [new TextRun(`Патентный ландшафт: ${meta.niche || meta.coreKeyword || "ниша"}`)] }));
  children.push(p(`Проверялась фича: ${scan?.feature || "тип товара"}${meta.coreKeyword ? ` · главный ключ: ${meta.coreKeyword}` : ""}`));
  children.push(p(`Подготовлено: ${meta.preparedBy || "FBA Launch Evaluator"} · ${date} · модель ${scan?.model || "—"} · источник: ${scan?.source || "Google Patents"}`, 18));
  children.push(p(`Итог скрининга: ${STATUS[scan?.status] || scan?.status || "—"}. ${scan?.summary || ""}`));

  if (scan?.holders?.length) {
    children.push(h1("Кто владеет патентами"));
    children.push(table(["Патентообладатель", "На чём специализируется", "Патенты"],
      scan.holders.map((x) => [x.name, x.focus, (x.patents || []).join(", ") || "—"]), [22, 56, 22]));
  }

  if (scan?.hotAreas?.length) {
    children.push(h1("Плотность патентов по узлам"));
    children.push(table(["Узел / функция", "Плотность", "Комментарий"],
      scan.hotAreas.map((x) => [x.area, DENSITY[x.density] || x.density, x.note]), [28, 22, 50]));
  }

  children.push(h1("Найденные патенты и обход"));
  if (!items.length) children.push(p("Патентов с пересечением не найдено."));
  else children.push(table(["Патент", "Риск", "Релев.", "Что защищает независимый claim", "Пересечение с нашим ТЗ", "Как обойти", "Приоритет"],
    items.map((x) => [`${x.number}${x.expired ? " (истёк)" : x.pending ? " (заявка)" : ""}${x.assignee ? `\n${x.assignee}` : ""}`,
      RISK[x.risk] || x.risk || "—", pct(x.relevance), x.claimed || "—", x.overlap || "—", x.designAround || "—",
      x.priorityDate || "—"]), [14, 8, 7, 24, 20, 20, 7]));

  if (scan?.whiteSpaces?.length) {
    children.push(h1("Белые пятна — где свободно"));
    children.push(table(["Свободная ниша", "Почему свободно", "Как использовать"],
      scan.whiteSpaces.map((x) => [x.area, x.why, x.howToUse]), [24, 38, 38]));
  }

  if (scan?.designHits?.length) {
    children.push(h1("Промышленные образцы (внешний вид)"));
    children.push(p(scan.designPatentNote || "Проверьте внешний вид по картинкам патентов ниже."));
    children.push(table(["Номер", "Название", "Владелец"], scan.designHits.map((d) => [d.number, d.title || "—", d.assignee || "—"]), [20, 50, 30]));
  }

  if (scan?.nextSteps?.length) {
    children.push(h1("Что сделать дальше"));
    for (const s of scan.nextSteps) children.push(new Paragraph({ bullet: { level: 0 }, children: [new TextRun({ text: String(s), size: 20 })] }));
  }

  if (scan?.queries?.length) {
    children.push(h1("Поисковые запросы (проверить вручную)"));
    children.push(table(["Запрос", "Зачем"], scan.queries.map((q) => [q.q, q.purpose || "—"]), [45, 55]));
  }

  children.push(h1("Оговорка"));
  children.push(p(scan?.disclaimer || "Предварительный AI-скрининг по независимым claims. Не является юридическим заключением (FTO opinion)."));

  const doc = new Document({ styles: { default: { document: { run: { font: "Calibri", size: 20 } } } }, sections: [{ children }] });
  return Packer.toBuffer(doc);
}

export const patentsFileName = (meta = {}) => `Patents-${slug(meta.niche || meta.coreKeyword || "niche")}-${meta.date || fileStamp()}.docx`;
