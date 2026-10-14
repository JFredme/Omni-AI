import { describe, expect, it } from "vitest";
import { expandOccurrences, type Repeating } from "./recurrence";
import { zonedParts } from "./tz";

const event = (over: Partial<Repeating>): Repeating => ({
  startsAt: new Date("2026-01-05T14:00:00Z"), // Monday 09:00 in New York
  endsAt: new Date("2026-01-05T15:00:00Z"),
  allDay: false,
  timezone: "America/New_York",
  recurrence: null,
  exdates: [],
  ...over,
});
const keys = (rows: { key: string }[]) => rows.map((row) => row.key);
const range = (from: string, to: string) => [new Date(`${from}T00:00:00Z`), new Date(`${to}T00:00:00Z`)] as const;

describe("expandOccurrences", () => {
  it("returns a single event only when it overlaps the range", () => {
    const single = event({});
    expect(keys(expandOccurrences(single, ...range("2026-01-01", "2026-02-01")))).toEqual(["2026-01-05"]);
    expect(expandOccurrences(single, ...range("2026-02-01", "2026-03-01"))).toEqual([]);
  });

  it("repeats daily with an interval, and stops at COUNT", () => {
    const rows = expandOccurrences(event({ recurrence: { freq: "daily", interval: 2, count: 4 } }), ...range("2026-01-01", "2026-03-01"));
    expect(keys(rows)).toEqual(["2026-01-05", "2026-01-07", "2026-01-09", "2026-01-11"]);
  });

  it("stops at UNTIL, inclusive", () => {
    const rows = expandOccurrences(event({ recurrence: { freq: "daily", interval: 1, until: "2026-01-07" } }), ...range("2026-01-01", "2026-03-01"));
    expect(keys(rows)).toEqual(["2026-01-05", "2026-01-06", "2026-01-07"]);
  });

  it("repeats weekly on chosen days, never before the start", () => {
    const rows = expandOccurrences(event({ recurrence: { freq: "weekly", interval: 1, byDay: [1, 3, 5] } }), ...range("2026-01-01", "2026-01-17"));
    expect(keys(rows)).toEqual(["2026-01-05", "2026-01-07", "2026-01-09", "2026-01-12", "2026-01-14", "2026-01-16"]);
  });

  it("repeats every other week", () => {
    const rows = expandOccurrences(event({ recurrence: { freq: "weekly", interval: 2 } }), ...range("2026-01-01", "2026-02-10"));
    expect(keys(rows)).toEqual(["2026-01-05", "2026-01-19", "2026-02-02"]);
  });

  it("repeats monthly, skipping months that lack the day", () => {
    const jan31 = event({ startsAt: new Date("2026-01-31T14:00:00Z"), endsAt: new Date("2026-01-31T15:00:00Z"), recurrence: { freq: "monthly", interval: 1 } });
    expect(keys(expandOccurrences(jan31, ...range("2026-01-01", "2026-06-01")))).toEqual(["2026-01-31", "2026-03-31", "2026-05-31"]);
  });

  it("repeats yearly, skipping Feb 29 in non-leap years", () => {
    const leap = event({ startsAt: new Date("2024-02-29T14:00:00Z"), endsAt: new Date("2024-02-29T15:00:00Z"), recurrence: { freq: "yearly", interval: 1 } });
    expect(keys(expandOccurrences(leap, ...range("2024-01-01", "2029-01-01")))).toEqual(["2024-02-29", "2028-02-29"]);
  });

  it("keeps the same local time across a daylight-saving change", () => {
    const rows = expandOccurrences(event({ recurrence: { freq: "weekly", interval: 1 } }), ...range("2026-03-01", "2026-03-31"));
    expect(rows.length).toBeGreaterThanOrEqual(4);
    for (const row of rows) expect(zonedParts(row.start, "America/New_York")).toMatchObject({ hour: 9, minute: 0 });
    // The UTC time moves by an hour when the clocks change.
    expect(rows.find((r) => r.key === "2026-03-02")!.start.toISOString()).toBe("2026-03-02T14:00:00.000Z");
    expect(rows.find((r) => r.key === "2026-03-09")!.start.toISOString()).toBe("2026-03-09T13:00:00.000Z");
  });

  it("omits removed occurrences without changing the rest of the series", () => {
    const rows = expandOccurrences(event({ recurrence: { freq: "daily", interval: 1, count: 4 }, exdates: ["2026-01-06"] }), ...range("2026-01-01", "2026-02-01"));
    expect(keys(rows)).toEqual(["2026-01-05", "2026-01-07", "2026-01-08"]);
  });

  it("handles all-day events as whole dates, in any time zone", () => {
    const holiday = event({
      startsAt: new Date("2026-12-25T00:00:00Z"),
      endsAt: new Date("2026-12-26T00:00:00Z"),
      allDay: true,
      timezone: "Pacific/Auckland",
      recurrence: { freq: "yearly", interval: 1 },
    });
    const rows = expandOccurrences(holiday, ...range("2026-12-01", "2028-01-01"));
    expect(keys(rows)).toEqual(["2026-12-25", "2027-12-25"]);
    expect(rows[0].start.toISOString()).toBe("2026-12-25T00:00:00.000Z");
  });

  it("only returns occurrences inside the asked range, even far into a long series", () => {
    const daily = event({ recurrence: { freq: "daily", interval: 1 } });
    const rows = expandOccurrences(daily, ...range("2030-06-10", "2030-06-13"));
    expect(keys(rows)).toEqual(["2030-06-10", "2030-06-11", "2030-06-12"]);
  });

  it("counts occurrences from the series start, not from the range", () => {
    const capped = event({ recurrence: { freq: "daily", interval: 1, count: 10 } });
    expect(keys(expandOccurrences(capped, ...range("2026-01-12", "2026-02-01")))).toEqual(["2026-01-12", "2026-01-13", "2026-01-14"]);
  });

  it("includes an occurrence that began before the range and runs into it", () => {
    const overnight = event({ startsAt: new Date("2026-01-05T22:00:00Z"), endsAt: new Date("2026-01-06T04:00:00Z"), recurrence: { freq: "daily", interval: 1 } });
    expect(keys(expandOccurrences(overnight, new Date("2026-01-06T00:00:00Z"), new Date("2026-01-06T02:00:00Z")))).toEqual(["2026-01-05"]);
  });

  it("caps the number of occurrences returned", () => {
    expect(expandOccurrences(event({ recurrence: { freq: "daily", interval: 1 } }), ...range("2026-01-01", "2036-01-01"), 50)).toHaveLength(50);
  });
});
