import { describe, expect, it } from "vitest";
import { addDays, dateKeyToDate, dateToDateKey, dueState, isDateKey, localDateKey } from "./dates";

describe("dates", () => {
  it("accepts only real calendar dates", () => {
    expect(isDateKey("2026-02-28")).toBe(true);
    expect(isDateKey("2028-02-29")).toBe(true);
    expect(isDateKey("2026-02-29")).toBe(false);
    expect(isDateKey("2026-13-01")).toBe(false);
    expect(isDateKey("2026-1-1")).toBe(false);
    expect(isDateKey("tomorrow")).toBe(false);
  });

  it("round-trips date keys without shifting the day", () => {
    expect(dateToDateKey(dateKeyToDate("2026-03-01"))).toBe("2026-03-01");
    expect(dateToDateKey(null)).toBeNull();
  });

  it("adds days across month and year boundaries", () => {
    expect(addDays("2026-12-30", 3)).toBe("2027-01-02");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });

  it("formats the local date, not the UTC date", () => {
    expect(localDateKey(new Date(2026, 0, 5, 23, 30))).toBe("2026-01-05");
  });

  it("classifies due dates relative to today", () => {
    const today = "2026-06-10";
    expect(dueState(null, today)).toBeNull();
    expect(dueState("2026-06-09", today)).toBe("overdue");
    expect(dueState("2026-06-10", today)).toBe("today");
    expect(dueState("2026-06-13", today)).toBe("soon");
    expect(dueState("2026-06-14", today)).toBe("later");
  });
});
