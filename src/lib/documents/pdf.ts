import { PDFDocument, PDFFont, PDFPage, StandardFonts, rgb } from "pdf-lib";
import { parseInline, plainInline, type Run } from "./markdown";
import type { DeckModel, DocumentModel } from "./model";

/**
 * Lays a document out as a PDF using the standard PDF fonts, so no font files are needed. Those fonts cover Western European
 * languages; other characters are replaced with "?" and counted in a warning.
 */

const A4 = { width: 595.28, height: 841.89 };
const MARGIN = 56;
const INK = rgb(0.14, 0.13, 0.12);
const MUTED = rgb(0.45, 0.43, 0.4);
const RULE = rgb(0.82, 0.8, 0.76);
const SHADE = rgb(0.95, 0.94, 0.91);
const LINK = rgb(0.1, 0.35, 0.25);

const FALLBACKS: Record<string, string> = { "‘": "'", "’": "'", "“": '"', "”": '"', "–": "-", "—": "-", "…": "...", " ": " ", "→": "->", "←": "<-", "✓": "v", "•": "•", "×": "x", "\t": "    " };

interface Fonts {
  regular: PDFFont;
  bold: PDFFont;
  italic: PDFFont;
  boldItalic: PDFFont;
  mono: PDFFont;
  serifBold: PDFFont;
}

class Sanitizer {
  replaced = 0;
  private readonly supported: Set<number>;
  constructor(font: PDFFont) {
    this.supported = new Set(font.getCharacterSet());
  }
  clean(text: string): string {
    let out = "";
    for (const char of text.replace(/\r\n?/g, "\n")) {
      const code = char.codePointAt(0)!;
      if (char === "\n") out += char;
      else if (this.supported.has(code)) out += char;
      else if (FALLBACKS[char] !== undefined) out += FALLBACKS[char];
      else if (code < 32 || (code >= 0x200b && code <= 0x200f) || code === 0xfeff) continue;
      else {
        this.replaced += 1;
        out += "?";
      }
    }
    return out;
  }
}

interface Word {
  text: string;
  font: PDFFont;
  size: number;
  color: ReturnType<typeof rgb>;
  underline: boolean;
  space: boolean;
}

class Layout {
  page!: PDFPage;
  y = 0;
  pages: PDFPage[] = [];
  constructor(
    readonly pdf: PDFDocument,
    readonly fonts: Fonts,
    readonly clean: Sanitizer,
    readonly size = A4,
    readonly margin = MARGIN,
  ) {
    this.newPage();
  }
  get width() {
    return this.size.width - this.margin * 2;
  }
  newPage() {
    this.page = this.pdf.addPage([this.size.width, this.size.height]);
    this.pages.push(this.page);
    this.y = this.size.height - this.margin;
  }
  ensure(height: number) {
    if (this.y - height < this.margin) this.newPage();
  }

  fontFor(run: Run, base: { bold?: boolean; italic?: boolean }): PDFFont {
    if (run.code) return this.fonts.mono;
    const bold = run.bold || base.bold;
    const italic = run.italic || base.italic;
    return bold && italic ? this.fonts.boldItalic : bold ? this.fonts.bold : italic ? this.fonts.italic : this.fonts.regular;
  }

