import { z } from "zod";
import { zonedToUtc } from "@/lib/calendar/tz";
import { addDays, isDateKey } from "@/lib/dates";
import type { TaskPriority } from "@/lib/tasks/types";
import type { ScheduleBlock } from "./types";

export const MAX_SCHEDULE_TASKS = 30;
export const MIN_BLOCK_MINUTES = 15;
export const MAX_BLOCK_MINUTES = 240;

export const scheduleOutputSchema = z.object({
  summary: z.string().nullish(),
  blocks: z
    .array(z.object({ taskId: z.string(), date: z.string(), start: z.string(), minutes: z.union([z.number(), z.string()]), reason: z.string().nullish() }))
    .nullish(),
});
export type ScheduleOutput = z.infer<typeof scheduleOutputSchema>;

export interface ScheduleContext {
  tasks: { id: string; title: string; priority: TaskPriority; dueDate: string | null }[];
  /** Times already taken (timed events). */
  busy: { start: Date; end: Date }[];
  from: string;
  days: number;
  timezone: string;
  /** Minutes from midnight. */
  workStart: number;
  workEnd: number;
  now: Date;
}

const clean = (value: string | null | undefined, max: number) => (value ?? "").replace(/\s+/g, " ").trim().slice(0, max);

export function parseClock(value: string): number | null {
  const match = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(value.trim());
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

const overlaps = (a: { start: Date; end: Date }, b: { start: Date; end: Date }) => a.start < b.end && b.start < a.end;

/**
 * Turns the model's suggested blocks into ones that are safe to offer: real tasks, inside the window and working
 * hours, in the future, and never on top of existing events or each other. A block that clashes is nudged later the
 * same day if there's room, and dropped if not.
 */
export function sanitizeSchedule(raw: ScheduleOutput, context: ScheduleContext): { summary: string; blocks: ScheduleBlock[]; dropped: number } {
  const known = new Map(context.tasks.map((task) => [task.id, task]));
  const lastDay = addDays(context.from, context.days - 1);
  const taken = [...context.busy];
  const seen = new Set<string>();
  const blocks: ScheduleBlock[] = [];
  let dropped = 0;

  const toInstant = (date: string, minute: number) => {
    const [year, month, day] = date.split("-").map(Number);
    return zonedToUtc({ year, month, day, hour: Math.floor(minute / 60), minute: minute % 60, second: 0 }, context.timezone);
  };

  for (const item of raw.blocks ?? []) {
    const task = known.get(item.taskId.trim());
    const date = item.date.trim();
    const startMinute = parseClock(item.start);
    const requested = Number(item.minutes);
    if (!task || seen.has(task.id) || !isDateKey(date) || date < context.from || date > lastDay || startMinute === null || !Number.isFinite(requested)) {
      dropped += 1;
      continue;
    }
    const minutes = Math.min(MAX_BLOCK_MINUTES, Math.max(MIN_BLOCK_MINUTES, Math.round(requested / 5) * 5));
    let placed: { start: Date; end: Date } | null = null;
    for (let at = Math.max(startMinute, context.workStart); at + minutes <= context.workEnd; at += 15) {
      const candidate = { start: toInstant(date, at), end: toInstant(date, at + minutes) };
      if (candidate.start < context.now) continue;
      if (taken.some((other) => overlaps(candidate, other))) continue;
      placed = candidate;
      break;
    }
    if (!placed) {
      dropped += 1;
      continue;
    }
    seen.add(task.id);
    taken.push(placed);
    blocks.push({ taskId: task.id, title: task.title, priority: task.priority, dueDate: task.dueDate, start: placed.start.toISOString(), end: placed.end.toISOString(), reason: clean(item.reason, 300) });
  }
  blocks.sort((a, b) => a.start.localeCompare(b.start));
  return { summary: clean(raw.summary, 1_000), blocks, dropped };
}
