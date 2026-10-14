// @vitest-environment node
import readXlsx from "read-excel-file/node";
import mammoth from "mammoth";
import { extractText, getDocumentProxy } from "unpdf";
import { describe, expect, it } from "vitest";
import { exportFile } from "./export";
import { markdownToBlocks } from "./markdown";
import { deckSchema, documentSchema, exportRequestSchema, safeFilename, sheetSchema, type DocumentModel } from "./model";
import { neutralizeFormula, renderCsv, sheetNames } from "./sheets";
import { readZip } from "./zip-reader";

const doc: DocumentModel = {
  title: "Quarterly report: Q3",
  blocks: [
    { type: "heading", level: 1, text: "Summary" },
    { type: "paragraph", text: "Revenue grew by **twelve percent** and costs fell. See [the dashboard](https://example.com/dash) for `raw numbers`." },
    { type: "bullets", items: ["First point", "Second point with *emphasis*"] },
    { type: "numbered", items: ["Step one", "Step two"] },
    { type: "numbered", items: ["Another list", "Starts again"] },
    { type: "table", header: ["Region", "Revenue"], rows: [["North", "120"], ["South", "95"]] },
    { type: "code", text: "const total = north + south;\nconsole.log(total);" },
  ],
};

async function pdfText(bytes: Uint8Array): Promise<{ pages: string[]; count: number }> {
  const pdf = await getDocumentProxy(new Uint8Array(bytes));
  const result = await extractText(pdf, { mergePages: false });
  return { pages: result.text as unknown as string[], count: result.totalPages };
}

describe("PDF", () => {
  it("is a valid PDF that contains the text, in reading order, with page numbers", async () => {
    const file = await exportFile({ kind: "document", format: "pdf", document: doc });
    expect(file).toMatchObject({ filename: "Quarterly-report-Q3.pdf", contentType: "application/pdf", warnings: [] });
    expect(Buffer.from(file.bytes).subarray(0, 5).toString()).toBe("%PDF-");
    const { pages, count } = await pdfText(file.bytes);
    expect(count).toBe(1);
    const text = pages.join("\n");
    expect(text).toContain("Quarterly report: Q3");
    expect(text).toMatch(/raw\s+numbers/);
    for (const expected of ["Summary", "Revenue grew by twelve percent", "First point", "Second point with emphasis", "Step one", "Another list", "Region", "North", "95", "const total = north + south;", "1 / 1"]) {
      expect(text, expected).toContain(expected);
    }
    expect(text).toContain("https://example.com/dash");
    expect(text.indexOf("Summary")).toBeLessThan(text.indexOf("Region"));
    expect(text).not.toContain("**");
  });

  it("flows long documents onto more pages without losing anything", async () => {
    const long: DocumentModel = { title: "Long", blocks: Array.from({ length: 80 }, (_, i) => ({ type: "paragraph" as const, text: `Paragraph number ${i} with enough words to take up a fair amount of room on the page so that the document needs several pages.` })) };
    const { pages, count } = await pdfText((await exportFile({ kind: "document", format: "pdf", document: long })).bytes);
    expect(count).toBeGreaterThan(2);
    const text = pages.join(" ");
    for (let i = 0; i < 80; i++) expect(text).toContain(`Paragraph number ${i} `);
    expect(pages.at(-1)).toContain(`${count} / ${count}`);
  });

  it("repeats a table's header when it continues on the next page", async () => {
    const big: DocumentModel = { title: "Table", blocks: [{ type: "table", header: ["Key", "Value"], rows: Array.from({ length: 120 }, (_, i) => [`row-${i}`, `value-${i}`]) }] };
    const { pages, count } = await pdfText((await exportFile({ kind: "document", format: "pdf", document: big })).bytes);
    expect(count).toBeGreaterThan(1);
    expect(pages[1]).toContain("Key");
    expect(pages.join(" ")).toContain("row-119");
  });

  it("copes with long unbroken words, empty documents, and characters the PDF fonts can't show", async () => {
    const odd: DocumentModel = { title: "Edge “cases” — ok", blocks: [{ type: "paragraph", text: `${"x".repeat(400)} café naïve 日本語 😀 “quoted” – dash…` }, { type: "code", text: "a".repeat(300) }] };
    const file = await exportFile({ kind: "document", format: "pdf", document: odd });
    expect(file.warnings[0]).toMatch(/4 characters/);
    const text = (await pdfText(file.bytes)).pages.join(" ");
    expect(text).toContain("café naïve");
    expect(text).toContain("“quoted”");
    expect(text).not.toContain("日本語");
    await expect(exportFile({ kind: "document", format: "pdf", document: { title: "", blocks: [] } })).resolves.toBeTruthy();
  });

  it("makes a landscape slide deck PDF, one page per slide", async () => {
    const deck = deckSchema.parse({ title: "Launch plan", slides: [{ title: "Goals", bullets: ["Ship in May", "Delight users"] }, { title: "Risks", bullets: ["Scope creep"] }] });
    const { pages, count } = await pdfText((await exportFile({ kind: "deck", format: "pdf", deck })).bytes);
    expect(count).toBe(3);
    expect(pages[0]).toContain("Launch plan");
    expect(pages[1]).toContain("Ship in May");
    expect(pages[2]).toContain("Scope creep");
  });
});

