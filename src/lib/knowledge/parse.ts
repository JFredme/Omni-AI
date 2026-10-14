import { CODE_EXTENSIONS } from "./accepted";
import { MAX_EXTRACTED_CHARS, type DocumentKind } from "./types";
import { chunkPages, chunkTable, chunkText, type TextChunk } from "./chunk";

export class ParseError extends Error {}

const IMAGE_TYPES: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif" };

export function extensionOf(name: string): string {
  const match = /\.([A-Za-z0-9]+)$/.exec(name.trim());
  return match ? match[1].toLowerCase() : "";
}

export function detectKind(name: string): DocumentKind | null {
  const ext = extensionOf(name);
  if (ext === "pdf") return "pdf";
  if (ext === "docx") return "docx";
  if (ext === "xlsx") return "xlsx";
  if (ext === "csv") return "csv";
  if (ext === "md" || ext === "markdown") return "markdown";
  if (ext === "txt" || ext === "text" || ext === "log") return "text";
  if (CODE_EXTENSIONS.has(ext)) return "code";
  if (ext in IMAGE_TYPES) return "image";
  return null;
}

export function imageMimeType(name: string): string | null {
  return IMAGE_TYPES[extensionOf(name)] ?? null;
}

function startsWith(bytes: Uint8Array, signature: number[], offset = 0): boolean {
  return signature.every((value, index) => bytes[offset + index] === value);
}

/** Checks the file's first bytes against its extension, so a renamed executable isn't accepted as a PDF. */
export function matchesSignature(kind: DocumentKind, ext: string, bytes: Uint8Array): boolean {
  switch (kind) {
    case "pdf":
      return startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d]);
    case "docx":
    case "xlsx":
      return startsWith(bytes, [0x50, 0x4b, 0x03, 0x04]);
    case "image":
      if (ext === "png") return startsWith(bytes, [0x89, 0x50, 0x4e, 0x47]);
      if (ext === "jpg" || ext === "jpeg") return startsWith(bytes, [0xff, 0xd8, 0xff]);
      if (ext === "gif") return startsWith(bytes, [0x47, 0x49, 0x46, 0x38]);
      if (ext === "webp") return startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8);
      return false;
    default:
      return true;
  }
}

/** Decodes bytes as UTF-8 text, refusing binary data. */
export function decodeText(bytes: Uint8Array): string {
  if (bytes.subarray(0, 8000).includes(0)) throw new ParseError("That file looks like binary data, not text.");
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    // Fall back for Latin-1 style files rather than rejecting them.
    text = new TextDecoder("latin1").decode(bytes);
  }
  return text.replace(/^﻿/, "");
}

/** A small RFC 4180 CSV parser: quoted fields, escaped quotes, and newlines inside quotes. */
export function parseCsv(text: string): string[][] {
  const delimiter = (text.split("\n", 1)[0].match(/\t/g)?.length ?? 0) > (text.split("\n", 1)[0].match(/,/g)?.length ?? 0) ? "\t" : ",";
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += char;
    } else if (char === '"' && field === "") quoted = true;
    else if (char === delimiter) {
      row.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.some((cell) => cell.trim() !== "")) rows.push(row.map((cell) => cell.trim()));
      row = [];
    } else field += char;
  }
  row.push(field);
  if (row.some((cell) => cell.trim() !== "")) rows.push(row.map((cell) => cell.trim()));
  return rows;
}

export interface ParsedDocument {
  kind: DocumentKind;
  chunks: TextChunk[];
  /** Notes for the user, such as "3 pages had no extractable text". */
  warnings: string[];
}

function limitChars(text: string): string {
  if (text.length > MAX_EXTRACTED_CHARS) throw new ParseError(`That file has more than ${MAX_EXTRACTED_CHARS.toLocaleString()} characters of text. Split it into smaller files.`);
  return text;
}

/** Extracts text from a non-image file and splits it into chunks. */
export async function parseDocument(name: string, bytes: Uint8Array): Promise<ParsedDocument> {
  const kind = detectKind(name);
  const ext = extensionOf(name);
  if (!kind || kind === "image" || kind === "note") throw new ParseError("That file type isn't supported.");
  if (!matchesSignature(kind, ext, bytes)) throw new ParseError(`That file doesn't look like a real .${ext} file.`);
  const warnings: string[] = [];

  if (kind === "pdf") {
    const { extractText, getDocumentProxy } = await import("unpdf");
    let pages: string[];
    try {
      const pdf = await getDocumentProxy(new Uint8Array(bytes));
      pages = (await extractText(pdf, { mergePages: false })).text as unknown as string[];
    } catch (error) {
      throw new ParseError(`The PDF couldn't be read${error instanceof Error ? `: ${error.message}` : "."}`);
    }
    const entries = pages.map((text, index) => ({ page: index + 1, text: text.trim() })).filter((entry) => entry.text.length > 0);
    const empty = pages.length - entries.length;
    if (entries.length === 0) throw new ParseError("No text found. This PDF may be scanned images; upload the pages as images instead.");
    if (empty > 0) warnings.push(`${empty} page(s) had no extractable text (scanned images aren't read).`);
    limitChars(entries.map((entry) => entry.text).join("\n"));
    return { kind, chunks: chunkPages(entries), warnings };
  }

  if (kind === "docx") {
    const mammoth = await import("mammoth");
    let text: string;
    try {
      text = (await mammoth.extractRawText({ buffer: Buffer.from(bytes) })).value;
    } catch (error) {
      throw new ParseError(`The Word file couldn't be read${error instanceof Error ? `: ${error.message}` : "."}`);
    }
    if (!text.trim()) throw new ParseError("That Word document has no text.");
    return { kind, chunks: chunkText(limitChars(text)), warnings };
  }

  if (kind === "xlsx") {
    const { default: readXlsx } = await import("read-excel-file/node");
    let sheets: { sheet: string; data: unknown[][] }[];
    try {
      sheets = (await readXlsx(Buffer.from(bytes))) as unknown as { sheet: string; data: unknown[][] }[];
    } catch (error) {
      throw new ParseError(`The spreadsheet couldn't be read${error instanceof Error ? `: ${error.message}` : "."}`);
    }
    const chunks: TextChunk[] = [];
    let total = 0;
    for (const { sheet, data } of sheets.slice(0, 30)) {
      const rows = data.map((row) => row.map((cell) => (cell === null || cell === undefined ? "" : cell instanceof Date ? cell.toISOString().slice(0, 10) : String(cell))));
      const filled = rows.filter((row) => row.some((cell) => cell.trim() !== ""));
      total += filled.reduce((sum, row) => sum + row.join(" ").length, 0);
      if (total > MAX_EXTRACTED_CHARS) throw new ParseError(`That spreadsheet has more than ${MAX_EXTRACTED_CHARS.toLocaleString()} characters of data. Split it into smaller files.`);
      chunks.push(...chunkTable(filled, { name: sheet }));
    }
    if (sheets.length > 30) warnings.push("Only the first 30 sheets were read.");
    if (chunks.length === 0) throw new ParseError("That spreadsheet has no data.");
    return { kind, chunks, warnings };
  }

  const text = limitChars(decodeText(bytes));
  if (!text.trim()) throw new ParseError("That file is empty.");
  if (kind === "csv") {
    const chunks = chunkTable(parseCsv(text), { name: name });
    return { kind, chunks, warnings };
  }
  if (kind === "code") {
    // Code has no paragraphs worth splitting on; keep lines together and break on blank lines or size.
    return { kind, chunks: chunkText(text, { target: 1400, overlap: 0 }), warnings };
  }
  return { kind, chunks: chunkText(text), warnings };
}
