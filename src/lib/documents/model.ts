import { z } from "zod";

// Client-safe: the shapes of the documents Omni can produce, and what they can be saved as.

export const DOCUMENT_FORMATS = ["pdf", "docx", "md", "txt"] as const;
export const DECK_FORMATS = ["pptx", "pdf", "md"] as const;
export const SHEET_FORMATS = ["xlsx", "csv"] as const;
export type DocumentFormat = (typeof DOCUMENT_FORMATS)[number];
export type DeckFormat = (typeof DECK_FORMATS)[number];
export type SheetFormat = (typeof SHEET_FORMATS)[number];

export const FORMAT_LABELS: Record<string, string> = {
  pdf: "PDF",
  docx: "Word (.docx)",
  pptx: "PowerPoint (.pptx)",
  xlsx: "Excel (.xlsx)",
  md: "Markdown",
  txt: "Plain text",
  csv: "CSV",
};

export const CONTENT_TYPES: Record<string, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  md: "text/markdown; charset=utf-8",
  txt: "text/plain; charset=utf-8",
  csv: "text/csv; charset=utf-8",
};

export const MAX_BLOCKS = 600;
export const MAX_SLIDES = 40;
export const MAX_SHEETS = 10;
export const MAX_ROWS = 5_000;
export const MAX_COLUMNS = 40;

const text = (max: number) => z.string().max(max);

export const blockSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("heading"), level: z.number().int().min(1).max(3), text: text(300) }),
  z.object({ type: z.literal("paragraph"), text: text(10_000) }),
  z.object({ type: z.literal("bullets"), items: z.array(text(2_000)).max(100) }),
  z.object({ type: z.literal("numbered"), items: z.array(text(2_000)).max(100) }),
  z.object({ type: z.literal("table"), header: z.array(text(300)).min(1).max(MAX_COLUMNS), rows: z.array(z.array(text(1_000)).max(MAX_COLUMNS)).max(500) }),
  z.object({ type: z.literal("code"), text: text(20_000) }),
]);

export const documentSchema = z.object({ title: text(200), blocks: z.array(blockSchema).max(MAX_BLOCKS) });

export const deckSchema = z.object({
  title: text(200),
  slides: z.array(z.object({ title: text(200), bullets: z.array(text(500)).max(12), notes: text(2_000).optional() })).min(1).max(MAX_SLIDES),
});

const cell = z.union([z.string().max(2_000), z.number().finite()]);
export const sheetSchema = z.object({
  title: text(200),
  sheets: z
    .array(z.object({ name: text(31), header: z.array(text(200)).min(1).max(MAX_COLUMNS), rows: z.array(z.array(cell).max(MAX_COLUMNS)).max(MAX_ROWS) }))
    .min(1)
    .max(MAX_SHEETS),
});

export type Block = z.infer<typeof blockSchema>;
export type DocumentModel = z.infer<typeof documentSchema>;
export type DeckModel = z.infer<typeof deckSchema>;
export type SheetModel = z.infer<typeof sheetSchema>;

export type ExportRequest =
  | { kind: "document"; format: DocumentFormat; document: DocumentModel }
  | { kind: "deck"; format: DeckFormat; deck: DeckModel }
  | { kind: "sheet"; format: SheetFormat; sheet: SheetModel };

export const exportRequestSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("document"), format: z.enum(DOCUMENT_FORMATS), document: documentSchema }),
  z.object({ kind: z.literal("deck"), format: z.enum(DECK_FORMATS), deck: deckSchema }),
  z.object({ kind: z.literal("sheet"), format: z.enum(SHEET_FORMATS), sheet: sheetSchema }),
]);

/** A file name that is safe on every system, from a document's title. */
export function safeFilename(title: string, extension: string): string {
  const base = title
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return `${base || "document"}.${extension}`;
}

export interface ExportResult {
  filename: string;
  contentType: string;
  bytes: Uint8Array;
  /** Things that couldn't be carried over exactly, for the user to read. */
  warnings: string[];
}