  /** Breaks formatted text into lines that fit `maxWidth`, wrapping very long words by character. */
  wrap(runs: Run[], size: number, maxWidth: number, base: { bold?: boolean; italic?: boolean; color?: ReturnType<typeof rgb> } = {}): Word[][] {
    const words: Word[] = [];
    for (const run of runs) {
      const font = this.fontFor(run, base);
      const color = run.link ? LINK : base.color ?? INK;
      const text = this.clean.clean(run.text);
      for (const part of text.split(/(\s+)/)) {
        if (!part) continue;
        if (/^\s+$/.test(part)) {
          // A space takes the style of the text beside it, so a styled phrase stays one piece of text.
          const spaceSize = run.code ? size - 1 : size;
          if (part.includes("\n")) words.push({ text: "\n", font, size: spaceSize, color, underline: false, space: false });
          else words.push({ text: " ", font, size: spaceSize, color, underline: Boolean(run.link), space: true });
        } else words.push({ text: part, font, size: run.code ? size - 1 : size, color, underline: Boolean(run.link), space: false });
      }
      if (run.link) {
        words.push({ text: " ", font: this.fonts.regular, size: size - 1.5, color: MUTED, underline: false, space: true });
        words.push({ text: this.clean.clean(`(${run.link})`), font: this.fonts.regular, size: size - 1.5, color: MUTED, underline: false, space: false });
      }
    }
    const lines: Word[][] = [[]];
    let width = 0;
    const push = (word: Word) => {
      lines.at(-1)!.push(word);
      width += word.font.widthOfTextAtSize(word.text, word.size);
    };
    for (const word of words) {
      if (word.text === "\n") {
        lines.push([]);
        width = 0;
        continue;
      }
      const w = word.font.widthOfTextAtSize(word.text, word.size);
      if (word.space) {
        if (lines.at(-1)!.length > 0) push(word);
        continue;
      }
      if (width + w > maxWidth && lines.at(-1)!.length > 0) {
        while (lines.at(-1)!.at(-1)?.space) lines.at(-1)!.pop();
        lines.push([]);
        width = 0;
      }
      if (w > maxWidth) {
        let chunk = "";
        for (const char of word.text) {
          if (word.font.widthOfTextAtSize(chunk + char, word.size) > maxWidth && chunk) {
            lines.at(-1)!.push({ ...word, text: chunk });
            lines.push([]);
            chunk = "";
          }
          chunk += char;
        }
        width = word.font.widthOfTextAtSize(chunk, word.size);
        lines.at(-1)!.push({ ...word, text: chunk });
      } else push(word);
    }
    return lines;
  }

  drawLine(line: Word[], x: number, y: number) {
    // Neighbouring words in the same style are drawn as one piece of text, spaces included, so selecting and copying
    // text from the PDF gives back proper words.
    let cursor = x;
    let index = 0;
    while (index < line.length) {
      const first = line[index];
      let text = "";
      let end = index;
      while (end < line.length && line[end].font === first.font && line[end].size === first.size && line[end].color === first.color && line[end].underline === first.underline) {
        text += line[end].text;
        end += 1;
      }
      const trimmed = text.replace(/\s+$/, "");
      const w = first.font.widthOfTextAtSize(text, first.size);
      if (trimmed) {
        this.page.drawText(trimmed, { x: cursor, y, size: first.size, font: first.font, color: first.color });
        if (first.underline) this.page.drawLine({ start: { x: cursor, y: y - 1.5 }, end: { x: cursor + first.font.widthOfTextAtSize(trimmed, first.size), y: y - 1.5 }, thickness: 0.5, color: first.color });
      }
      cursor += w;
      index = end;
    }
  }

  /** Writes wrapped paragraph text at the cursor, flowing onto new pages as needed. */
  paragraph(text: string, size: number, options: { x?: number; width?: number; bold?: boolean; italic?: boolean; color?: ReturnType<typeof rgb>; gap?: number; leading?: number; runs?: Run[] } = {}) {
    const x = options.x ?? this.margin;
    const lines = this.wrap(options.runs ?? parseInline(text), size, options.width ?? this.width, options);
    const leading = size * (options.leading ?? 1.4);
    for (const line of lines) {
      this.ensure(leading);
      this.y -= size;
      this.drawLine(line, x, this.y);
      this.y -= leading - size;
    }
    this.y -= options.gap ?? size * 0.6;
  }
}

async function makeFonts(pdf: PDFDocument): Promise<Fonts> {
  return {
    regular: await pdf.embedFont(StandardFonts.Helvetica),
    bold: await pdf.embedFont(StandardFonts.HelveticaBold),
    italic: await pdf.embedFont(StandardFonts.HelveticaOblique),
    boldItalic: await pdf.embedFont(StandardFonts.HelveticaBoldOblique),
    mono: await pdf.embedFont(StandardFonts.Courier),
    serifBold: await pdf.embedFont(StandardFonts.TimesRomanBold),
  };
}

