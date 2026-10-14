import { z } from "zod";
import { dateKeySchema } from "@/lib/dates";
import { tagsSchema } from "@/lib/tags";
import { DUE_FILTERS, TASK_PRIORITIES, TASK_SORTS, TASK_STATUSES } from "./types";

export const MAX_TASK_TITLE = 200;
export const MAX_TASK_DESCRIPTION = 10_000;

const title = z.string().trim().min(1, "Give the task a title").max(MAX_TASK_TITLE);
const id = z.string().trim().min(1).max(60);

export const createTaskSchema = z.object({
  title,
  description: z.string().max(MAX_TASK_DESCRIPTION).optional(),
  status: z.enum(TASK_STATUSES).optional(),
  priority: z.enum(TASK_PRIORITIES).optional(),
  dueDate: dateKeySchema.nullable().optional(),
  tags: tagsSchema.optional(),
  projectId: id.nullable().optional(),
  milestoneId: id.nullable().optional(),
  parentId: id.nullable().optional(),
});

export const updateTaskSchema = z.object({
  title: title.optional(),
  description: z.string().max(MAX_TASK_DESCRIPTION).optional(),
  status: z.enum(TASK_STATUSES).optional(),
  priority: z.enum(TASK_PRIORITIES).optional(),
  dueDate: dateKeySchema.nullable().optional(),
  tags: tagsSchema.optional(),
  projectId: id.nullable().optional(),
  milestoneId: id.nullable().optional(),
  position: z.number().finite().optional(),
});

export const taskFiltersSchema = z.object({
  q: z.string().trim().max(200).optional(),
  status: z.enum(TASK_STATUSES).optional(),
  priority: z.enum(TASK_PRIORITIES).optional(),
  projectId: id.optional(),
  tag: z.string().trim().max(60).optional(),
  due: z.enum(DUE_FILTERS).optional(),
  sort: z.enum(TASK_SORTS).optional(),
});

export type CreateTaskInput = z.infer<typeof createTaskSchema>;
export type UpdateTaskInput = z.infer<typeof updateTaskSchema>;

/** Reads query-string filters, ignoring empty values. */
export function parseTaskFilters(searchParams: URLSearchParams) {
  const raw: Record<string, string> = {};
  for (const key of ["q", "status", "priority", "projectId", "tag", "due", "sort"]) {
    const value = searchParams.get(key);
    if (value) raw[key] = value;
  }
  return taskFiltersSchema.parse(raw);
}
