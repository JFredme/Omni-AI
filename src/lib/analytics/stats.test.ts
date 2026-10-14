import { describe, expect, it } from "vitest";
import { countByDay, lastDays, median, round1, sum, sumByDay } from "./stats";

describe("analytics helpers", () => {
  it("lists the days ending today, oldest first, across month ends", () => {
    expect(lastDays("2026-03-02", 4)).toEqual(["2026-02-27", "2026-02-28", "2026-03-01", "2026-03-02"]);
    expect(lastDays("2026-03-02", 1)).toEqual(["2026-03-02"]);
  });

  it("counts by the day in the viewer's time zone, and ignores days outside the window", () => {
    const keys = ["2026-05-01", "2026-05-02", "2026-05-03"];
    const instants = [new Date("2026-05-02T03:00:00Z"), new Date("2026-05-02T20:00:00Z"), new Date("2026-04-20T12:00:00Z"), new Date("2026-05-04T12:00:00Z")];
    expect(countByDay(instants, keys, "UTC").map((p) => p.value)).toEqual([0, 2, 0]);
    // In Los Angeles, 03:00 UTC on the 2nd is still the evening of the 1st.
    expect(countByDay(instants, keys, "America/Los_Angeles").map((p) => p.value)).toEqual([1, 1, 0]);
  });

  it("adds amounts per day and rounds away floating-point noise", () => {
    const keys = ["2026-05-01", "2026-05-02"];
    const points = sumByDay([{ at: new Date("2026-05-01T10:00:00Z"), amount: 0.1 }, { at: new Date("2026-05-01T11:00:00Z"), amount: 0.2 }, { at: new Date("2026-05-02T11:00:00Z"), amount: 1.5 }], keys, "UTC");
    expect(points).toEqual([{ date: "2026-05-01", value: 0.3 }, { date: "2026-05-02", value: 1.5 }]);
    expect(sum(points)).toBeCloseTo(1.8);
  });

  it("finds a median, and says nothing for no data", () => {
    expect(median([])).toBeNull();
    expect(median([5])).toBe(5);
    expect(median([1, 9, 3])).toBe(3);
    expect(median([1, 2, 3, 10])).toBe(2.5);
    expect(round1(2.449)).toBe(2.4);
  });
});
