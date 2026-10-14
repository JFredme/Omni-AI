import { ApiError } from "@/lib/api-error";
import { describeImage } from "@/lib/ai/vision";
import { prisma } from "@/lib/db";
import { OpenRouterError, userMessageFor } from "@/lib/openrouter/errors";
import { escapeLike } from "@/lib/search";
import type { Prisma } from "@/generated/prisma/client";
import { chunkText, type TextChunk } from "./chunk";
import { embedTexts, getEmbeddingModel } from "./embed";
import { detectKind, extensionOf, imageMimeType, matchesSignature, parseDocument, ParseError } from "./parse";
import {
  MAX_CHUNKS_PER_DOCUMENT,
  MAX_PASTED_CHARS,
  MAX_UPLOAD_BYTES,
  type ChunkDto,
  type DocumentDto,
  type DocumentKind,
  type SearchHit,
  type SearchMode,
} from "./types";
import { dot, fromBytes, toBytes, topK } from "./vectors";

const MIN_SEMANTIC_SCORE = 0.22;
const KEYWORD_WEIGHT_WHEN_MIXED = 0.5;

interface State {
  index: { model: string; chunks: { id: string; documentId: string; vector: Float32Array }[] } | null;
  jobs: Map<string, Promise<void>>;
  recovered: boolean;
}
const holder = globalThis as { __omniKnowledge?: State };
const state: State = (holder.__omniKnowledge ??= { index: null, jobs: new Map(), recovered: false });

export function invalidateIndex(): void {
  state.index = null;
}

export function describeError(error: unknown): string {
  if (error instanceof OpenRouterError) return userMessageFor(error);
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error && error.name === "AbortError") return "The request was cancelled.";
  console.error("Knowledge base error:", error);
  return "Something went wrong.";
}

async function loadIndex(model: string) {
  if (state.index?.model === model) return state.index.chunks;
  const rows = await prisma.knowledgeChunk.findMany({
    where: { embeddingModel: model, embedding: { not: null }, document: { status: "ready" } },
    select: { id: true, documentId: true, embedding: true },
  });
  const chunks = rows.map((row) => ({ id: row.id, documentId: row.documentId, vector: fromBytes(row.embedding!) }));
  state.index = { model, chunks };
  return chunks;
}

type DocumentRow = Awaited<ReturnType<typeof prisma.knowledgeDocument.findFirstOrThrow>>;

export function serializeDocument(row: DocumentRow): DocumentDto {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind as DocumentKind,
    sourceType: row.sourceType as DocumentDto["sourceType"],
    sourceId: row.sourceId,
    sizeBytes: row.sizeBytes,
    status: row.status,
    error: row.error,
    chunkCount: row.chunkCount,
    embeddedCount: row.embeddedCount,
    tags: row.tags,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function listDocuments(): Promise<DocumentDto[]> {
  void recoverIngests();
  const rows = await prisma.knowledgeDocument.findMany({ orderBy: { createdAt: "desc" }, take: 500 });
  return rows.map(serializeDocument);
}

export async function getDocument(id: string): Promise<{ document: DocumentDto; chunks: ChunkDto[] }> {
  const row = await prisma.knowledgeDocument.findUnique({
    where: { id },
    include: { chunks: { orderBy: { index: "asc" }, select: { id: true, index: true, content: true, heading: true, page: true } } },
  });
  if (!row) throw new ApiError(404, "not_found", "That document no longer exists.");
  const { chunks, ...document } = row;
  return { document: serializeDocument(document as DocumentRow), chunks };
}

export async function deleteDocument(id: string): Promise<void> {
  const result = await prisma.knowledgeDocument.deleteMany({ where: { id } });
  if (result.count === 0) throw new ApiError(404, "not_found", "That document no longer exists.");
  invalidateIndex();
}

export async function updateDocumentTags(id: string, tags: string[]): Promise<DocumentDto> {
  const existing = await prisma.knowledgeDocument.findUnique({ where: { id }, select: { id: true } });
  if (!existing) throw new ApiError(404, "not_found", "That document no longer exists.");
  return serializeDocument(await prisma.knowledgeDocument.update({ where: { id }, data: { tags } }));
}

function cleanName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? name;
  return base.replace(/[\u0000-\u001f]/g, "").trim().slice(0, 200) || "Untitled";
}

function chunkRows(chunks: TextChunk[]) {
  return chunks.map((chunk, index) => ({ index, content: chunk.content, heading: chunk.heading, page: chunk.page }));
}

