import { ApiError } from "@/lib/api-error";
import { prisma } from "@/lib/db";
import { dateKeyToDate, dateToDateKey } from "@/lib/dates";
import { Prisma, type CalendarEvent } from "@/generated/prisma/client";
import { generateIcs, parseIcs, type IcsEvent } from "./ics";
import { expandOccurrences, type Recurrence } from "./recurrence";
import type { CreateEventInput, UpdateEventInput } from "./schemas";
import { dateKeyIn } from "./tz";
import { MAX_EVENT_DAYS, type CalendarRangeDto, type EventDto, type OccurrenceDto } from "./types";

const DAY = 86_400_000;
const MAX_RANGE_DAYS = 400;

type Row = CalendarEvent & { task?: { title: string } | null };

const asRecurrence = (value: unknown): Recurrence | null => (value && typeof value === "object" ? (value as Recurrence) : null);

export function serializeEvent(row: Row): EventDto {
  return {
    id: row.id,
    uid: row.uid,
    title: row.title,
    description: row.description,
    location: row.location,
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt.toISOString(),
    allDay: row.allDay,
    timezone: row.timezone,
    recurrence: asRecurrence(row.recurrence),
    exdates: row.exdates,
    taskId: row.taskId,
    taskTitle: row.task?.title ?? null,
  };
}

/** Turns the form's start/end into stored instants. All-day events are whole UTC dates with an exclusive end. */
export function resolveTimes(input: { allDay: boolean; start: string; end: string }): { startsAt: Date; endsAt: Date } {
  let startsAt: Date;
  let endsAt: Date;
  if (input.allDay) {
    startsAt = dateKeyToDate(input.start);
    endsAt = new Date(dateKeyToDate(input.end).getTime() + DAY);
  } else {
    startsAt = new Date(input.start);
    endsAt = new Date(input.end);
  }
  if (endsAt.getTime() < startsAt.getTime() || (input.allDay && endsAt.getTime() <= startsAt.getTime())) {
    throw new ApiError(400, "invalid_times", "The event can't end before it starts.");
  }
  if (endsAt.getTime() - startsAt.getTime() > MAX_EVENT_DAYS * DAY) {
    throw new ApiError(400, "invalid_times", `Events can be at most ${MAX_EVENT_DAYS} days long.`);
  }
  return { startsAt, endsAt };
}

async function assertTask(taskId: string | null | undefined) {
  if (taskId && !(await prisma.task.findUnique({ where: { id: taskId }, select: { id: true } }))) {
    throw new ApiError(400, "task_not_found", "That task no longer exists.");
  }
}

export async function listRange(from: Date, to: Date): Promise<CalendarRangeDto> {
  if (to <= from) throw new ApiError(400, "invalid_range", "The end of the range must be after its start.");
  if (to.getTime() - from.getTime() > MAX_RANGE_DAYS * DAY) throw new ApiError(400, "range_too_long", `Ask for at most ${MAX_RANGE_DAYS} days at a time.`);

  const rows = await prisma.calendarEvent.findMany({
    where: { OR: [{ recurrence: { not: Prisma.DbNull } }, { startsAt: { lt: to }, endsAt: { gt: from } }, { startsAt: { gte: from, lt: to } }] },
    orderBy: { startsAt: "asc" },
  });

  const occurrences: OccurrenceDto[] = [];
  for (const row of rows) {
    const recurrence = asRecurrence(row.recurrence);
    for (const occurrence of expandOccurrences({ startsAt: row.startsAt, endsAt: row.endsAt, allDay: row.allDay, timezone: row.timezone, recurrence, exdates: row.exdates }, from, to)) {
      occurrences.push({
        eventId: row.id,
        key: occurrence.key,
        title: row.title,
        description: row.description,
        location: row.location,
        start: occurrence.start.toISOString(),
        end: occurrence.end.toISOString(),
        allDay: row.allDay,
        timezone: row.timezone,
        recurring: recurrence !== null,
        taskId: row.taskId,
      });
    }
  }
  occurrences.sort((a, b) => a.start.localeCompare(b.start) || a.title.localeCompare(b.title));

  // Tasks and milestones appear by their due date. A day either side keeps zone differences from dropping edge dates.
  const fromDay = new Date(from.getTime() - DAY);
  const toDay = new Date(to.getTime() + DAY);
  const [tasks, milestones] = await Promise.all([
    prisma.task.findMany({ where: { parentId: null, dueDate: { gte: fromDay, lt: toDay } }, orderBy: [{ dueDate: "asc" }, { priority: "desc" }], take: 500 }),
    prisma.milestone.findMany({ where: { dueDate: { gte: fromDay, lt: toDay } }, include: { project: { select: { name: true } } }, orderBy: { dueDate: "asc" }, take: 200 }),
  ]);
  return {
    occurrences,
    tasks: tasks.map((task) => ({ id: task.id, title: task.title, dueDate: dateToDateKey(task.dueDate)!, priority: task.priority, status: task.status })),
    milestones: milestones.map((m) => ({ id: m.id, title: m.title, dueDate: dateToDateKey(m.dueDate)!, projectId: m.projectId, projectName: m.project.name, completed: m.completedAt !== null })),
  };
}

