import { listRange } from "@/lib/calendar/service";
import { dateKeyIn, isValidTimeZone, zonedToUtc } from "@/lib/calendar/tz";
import { prisma } from "@/lib/db";
import { addDays, dateKeyToDate } from "@/lib/dates";
import { getUsageSummary } from "@/lib/usage";
import { countByDay, lastDays, median, round1, sum, sumByDay } from "./stats";
import type { AnalyticsDto, DayPoint } from "./types";

const DAY = 86_400_000;
const PRIORITIES = ["low", "medium", "high", "urgent"] as const;

const midnight = (key: string, timeZone: string) => {
  const [year, month, day] = key.split("-").map(Number);
  return zonedToUtc({ year, month, day, hour: 0, minute: 0, second: 0 }, timeZone);
};

export async function getAnalytics(input: { days: number; timeZone?: string; now?: Date }): Promise<AnalyticsDto> {
  const now = input.now ?? new Date();
  const timezone = input.timeZone && isValidTimeZone(input.timeZone) ? input.timeZone : "UTC";
  const days = Math.min(365, Math.max(1, input.days));
  const today = dateKeyIn(now, timezone);
  const keys = lastDays(today, days);
  const start = midnight(keys[0], timezone);
  const end = midnight(addDays(today, 1), timezone);

  const [createdTasks, completedTasks, openByPriority, doneByPriority, overdue, openByProject, doneByProject, usage, settings, occurrences, activity] = await Promise.all([
    prisma.task.findMany({ where: { parentId: null, createdAt: { gte: start } }, select: { createdAt: true } }),
    prisma.task.findMany({ where: { parentId: null, completedAt: { gte: start } }, select: { createdAt: true, completedAt: true } }),
    prisma.task.groupBy({ by: ["priority"], where: { parentId: null, status: { not: "done" } }, _count: true }),
    prisma.task.groupBy({ by: ["priority"], where: { parentId: null, completedAt: { gte: start } }, _count: true }),
    prisma.task.count({ where: { parentId: null, status: { not: "done" }, dueDate: { lt: dateKeyToDate(today) } } }),
    prisma.task.groupBy({ by: ["projectId"], where: { parentId: null, status: { not: "done" }, projectId: { not: null } }, _count: true }),
    prisma.task.groupBy({ by: ["projectId"], where: { parentId: null, completedAt: { gte: start }, projectId: { not: null } }, _count: true }),
    getUsageSummary(now, days),
    prisma.appSettings.findUnique({ where: { id: 1 }, select: { monthlyBudgetUsd: true } }),
    listRange(start, end).then((range) => range.occurrences),
    Promise.all([
      prisma.conversation.count({ where: { createdAt: { gte: start } } }),
      prisma.message.count({ where: { role: "user", createdAt: { gte: start } } }),
      prisma.note.count({ where: { createdAt: { gte: start } } }),
      prisma.knowledgeDocument.count({ where: { createdAt: { gte: start } } }),
      prisma.researchReport.count({ where: { createdAt: { gte: start } } }),
      prisma.calendarEvent.count({ where: { createdAt: { gte: start } } }),
      prisma.agentRun.groupBy({ by: ["status"], where: { parentRunId: null, createdAt: { gte: start } }, _count: true }),
      prisma.workflowRun.groupBy({ by: ["status"], where: { startedAt: { gte: start } }, _count: true }),
    ]),
  ]);

  const projectIds = [...new Set([...openByProject, ...doneByProject].map((row) => row.projectId).filter((id): id is string => Boolean(id)))];
  const projectNames = new Map((await prisma.project.findMany({ where: { id: { in: projectIds } }, select: { id: true, name: true } })).map((project) => [project.id, project.name]));
  const byProject = projectIds
    .map((id) => ({ name: projectNames.get(id) ?? "Unknown", open: openByProject.find((r) => r.projectId === id)?._count ?? 0, completed: doneByProject.find((r) => r.projectId === id)?._count ?? 0 }))
    .sort((a, b) => b.open + b.completed - (a.open + a.completed))
    .slice(0, 8);

  const created = countByDay(createdTasks.map((task) => task.createdAt), keys, timezone);
  const completed = countByDay(completedTasks.map((task) => task.completedAt!), keys, timezone);
  const daysToComplete = completedTasks.map((task) => Math.max(0, (task.completedAt!.getTime() - task.createdAt.getTime()) / DAY));
  const median$ = median(daysToComplete);

  const timed = occurrences.filter((o) => !o.allDay);
  const hours = (o: (typeof timed)[number]) => (Date.parse(o.end) - Date.parse(o.start)) / 3_600_000;
  const scheduledHoursByDay: DayPoint[] = sumByDay(timed.map((o) => ({ at: new Date(o.start), amount: hours(o) })), keys, timezone);
  const focusHoursByDay: DayPoint[] = sumByDay(timed.filter((o) => o.taskId).map((o) => ({ at: new Date(o.start), amount: hours(o) })), keys, timezone);

  const spendByDay = usage.daily.map((day) => ({ date: day.date, value: Math.round(day.costUsd * 100000) / 100000 }));
  const requestsByDay = usage.daily.map((day) => ({ date: day.date, value: day.requests }));
  const tally = (rows: { status: string; _count: number }[]) => Object.fromEntries(rows.map((row) => [row.status, row._count]));

  return {
    days,
    timezone,
    from: keys[0],
    to: today,
    tasks: {
      created,
      completed,
      totals: { created: sum(created), completed: sum(completed), open: openByPriority.reduce((total, row) => total + row._count, 0), overdue },
      medianDaysToComplete: median$ === null ? null : round1(median$),
      completedPerCreated: sum(created) > 0 ? Math.round((sum(completed) / sum(created)) * 100) : null,
      byPriority: PRIORITIES.map((priority) => ({ priority, open: openByPriority.find((r) => r.priority === priority)?._count ?? 0, completed: doneByPriority.find((r) => r.priority === priority)?._count ?? 0 })),
      byProject,
    },
    time: {
      scheduledHoursByDay,
      focusHoursByDay,
      totalScheduledHours: round1(sum(scheduledHoursByDay)),
      totalFocusHours: round1(sum(focusHoursByDay)),
    },
    ai: {
      spendByDay,
      requestsByDay,
      totals: { requests: usage.totals.requests, failedRequests: usage.totals.failedRequests, totalTokens: usage.totals.totalTokens, costUsd: usage.totals.costUsd, unknownCostRequests: usage.totals.unknownCostRequests },
      byModel: usage.byModel.slice(0, 8),
      month: { spendUsd: usage.month.spendUsd, budgetUsd: settings?.monthlyBudgetUsd ?? null },
    },
    activity: {
      conversations: activity[0],
      messagesSent: activity[1],
      notesCreated: activity[2],
      documentsAdded: activity[3],
      researchReports: activity[4],
      calendarEventsCreated: activity[5],
      agentRuns: tally(activity[6]),
      automationRuns: tally(activity[7]),
    },
  };
}
