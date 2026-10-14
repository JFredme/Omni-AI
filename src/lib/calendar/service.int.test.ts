// @vitest-environment node
import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { assertTestDatabase } from "@/test/db-guard";
import { createTask } from "@/lib/tasks/service";
import { createMilestone, createProject } from "@/lib/projects/service";
import { createEventSchema, updateEventSchema } from "./schemas";
import { createEvent, deleteEvent, exportIcs, getEvent, importIcs, listRange, updateEvent } from "./service";

const make = (over: Record<string, unknown> = {}) =>
  createEvent(
    createEventSchema.parse({
      title: "Standup",
      start: "2026-01-05T14:00:00.000Z",
      end: "2026-01-05T14:30:00.000Z",
      timezone: "America/New_York",
      ...over,
    }),
  );
const range = (from: string, to: string) => listRange(new Date(`${from}T00:00:00Z`), new Date(`${to}T00:00:00Z`));
const days = async (from: string, to: string) => (await range(from, to)).occurrences.map((o) => o.key);

beforeEach(async () => {
  assertTestDatabase();
  await prisma.calendarEvent.deleteMany();
  await prisma.task.deleteMany();
  await prisma.milestone.deleteMany();
  await prisma.project.deleteMany();
});

describe("calendar events (database)", () => {
  it("creates, reads, updates and deletes a one-off event", async () => {
    const event = await make({ description: "Daily sync", location: "Room 2" });
    expect(await getEvent(event.id)).toMatchObject({ title: "Standup", location: "Room 2", recurrence: null, allDay: false });
    const changed = await updateEvent(event.id, updateEventSchema.parse({ title: "Standup (moved)", start: "2026-01-05T16:00:00.000Z", end: "2026-01-05T16:15:00.000Z" }), { scope: "all" });
    expect(changed.title).toBe("Standup (moved)");
    expect(changed.startsAt).toBe("2026-01-05T16:00:00.000Z");
    expect(changed.location).toBe("Room 2");
    await deleteEvent(event.id, { scope: "all" });
    await expect(getEvent(event.id)).rejects.toMatchObject({ status: 404 });
  });

  it("shows only events inside the asked range", async () => {
    await make();
    expect(await days("2026-01-01", "2026-02-01")).toEqual(["2026-01-05"]);
    expect(await days("2026-02-01", "2026-03-01")).toEqual([]);
  });

  it("stores all-day events as whole dates with an inclusive last day", async () => {
    const trip = await make({ allDay: true, start: "2026-03-10", end: "2026-03-12", title: "Trip", timezone: "Asia/Tokyo" });
    expect(trip.startsAt).toBe("2026-03-10T00:00:00.000Z");
    expect(trip.endsAt).toBe("2026-03-13T00:00:00.000Z");
    expect((await range("2026-03-01", "2026-04-01")).occurrences).toHaveLength(1);
    expect(await days("2026-03-13", "2026-04-01")).toEqual([]);
    const moved = await updateEvent(trip.id, updateEventSchema.parse({ end: "2026-03-14" }), { scope: "all" });
    expect(moved.endsAt).toBe("2026-03-15T00:00:00.000Z");
  });

  it("expands a weekly series, then edits or removes a single date", async () => {
    const series = await make({ recurrence: { freq: "weekly", interval: 1, byDay: [1, 3] } });
    expect(await days("2026-01-01", "2026-01-15")).toEqual(["2026-01-05", "2026-01-07", "2026-01-12", "2026-01-14"]);

    // Move just the 7th.
    const single = await updateEvent(series.id, updateEventSchema.parse({ title: "Standup (special)", start: "2026-01-07T18:00:00.000Z", end: "2026-01-07T18:30:00.000Z" }), { scope: "this", occurrence: "2026-01-07" });
    expect(single.recurrence).toBeNull();
    let occ = (await range("2026-01-01", "2026-01-15")).occurrences;
    expect(occ.map((o) => `${o.key} ${o.title}`)).toEqual(["2026-01-05 Standup", "2026-01-07 Standup (special)", "2026-01-12 Standup", "2026-01-14 Standup"]);
    expect(occ[1].start).toBe("2026-01-07T18:00:00.000Z");

    // Delete just the 12th.
    await deleteEvent(series.id, { scope: "this", occurrence: "2026-01-12" });
    expect(await days("2026-01-01", "2026-01-15")).toEqual(["2026-01-05", "2026-01-07", "2026-01-14"]);

    // Changing all repeats changes the rest of the series.
    await updateEvent(series.id, updateEventSchema.parse({ title: "Renamed" }), { scope: "all" });
    occ = (await range("2026-01-01", "2026-01-15")).occurrences;
    expect(occ.filter((o) => o.title === "Renamed").map((o) => o.key)).toEqual(["2026-01-05", "2026-01-14"]);
  });

  it("can turn repeating off, and on", async () => {
    const event = await make({ recurrence: { freq: "daily", interval: 1, count: 3 } });
    expect(await days("2026-01-01", "2026-02-01")).toHaveLength(3);
    await updateEvent(event.id, updateEventSchema.parse({ recurrence: null }), { scope: "all" });
    expect(await days("2026-01-01", "2026-02-01")).toEqual(["2026-01-05"]);
    await updateEvent(event.id, updateEventSchema.parse({ recurrence: { freq: "weekly", interval: 2 } }), { scope: "all" });
    expect(await days("2026-01-01", "2026-02-10")).toEqual(["2026-01-05", "2026-01-19", "2026-02-02"]);
  });

  it("deleting a whole series removes every date", async () => {
    const series = await make({ recurrence: { freq: "daily", interval: 1 } });
    await deleteEvent(series.id, { scope: "all" });
    expect(await days("2026-01-01", "2026-02-01")).toEqual([]);
  });

  it("requires an occurrence date when changing one repeat", async () => {
    const series = await make({ recurrence: { freq: "daily", interval: 1 } });
    await expect(updateEvent(series.id, updateEventSchema.parse({ title: "x" }), { scope: "this" })).rejects.toMatchObject({ code: "occurrence_required" });
    await expect(deleteEvent(series.id, { scope: "this" })).rejects.toMatchObject({ code: "occurrence_required" });
    await expect(updateEvent(series.id, updateEventSchema.parse({ title: "x" }), { scope: "this", occurrence: "2020-01-01" })).rejects.toMatchObject({ status: 404 });
  });

  it("rejects bad input", async () => {
    expect(() => createEventSchema.parse({ title: " ", start: "2026-01-05T14:00:00Z", end: "2026-01-05T15:00:00Z" })).toThrow();
    expect(() => createEventSchema.parse({ title: "x", start: "soon", end: "later" })).toThrow();
    expect(() => createEventSchema.parse({ title: "x", allDay: true, start: "2026-01-05T14:00:00Z", end: "2026-01-06" })).toThrow();
    expect(() => createEventSchema.parse({ title: "x", start: "2026-01-05T14:00:00Z", end: "2026-01-05T15:00:00Z", timezone: "Mars/Base" })).toThrow();
    expect(() => createEventSchema.parse({ title: "x", start: "2026-01-05T14:00:00Z", end: "2026-01-05T15:00:00Z", recurrence: { freq: "daily", interval: 1, count: 3, until: "2026-02-01" } })).toThrow();
    expect(() => createEventSchema.parse({ title: "x", start: "2026-01-05T14:00:00Z", end: "2026-01-05T15:00:00Z", recurrence: { freq: "daily", interval: 1, byDay: [1] } })).toThrow();
    await expect(make({ start: "2026-01-05T15:00:00.000Z", end: "2026-01-05T14:00:00.000Z" })).rejects.toMatchObject({ code: "invalid_times" });
    await expect(make({ allDay: true, start: "2026-03-10", end: "2026-03-09" })).rejects.toMatchObject({ code: "invalid_times" });
    await expect(make({ start: "2026-01-01T00:00:00.000Z", end: "2028-01-01T00:00:00.000Z" })).rejects.toMatchObject({ code: "invalid_times" });
    await expect(make({ taskId: "nope" })).rejects.toMatchObject({ code: "task_not_found" });
  });

  it("partial updates leave other fields alone (no schema defaults sneaking in)", async () => {
    const event = await make({ description: "keep me", location: "keep too", recurrence: { freq: "daily", interval: 2 } });
    const changed = await updateEvent(event.id, updateEventSchema.parse({ title: "Only the title" }), { scope: "all" });
    expect(changed).toMatchObject({ title: "Only the title", description: "keep me", location: "keep too", recurrence: { freq: "daily", interval: 2 }, allDay: false, timezone: "America/New_York" });
  });

  it("rejects ranges that are backwards or too long", async () => {
    await expect(range("2026-02-01", "2026-01-01")).rejects.toMatchObject({ code: "invalid_range" });
    await expect(range("2026-01-01", "2028-01-01")).rejects.toMatchObject({ code: "range_too_long" });
  });

  it("shows tasks and milestones by due date alongside events, and links events to tasks", async () => {
    const project = await createProject({ name: "Launch" });
    await createMilestone(project.id, { title: "Beta", dueDate: "2026-01-20" });
    const due = await createTask({ title: "Write copy", dueDate: "2026-01-10", projectId: project.id });
    await createTask({ title: "No date" });
    await createTask({ title: "Out of range", dueDate: "2026-06-01" });
    const linked = await make({ taskId: due.id });
    expect(linked.taskTitle).toBe("Write copy");

    const result = await range("2026-01-01", "2026-02-01");
    expect(result.tasks.map((t) => t.title)).toEqual(["Write copy"]);
    expect(result.milestones).toEqual([expect.objectContaining({ title: "Beta", projectName: "Launch", dueDate: "2026-01-20", completed: false })]);

    await prisma.task.delete({ where: { id: due.id } });
    expect((await getEvent(linked.id)).taskId).toBeNull();
  });
});

