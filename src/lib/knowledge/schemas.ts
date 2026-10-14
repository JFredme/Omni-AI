import { z } from "zod";
import { tagsSchema } from "@/lib/tags";
import { MAX_MEMORY_CHARS, MAX_PASTED_CHARS } from "./types";

export const pasteSchema = z.object({
  name: z.string().trim().max(200).default("Pasted text"),
  text: z.string().max(MAX_PASTED_CHARS * 2),
  tags: tagsSchema.optional(),
});

export const searchSchema = z.object({
  query: z.string().trim().min(1).max(1_000),
  k: z.number().int().min(1).max(20).optional(),
  documentIds: z.array(z.string().max(60)).max(100).optional(),
});

export const knowledgeSettingsSchema = z.object({
  embeddingModelId: z.string().trim().min(1).max(200).nullable().optional(),
  memoryEnabled: z.boolean().optional(),
});

export const memorySchema = z.object({ content: z.string().max(MAX_MEMORY_CHARS * 2) });
