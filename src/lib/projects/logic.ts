import type { MilestoneDto, ProjectStats } from "./types";

export function progressPercent(done: number, total: number): number {
  return total === 0 ? 0 : Math.round((done / total) * 100);
}

/** Rolls top-level task rows up into the numbers shown on a project card or dashboard. */
export function computeStats(tasks: { status: "todo" | "in_progress" | "done"; dueDate: string | null }[], today: string): ProjectStats {
  const stats: ProjectStats = { total: tasks.length, todo: 0, inProgress: 0, done: 0, overdue: 0, progress: 0 };
  for (const task of tasks) {
    if (task.status === "done") stats.done += 1;
    else if (task.status === "in_progress") stats.inProgress += 1;
    else stats.todo += 1;
    if (task.status !== "done" && task.dueDate && task.dueDate < today) stats.overdue += 1;
  }
  stats.progress = progressPercent(stats.done, stats.total);
  return stats;
}

export type MilestoneState = "done" | "overdue" | "upcoming" | "open";

export function milestoneState(milestone: Pick<MilestoneDto, "completedAt" | "dueDate">, today: string): MilestoneState {
  if (milestone.completedAt) return "done";
  if (milestone.dueDate && milestone.dueDate < today) return "overdue";
  return milestone.dueDate ? "upcoming" : "open";
}

/** Milestones with a date come first (soonest first); undated ones follow in creation order. */
export function sortMilestones<T extends Pick<MilestoneDto, "dueDate" | "createdAt">>(milestones: T[]): T[] {
  return [...milestones].sort((a, b) => {
    if (a.dueDate && b.dueDate) return a.dueDate.localeCompare(b.dueDate) || a.createdAt.localeCompare(b.createdAt);
    if (a.dueDate) return -1;
    if (b.dueDate) return 1;
    return a.createdAt.localeCompare(b.createdAt);
  });
}
