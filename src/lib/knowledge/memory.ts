import { ApiError } from "@/lib/api-error";
import { prisma } from "@/lib/db";
import { embedTexts, getEmbeddingModel } from "./embed";
import { describeError, lexicalScore, queryTerms } from "./service";
import { MAX_MEMORY_CHARS, type MemoryDto } from "./types";
import { dot, fromBytes, toBytes } from "./vectors";

const MIN_SEMANTIC_SCORE = 0.3;
const MAX_MEMORIES = 2_000;

type Row = Awaited<ReturnType<typeof prisma.memory.findFirstOrThrow>>;

function serialize(row: Row): MemoryDto {
  return { id: row.id, content: row.content, source: row.source as MemoryDto["source"], createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() };
}

export async function listMemories(): Promise<MemoryDto[]> {
  return (await prisma.memory.findMany({ orderBy: { createdAt: "desc" }, take: MAX_MEMORIES })).map(serialize);
}

async function embedInto(id: string, content: string): Promise<void> {
  try {
    const {
      vectors: [vector],
      model,
    } = await embedTexts([content]);
    await prisma.memory.updateMany({ where: { id }, data: { embedding: toBytes(vector), embeddingModel: model } });
  } catch (error) {
    // The memory is saved either way; without a vector it is found by keyword.
    console.warn("Memory saved without an embedding:", describeError(error));
  }
}

export async function createMemory(input: { content: string; source?: MemoryDto["source"] }): Promise<MemoryDto> {
  const content = input.content.trim();
  if (!content) throw new ApiError(400, "empty_memory", "Write something to remember.");
  if (content.length > MAX_MEMORY_CHARS) throw new ApiError(400, "memory_too_long", `A memory can be up to ${MAX_MEMORY_CHARS.toLocaleString()} characters.`);
  if ((await prisma.memory.count()) >= MAX_MEMORIES) throw new ApiError(400, "too_many_memories", "You've reached the memory limit. Delete some first.");
  const duplicate = await prisma.memory.findFirst({ where: { content: { equals: content, mode: "insensitive" } } });
  if (duplicate) return serialize(duplicate);
  const row = await prisma.memory.create({ data: { content, source: input.source ?? "user" } });
  await embedInto(row.id, content);
  return serialize(row);
}

export async function updateMemory(id: string, content: string): Promise<MemoryDto> {
  const trimmed = content.trim();
  if (!trimmed) throw new ApiError(400, "empty_memory", "Write something to remember.");
  if (trimmed.length > MAX_MEMORY_CHARS) throw new ApiError(400, "memory_too_long", `A memory can be up to ${MAX_MEMORY_CHARS.toLocaleString()} characters.`);
  const existing = await prisma.memory.findUnique({ where: { id }, select: { id: true } });
  if (!existing) throw new ApiError(404, "not_found", "That memory no longer exists.");
  const row = await prisma.memory.update({ where: { id }, data: { content: trimmed, embedding: null, embeddingModel: null } });
  await embedInto(id, trimmed);
  return serialize(row);
}

export async function deleteMemory(id: string): Promise<void> {
  const result = await prisma.memory.deleteMany({ where: { id } });
  if (result.count === 0) throw new ApiError(404, "not_found", "That memory no longer exists.");
}

export async function clearMemories(): Promise<number> {
  return (await prisma.memory.deleteMany()).count;
}

export interface MemoryHit extends MemoryDto {
  score: number;
}

export async function searchMemories(query: string, options: { k?: number; signal?: AbortSignal } = {}): Promise<{ hits: MemoryHit[]; mode: "semantic" | "keyword" }> {
  const k = options.k ?? 5;
  const trimmed = query.trim();
  if (!trimmed) return { hits: [], mode: "keyword" };
  const rows = await prisma.memory.findMany({ take: MAX_MEMORIES });
  if (rows.length === 0) return { hits: [], mode: "keyword" };
  const model = await getEmbeddingModel();
  const terms = queryTerms(trimmed);

  const embedded = rows.filter((row) => row.embedding && row.embeddingModel === model);
  if (embedded.length > 0) {
    try {
      const {
        vectors: [queryVector],
      } = await embedTexts([trimmed], { model, signal: options.signal });
      const semantic = embedded
        .map((row) => ({ row, score: dot(queryVector, fromBytes(row.embedding!)) + 0.08 * lexicalScore(row.content, terms) }))
        .filter((entry) => entry.score >= MIN_SEMANTIC_SCORE);
      // Memories without a vector are still found by keyword, ranked lower.
      const loose = rows
        .filter((row) => !(row.embedding && row.embeddingModel === model))
        .map((row) => ({ row, score: lexicalScore(row.content, terms) * 0.5 }))
        .filter((entry) => entry.score >= 0.2);
      return { mode: "semantic", hits: [...semantic, ...loose].sort((a, b) => b.score - a.score).slice(0, k).map(({ row, score }) => ({ ...serialize(row), score: Math.min(1, Math.round(score * 1000) / 1000) })) };
    } catch (error) {
      if (options.signal?.aborted) throw error;
      // Fall through to keyword matching.
    }
  }
  const keyword = rows
    .map((row) => ({ row, score: lexicalScore(row.content, terms) }))
    .filter((entry) => entry.score >= 0.34)
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
  return { mode: "keyword", hits: keyword.map(({ row, score }) => ({ ...serialize(row), score: Math.round(score * 1000) / 1000 })) };
}

export async function getMemorySettings(): Promise<{ enabled: boolean }> {
  const settings = await prisma.appSettings.findUnique({ where: { id: 1 }, select: { memoryEnabled: true } });
  return { enabled: settings?.memoryEnabled ?? true };
}

export async function setMemoryEnabled(enabled: boolean): Promise<void> {
  await prisma.appSettings.upsert({ where: { id: 1 }, update: { memoryEnabled: enabled }, create: { id: 1, memoryEnabled: enabled } });
}
