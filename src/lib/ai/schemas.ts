import { z } from "zod";
import { dateKeySchema } from "@/lib/dates";
import { isValidTimeZone } from "@/lib/calendar/tz";
import { tagsSchema } from "@/lib/tags";
import { TASK_PRIORITIES } from "@/lib/tasks/types";

const id = z.string().trim().min(1).max(60);
const modelId = z.string().trim().min(1).max(200).optional();

/* ---------- requests: ask the assistant for a proposal ---------- */

export const proposeSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("project_plan"),
    projectId: id,
    mode: z.enum(["tasks", "plan"]),
    goal: z.string().trim().max(2_000).optional(),
    modelId,
  }),
  z.object({ kind: z.literal("note_summary"), noteId: id, modelId }),
  z.object({ kind: z.literal("task_priorities"), taskIds: z.array(id).max(60).optional(), modelId }),
  z.object({ kind: z.literal("organize_tasks"), modelId }),
  z.object({ kind: z.literal("organize_notes"), modelId }),
  z.object({
    kind: z.literal("schedule_tasks"),
    from: dateKeySchema,
    days: z.number().int().min(1).max(14).default(5),
    timezone: z.string().max(64).refine(isValidTimeZone, { message: "is not a known time zone" }),
    workStart: z.string().max(5).default("09:00"),
    workEnd: z.string().max(5).default("17:00"),
    taskIds: z.array(id).max(30).optional(),
    modelId,
  }),
]);

export type ProposeRequest = z.infer<typeof proposeSchema>;

/* ---------- requests: apply what the user confirmed ---------- */

const planTask = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().max(5_000).default(""),
  priority: z.enum(TASK_PRIORITIES).default("medium"),
  dueDate: dateKeySchema.nullable().default(null),
  milestone: z.string().trim().max(160).nullable().default(null),
  tags: tagsSchema.default([]),
  subtasks: z.array(z.string().trim().min(1).max(200)).max(12).default([]),
});

export const applySchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("project_plan"),
    projectId: id,
    milestones: z
      .array(z.object({ title: z.string().trim().min(1).max(160), dueDate: dateKeySchema.nullable().default(null) }))
      .max(20),
    tasks: z.array(planTask).max(60),
  }),
  z.object({
    kind: z.literal("task_priorities"),
    changes: z.array(z.object({ taskId: id, priority: z.enum(TASK_PRIORITIES) })).min(1).max(100),
  }),
  z.object({
    kind: z.literal("organize_tasks"),
    changes: z
      .array(z.object({ taskId: id, projectId: id.nullable().default(null), addTags: tagsSchema.default([]) }))
      .min(1)
      .max(100),
  }),
  z.object({
    kind: z.literal("schedule_tasks"),
    timezone: z.string().max(64).refine(isValidTimeZone, { message: "is not a known time zone" }),
    blocks: z
      .array(
        z.object({
          taskId: id,
          start: z.string().refine((value) => !Number.isNaN(Date.parse(value)), { message: "must be a date and time" }),
          end: z.string().refine((value) => !Number.isNaN(Date.parse(value)), { message: "must be a date and time" }),
        }),
      )
      .min(1)
      .max(40),
  }),
  z.object({
    kind: z.literal("organize_notes"),
    changes: z
      .array(
        z.object({
          noteId: id,
          folder: z.string().trim().min(1).max(60).nullable().default(null),
          addTags: tagsSchema.default([]),
        }),
      )
      .min(1)
      .max(100),
  }),
]);

export type ApplyRequest = z.infer<typeof applySchema>;

/* ---------- what the model is asked to return (lenient; sanitized afterwards) ---------- */

const text = z.string().nullish();
const textList = z.array(z.string()).nullish();

export const planOutputSchema = z.object({
  summary: text,
  milestones: z.array(z.object({ title: z.string(), dueDate: text })).nullish(),
  tasks: z
    .array(
      z.object({
        title: z.string(),
        description: text,
        priority: text,
        dueDate: text,
        milestone: text,
        tags: textList,
        subtasks: textList,
      }),
    )
    .nullish(),
});

export const summaryOutputSchema = z.object({ summary: z.string(), keyPoints: textList, suggestedTags: textList });

export const prioritiesOutputSchema = z.object({
  summary: text,
  suggestions: z.array(z.object({ taskId: z.string(), priority: z.string(), reason: text })).nullish(),
});

export const organizeTasksOutputSchema = z.object({
  summary: text,
  suggestions: z
    .array(z.object({ taskId: z.string(), projectId: text, addTags: textList, reason: text }))
    .nullish(),
});

export const organizeNotesOutputSchema = z.object({
  summary: text,
  suggestions: z.array(z.object({ noteId: z.string(), folder: text, addTags: textList, reason: text })).nullish(),
});

export type PlanOutput = z.infer<typeof planOutputSchema>;
export type SummaryOutput = z.infer<typeof summaryOutputSchema>;
export type PrioritiesOutput = z.infer<typeof prioritiesOutputSchema>;
export type OrganizeTasksOutput = z.infer<typeof organizeTasksOutputSchema>;
export type OrganizeNotesOutput = z.infer<typeof organizeNotesOutputSchema>;