export async function getEvent(id: string): Promise<EventDto> {
  const row = await prisma.calendarEvent.findUnique({ where: { id }, include: { task: { select: { title: true } } } });
  if (!row) throw new ApiError(404, "not_found", "That event no longer exists.");
  return serializeEvent(row);
}

export async function createEvent(input: CreateEventInput): Promise<EventDto> {
  const { startsAt, endsAt } = resolveTimes(input);
  await assertTask(input.taskId);
  const row = await prisma.calendarEvent.create({
    data: {
      title: input.title,
      description: input.description,
      location: input.location,
      startsAt,
      endsAt,
      allDay: input.allDay,
      timezone: input.timezone,
      recurrence: input.recurrence ? (input.recurrence as unknown as Prisma.InputJsonValue) : undefined,
      taskId: input.taskId,
    },
    include: { task: { select: { title: true } } },
  });
  return serializeEvent(row);
}

export async function updateEvent(id: string, patch: UpdateEventInput, options: { scope: "all" | "this"; occurrence?: string }): Promise<EventDto> {
  const existing = await prisma.calendarEvent.findUnique({ where: { id } });
  if (!existing) throw new ApiError(404, "not_found", "That event no longer exists.");
  await assertTask(patch.taskId);

  const allDay = patch.allDay ?? existing.allDay;
  const touchesTime = patch.start !== undefined || patch.end !== undefined || patch.allDay !== undefined;
  let times: { startsAt: Date; endsAt: Date } | null = null;
  if (touchesTime) {
    const form = (instantValue: Date, isEnd: boolean) =>
      allDay ? dateToDateKey(isEnd ? new Date(instantValue.getTime() - DAY) : instantValue)! : instantValue.toISOString();
    times = resolveTimes({ allDay, start: patch.start ?? form(existing.startsAt, false), end: patch.end ?? form(existing.endsAt, true) });
  }
  const fields = {
    ...(patch.title !== undefined ? { title: patch.title } : {}),
    ...(patch.description !== undefined ? { description: patch.description } : {}),
    ...(patch.location !== undefined ? { location: patch.location } : {}),
    ...(patch.allDay !== undefined ? { allDay: patch.allDay } : {}),
    ...(patch.timezone !== undefined ? { timezone: patch.timezone } : {}),
    ...(patch.taskId !== undefined ? { taskId: patch.taskId } : {}),
    ...(times ?? {}),
  };

  const isSeries = existing.recurrence !== null;
  if (options.scope === "this" && isSeries) {
    if (!options.occurrence) throw new ApiError(400, "occurrence_required", "Say which occurrence to change.");
    const day = dateKeyToDate(options.occurrence);
    const found = expandOccurrences(
      { startsAt: existing.startsAt, endsAt: existing.endsAt, allDay: existing.allDay, timezone: existing.timezone, recurrence: asRecurrence(existing.recurrence), exdates: existing.exdates },
      new Date(day.getTime() - 2 * DAY),
      new Date(day.getTime() + 3 * DAY),
    ).find((occurrence) => occurrence.key === options.occurrence);
    if (!found) throw new ApiError(404, "not_found", "That occurrence no longer exists.");

    // Edit one repeat: remove it from the series and save the changed version as its own event.
    const [, created] = await prisma.$transaction([
      prisma.calendarEvent.update({ where: { id }, data: { exdates: [...new Set([...existing.exdates, options.occurrence])] } }),
      prisma.calendarEvent.create({
        data: {
          title: existing.title,
          description: existing.description,
          location: existing.location,
          startsAt: found.start,
          endsAt: found.end,
          allDay: existing.allDay,
          timezone: existing.timezone,
          taskId: existing.taskId,
          ...fields,
          recurrence: undefined,
        },
        include: { task: { select: { title: true } } },
      }),
    ]);
    return serializeEvent(created);
  }

  const row = await prisma.calendarEvent.update({
    where: { id },
    data: {
      ...fields,
      ...(patch.recurrence !== undefined ? { recurrence: patch.recurrence ? (patch.recurrence as unknown as Prisma.InputJsonValue) : Prisma.DbNull } : {}),
    },
    include: { task: { select: { title: true } } },
  });
  return serializeEvent(row);
}

