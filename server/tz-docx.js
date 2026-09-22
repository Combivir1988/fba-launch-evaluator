// Этап 2 (spec 010, D9): ТЗ производителю → DOCX (пакет docx). Строится из присланного ТЗ — сервер ничего не читает из базы.
import { Document, Packer, Paragraph, Table, TableRow, TableCell, TextRun, HeadingLevel, WidthType, AlignmentType, ShadingType, BorderStyle } from "docx";
import { TZ_SECTIONS } from "./config-prompts.js";
import { slug, fileStamp } from "../shared/analysis.js";

const PRIO = { must: "обязательно", should: "желательно" };
const cell = (text, { bold = false, width, shade } = {}) => new TableCell({ width: width ? { size: width, type: WidthType.PERCENTAGE } : undefined, shading: shade ? { type: ShadingType.CLEAR, fill: shade, color: "auto" } : undefined,
  children: [new Paragraph({ children: [new TextRun({ text: String(text ?? ""), bold, size: 18 })] })] });
const border = { style: BorderStyle.SINGLE, size: 4, color: "BBBBBB" };

/** → Buffer .docx */
export async function buildTzDocx(tz, meta = {}) {
  const rows = Array.isArray(tz?.rows) ? tz.rows : [];
  const date = meta.date || fileStamp(); const children = [];
  children.push(new Paragraph({ heading: HeadingLevel.TITLE, children: [new TextRun(String(tz?.title || "Техническое задание производителю"))] }));
  children.push(new Paragraph({ children: [new TextRun({ text: `Ниша: ${meta.niche || "—"}${meta.coreKeyword ? ` · главный ключ: ${meta.coreKeyword}` : ""}`, size: 20 })] }));
  children.push(new Paragraph({ children: [new TextRun({ text: `Подготовлено: ${meta.preparedBy || "FBA Launch Evaluator"} · ${date} · листингов в анализе: ${meta.listingsAnalyzed ?? "—"}`, size: 18, color: "666666" })] }));
  if (tz?.summary) { children.push(new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun("Кратко")] })); children.push(new Paragraph({ children: [new TextRun(String(tz.summary))] })); }
  const order = [...TZ_SECTIONS, ...rows.map((r) => r.section).filter((s) => s && !TZ_SECTIONS.includes(s))];
  let n = 0;
  for (const sec of [...new Set(order)]) {
    const rs = rows.filter((r) => (r.section || "прочее") === sec); if (!rs.length) continue;
    children.push(new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun(sec[0].toUpperCase() + sec.slice(1))] }));
    children.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, borders: { top: border, bottom: border, left: border, right: border, insideHorizontal: border, insideVertical: border }, rows: [
      new TableRow({ tableHeader: true, children: [cell("№", { bold: true, width: 5, shade: "EEEEEE" }), cell("Параметр", { bold: true, width: 18, shade: "EEEEEE" }), cell("Требование", { bold: true, width: 35, shade: "EEEEEE" }), cell("Обоснование", { bold: true, width: 27, shade: "EEEEEE" }), cell("Приоритет", { bold: true, width: 15, shade: "EEEEEE" })] }),
      ...rs.map((r) => new TableRow({ children: [cell(++n, { width: 5 }), cell(r.param, { width: 18 }), cell(r.requirement, { width: 35 }), cell((r.rationale || "") + (r.source ? ` [${r.source}]` : "") + (r.unverified ? " (число не подтверждено расчётом — проверьте)" : ""), { width: 27 }), cell(PRIO[r.priority] || r.priority || "", { width: 15, bold: r.priority === "must" })] })),
    ] }));
    children.push(new Paragraph({ children: [new TextRun("")] }));
  }
  if (tz?.openQuestions?.length) { children.push(new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun("Открытые вопросы к производителю")] })); for (const q of tz.openQuestions) children.push(new Paragraph({ bullet: { level: 0 }, children: [new TextRun(String(q))] })); }
  children.push(new Paragraph({ alignment: AlignmentType.LEFT, children: [new TextRun({ text: "Числа в ТЗ — из расчётов приложения FBA Launch Evaluator (Xray, POE, извлечённые характеристики листингов ниши); строки с пометкой «число не подтверждено расчётом» проверьте вручную. Регуляторные и патентные пункты — подсказки, не юридическое заключение.", size: 16, color: "666666", italics: true })] }));
  const doc = new Document({ creator: "FBA Launch Evaluator", title: String(tz?.title || "ТЗ"), sections: [{ children }] });
  return Packer.toBuffer(doc);
}

export function tzFileName(meta = {}) { return `TZ-${slug(meta.niche || meta.coreKeyword || "niche")}-${meta.date || fileStamp()}.docx`; }
