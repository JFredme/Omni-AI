import { describe, expect, it } from "vitest";
import { generateIcs, parseIcs, type IcsEvent } from "./ics";

const sample = [
  "BEGIN:VCALENDAR",
  "VERSION:2.0",
  "BEGIN:VEVENT",
  "UID:abc-1",
  "SUMMARY:Team sync\\, weekly",
  "DESCRIPTION:Line one\\nLine two\; with semicolon",
  "LOCATION:Room 4",
  "DTSTART;TZID=America/New_York:20260105T090000",
  "DTEND;TZID=America/New_York:20260105T093000",
  "RRULE:FREQ=WEEKLY;BYDAY=MO,WE;COUNT=6",
  "EXDATE;TZID=America/New_York:20260107T090000",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "UID:abc-2",
  "SUMMARY:Holiday",
  "DTSTART;VALUE=DATE:20261225",
  "DTEND;VALUE=DATE:20261226",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "UID:abc-3",
  "SUMMARY:Utc call",
  "DTSTART:20260301T150000Z",
  "DURATION:PT1H30M",
  "END:VEVENT",
  "END:VCALENDAR",
].join("\r\n");

describe("parseIcs", () => {
  const { events, warnings } = parseIcs(sample, "UTC");

  it("reads timed events with their zone, recurrence, and removed dates", () => {
    const sync = events[0];
    expect(sync).toMatchObject({ uid: "abc-1", title: "Team sync, weekly", location: "Room 4", timezone: "America/New_York", allDay: false });
    expect(sync.description).toBe("Line one\nLine two; with semicolon");
    expect(sync.startsAt.toISOString()).toBe("2026-01-05T14:00:00.000Z");
    expect(sync.endsAt.toISOString()).toBe("2026-01-05T14:30:00.000Z");
    expect(sync.recurrence).toEqual({ freq: "weekly", interval: 1, byDay: [1, 3], count: 6 });
    expect(sync.exdates).toEqual(["2026-01-07"]);
  });

  it("reads all-day events and durations", () => {
    expect(events[1]).toMatchObject({ title: "Holiday", allDay: true });
    expect(events[1].startsAt.toISOString()).toBe("2026-12-25T00:00:00.000Z");
    expect(events[1].endsAt.toISOString()).toBe("2026-12-26T00:00:00.000Z");
    expect(events[2].endsAt.getTime() - events[2].startsAt.getTime()).toBe(90 * 60_000);
  });

  it("has nothing to warn about for supported files", () => {
    expect(warnings).toEqual([]);
  });

  it("unfolds long lines", () => {
    const folded = "BEGIN:VEVENT\r\nUID:x\r\nSUMMARY:A very long\r\n  title that was folded\r\nDTSTART:20260101T000000Z\r\nEND:VEVENT";
    expect(parseIcs(folded, "UTC").events[0].title).toBe("A very long title that was folded");
  });

  it("skips events with no start and says so, and warns about repeat rules it can't honor", () => {
    const text = [
      "BEGIN:VEVENT", "SUMMARY:No time", "END:VEVENT",
      "BEGIN:VEVENT", "UID:r", "SUMMARY:Odd repeat", "DTSTART:20260101T100000Z", "RRULE:FREQ=HOURLY", "END:VEVENT",
      "BEGIN:VEVENT", "UID:s", "SUMMARY:Setpos", "DTSTART:20260101T100000Z", "RRULE:FREQ=MONTHLY;BYSETPOS=-1;BYDAY=FR", "END:VEVENT",
    ].join("\n");
    const result = parseIcs(text, "UTC");
    expect(result.events.map((e) => e.title)).toEqual(["Odd repeat", "Setpos"]);
    expect(result.events[0].recurrence).toBeNull();
    expect(result.warnings.join(" ")).toMatch(/Skipped "No time"/);
    expect(result.warnings.join(" ")).toMatch(/HOURLY/);
    expect(result.warnings.join(" ")).toMatch(/BYSETPOS/);
  });

  it("ignores garbage rather than crashing", () => {
    expect(parseIcs("not a calendar", "UTC")).toEqual({ events: [], warnings: [] });
    expect(parseIcs("", "UTC").events).toEqual([]);
  });
});

describe("generateIcs", () => {
  it("round-trips events through a file", () => {
    const original = parseIcs(sample, "UTC").events as IcsEvent[];
    const file = generateIcs(original, new Date("2026-01-01T00:00:00Z"));
    expect(file.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
    expect(file.endsWith("END:VCALENDAR\r\n")).toBe(true);
    const again = parseIcs(file, "America/New_York").events;
    expect(again).toHaveLength(3);
    expect(again[0].title).toBe("Team sync, weekly");
    expect(again[0].description).toBe("Line one\nLine two; with semicolon");
    expect(again[0].startsAt.toISOString()).toBe(original[0].startsAt.toISOString());
    expect(again[0].recurrence).toEqual(original[0].recurrence);
    expect(again[0].exdates).toEqual(["2026-01-07"]);
    expect(again[1].allDay).toBe(true);
    expect(again[1].startsAt.toISOString()).toBe(original[1].startsAt.toISOString());
  });

  it("escapes special characters and folds long lines", () => {
    const file = generateIcs([{ uid: "u", title: "A; B, C\\D", description: "x".repeat(200), location: "", startsAt: new Date("2026-01-01T10:00:00Z"), endsAt: new Date("2026-01-01T11:00:00Z"), allDay: false, timezone: "UTC", recurrence: null, exdates: [] }]);
    expect(file).toContain("SUMMARY:A\; B\\, C\\\\D");
    for (const line of file.split("\r\n")) expect(Buffer.byteLength(line)).toBeLessThanOrEqual(75);
    expect(parseIcs(file, "UTC").events[0].description).toBe("x".repeat(200));
  });
});