function footers(layout: Layout, label: string, clean: Sanitizer) {
  const total = layout.pages.length;
  layout.pages.forEach((page, index) => {
    const text = `${clean.clean(label).slice(0, 70)}   ·   ${index + 1} / ${total}`;
    const font = layout.fonts.regular;
    page.drawText(text, { x: layout.size.width - layout.margin - font.widthOfTextAtSize(text, 8), y: layout.margin - 28, size: 8, font, color: MUTED });
  });
}

function warningsFor(clean: Sanitizer): string[] {
  return clean.replaced > 0 ? [`${clean.replaced} character${clean.replaced === 1 ? "" : "s"} outside Western European alphabets (such as other scripts or emoji) were replaced with "?", because PDF export can't show them yet. Word and Markdown exports keep them.`] : [];
}

export async function renderPdf(doc: DocumentModel): Promise<{ bytes: Uint8Array; warnings: string[] }> {
  const pdf = await PDFDocument.create();
  const fonts = await makeFonts(pdf);
  const clean = new Sanitizer(fonts.regular);
  pdf.setTitle(clean.clean(doc.title));
  pdf.setProducer("Omni");
  pdf.setCreator("Omni");
  const layout = new Layout(pdf, fonts, clean);

  layout.y -= 4;
  const titleLines = layout.wrap([{ text: doc.title || "Untitled" }], 24, layout.width, { bold: true });
  for (const line of titleLines) {
    layout.ensure(32);
    layout.y -= 24;
    // The title uses the serif face for a little character.
    layout.drawLine(line.map((word) => ({ ...word, font: fonts.serifBold })), layout.margin, layout.y);
    layout.y -= 8;
  }
  layout.page.drawLine({ start: { x: layout.margin, y: layout.y }, end: { x: layout.margin + layout.width, y: layout.y }, thickness: 1, color: RULE });
  layout.y -= 22;

  for (const block of doc.blocks) {
    switch (block.type) {
      case "heading": {
        const size = block.level === 1 ? 17 : block.level === 2 ? 14 : 12;
        layout.ensure(size * 3);
        layout.y -= size * 0.5;
        layout.paragraph(block.text, size, { bold: true, gap: size * 0.35, leading: 1.25, runs: [{ text: plainInline(block.text) }] });
        break;
      }
      case "paragraph":
        layout.paragraph(block.text, 11);
        break;
      case "bullets":
      case "numbered": {
        block.items.forEach((item, index) => {
          layout.ensure(16);
          const marker = block.type === "bullets" ? "•" : `${index + 1}.`;
          const markerFont = fonts.regular;
          const before = layout.y;
          layout.y -= 11;
          layout.page.drawText(clean.clean(marker), { x: layout.margin + 8, y: layout.y, size: 11, font: markerFont, color: MUTED });
          layout.y = before;
          layout.paragraph(item, 11, { x: layout.margin + 28, width: layout.width - 28, gap: 3 });
        });
        layout.y -= 6;
        break;
      }
      case "code": {
        const lines = block.text.split("\n");
        const size = 8.5;
        const leading = size * 1.35;
        let index = 0;
        while (index < lines.length) {
          layout.ensure(leading * 2 + 8);
          const room = Math.max(1, Math.floor((layout.y - layout.margin - 8) / leading));
          const chunk = lines.slice(index, index + room);
          const wrapped = chunk.flatMap((line) => layout.wrap([{ text: line || " ", code: true }], size + 1, layout.width - 16, {}));
          const height = wrapped.length * leading + 10;
          layout.page.drawRectangle({ x: layout.margin, y: layout.y - height + 4, width: layout.width, height, color: SHADE });
          layout.y -= 5;
          for (const line of wrapped) {
            layout.y -= size;
            layout.drawLine(line.map((word) => ({ ...word, font: fonts.mono, size })), layout.margin + 8, layout.y);
            layout.y -= leading - size;
          }
          layout.y -= 5;
          index += chunk.length;
        }
        layout.y -= 8;
        break;
      }
      case "table": {
        const columns = block.header.length;
        const size = 9;
        const pad = 4;
        const colWidth = layout.width / columns;
        const measure = (cells: string[], bold: boolean) => cells.map((cell) => layout.wrap(parseInline(cell ?? ""), size, colWidth - pad * 2, { bold }));
        const drawRow = (cells: string[], header: boolean) => {
          const wrapped = measure(Array.from({ length: columns }, (_, i) => cells[i] ?? ""), header);
          const lineCount = Math.max(...wrapped.map((c) => c.length));
          const height = lineCount * size * 1.35 + pad * 2;
          layout.ensure(height);
          const top = layout.y;
          if (header) layout.page.drawRectangle({ x: layout.margin, y: top - height, width: layout.width, height, color: SHADE });
          wrapped.forEach((lines, col) => {
            let y = top - pad;
            for (const line of lines) {
              y -= size;
              layout.drawLine(line, layout.margin + col * colWidth + pad, y);
              y -= size * 0.35;
            }
          });
          layout.page.drawLine({ start: { x: layout.margin, y: top - height }, end: { x: layout.margin + layout.width, y: top - height }, thickness: 0.5, color: RULE });
          layout.y = top - height;
        };
        layout.page.drawLine({ start: { x: layout.margin, y: layout.y }, end: { x: layout.margin + layout.width, y: layout.y }, thickness: 0.5, color: RULE });
        drawRow(block.header, true);
        for (const row of block.rows) {
          const before = layout.pages.length;
          drawRow(row, false);
          // A table that continues on a new page starts with its header again.
          if (layout.pages.length > before) {
            layout.y = layout.size.height - layout.margin;
            drawRow(block.header, true);
            drawRow(row, false);
          }
        }
        layout.y -= 14;
        break;
      }
    }
  }
  footers(layout, doc.title, clean);
  return { bytes: await pdf.save(), warnings: warningsFor(clean) };
}

