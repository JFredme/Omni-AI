import { describe, expect, it } from "vitest";
import { parseClock, sanitizeSchedule, type ScheduleContext } from "./schedule-plan";

const base: ScheduleContext = {
  tasks: [
    { id: "t1", title: "Write report", priority: "high", dueDate: "2026-03-05" },
    { id: "t2", title: "Email Sam", priority: "low", dueDate: null },
    { id: "t3", title: "Plan trip", priority: "medium", dueDate: null },
  ],
  busy: [],
  from: "2026-03-02", // a Monday
  days: 3,
  timezone: "UTC",
  workStart: 9 * 60,
  workEnd: 17 * 60,
  now: new Date("2026-03-01T00:00:00Z"),
};
const run = (blocks: unknown[], over: Partial<ScheduleContext> = {}) =>
  sanitizeSchedule({ summary: "plan", blocks: blocks as never }, { ...base, ...over });
const block = (over: Record<string, unknown> = {}) => ({ taskId: "t1", date: "2026-03-02", start: "10:00", minutes: 60, reason: "because", ...over });

describe("parseClock", () => {
  it("reads 24-hour times only", () => {
    expect(parseClock("09:30")).toBe(570);
    expect(parseClock("9:05")).toBe(545);
    expect(parseClock("24:00")).toBeNull();
    expect(parseClock("9am")).toBeNull();
    expect(parseClock("10:75")).toBeNull();
  });
});

describe("sanitizeSchedule", () => {
  it("keeps a valid block and converts it to instants in the viewer's zone", () => {
    const result = run([block()], { timezone: "America/New_York" });
    expect(result.blocks).toHaveLength(1);
    expect(result.blocks[0]).toMatchObject({ taskId: "t1", title: "Write report", start: "2026-03-02T15:00:00.000Z", end: "2026-03-02T16:00:00.000Z" });
    expect(result.dropped).toBe(0);
  });

  it("drops unknown tasks, repeated tasks, bad dates, bad times, and dates outside the window", () => {
    const result = run([
      block({ taskId: "made-up" }),
      block({ taskId: "t1" }),
      block({ taskId: "t1", start: "13:00" }),
      block({ taskId: "t2", date: "2026-02-28" }),
      block({ taskId: "t2", date: "2026-03-06" }),
      block({ taskId: "t2", date: "tomorrow" }),
      block({ taskId: "t3", start: "ten" }),
      block({ taskId: "t3", minutes: "soon" }),
    ]);
    expect(result.blocks.map((b) => b.taskId)).toEqual(["t1"]);
    expect(result.dropped).toBe(7);
  });

  it("clamps the length, rounds it to five minutes, and keeps blocks inside working hours", () => {
    expect(run([block({ minutes: 5 })]).blocks[0].end).toBe("2026-03-02T10:15:00.000Z");
    expect(run([block({ minutes: 999 })]).blocks[0].end).toBe("2026-03-02T14:00:00.000Z");
    expect(run([block({ minutes: 62 })]).blocks[0].end).toBe("2026-03-02T11:00:00.000Z");
    // Asked for 06:00: moved to the start of the working day instead of before it.
    expect(run([block({ start: "06:00" })]).blocks[0].start).toBe("2026-03-02T09:00:00.000Z");
    // Doesn't fit before the end of the day.
    expect(run([block({ start: "16:30", minutes: 120 })]).blocks).toEqual([]);
  });

  it("never lands on top of existing events, nudging later the same day when there's room", () => {
    const busy = [{ start: new Date("2026-03-02T10:00:00Z"), end: new Date("2026-03-02T11:00:00Z") }];
    const result = run([block({ start: "10:00" })], { busy });
    expect(result.blocks[0].start).toBe("2026-03-02T11:00:00.000Z");
    const fullDay = [{ start: new Date("2026-03-02T09:00:00Z"), end: new Date("2026-03-02T17:00:00Z") }];
    expect(run([block()], { busy: fullDay }).blocks).toEqual([]);
  });

  it("never double-books two of its own blocks", () => {
    const result = run([block({ taskId: "t1", start: "10:00", minutes: 60 }), block({ taskId: "t2", start: "10:30", minutes: 60 })]);
    const [a, b] = result.blocks;
    expect(new Date(b.start).getTime()).toBeGreaterThanOrEqual(new Date(a.end).getTime());
  });

  it("won't schedule in the past", () => {
    const result = run([block({ start: "09:00" })], { now: new Date("2026-03-02T09:50:00Z") });
    expect(result.blocks[0].start).toBe("2026-03-02T10:00:00.000Z");
    expect(run([block()], { now: new Date("2026-03-02T23:00:00Z") }).blocks).toEqual([]);
  });

  it("returns blocks in time order and tolerates a missing list", () => {
    const result = run([block({ taskId: "t2", date: "2026-03-03", start: "09:00" }), block({ taskId: "t1", date: "2026-03-02", start: "15:00" })]);
    expect(result.blocks.map((b) => b.taskId)).toEqual(["t1", "t2"]);
    expect(sanitizeSchedule({}, base)).toEqual({ summary: "", blocks: [], dropped: 0 });
  });
});