async function createWithChunks(
  data: Omit<Prisma.KnowledgeDocumentCreateInput, "chunks" | "chunkCount" | "status">,
  chunks: TextChunk[],
  warnings: string[] = [],
): Promise<DocumentDto> {
  if (chunks.length === 0) throw new ApiError(400, "no_text", "No readable text was found.");
  if (chunks.length > MAX_CHUNKS_PER_DOCUMENT) {
    throw new ApiError(400, "too_large", `That would create more than ${MAX_CHUNKS_PER_DOCUMENT.toLocaleString()} searchable pieces. Split it into smaller files.`);
  }
  const row = await prisma.knowledgeDocument.create({
    data: {
      ...data,
      status: "processing",
      chunkCount: chunks.length,
      error: warnings.length ? warnings.join(" ") : null,
      chunks: { create: chunkRows(chunks) },
    },
  });
  invalidateIndex();
  void embedDocument(row.id);
  return serializeDocument(row);
}

export async function addFile(input: { name: string; bytes: Uint8Array; tags?: string[]; signal?: AbortSignal }): Promise<DocumentDto> {
  const name = cleanName(input.name);
  if (input.bytes.byteLength === 0) throw new ApiError(400, "empty_file", "That file is empty.");
  if (input.bytes.byteLength > MAX_UPLOAD_BYTES) {
    throw new ApiError(413, "file_too_large", `Files can be up to ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)} MB.`);
  }
  const kind = detectKind(name);
  if (!kind) throw new ApiError(400, "unsupported_type", `.${extensionOf(name) || "that"} files aren't supported. Try PDF, DOCX, XLSX, CSV, Markdown, text, code, or an image.`);

  try {
    if (kind === "image") {
      const ext = extensionOf(name);
      const mimeType = imageMimeType(name);
      if (!mimeType || !matchesSignature("image", ext, input.bytes)) throw new ApiError(400, "invalid_file", `That doesn't look like a real .${ext} image.`);
      const description = await describeImage({ bytes: input.bytes, mimeType, signal: input.signal });
      return await createWithChunks(
        { name, kind, sourceType: "file", mimeType, sizeBytes: input.bytes.byteLength, tags: input.tags ?? [] },
        chunkText(`# ${name}\n\n${description}`),
        ["The text for this image was written by an AI model and may contain mistakes."],
      );
    }
    const parsed = await parseDocument(name, input.bytes);
    return await createWithChunks(
      { name, kind: parsed.kind, sourceType: "file", sizeBytes: input.bytes.byteLength, tags: input.tags ?? [] },
      parsed.chunks,
      parsed.warnings,
    );
  } catch (error) {
    if (error instanceof ParseError) throw new ApiError(400, "unreadable_file", error.message);
    throw error;
  }
}

export async function addText(input: { name: string; text: string; tags?: string[] }): Promise<DocumentDto> {
  const text = input.text.trim();
  if (!text) throw new ApiError(400, "empty_text", "Paste some text first.");
  if (text.length > MAX_PASTED_CHARS) throw new ApiError(400, "too_long", `Pasted text can be up to ${MAX_PASTED_CHARS.toLocaleString()} characters.`);
  return createWithChunks(
    { name: cleanName(input.name) || "Pasted text", kind: "text", sourceType: "text", sizeBytes: Buffer.byteLength(text), tags: input.tags ?? [] },
    chunkText(text),
  );
}

/** Indexes new and changed notes, and drops entries for notes that were deleted. */
export async function syncNotes(): Promise<{ added: number; updated: number; removed: number }> {
  const [notes, docs] = await Promise.all([
    prisma.note.findMany({ select: { id: true, title: true, content: true, updatedAt: true } }),
    prisma.knowledgeDocument.findMany({ where: { sourceType: "note" }, select: { id: true, sourceId: true, sourceUpdatedAt: true, name: true } }),
  ]);
  const byNote = new Map(docs.map((doc) => [doc.sourceId, doc]));
  let added = 0;
  let updated = 0;

  for (const note of notes) {
    const title = note.title.trim() || "Untitled note";
    const existing = byNote.get(note.id);
    if (existing && existing.sourceUpdatedAt && existing.sourceUpdatedAt >= note.updatedAt && existing.name === title) continue;
    const body = note.content.replace(/<!--[\s\S]*?-->/g, " ").trim();
    const chunks = body ? chunkText(`# ${title}\n\n${body}`) : [];
    if (existing) {
      await prisma.$transaction([
        prisma.knowledgeChunk.deleteMany({ where: { documentId: existing.id } }),
        prisma.knowledgeDocument.update({
          where: { id: existing.id },
          data: {
            name: title,
            status: chunks.length ? "processing" : "ready",
            error: null,
            chunkCount: chunks.length,
            embeddedCount: 0,
            sourceUpdatedAt: note.updatedAt,
            sizeBytes: Buffer.byteLength(body),
            chunks: { create: chunkRows(chunks) },
          },
        }),
      ]);
      updated += 1;
      if (chunks.length) void embedDocument(existing.id);
    } else if (chunks.length) {
      const row = await prisma.knowledgeDocument.create({
        data: {
          name: title,
          kind: "note",
          sourceType: "note",
          sourceId: note.id,
          sizeBytes: Buffer.byteLength(body),
          status: "processing",
          chunkCount: chunks.length,
          sourceUpdatedAt: note.updatedAt,
          chunks: { create: chunkRows(chunks) },
        },
      });
      added += 1;
      void embedDocument(row.id);
    }
  }

  const live = new Set(notes.map((note) => note.id));
  const stale = docs.filter((doc) => doc.sourceId && !live.has(doc.sourceId)).map((doc) => doc.id);
  if (stale.length) await prisma.knowledgeDocument.deleteMany({ where: { id: { in: stale } } });
  invalidateIndex();
  return { added, updated, removed: stale.length };
}

