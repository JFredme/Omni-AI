import { z } from "zod";
import { isValidTimeZone } from "@/lib/calendar/tz";
import { actionById } from "@/lib/integrations/catalog";
import { MIN_INTERVAL_MINUTES } from "./schedule";
import { CONDITION_OPERATORS, EVENT_RANGES, HTTP_METHODS, MAX_STEPS, TASK_FILTERS } from "./types";

const timezone = z.string().max(64).refine(isValidTimeZone, { message: "is not a known time zone" });
const clock = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "must be a time like 08:30");
const text = (max: number) => z.string().max(max);

export const scheduleSchema = z.discriminatedUnion("frequency", [
  z.object({ frequency: z.literal("interval"), everyMinutes: z.number().int().min(MIN_INTERVAL_MINUTES).max(1440), timezone }),
  z.object({ frequency: z.literal("daily"), time: clock, timezone }),
  z.object({ frequency: z.literal("weekly"), time: clock, days: z.array(z.number().int().min(0).max(6)).min(1).max(7), timezone }),
]);

export const triggerSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("schedule"), schedule: scheduleSchema }),
  z.object({ type: z.literal("manual") }),
  z.object({ type: z.literal("task_created") }),
  z.object({ type: z.literal("task_completed") }),
  z.object({ type: z.literal("note_created") }),
  z.object({ type: z.literal("document_added") }),
  z.object({ type: z.literal("webhook") }),
]);

const id = z.string().min(1).max(40);

export const stepSchema = z.discriminatedUnion("type", [
  z.object({ id, type: z.literal("fetch_tasks"), filter: z.enum(TASK_FILTERS) }),
  z.object({ id, type: z.literal("fetch_events"), range: z.enum(EVENT_RANGES), timezone }),
  z.object({ id, type: z.literal("ai_prompt"), prompt: text(8_000).min(1), system: text(2_000).default("") }),
  z.object({
    id,
    type: z.literal("create_task"),
    title: text(300).min(1),
    description: text(5_000).default(""),
    priority: z.enum(["low", "medium", "high", "urgent"]).default("medium"),
    dueInDays: z.number().int().min(0).max(365).nullable().default(null),
    tags: text(200).default(""),
  }),
  z.object({ id, type: z.literal("create_note"), title: text(300).default(""), content: text(50_000).default("") }),
  z.object({
    id,
    type: z.literal("create_event"),
    title: text(300).min(1),
    day: z.enum(["today", "tomorrow"]),
    time: clock,
    durationMinutes: z.number().int().min(5).max(1440),
    timezone,
  }),
  z.object({
    id,
    type: z.literal("http_request"),
    method: z.enum(HTTP_METHODS),
    url: text(2_000).min(1),
    headers: z.array(z.object({ name: text(100).regex(/^[A-Za-z0-9-]+$/, "header names use letters, numbers, and dashes"), value: text(1_000) })).max(8).default([]),
    body: text(20_000).default(""),
    failOnError: z.boolean().default(true),
  }),
  z.object({
    id,
    type: z.literal("integration"),
    action: z.string().max(60).refine((value) => actionById(value) !== undefined, { message: "is not a known action" }),
    params: z.record(z.string().max(60), z.string().max(20_000)).default({}),
  }),
  z.object({ id, type: z.literal("condition"), value: text(2_000), operator: z.enum(CONDITION_OPERATORS), compare: text(1_000).default("") }),
]);

export const stepsSchema = z
  .array(stepSchema)
  .max(MAX_STEPS)
  .superRefine((steps, ctx) => {
    const seen = new Set<string>();
    for (const [index, step] of steps.entries()) {
      if (seen.has(step.id)) ctx.addIssue({ code: "custom", path: [index, "id"], message: "step ids must be unique" });
      seen.add(step.id);
    }
  });

export const createWorkflowSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().max(1_000).default(""),
  trigger: triggerSchema,
  steps: stepsSchema.default([]),
});

/** Built from default-free fields so a partial update never resets what it doesn't mention. */
export const updateWorkflowSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    description: z.string().max(1_000),
    trigger: triggerSchema,
    steps: stepsSchema,
    enabled: z.boolean(),
  })
  .partial();

export type CreateWorkflowInput = z.infer<typeof createWorkflowSchema>;
export type UpdateWorkflowInput = z.infer<typeof updateWorkflowSchema>;
