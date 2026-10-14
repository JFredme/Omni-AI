// @vitest-environment node
import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { assertTestDatabase } from "@/test/db-guard";
import { getDashboard } from "./dashboard";

beforeEach(async () => {
  assertTestDatabase();
  await prisma.calendarEvent.deleteMany();
  await prisma.task.deleteMany();
});

describe("dashboard week strip (database)", () => {
  it("counts what is due and scheduled on each of the next seven days, and keeps today's list to today", async () => {
    await prisma.task.createMany({
      data: [
        { title: "today", dueDate: new Date("2026-05-20") },
        { title: "tomorrow a", dueDate: new Date("2026-05-21") },
        { title: "tomorrow b", dueDate: new Date("2026-05-21") },
        { title: "finished", dueDate: new Date("2026-05-21"), status: "done" },
        { title: "too far", dueDate: new Date("2026-05-30") },
      ],
    });
    await prisma.calendarEvent.create({ data: { title: "Standup", startsAt: new Date("2026-05-20T13:00:00Z"), endsAt: new Date("2026-05-20T13:30:00Z") } });
    await prisma.calendarEvent.create({ data: { title: "Dentist", startsAt: new Date("2026-05-22T14:00:00Z"), endsAt: new Date("2026-05-22T15:00:00Z") } });

    const { week, events } = await getDashboard("2026-05-20", "UTC");
    expect(week.map((d) => d.date)).toEqual(["2026-05-20", "2026-05-21", "2026-05-22", "2026-05-23", "2026-05-24", "2026-05-25", "2026-05-26"]);
    expect(week[0]).toEqual({ date: "2026-05-20", tasksDue: 1, events: 1 });
    expect(week[1]).toEqual({ date: "2026-05-21", tasksDue: 2, events: 0 });
    expect(week[2]).toEqual({ date: "2026-05-22", tasksDue: 0, events: 1 });
    expect(week.reduce((sum, d) => sum + d.tasksDue, 0)).toBe(3);
    expect(events.map((e) => e.title)).toEqual(["Standup"]);
  });

  it("puts an event on the day it falls on in the viewer's time zone", async () => {
    // 03:30 UTC on the 21st is still the evening of the 20th in Los Angeles.
    await prisma.calendarEvent.create({ data: { title: "Late", startsAt: new Date("2026-05-21T03:30:00Z"), endsAt: new Date("2026-05-21T04:00:00Z") } });
    const la = await getDashboard("2026-05-20", "America/Los_Angeles");
    expect(la.week[0].events).toBe(1);
    expect(la.week[1].events).toBe(0);
    const utc = await getDashboard("2026-05-20", "UTC");
    expect(utc.week[0].events).toBe(0);
    expect(utc.week[1].events).toBe(1);
  });
});