/** Embeds a document's chunks that don't yet have a vector for the current embedding model. Safe to call twice. */
export function embedDocument(documentId: string): Promise<void> {
  const running = state.jobs.get(documentId);
  if (running) return running;
  const job = runEmbedding(documentId).finally(() => state.jobs.delete(documentId));
  state.jobs.set(documentId, job);
  return job;
}

/** Resolves once no embedding job is running. Used by tests to avoid work leaking between them. */
export async function knowledgeIdle(): Promise<void> {
  while (state.jobs.size > 0) await Promise.allSettled([...state.jobs.values()]);
}

async function runEmbedding(documentId: string): Promise<void> {
  try {
    const model = await getEmbeddingModel();
    const document = await prisma.knowledgeDocument.findUnique({ where: { id: documentId }, select: { name: true } });
    if (!document) return;
    for (;;) {
      const pending = await prisma.knowledgeChunk.findMany({
        where: { documentId, OR: [{ embedding: null }, { embeddingModel: { not: model } }] },
        orderBy: { index: "asc" },
        take: 48,
        select: { id: true, content: true, heading: true },
      });
      if (pending.length === 0) break;
      if (!(await prisma.knowledgeDocument.findUnique({ where: { id: documentId }, select: { id: true } }))) return;
      const { vectors } = await embedTexts(
        pending.map((chunk) => `${document.name}${chunk.heading ? ` — ${chunk.heading}` : ""}\n${chunk.content}`),
        { model },
      );
      await prisma.$transaction(
        pending.map((chunk, i) => prisma.knowledgeChunk.update({ where: { id: chunk.id }, data: { embedding: toBytes(vectors[i]), embeddingModel: model } })),
      );
      invalidateIndex();
    }
    const embedded = await prisma.knowledgeChunk.count({ where: { documentId, embeddingModel: model } });
    await prisma.knowledgeDocument.updateMany({ where: { id: documentId }, data: { status: "ready", embeddedCount: embedded, embeddingModel: model } });
    invalidateIndex();
  } catch (error) {
    const reason = describeError(error);
    const embedded = await prisma.knowledgeChunk.count({ where: { documentId, embedding: { not: null } } }).catch(() => 0);
    await prisma.knowledgeDocument
      .updateMany({
        where: { id: documentId },
        data: { status: "ready", embeddedCount: embedded, error: `Meaning-based search is off for this document (${reason}) Keyword search still works. Use Re-index to try again.` },
      })
      .catch(() => undefined);
    invalidateIndex();
  }
}

/** Re-embeds one document, or every document, with the current embedding model. */
export async function reindex(documentId?: string): Promise<number> {
  const docs = await prisma.knowledgeDocument.findMany({ where: documentId ? { id: documentId } : {}, select: { id: true } });
  if (documentId && docs.length === 0) throw new ApiError(404, "not_found", "That document no longer exists.");
  const ids = docs.map((doc) => doc.id);
  await prisma.knowledgeChunk.updateMany({ where: { documentId: { in: ids } }, data: { embedding: null, embeddingModel: null } });
  await prisma.knowledgeDocument.updateMany({ where: { id: { in: ids } }, data: { status: "processing", error: null, embeddedCount: 0 } });
  invalidateIndex();
  for (const id of ids) void embedDocument(id);
  return ids.length;
}

/** Resumes embedding for documents left "processing" by a restart. Runs once per server process. */
export async function recoverIngests(): Promise<void> {
  if (state.recovered) return;
  state.recovered = true;
  const stuck = await prisma.knowledgeDocument.findMany({ where: { status: "processing" }, select: { id: true } });
  for (const doc of stuck) void embedDocument(doc.id);
}