/** One landscape page per slide, with the title and its points in large type. */
export async function renderDeckPdf(deck: DeckModel): Promise<{ bytes: Uint8Array; warnings: string[] }> {
  const pdf = await PDFDocument.create();
  const fonts = await makeFonts(pdf);
  const clean = new Sanitizer(fonts.regular);
  pdf.setTitle(clean.clean(deck.title));
  pdf.setProducer("Omni");
  const size = { width: 841.89, height: 473.56 };
  const layout = new Layout(pdf, fonts, clean, size, 48);

  const slide = (title: string, bullets: string[], opening: boolean) => {
    if (layout.pages.length > 1 || layout.y < size.height - 48 - 1) layout.newPage();
    layout.y -= opening ? 140 : 8;
    const lines = layout.wrap([{ text: title }], opening ? 38 : 28, layout.width, { bold: true });
    for (const line of lines) {
      layout.y -= opening ? 38 : 28;
      layout.drawLine(line.map((word) => ({ ...word, font: fonts.serifBold })), layout.margin, layout.y);
      layout.y -= 10;
    }
    layout.page.drawLine({ start: { x: layout.margin, y: layout.y }, end: { x: layout.margin + 120, y: layout.y }, thickness: 2, color: LINK });
    layout.y -= 24;
    for (const bullet of bullets) {
      layout.ensure(24);
      const before = layout.y;
      layout.y -= 17;
      layout.page.drawText("•", { x: layout.margin + 4, y: layout.y, size: 17, font: fonts.regular, color: LINK });
      layout.y = before;
      layout.paragraph(bullet, 17, { x: layout.margin + 26, width: layout.width - 26, gap: 8 });
    }
  };
  slide(deck.title, [], true);
  for (const s of deck.slides) slide(s.title, s.bullets, false);
  footers(layout, deck.title, clean);
  return { bytes: await pdf.save(), warnings: warningsFor(clean) };
}
