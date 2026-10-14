import { describe, expect, it } from "vitest";
import { layoutLanes, monthGrid, occurrenceDays, rangeForView, shiftMonth, startOfWeek, weekDays } from "./view";

describe("calendar view helpers", () => {
  it("finds the week, starting on Sunday", () => {
    expect(startOfWeek("2026-01-07")).toBe("2026-01-04");
    expect(weekDays("2026-01-04")).toEqual(["2026-01-04", "2026-01-05", "2026-01-06", "2026-01-07", "2026-01-08", "2026-01-09", "2026-01-10"]);
  });

  it("builds a six-week month grid that includes the neighbouring days", () => {
    const grid = monthGrid("2026-02-14");
    expect(grid).toHaveLength(6);
    expect(grid.every((week) => week.length === 7)).toBe(true);
    expect(grid[0][0]).toBe("2026-02-01"); // Feb 1, 2026 is a Sunday
    expect(grid[5][6]).toBe("2026-03-14");
    const jan = monthGrid("2026-01-15");
    expect(jan[0][0]).toBe("2025-12-28");
    expect(jan.flat()).toContain("2026-01-31");
  });

  it("moves between months, across year ends", () => {
    expect(shiftMonth("2026-01-15", -1)).toBe("2025-12-01");
    expect(shiftMonth("2026-12-31", 1)).toBe("2027-01-01");
    expect(shiftMonth("2026-03-31", 12)).toBe("2027-03-01");
  });

  it("covers exactly the days a view shows, in the viewer's zone", () => {
    const week = rangeForView("week", "2026-01-07", "America/New_York");
    expect(week.from.toISOString()).toBe("2026-01-04T05:00:00.000Z");
    expect(week.to.toISOString()).toBe("2026-01-11T05:00:00.000Z");
    const agenda = rangeForView("agenda", "2026-03-01", "UTC");
    expect(agenda.to.getTime() - agenda.from.getTime()).toBe(30 * 86_400_000);
    const month = rangeForView("month", "2026-02-14", "UTC");
    expect(month.to.getTime() - month.from.getTime()).toBe(42 * 86_400_000);
  });

  it("puts a timed event on the day it starts in the viewer's zone, and all-day events on each of their days", () => {
    expect(occurrenceDays({ start: "2026-05-01T02:00:00.000Z", end: "2026-05-01T03:00:00.000Z", allDay: false }, "America/Los_Angeles")).toEqual(["2026-04-30"]);
    expect(occurrenceDays({ start: "2026-03-10T00:00:00.000Z", end: "2026-03-13T00:00:00.000Z", allDay: true }, "Asia/Tokyo")).toEqual(["2026-03-10", "2026-03-11", "2026-03-12"]);
  });

  it("lays overlapping blocks side by side and gives separate ones the full width", () => {
    const lanes = layoutLanes([
      { id: "a", start: 540, end: 600 },
      { id: "b", start: 570, end: 660 },
      { id: "c", start: 580, end: 620 },
      { id: "d", start: 700, end: 760 },
    ]);
    expect(lanes.get("a")).toEqual({ lane: 0, lanes: 3 });
    expect(lanes.get("b")).toEqual({ lane: 1, lanes: 3 });
    expect(lanes.get("c")).toEqual({ lane: 2, lanes: 3 });
    expect(lanes.get("d")).toEqual({ lane: 0, lanes: 1 });
    expect(layoutLanes([]).size).toBe(0);
  });
});