const STOPWORDS = new Set("the and for are but not you all any can had her was one our out has his how its may new now old see two way who did get let put say she too use with that this from have they will your what when where which there their about would could should these those into than then them been being does done each just like make many more most much only other over same some such very also".split(" "));

export function queryTerms(query: string): string[] {
  const words = query.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  return [...new Set(words.filter((word) => (word.length >= 3 || /\d/.test(word)) && !STOPWORDS.has(word)))].slice(0, 12);
}

export function lexicalScore(text: string, terms: string[]): number {
  if (terms.length === 0) return 0;
  const lower = text.toLowerCase();
  return terms.filter((term) => lower.includes(term)).length / terms.length;
}

export interface SearchResult {
  mode: SearchMode;
  hits: SearchHit[];
  /** Why meaning-based search wasn't used, when that's the case. */
  warning: string | null;
}

export async function searchKnowledge(
  query: string,
  options: { k?: number; documentIds?: string[]; signal?: AbortSignal } = {},
): Promise<SearchResult> {
  const k = options.k ?? 6;
  const trimmed = query.trim();
  if (!trimmed) return { mode: "keyword", hits: [], warning: null };
  const scope = options.documentIds?.length ? new Set(options.documentIds) : null;
  const terms = queryTerms(trimmed);

  const model = await getEmbeddingModel();
  const index = (await loadIndex(model)).filter((chunk) => !scope || scope.has(chunk.documentId));

  let mode: SearchMode = "keyword";
  let warning: string | null = null;
  let semantic: { id: string; score: number }[] = [];
  if (index.length > 0) {
    try {
      const {
        vectors: [queryVector],
      } = await embedTexts([trimmed], { model, signal: options.signal });
      semantic = topK(index, (chunk) => dot(queryVector, chunk.vector), 30, MIN_SEMANTIC_SCORE).map(({ item, score }) => ({ id: item.id, score }));
      mode = "semantic";
    } catch (error) {
      if (options.signal?.aborted) throw error;
      warning = `Meaning-based search wasn't available (${describeError(error)}) Showing keyword matches instead.`;
    }
  }

  // Chunks without a vector for this model can only be found by keyword; they rank below semantic matches.
  const keywordWhere: Prisma.KnowledgeChunkWhereInput = {
    ...(scope ? { documentId: { in: [...scope] } } : {}),
    document: { status: "ready" },
    ...(mode === "semantic" ? { OR: [{ embedding: null }, { embeddingModel: { not: model } }] } : {}),
    AND: [{ OR: terms.map((term) => ({ content: { contains: escapeLike(term), mode: "insensitive" as const } })) }],
  };
  const keywordRows = terms.length > 0 ? await prisma.knowledgeChunk.findMany({ where: keywordWhere, take: 300, select: { id: true, content: true } }) : [];
  const keyword = keywordRows
    .map((row) => ({ id: row.id, score: lexicalScore(row.content, terms) * (mode === "semantic" ? KEYWORD_WEIGHT_WHEN_MIXED : 1) }))
    .filter((entry) => entry.score >= (mode === "semantic" ? 0.2 : 0.34));

  const wanted = new Map<string, number>();
  for (const entry of [...semantic, ...keyword]) wanted.set(entry.id, Math.max(wanted.get(entry.id) ?? 0, entry.score));
  if (wanted.size === 0) return { mode, hits: [], warning };

  const rows = await prisma.knowledgeChunk.findMany({
    where: { id: { in: [...wanted.keys()] } },
    select: { id: true, content: true, heading: true, page: true, document: { select: { id: true, name: true, kind: true } } },
  });
  const hits = rows
    .map((row): SearchHit => {
      const base = wanted.get(row.id) ?? 0;
      const isSemantic = semantic.some((entry) => entry.id === row.id);
      // A little credit for exact word matches helps names and numbers that embeddings blur.
      const score = isSemantic ? Math.min(1, base + 0.08 * lexicalScore(row.content, terms)) : base;
      return {
        chunkId: row.id,
        documentId: row.document.id,
        documentName: row.document.name,
        kind: row.document.kind as DocumentKind,
        content: row.content,
        heading: row.heading,
        page: row.page,
        score: Math.round(score * 1000) / 1000,
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
  return { mode, hits, warning };
}

export async function knowledgeStats(): Promise<{ documents: number; chunks: number; embeddedChunks: number; model: string }> {
  const model = await getEmbeddingModel();
  const [documents, chunks, embeddedChunks] = await Promise.all([
    prisma.knowledgeDocument.count(),
    prisma.knowledgeChunk.count(),
    prisma.knowledgeChunk.count({ where: { embeddingModel: model } }),
  ]);
  return { documents, chunks, embeddedChunks, model };
}
