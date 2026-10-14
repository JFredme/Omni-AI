// Client-safe types and limits for the knowledge base and memory.

export const DOCUMENT_KINDS = ["pdf", "docx", "xlsx", "csv", "markdown", "text", "code", "image", "note"] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];

export const KIND_LABELS: Record<DocumentKind, string> = {
  pdf: "PDF",
  docx: "Word",
  xlsx: "Spreadsheet",
  csv: "CSV",
  markdown: "Markdown",
  text: "Text",
  code: "Code",
  image: "Image",
  note: "Note",
};

export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;
export const MAX_EXTRACTED_CHARS = 2_000_000;
export const MAX_CHUNKS_PER_DOCUMENT = 3_000;
export const MAX_PASTED_CHARS = 200_000;

export type DocumentStatus = "processing" | "ready" | "failed";

export interface DocumentDto {
  id: string;
  name: string;
  kind: DocumentKind;
  sourceType: "file" | "note" | "text";
  sourceId: string | null;
  sizeBytes: number;
  status: DocumentStatus;
  error: string | null;
  chunkCount: number;
  embeddedCount: number;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

export interface ChunkDto {
  id: string;
  index: number;
  content: string;
  heading: string | null;
  page: number | null;
}

export interface SearchHit {
  chunkId: string;
  documentId: string;
  documentName: string;
  kind: DocumentKind;
  content: string;
  heading: string | null;
  page: number | null;
  /** 0–1. Cosine similarity for semantic hits; a term-match ratio for keyword hits. */
  score: number;
}

export type SearchMode = "semantic" | "keyword";

export interface MemoryDto {
  id: string;
  content: string;
  source: "user" | "chat" | "agent";
  createdAt: string;
  updatedAt: string;
}

/** What was retrieved for a reply. Stored with the message so the sources stay visible later. */
export interface Citation {
  n: number;
  kind: "source" | "memory";
  documentId: string | null;
  name: string;
  page: number | null;
  heading: string | null;
  snippet: string;
  score: number;
}

export const MAX_MEMORY_CHARS = 2_000;
