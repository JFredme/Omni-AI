import { z } from "zod";

export const MAX_TAG_LENGTH = 30;
export const MAX_TAGS = 20;

/** Lower-cases, strips a leading "#", collapses whitespace, and drops empty or duplicate tags. */
export function normalizeTags(tags: readonly string[]): string[] {
  const seen = new Set<string>();
  for (const raw of tags) {
    const tag = raw.trim().replace(/^#+/, "").replace(/\s+/g, "-").toLowerCase().slice(0, MAX_TAG_LENGTH);
    if (tag) seen.add(tag);
    if (seen.size >= MAX_TAGS) break;
  }
  return [...seen];
}

export const tagsSchema = z
  .array(z.string().max(MAX_TAG_LENGTH * 2))
  .max(MAX_TAGS * 2)
  .transform(normalizeTags);

/** Splits free text such as "work, #urgent  home" into tags. */
export function parseTagInput(text: string): string[] {
  return normalizeTags(text.split(/[,\n]/));
}
