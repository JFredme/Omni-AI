import { describe, expect, it } from "vitest";
import { dateKeyIn, isValidTimeZone, zonedParts, zonedToUtc } from "./tz";

describe("time zones", () => {
  it("reads the wall clock in a zone", () => {
    expect(zonedParts(new Date("2026-01-15T12:00:00Z"), "America/New_York")).toMatchObject({ year: 2026, month: 1, day: 15, hour: 7 });
    expect(zonedParts(new Date("2026-07-15T12:00:00Z"), "America/New_York")).toMatchObject({ hour: 8 });
    expect(zonedParts(new Date("2026-03-01T00:30:00Z"), "Asia/Tokyo")).toMatchObject({ day: 1, hour: 9, minute: 30 });
  });

  it("turns a wall-clock time back into an instant, either side of daylight saving", () => {
    const p = (month: number, day: number, hour: number) => ({ year: 2026, month, day, hour, minute: 0, second: 0 });
    expect(zonedToUtc(p(1, 15, 9), "America/New_York").toISOString()).toBe("2026-01-15T14:00:00.000Z");
    expect(zonedToUtc(p(7, 15, 9), "America/New_York").toISOString()).toBe("2026-07-15T13:00:00.000Z");
    expect(zonedToUtc(p(7, 15, 9), "UTC").toISOString()).toBe("2026-07-15T09:00:00.000Z");
  });

  it("handles the spring-forward gap and the fall-back repeat", () => {
    // 2026-03-08 02:30 doesn't exist in New York; 2026-11-01 01:30 happens twice.
    const gap = zonedToUtc({ year: 2026, month: 3, day: 8, hour: 2, minute: 30, second: 0 }, "America/New_York");
    expect(zonedParts(gap, "America/New_York").hour).toBeGreaterThanOrEqual(3);
    const repeat = zonedToUtc({ year: 2026, month: 11, day: 1, hour: 1, minute: 30, second: 0 }, "America/New_York");
    expect(zonedParts(repeat, "America/New_York")).toMatchObject({ day: 1, hour: 1, minute: 30 });
  });

  it("finds the local date of an instant", () => {
    expect(dateKeyIn(new Date("2026-05-01T02:00:00Z"), "America/Los_Angeles")).toBe("2026-04-30");
    expect(dateKeyIn(new Date("2026-05-01T02:00:00Z"), "Pacific/Auckland")).toBe("2026-05-01");
  });

  it("validates zone names", () => {
    expect(isValidTimeZone("Europe/Paris")).toBe(true);
    expect(isValidTimeZone("Mars/Olympus")).toBe(false);
  });
});
