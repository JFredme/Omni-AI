import { z, type ZodType } from "zod";
import type { ActionInfo } from "./catalog";

/** The rules for each field, beyond "it's text": a repository looks like owner/name, an email looks like an email. */
const SPECIFIC: Record<string, ZodType<unknown>> = {
  repo: z.string().trim().regex(/^[\w.-]{1,100}\/[\w.-]{1,100}$/, "must look like owner/name"),
  to: z.string().trim().max(320).regex(/^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/, "must be one email address"),
  parentPageId: z.string().trim().regex(/^[0-9a-fA-F-]{32,36}$/, "must be a Notion page ID"),
  fileId: z.string().trim().regex(/^[\w-]{8,120}$/, "must be a Drive file ID"),
  id: z.string().trim().regex(/^[\w-]{1,40}$/, "must be a task ID"),
  state: z.enum(["open", "closed", "all"]),
  number: z.coerce.number().int().min(1).max(10_000_000),
  limit: z.coerce.number().int().min(1).max(25),
  days: z.coerce.number().int().min(1).max(90),
};

export function paramsSchema(action: ActionInfo): ZodType<Record<string, unknown>> {
  const shape: Record<string, ZodType<unknown>> = {};
  for (const field of action.fields) {
    const base: ZodType<unknown> = SPECIFIC[field.name] ?? (field.kind === "textarea" ? z.string().max(20_000) : z.string().trim().max(2_000));
    if (field.required) shape[field.name] = base;
    else shape[field.name] = z.preprocess((value) => (value === "" || value === null ? undefined : value), base.optional());
  }
  return z.object(shape).strip() as unknown as ZodType<Record<string, unknown>>;
}