describe("calendar import and export (database)", () => {
  it("round-trips through an .ics file without duplicating", async () => {
    await make({ title: "Weekly review", recurrence: { freq: "weekly", interval: 1, count: 4 }, location: "Office; 2nd floor" });
    await make({ title: "Holiday", allDay: true, start: "2026-12-25", end: "2026-12-25" });
    const file = await exportIcs();
    expect(file).toContain("BEGIN:VCALENDAR");
    expect(file).toContain("RRULE:FREQ=WEEKLY;INTERVAL=1;COUNT=4");

    // Importing the same file updates, not duplicates.
    expect(await importIcs(file, "UTC")).toMatchObject({ created: 0, updated: 2 });
    expect(await prisma.calendarEvent.count()).toBe(2);

    // Importing into an empty calendar recreates both.
    await prisma.calendarEvent.deleteMany();
    expect(await importIcs(file, "UTC")).toMatchObject({ created: 2, updated: 0 });
    const review = await prisma.calendarEvent.findFirstOrThrow({ where: { title: "Weekly review" } });
    expect(review.location).toBe("Office; 2nd floor");
    expect(review.recurrence).toMatchObject({ freq: "weekly", count: 4 });
  });

  it("imports a file from another calendar app, with a warning for what it can't honor", async () => {
    const ics = ["BEGIN:VCALENDAR", "BEGIN:VEVENT", "UID:ext-1", "SUMMARY:Imported", "DTSTART:20260601T100000Z", "DTEND:20260601T110000Z", "RRULE:FREQ=MONTHLY;BYSETPOS=1;BYDAY=MO", "END:VEVENT", "END:VCALENDAR"].join("\r\n");
    const result = await importIcs(ics, "Europe/Paris");
    expect(result.created).toBe(1);
    expect(result.warnings.join(" ")).toMatch(/BYSETPOS/);
    expect((await prisma.calendarEvent.findFirstOrThrow()).uid).toBe("ext-1");
  });

  it("refuses a file with no events", async () => {
    await expect(importIcs("hello", "UTC")).rejects.toMatchObject({ code: "no_events" });
    await expect(importIcs("BEGIN:VEVENT\nSUMMARY:No time\nEND:VEVENT", "UTC")).rejects.toMatchObject({ code: "no_events" });
  });
});
