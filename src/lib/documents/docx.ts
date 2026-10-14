import {
  AlignmentType,
  BorderStyle,
  Document,
  ExternalHyperlink,
  HeadingLevel,
  LevelFormat,
  Packer,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from "docx";
import { parseInline, type Run } from "./markdown";
import type { DocumentModel } from "./model";

const MONO = "Courier New";

function runsFor(text: string, base: { bold?: boolean; italics?: boolean; size?: number } = {}): (TextRun | ExternalHyperlink)[] {
  return parseInline(text).map((run: Run) => {
    const style = { text: run.text, bold: run.bold || base.bold, italics: run.italic || base.italics, size: base.size, font: run.code ? MONO : undefined };
    if (run.link && /^https?:\/\//i.test(run.link)) {
      return new ExternalHyperlink({ link: run.link, children: [new TextRun({ ...style, style: "Hyperlink", color: "1A5A40", underline: {} })] });
    }
    return new TextRun(style);
  });
}

export async function renderDocx(doc: DocumentModel): Promise<Uint8Array> {
  const numbering: { reference: string; levels: { level: number; format: (typeof LevelFormat)[keyof typeof LevelFormat]; text: string; alignment: (typeof AlignmentType)[keyof typeof AlignmentType]; style: { paragraph: { indent: { left: number; hanging: number } } } }[] }[] = [
    { reference: "bullets", levels: [{ level: 0, format: LevelFormat.BULLET, text: "•", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 540, hanging: 270 } } } }] },
  ];
  const children: (Paragraph | Table)[] = [new Paragraph({ heading: HeadingLevel.TITLE, children: [new TextRun({ text: doc.title || "Untitled", bold: true })], spacing: { after: 240 } })];
  let lists = 0;

  for (const block of doc.blocks) {
    switch (block.type) {
      case "heading":
        children.push(new Paragraph({ heading: block.level === 1 ? HeadingLevel.HEADING_1 : block.level === 2 ? HeadingLevel.HEADING_2 : HeadingLevel.HEADING_3, children: runsFor(block.text), spacing: { before: 240, after: 100 } }));
        break;
      case "paragraph":
        children.push(new Paragraph({ children: runsFor(block.text), spacing: { after: 140, line: 300 } }));
        break;
      case "bullets":
        for (const item of block.items) children.push(new Paragraph({ children: runsFor(item), numbering: { reference: "bullets", level: 0 }, spacing: { after: 60 } }));
        break;
      case "numbered": {
        // Each numbered list gets its own numbering instance so every list starts at 1.
        const reference = `numbered-${(lists += 1)}`;
        numbering.push({ reference, levels: [{ level: 0, format: LevelFormat.DECIMAL, text: "%1.", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 540, hanging: 360 } } } }] });
        for (const item of block.items) children.push(new Paragraph({ children: runsFor(item), numbering: { reference, level: 0 }, spacing: { after: 60 } }));
        break;
      }
      case "code":
        for (const line of block.text.split("\n")) {
          children.push(new Paragraph({ children: [new TextRun({ text: line || " ", font: MONO, size: 18 })], shading: { type: ShadingType.CLEAR, fill: "F2EFE8" }, spacing: { after: 0 } }));
        }
        children.push(new Paragraph({ children: [], spacing: { after: 140 } }));
        break;
      case "table": {
        const columns = block.header.length;
        const border = { style: BorderStyle.SINGLE, size: 4, color: "D1CDC4" };
        const borders = { top: border, bottom: border, left: border, right: border };
        const cell = (text: string, header: boolean) =>
          new TableCell({ borders, width: { size: Math.floor(9000 / columns), type: WidthType.DXA }, shading: header ? { type: ShadingType.CLEAR, fill: "F2EFE8" } : undefined, margins: { top: 60, bottom: 60, left: 100, right: 100 }, children: [new Paragraph({ children: runsFor(text ?? "", { bold: header, size: 20 }) })] });
        children.push(
          new Table({
            width: { size: 9000, type: WidthType.DXA },
            columnWidths: Array.from({ length: columns }, () => Math.floor(9000 / columns)),
            rows: [new TableRow({ tableHeader: true, children: block.header.map((h) => cell(h, true)) }), ...block.rows.map((row) => new TableRow({ children: Array.from({ length: columns }, (_, i) => cell(row[i] ?? "", false)) }))],
          }),
          new Paragraph({ children: [], spacing: { after: 160 } }),
        );
        break;
      }
    }
  }

  const document = new Document({
    creator: "Omni",
    title: doc.title,
    numbering: { config: numbering },
    styles: { default: { document: { run: { font: "Calibri", size: 22 } } } },
    sections: [{ properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 1300, right: 1300, bottom: 1300, left: 1300 } } }, children }],
  });
  return new Uint8Array(await Packer.toBuffer(document));
}
