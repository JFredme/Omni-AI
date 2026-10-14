import { prisma } from "@/lib/db";
import { localDateKey } from "@/lib/dates";
import { listNotes } from "@/lib/notes/service";
import { listProjects } from "@/lib/projects/service";
import { listRuns } from "@/lib/agents/runs";
import { listTasks } from "@/lib/tasks/service";
import { listRange } from "@/lib/calendar/service";
import { isValidTimeZone, zonedToUtc } from "@/lib/calendar/tz";
import { addDays } from "@/lib/dates";
import { getMonthSpend } from "@/lib/usage";
import type { DashboardDto } from "./dashboard-types";

export async function getDashboard(today: string = localDateKey(), timeZone = "UTC"): Promise<DashboardDto> {
  const zone = isValidTimeZone(timeZone) ? timeZone : "UTC";
  const midnight = (key: string) => {
    const [year, month, day] = key.split("-").map(Number);
    return zonedToUtc({ year, month, day, hour: 0, minute: 0, second: 0 }, zone);
  };
  const [overdue, dueToday, inProgress, openCount, projects, notes, runs, spend, settings, conversations, schedule] = await Promise.all([
    listTasks({ due: "overdue", sort: "due" }, today),
    listTasks({ due: "today", sort: "priority" }, today),
    listTasks({ status: "in_progress", sort: "priority" }, today),
    prisma.task.count({ where: { parentId: null, status: { not: "done" } } }),
    listProjects({}, today),
    listNotes({}),
    listRuns({ limit: 5 }),
    getMonthSpend(),
    prisma.appSettings.findUnique({ where: { id: 1 }, select: { monthlyBudgetUsd: true } }),
    prisma.conversation.count(),
    listRange(midnight(today), midnight(addDays(today, 1))),
  ]);

  const slim = (task: (typeof overdue)[number]) => ({
    id: task.id,
    title: task.title,
    priority: task.priority,
    dueDate: task.dueDate,
    projectName: task.projectName,
    status: task.status,
  });

  return {
    today,
    counts: { open: openCount, overdue: overdue.length, dueToday: dueToday.length, inProgress: inProgress.length, conversations },
    overdue: overdue.slice(0, 6).map(slim),
    dueToday: dueToday.filter((task) => task.status !== "done").slice(0, 8).map(slim),
    inProgress: inProgress.slice(0, 6).map(slim),
    events: schedule.occurrences.map((o) => ({ id: `${o.eventId}-${o.key}`, title: o.title, start: o.start, end: o.end, allDay: o.allDay })).slice(0, 8),
    projects: projects.filter((project) => project.status === "active" || project.status === "planning").slice(0, 5).map((project) => ({
      id: project.id,
      name: project.name,
      dueDate: project.dueDate,
      progress: project.stats.progress,
      total: project.stats.total,
      done: project.stats.done,
      overdue: project.stats.overdue,
    })),
    notes: notes.slice(0, 5).map((note) => ({ id: note.id, title: note.title, excerpt: note.excerpt, updatedAt: note.updatedAt, pinned: note.pinned })),
    runs: runs.map((run) => ({ id: run.id, agentName: run.agentName, objective: run.objective, status: run.status, createdAt: run.createdAt })),
    spend: { monthUsd: spend.spendUsd, budgetUsd: settings?.monthlyBudgetUsd ?? null },
  };
}
