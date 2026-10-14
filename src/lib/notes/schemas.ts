import { z } from "zod";
import { tagsSchema } from "@/lib/tags";

export const MAX_NOTE_TITLE = 200;
export const MAX_NOTE_CONTENT = 200_000;
export const MAX_FOLDER_NAME = 60;

const id = z.string().trim().min(1).max(60);

export const createNoteSchema = z.object({
  title: z.string().max(MAX_NOTE_TITLE).optional(),
  content: z.string().max(MAX_NOTE_CONTENT).optional(),
  tags: tagsSchema.optional(),
  folderId: id.nullable().optional(),
});

export const updateNoteSchema = z.object({
  title: z.string().max(MAX_NOTE_TITLE).optional(),
  content: z.string().max(MAX_NOTE_CONTENT).optional(),
  tags: tagsSchema.optional(),
  pinned: z.boolean().optional(),
  folderId: id.nullable().optional(),
});

export const folderSchema = z.object({
  name: z.string().trim().min(1, "Give the folder a name").max(MAX_FOLDER_NAME),
});

export const noteFiltersSchema = z.object({
  q: z.string().trim().max(200).optional(),
  folderId: id.optional(),
  tag: z.string().trim().max(60).optional(),
});

export function parseNoteFilters(searchParams: URLSearchParams) {
  const raw: Record<string, string> = {};
  for (const key of ["q", "folderId", "tag"]) {
    const value = searchParams.get(key);
    if (value) raw[key] = value;
  }
  return noteFiltersSchema.parse(raw);
}
