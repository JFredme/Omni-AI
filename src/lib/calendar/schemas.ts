import { z } from "zod";
import { dateKeySchema } from "@/lib/dates";
import { FREQUENCIES } from "./recurrence";
import { isValidTimeZone } from "./tz";

export const recurrenceSchema = z
  .object({
    freq: z.enum(FREQUENCIES),
    interval: z.number().int().min(1).max(99).default(1),
    byDay: z.array(z.number().int().min(0).max(6)).max(7).optional(),
    until: dateKeySchema.optional(),
    count: z.number().int().min(1).max(999).optional(),
  })
  .refine((rule) => !(rule.until && rule.count), { message: "choose either an end date or a number of repeats, not both" })
  .refine((rule) => rule.freq === "weekly" || !rule.byDay?.length, { message: "days of the week only apply to weekly repeats" });

const timezoneSchema = z.string().max(64).refine(isValidTimeZone, { message: "is not a known time zone" });
const instant = z.string().refine((value) => !Number.isNaN(Date.parse(value)), { message: "must be a date and time" });

const eventFields = {
  title: z.string().trim().min(1).max(200),
  description: z.string().max(10_000),
  location: z.string().trim().max(300),
  allDay: z.boolean(),
  /** An ISO date-time for timed events, or YYYY-MM-DD (the first day) for all-day events. */
  start: z.string().min(8).max(40),
  /** An ISO date-time, or YYYY-MM-DD (the last day, inclusive) for all-day events. */
  end: z.string().min(8).max(40),
  timezone: timezoneSchema,
  recurrence: recurrenceSchema.nullable(),
  taskId: z.string().max(60).nullable(),
};

function checkTimes(value: { allDay?: boolean; start?: string; end?: string }, ctx: z.RefinementCtx) {
  if (value.allDay === undefined || value.start === undefined || value.end === undefined) return;
  const ok = value.allDay
    ? dateKeySchema.safeParse(value.start).success && dateKeySchema.safeParse(value.end).success
    : instant.safeParse(value.start).success && instant.safeParse(value.end).success;
  if (!ok) ctx.addIssue({ code: "custom", path: ["start"], message: value.allDay ? "all-day events need dates like 2026-03-01" : "timed events need a date and time" });
}

export const createEventSchema = z
  .object({
    ...eventFields,
    description: eventFields.description.default(""),
    location: eventFields.location.default(""),
    allDay: eventFields.allDay.default(false),
    timezone: eventFields.timezone.default("UTC"),
    recurrence: eventFields.recurrence.default(null),
    taskId: eventFields.taskId.default(null),
  })
  .superRefine(checkTimes);

/** Built from default-free fields so a partial update never resets what it doesn't mention. */
export const updateEventSchema = z.object(eventFields).partial().superRefine(checkTimes);

export const scopeSchema = z.object({
  scope: z.enum(["all", "this"]).default("all"),
  /** The date (YYYY-MM-DD) of the occurrence being changed. Required when scope is "this" for a repeating event. */
  occurrence: dateKeySchema.optional(),
});

export const rangeSchema = z.object({
  from: instant,
  to: instant,
});

export type CreateEventInput = z.infer<typeof createEventSchema>;
export type UpdateEventInput = z.infer<typeof updateEventSchema>;
