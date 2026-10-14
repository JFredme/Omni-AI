import { ApiError } from "@/lib/api-error";
import { prisma } from "@/lib/db";
import { escapeLike } from "@/lib/search";
import type { Prisma } from "@/generated/prisma/client";
import { makeExcerpt } from "./logic";
import type { FolderDto, NoteDto, NoteFilters, NotesMeta, NoteSummaryDto } from "./types";

type NoteRow = Prisma.NoteGetPayload<object>;

function serializeSummary(row: NoteRow): NoteSummaryDto {
  return {
    id: row.id,
    title: row.title,
    excerpt: makeExcerpt(row.content),
    tags: row.tags,
    pinned: row.pinned,
    folderId: row.folderId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function serializeNote(row: NoteRow): NoteDto {
  return { ...serializeSummary(row), content: row.content };
}

export async function listNotes(filters: NoteFilters = {}): Promise<NoteSummaryDto[]> {
  const and: Prisma.NoteWhereInput[] = [];
  if (filters.folderId) and.push({ folderId: filters.folderId === "none" ? null : filters.folderId });
  if (filters.tag) and.push({ tags: { has: filters.tag.toLowerCase() } });
  if (filters.q) {
    and.push({
      OR: [
        { title: { contains: escapeLike(filters.q), mode: "insensitive" } },
        { content: { contains: escapeLike(filters.q), mode: "insensitive" } },
        { tags: { has: filters.q.toLowerCase().replace(/^#/, "") } },
      ],
    });
  }
  const rows = await prisma.note.findMany({
    where: { AND: and },
    orderBy: [{ pinned: "desc" }, { updatedAt: "desc" }],
    take: 500,
  });
  return rows.map(serializeSummary);
}

export async function getNote(id: string): Promise<NoteDto> {
  const row = await prisma.note.findUnique({ where: { id } });
  if (!row) throw new ApiError(404, "not_found", "That note no longer exists.");
  return serializeNote(row);
}

async function assertFolderExists(folderId: string | null | undefined) {
  if (!folderId) return;
  const folder = await prisma.noteFolder.findUnique({ where: { id: folderId }, select: { id: true } });
  if (!folder) throw new ApiError(400, "folder_not_found", "That folder no longer exists.");
}

export async function createNote(input: {
  title?: string;
  content?: string;
  tags?: string[];
  folderId?: string | null;
}): Promise<NoteDto> {
  await assertFolderExists(input.folderId);
  const row = await prisma.note.create({
    data: {
      title: input.title?.trim() ?? "",
      content: input.content ?? "",
      tags: input.tags ?? [],
      folderId: input.folderId ?? null,
    },
  });
  return serializeNote(row);
}

export async function updateNote(
  id: string,
  patch: { title?: string; content?: string; tags?: string[]; pinned?: boolean; folderId?: string | null },
): Promise<NoteDto> {
  await assertFolderExists(patch.folderId);
  try {
    const row = await prisma.note.update({
      where: { id },
      data: {
        ...(patch.title !== undefined ? { title: patch.title.trim() } : {}),
        ...(patch.content !== undefined ? { content: patch.content } : {}),
        ...(patch.tags !== undefined ? { tags: patch.tags } : {}),
        ...(patch.pinned !== undefined ? { pinned: patch.pinned } : {}),
        ...(patch.folderId !== undefined ? { folderId: patch.folderId } : {}),
      },
    });
    return serializeNote(row);
  } catch (error) {
    if ((error as { code?: string }).code === "P2025") throw new ApiError(404, "not_found", "That note no longer exists.");
    throw error;
  }
}

export async function deleteNote(id: string): Promise<void> {
  const result = await prisma.note.deleteMany({ where: { id } });
  if (result.count === 0) throw new ApiError(404, "not_found", "That note no longer exists.");
}

export async function getNotesMeta(): Promise<NotesMeta> {
  const [folders, notes] = await Promise.all([
    prisma.noteFolder.findMany({ orderBy: { name: "asc" }, include: { _count: { select: { notes: true } } } }),
    prisma.note.findMany({ select: { tags: true, folderId: true } }),
  ]);
  const tagCounts = new Map<string, number>();
  for (const note of notes) for (const tag of note.tags) tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
  return {
    folders: folders.map((folder) => ({ id: folder.id, name: folder.name, noteCount: folder._count.notes })),
    tags: [...tagCounts.entries()].map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag)),
    total: notes.length,
    unfiled: notes.filter((note) => note.folderId === null).length,
  };
}

async function assertFolderNameFree(name: string, exceptId?: string) {
  const clash = await prisma.noteFolder.findFirst({
    where: { name: { equals: name, mode: "insensitive" }, ...(exceptId ? { NOT: { id: exceptId } } : {}) },
    select: { id: true },
  });
  if (clash) throw new ApiError(409, "folder_exists", `A folder named "${name}" already exists.`);
}

export async function createFolder(name: string): Promise<FolderDto> {
  await assertFolderNameFree(name);
  const row = await prisma.noteFolder.create({ data: { name } });
  return { id: row.id, name: row.name, noteCount: 0 };
}

export async function renameFolder(id: string, name: string): Promise<FolderDto> {
  await assertFolderNameFree(name, id);
  try {
    const row = await prisma.noteFolder.update({
      where: { id },
      data: { name },
      include: { _count: { select: { notes: true } } },
    });
    return { id: row.id, name: row.name, noteCount: row._count.notes };
  } catch (error) {
    if ((error as { code?: string }).code === "P2025") throw new ApiError(404, "not_found", "That folder no longer exists.");
    throw error;
  }
}

/** Deleting a folder keeps its notes; they move out of any folder. */
export async function deleteFolder(id: string): Promise<void> {
  const result = await prisma.noteFolder.deleteMany({ where: { id } });
  if (result.count === 0) throw new ApiError(404, "not_found", "That folder no longer exists.");
}