describe("Word", () => {
  it("is a valid .docx containing the text, links, table and code", async () => {
    const file = await exportFile({ kind: "document", format: "docx", document: doc });
    expect(file.filename).toBe("Quarterly-report-Q3.docx");
    const text = (await mammoth.extractRawText({ buffer: Buffer.from(file.bytes) })).value;
    for (const expected of ["Quarterly report: Q3", "Summary", "Revenue grew by twelve percent", "the dashboard", "First point", "Step two", "Region", "North", "const total = north + south;"]) {
      expect(text, expected).toContain(expected);
    }
    const parts = readZip(file.bytes);
    const xml = parts.get("word/document.xml")!.toString("utf8");
    expect(xml).toContain("<w:b/>"); // the bold run
    expect(xml).toContain("w:hyperlink");
    // Each numbered list restarts at 1, which needs a separate numbering instance per list.
    expect(new Set(xml.match(/<w:numId w:val="\d+"\/>/g)).size).toBeGreaterThanOrEqual(3);
    expect(parts.get("word/_rels/document.xml.rels")!.toString("utf8")).toContain("https://example.com/dash");
  });

  it("renders a table with a header row", async () => {
    const xml = readZip((await exportFile({ kind: "document", format: "docx", document: doc })).bytes).get("word/document.xml")!.toString("utf8");
    expect(xml).toContain("<w:tbl>");
    expect(xml).toContain("w:tblHeader");
  });
});

describe("PowerPoint", () => {
  const deck = deckSchema.parse({
    title: "Launch plan",
    slides: [
      { title: "Goals", bullets: ["Ship in **May**", "Delight users"], notes: "Say hello first." },
      { title: "Risks", bullets: [] },
    ],
  });

  it("is a valid .pptx with a title slide, a slide per entry, bullets, and speaker notes", async () => {
    const file = await exportFile({ kind: "deck", format: "pptx", deck });
    expect(file.filename).toBe("Launch-plan.pptx");
    const parts = readZip(file.bytes);
    const slides = [...parts.keys()].filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name)).sort();
    expect(slides).toHaveLength(3);
    const all = slides.map((name) => parts.get(name)!.toString("utf8")).join("\n");
    for (const expected of ["Launch plan", "Goals", "Ship in May", "Delight users", "Risks"]) expect(all, expected).toContain(expected);
    expect(all).not.toContain("**");
    const notes = [...parts.keys()].filter((name) => /^ppt\/notesSlides\/notesSlide\d+\.xml$/.test(name)).map((name) => parts.get(name)!.toString("utf8")).join("\n");
    expect(notes).toContain("Say hello first.");
  });
});