export async function deleteEvent(id: string, options: { scope: "all" | "this"; occurrence?: string }): Promise<void> {
  const existing = await prisma.calendarEvent.findUnique({ where: { id }, select: { exdates: true, recurrence: true } });
  if (!existing) throw new ApiError(404, "not_found", "That event no longer exists.");
  if (options.scope === "this" && existing.recurrence !== null) {
    if (!options.occurrence) throw new ApiError(400, "occurrence_required", "Say which occurrence to delete.");
    await prisma.calendarEvent.update({ where: { id }, data: { exdates: [...new Set([...existing.exdates, options.occurrence])] } });
    return;
  }
  await prisma.calendarEvent.delete({ where: { id } });
}

export async function exportIcs(): Promise<string> {
  const rows = await prisma.calendarEvent.findMany({ orderBy: { startsAt: "asc" } });
  const events: IcsEvent[] = rows.map((row) => ({
    uid: row.uid,
    title: row.title,
    description: row.description,
    location: row.location,
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    allDay: row.allDay,
    timezone: row.timezone,
    recurrence: asRecurrence(row.recurrence),
    exdates: row.exdates,
  }));
  return generateIcs(events);
}

const MAX_IMPORT_EVENTS = 2_000;

/** Reads an .ics file. Events with a UID already here are updated rather than duplicated. */
export async function importIcs(text: string, defaultZone: string): Promise<{ created: number; updated: number; warnings: string[] }> {
  const parsed = parseIcs(text, defaultZone);
  if (parsed.events.length === 0) throw new ApiError(400, "no_events", parsed.warnings[0] ?? "No events were found in that file.");
  const warnings = [...parsed.warnings];
  const events = parsed.events.slice(0, MAX_IMPORT_EVENTS);
  if (parsed.events.length > MAX_IMPORT_EVENTS) warnings.push(`Only the first ${MAX_IMPORT_EVENTS} events were imported.`);
  let created = 0;
  let updated = 0;
  for (const event of events) {
    const data = {
      title: event.title,
      description: event.description,
      location: event.location,
      startsAt: event.startsAt,
      endsAt: event.endsAt,
      allDay: event.allDay,
      timezone: event.timezone,
      exdates: event.exdates,
    };
    const recurrence = event.recurrence ? (event.recurrence as unknown as Prisma.InputJsonValue) : undefined;
    const existing = await prisma.calendarEvent.findUnique({ where: { uid: event.uid }, select: { id: true } });
    if (existing) {
      await prisma.calendarEvent.update({ where: { id: existing.id }, data: { ...data, recurrence: recurrence ?? Prisma.DbNull } });
      updated += 1;
    } else {
      await prisma.calendarEvent.create({ data: { ...data, uid: event.uid, recurrence } });
      created += 1;
    }
  }
  return { created, updated, warnings };
}

/** Today's date in a zone, for callers that need a default day. */
export function todayIn(timeZone: string, now: Date = new Date()): string {
  return dateKeyIn(now, timeZone);
}
