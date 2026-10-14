import { blocksToMarkdown, blocksToText } from "./markdown";
import { CONTENT_TYPES, safeFilename, type DeckModel, type ExportRequest, type ExportResult } from "./model";
import { renderDocx } from "./docx";
import { renderDeckPdf, renderPdf } from "./pdf";
import { renderPptx } from "./pptx";
import { renderCsv, renderXlsx } from "./sheets";

const encode = (text: string) => new TextEncoder().encode(text);

export function deckToMarkdown(deck: DeckModel): string {
  const out = [`# ${deck.title}`, ""];
  for (const slide of deck.slides) {
    out.push(`## ${slide.title}`, "", ...slide.bullets.map((bullet) => `- ${bullet}`), "");
    if (slide.notes) out.push(`> Speaker notes: ${slide.notes}`, "");
  }
  return `${out.join("\n").trimEnd()}\n`;
}

/** Produces the file for an export request. Throws only for programming errors; bad content is the caller's to validate. */
export async function exportFile(request: ExportRequest): Promise<ExportResult> {
  const finish = (title: string, format: string, bytes: Uint8Array, warnings: string[] = []): ExportResult => ({ filename: safeFilename(title, format), contentType: CONTENT_TYPES[format], bytes, warnings });

  if (request.kind === "document") {
    const doc = request.document;
    switch (request.format) {
      case "pdf": {
        const { bytes, warnings } = await renderPdf(doc);
        return finish(doc.title, "pdf", bytes, warnings);
      }
      case "docx":
        return finish(doc.title, "docx", await renderDocx(doc));
      case "md":
        return finish(doc.title, "md", encode(blocksToMarkdown(doc)));
      case "txt":
        return finish(doc.title, "txt", encode(blocksToText(doc)));
    }
  }
  if (request.kind === "deck") {
    const deck = request.deck;
    switch (request.format) {
      case "pptx":
        return finish(deck.title, "pptx", await renderPptx(deck));
      case "pdf": {
        const { bytes, warnings } = await renderDeckPdf(deck);
        return finish(deck.title, "pdf", bytes, warnings);
      }
      case "md":
        return finish(deck.title, "md", encode(deckToMarkdown(deck)));
    }
  }
  const sheet = request.sheet;
  return request.format === "xlsx" ? finish(sheet.title, "xlsx", await renderXlsx(sheet)) : finish(sheet.title, "csv", encode(renderCsv(sheet)));
}