describe("spreadsheets", () => {
  const sheet = sheetSchema.parse({
    title: "Budget",
    sheets: [
      { name: "Q1/Q2: totals?", header: ["Item", "Cost"], rows: [["Rent", 1200], ["=HYPERLINK(\"http://evil.test\",\"x\")", 5], ["Notes, with comma", 0.5]] },
      { name: "Q1/Q2: totals?", header: ["A"], rows: [] },
    ],
  });

  it("writes a readable .xlsx with numbers kept as numbers, headers, and safe sheet names", async () => {
    const file = await exportFile({ kind: "sheet", format: "xlsx", sheet });
    expect(file.filename).toBe("Budget.xlsx");
    const sheets = (await readXlsx(Buffer.from(file.bytes))) as unknown as { sheet: string; data: unknown[][] }[];
    expect(sheets.map((s) => s.sheet)).toEqual(["Q1 Q2 totals", "Q1 Q2 totals 2"]);
    expect(sheets[0].data[0]).toEqual(["Item", "Cost"]);
    expect(sheets[0].data[1]).toEqual(["Rent", 1200]);
    expect(sheets[0].data[3]).toEqual(["Notes, with comma", 0.5]);
  });

  it("writes CSV with a byte-order mark, quoting, and formulas defused", () => {
    const csv = renderCsv(sheet);
    expect(csv.startsWith("﻿Item,Cost\r\n")).toBe(true);
    expect(csv).toContain('"Notes, with comma",0.5');
    expect(csv).toContain("\"'=HYPERLINK(\"\"http://evil.test\"\",\"\"x\"\")\",5");
    expect(neutralizeFormula("+1+1")).toBe("'+1+1");
    expect(neutralizeFormula("-5")).toBe("'-5");
    expect(neutralizeFormula(-5)).toBe(-5);
    expect(neutralizeFormula("plain")).toBe("plain");
  });

  it("keeps sheet names unique, valid, and at most 31 characters", () => {
    expect(sheetNames(["Data", "data", "x".repeat(40), "", "[bad]"])).toEqual(["Data", "data 2", "x".repeat(31), "Sheet 4", "bad"]);
  });
});

describe("text formats and names", () => {
  it("writes Markdown and plain text", async () => {
    const md = new TextDecoder().decode((await exportFile({ kind: "document", format: "md", document: doc })).bytes);
    expect(md).toContain("# Quarterly report: Q3");
    expect(md).toContain("| Region | Revenue |");
    const txt = new TextDecoder().decode((await exportFile({ kind: "document", format: "txt", document: doc })).bytes);
    expect(txt).toContain("  • First point");
    expect(markdownToBlocks(md).some((b) => b.type === "table")).toBe(true);
  });

  it("makes safe file names", () => {
    expect(safeFilename("Q3 report / final?", "pdf")).toBe("Q3-report-final.pdf");
    expect(safeFilename("../../etc/passwd", "docx")).toBe("etc-passwd.docx");
    expect(safeFilename("日本語", "md")).toBe("document.md");
    expect(safeFilename("Café Münch", "txt")).toBe("Cafe-Munch.txt");
    expect(safeFilename("x".repeat(200), "pdf").length).toBeLessThanOrEqual(64);
  });

  it("validates export requests", () => {
    expect(exportRequestSchema.safeParse({ kind: "document", format: "pptx", document: doc }).success).toBe(false);
    expect(exportRequestSchema.safeParse({ kind: "sheet", format: "pdf", sheet: { title: "x", sheets: [] } }).success).toBe(false);
    expect(documentSchema.safeParse({ title: "x", blocks: [{ type: "heading", level: 9, text: "x" }] }).success).toBe(false);
    expect(documentSchema.safeParse({ title: "x", blocks: Array.from({ length: 601 }, () => ({ type: "paragraph", text: "x" })) }).success).toBe(false);
  });
});
