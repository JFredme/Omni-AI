import { describe, expect, it } from "vitest";
import { computeStats, milestoneState, progressPercent, sortMilestones } from "./logic";

describe("project logic", () => {
  it("computes percentages without dividing by zero", () => {
    expect(progressPercent(0, 0)).toBe(0);
    expect(progressPercent(1, 3)).toBe(33);
    expect(progressPercent(2, 3)).toBe(67);
    expect(progressPercent(4, 4)).toBe(100);
  });

  it("rolls tasks up into stats and counts only unfinished overdue tasks", () => {
    const stats = computeStats(
      [
        { status: "done", dueDate: "2026-06-01" },
        { status: "in_progress", dueDate: "2026-06-05" },
        { status: "todo", dueDate: "2026-06-20" },
        { status: "todo", dueDate: null },
      ],
      "2026-06-10",
    );
    expect(stats).toEqual({ total: 4, todo: 2, inProgress: 1, done: 1, overdue: 1, progress: 25 });
  });

  it("classifies milestones", () => {
    const today = "2026-06-10";
    expect(milestoneState({ completedAt: "2026-06-01T00:00:00Z", dueDate: "2026-05-01" }, today)).toBe("done");
    expect(milestoneState({ completedAt: null, dueDate: "2026-06-09" }, today)).toBe("overdue");
    expect(milestoneState({ completedAt: null, dueDate: "2026-06-10" }, today)).toBe("upcoming");
    expect(milestoneState({ completedAt: null, dueDate: null }, today)).toBe("open");
  });

  it("orders dated milestones first, soonest first", () => {
    const sorted = sortMilestones([
      { dueDate: null, createdAt: "2026-01-02" },
      { dueDate: "2026-09-01", createdAt: "2026-01-01" },
      { dueDate: "2026-07-01", createdAt: "2026-01-03" },
      { dueDate: null, createdAt: "2026-01-01" },
    ]);
    expect(sorted.map((m) => `${m.dueDate}|${m.createdAt}`)).toEqual([
      "2026-07-01|2026-01-03",
      "2026-09-01|2026-01-01",
      "null|2026-01-01",
      "null|2026-01-02",
    ]);
  });
});
