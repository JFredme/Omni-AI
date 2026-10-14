import { describe, expect, it } from "vitest";
import { describeSchedule, nextRunAfter } from "./schedule";

describe("nextRunAfter", () => {
  it("adds the interval, never less than five minutes", () => {
    const after = new Date("2026-03-01T10:00:00Z");
    expect(nextRunAfter({ frequency: "interval", everyMinutes: 30, timezone: "UTC" }, after).toISOString()).toBe("2026-03-01T10:30:00.000Z");
    expect(nextRunAfter({ frequency: "interval", everyMinutes: 1, timezone: "UTC" }, after).toISOString()).toBe("2026-03-01T10:05:00.000Z");
  });

  it("runs daily at a local time, today if it's still ahead and tomorrow if not", () => {
    const spec = { frequency: "daily" as const, time: "08:00", timezone: "America/New_York" };
    expect(nextRunAfter(spec, new Date("2026-01-15T10:00:00Z")).toISOString()).toBe("2026-01-15T13:00:00.000Z"); // 05:00 local → 08:00 local today
    expect(nextRunAfter(spec, new Date("2026-01-15T14:00:00Z")).toISOString()).toBe("2026-01-16T13:00:00.000Z"); // 09:00 local → tomorrow
    // Exactly at the time counts as passed.
    expect(nextRunAfter(spec, new Date("2026-01-15T13:00:00Z")).toISOString()).toBe("2026-01-16T13:00:00.000Z");
  });

  it("keeps the local time across daylight saving", () => {
    const spec = { frequency: "daily" as const, time: "08:00", timezone: "America/New_York" };
    expect(nextRunAfter(spec, new Date("2026-03-07T14:00:00Z")).toISOString()).toBe("2026-03-08T12:00:00.000Z"); // clocks change on the 8th
  });

  it("runs weekly on the chosen days only", () => {
    const spec = { frequency: "weekly" as const, time: "09:00", days: [1, 5], timezone: "UTC" }; // Mon, Fri
    expect(nextRunAfter(spec, new Date("2026-03-02T10:00:00Z")).toISOString()).toBe("2026-03-06T09:00:00.000Z"); // Monday after 09:00 → Friday
    expect(nextRunAfter(spec, new Date("2026-03-06T10:00:00Z")).toISOString()).toBe("2026-03-09T09:00:00.000Z"); // Friday after → next Monday
    expect(nextRunAfter(spec, new Date("2026-03-03T00:00:00Z")).toISOString()).toBe("2026-03-06T09:00:00.000Z");
  });

  it("describes schedules in words", () => {
    expect(describeSchedule({ frequency: "interval", everyMinutes: 120, timezone: "UTC" })).toBe("Every 2 hours");
    expect(describeSchedule({ frequency: "interval", everyMinutes: 45, timezone: "UTC" })).toBe("Every 45 minutes");
    expect(describeSchedule({ frequency: "daily", time: "08:00", timezone: "UTC" })).toBe("Every day at 08:00");
    expect(describeSchedule({ frequency: "weekly", time: "09:30", days: [1, 3], timezone: "UTC" })).toBe("Mon, Wed at 09:30");
  });
});
